import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { control, root } from "../../tools/scriptcat.mjs";

// Ego diagnostics name the page's URL and title (meeting, issue, or folder names).
// Keep failures to status text: drop URLs, titles, and anything the script printed.
export function redact(text) {
  return String(text)
    .replace(/last (URL|title) was "(?:[^"\\]|\\.)*"/g, "last $1 was <redacted>")
    .replace(/\b(?:https?|chrome-extension|file):\/\/[^\s"'<>)]+/g, "<url>");
}

// Use Ego's authenticated browser, not a separately launched Playwright profile.
export function egoRun(fn, data) {
  return new Promise((accept, reject) => {
    const source = `const run = ${fn.toString()};\nconst input = ${JSON.stringify(data)};\nconst result = await run(input);\nconsole.log("RESULT:" + JSON.stringify(result));`;
    const child = spawn("ego-browser", ["nodejs", "-e", source], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 60000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      const line = (stdout + "\n" + stderr)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.startsWith("RESULT:"));
      if (code !== 0 || !line)
        return reject(new Error(JSON.stringify({ code, stderr: redact(stderr) })));
      accept(JSON.parse(line.slice(7)));
    });
  });
}

// Returns the installed source hash. With `expected`, keeps re-reading until the
// manager has applied the sync (delivery has no acknowledgement) or times out.
export async function installed({ space, name, version, expected }) {
  const task = await taskSpace(space);
  // egoRun serializes this function alone, so module helpers are not in scope.
  const tab = (await task.tabs()).find((tab) =>
    /^chrome-extension:\/\/(ndcooeababalnlpkfedmmbbbgkljhpjf|jaehimmlecjmebpekkipmpmbpfhdacom)\/src\/options.html/.test(tab.url),
  );
  if (!tab)
    throw new Error("Keep the ScriptCat options page open in this task space");
  const page = tab.label ? task.page(tab.label) : await task.adopt(tab.page);
  const list = tab.url.split("#")[0];
  const deadline = Date.now() + 20000;
  let result;
  do {
    await page.goto(list);
    await page.waitForFunction(
      ({ name, version }) => {
        const exact = new RegExp("(^|[^\\d.])" + version.replace(/\./g, "\\.") + "($|[^\\d.])");
        return [...document.querySelectorAll("a")].some(
          (a) => a.textContent.trim() === name && exact.test(a.closest("tr")?.textContent || ""),
        );
      },
      { name, version },
      { timeout: 15000 },
    );
    const links = await page.evaluate(
      (name) =>
        [...document.querySelectorAll("a")]
          .filter((a) => a.textContent.trim() === name)
          .map((a) => a.href),
      name,
    );
    if (links.length !== 1)
      throw new Error(`Expected exactly one installed "${name}", found ${links.length}`);
    await page.goto(links[0]);
    await page.waitForSelector("loc=css:.monaco-editor", { state: "visible" });
    result = await page.evaluate(async () => {
      // ScriptCat 1.4's editor does not expose window.monaco. Read its loaded code prop;
      // this is diagnostic only, never an alternative route for installing a script.
      let source;
      for (
        let element = document.querySelector(".monaco-editor");
        element && !source;
        element = element.parentElement
      ) {
        const key = Object.keys(element).find((key) =>
          key.startsWith("__reactFiber"),
        );
        for (
          let fiber = key && element[key], depth = 0;
          fiber && depth < 12;
          fiber = fiber.return, depth++
        ) {
          if (fiber.memoizedProps?.code?.includes("==UserScript==")) {
            source = fiber.memoizedProps.code;
            break;
          }
        }
      }
      if (!source)
        throw new Error("Cannot read installed source from ScriptCat editor");
      const bytes = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(source),
      );
      return {
        hash: [...new Uint8Array(bytes)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join(""),
      };
    });
    if (!expected || result.hash === expected) break;
    await new Promise((accept) => setTimeout(accept, 500));
  } while (Date.now() < deadline);
  return result;
}

// Delete generated fixtures by exact name through the manager UI, including
// duplicates and copies left by an interrupted run. Never touches other scripts.
export async function uninstallFixture({ space, name }) {
  if (!name.startsWith("Userscripts ") || !name.includes("Fixture"))
    throw new Error("Only generated test fixtures may be removed");
  const task = await taskSpace(space);
  // egoRun serializes this function alone, so module helpers are not in scope.
  const tab = (await task.tabs()).find((tab) =>
    /^chrome-extension:\/\/(ndcooeababalnlpkfedmmbbbgkljhpjf|jaehimmlecjmebpekkipmpmbpfhdacom)\/src\/options.html/.test(tab.url),
  );
  if (!tab)
    throw new Error("Keep the ScriptCat options page open in this task space");
  const page = tab.label ? task.page(tab.label) : await task.adopt(tab.page);
  const list = tab.url.split("#")[0];
  let removed = 0;
  for (;;) {
    await page.goto(list);
    await page.waitForSelector("loc=css:table");
    const id = await page.evaluate((name) => {
      const link = [...document.querySelectorAll('a[href*="/script/editor/"]')].find(
        (a) => a.textContent.trim() === name,
      );
      return link?.href.split("/").pop() || null;
    }, name);
    if (!id) return { removed };
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid fixture identity");
    await page.click(`loc=css:tr:has(a[href$="/script/editor/${id}"]) .arco-btn-group > button`);
    await page.waitForSelector("loc=role:button[name=确定]");
    await page.click("loc=role:button[name=确定]");
    await page.waitForFunction(
      (id) => !document.querySelector(`a[href$="/script/editor/${id}"]`),
      id,
    );
    if (++removed > 5) throw new Error("Fixture removal did not converge");
  }
}

async function verify({ space, label, revision, create }) {
  const task = await taskSpace(space);
  const page = create ? await task.newPage() : task.page(label);
  try {
    if (create) await page.goto("http://127.0.0.1:8642/__fixture");
    else await page.reload();
    await page.waitForFunction(
      (revision) =>
        document.documentElement.dataset.scriptcatVersion === revision &&
        document.documentElement.dataset.gmRequest === "ok" &&
        window.__scriptcatFixtureVersion === revision,
      revision,
      { timeout: 15000 },
    );
    // Cross-site iframe must be inspected through its own CDP session.
    const targets = await task.cdp("Target.getTargets");
    const target = targets.targetInfos.find(
      (target) =>
        target.type === "iframe" &&
        target.parentId === page.targetId &&
        target.url.startsWith("http://localhost:8642/__fixture"),
    );
    if (!target) throw new Error("Cross-origin iframe target missing");
    const { sessionId } = await page.cdp("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: false,
    });
    let iframe;
    try {
      const expression = `(async()=>{for(let i=0;i<100;i++){if(document.documentElement.dataset.scriptcatVersion===${JSON.stringify(revision)}&&document.documentElement.dataset.gmRequest==='ok')return {revision:window.__scriptcatFixtureVersion,gm:document.documentElement.dataset.gmRequest};await new Promise(r=>setTimeout(r,100))}throw new Error('iframe userscript did not execute')})()`;
      await page.cdp("Target.sendMessageToTarget", {
        sessionId,
        message: JSON.stringify({
          id: 101,
          method: "Runtime.evaluate",
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      });
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        const event = (await page.events()).find(
          (event) =>
            event.method === "Target.receivedMessageFromTarget" &&
            event.params.sessionId === sessionId &&
            JSON.parse(event.params.message).id === 101,
        );
        if (event) {
          const message = JSON.parse(event.params.message);
          if (message.error || message.result.exceptionDetails)
            throw new Error("iframe evaluation failed");
          iframe = message.result.result.value;
          break;
        }
        await new Promise((accept) => setTimeout(accept, 100));
      }
      if (iframe?.revision !== revision || iframe?.gm !== "ok")
        throw new Error("iframe GM checks failed");
    } finally {
      await page.cdp("Target.detachFromTarget", { sessionId });
    }
    await page.click("loc=css:#automation-export");
    await page.waitForFunction(
      (revision) =>
        document.querySelector("[role=dialog]")?.textContent ===
        "Export modal " + revision,
      revision,
      { timeout: 5000 },
    );
    return {
      page: page.label,
      top: revision,
      iframe: iframe.revision,
      gm: "ok",
      modal: "ok",
    };
  } catch (error) {
    if (create) await page.close();
    throw error;
  }
}

async function main() {
  const space = Number(process.argv[2]);
  if (!Number.isInteger(space) || space < 1)
    throw new Error("Usage: npm run test:ego -- <ego-space-id>");
  const name = "Userscripts ScriptCat Sync E2E Fixture";
  let fixturePage, synced = false;
  const file = "tests/browser/.generated/live.user.js";
  try {
    if (!(await control("status")).connected)
      throw new Error("ScriptCat WebSocket is not connected");
    const template = (
      await readFile(resolve(root, "tests/browser/fixtures/automation.user.js"), "utf8")
    ).replace(
      "Userscripts ScriptCat Automation Fixture",
      name,
    );
    await mkdir(resolve(root, "tests/browser/.generated"), { recursive: true });
    await writeFile(resolve(root, file), template);
    synced = true;
    await control("sync", { file });
    const { createHash } = await import("node:crypto");
    const hash = (source) => createHash("sha256").update(source).digest("hex");
    const v1 = await egoRun(installed, { space, name, version: "1.0.0", expected: hash(template) });
    if (v1.hash !== hash(template))
      throw new Error("Installed v1 source differs from the local file");
    const first = await egoRun(verify, { space, revision: "v1", create: true });
    fixturePage = first.page;
    console.log(
      JSON.stringify({ stage: "v1", ...first, sourceHash: "matched" }),
    );
    const updated = template
      .replace("// @version      1.0.0", "// @version      1.0.1")
      .replace(/const version = (["'])v1\1;/, 'const version = "v2";');
    // An explicit second sync must update the same installation in place.
    await writeFile(resolve(root, file), updated);
    await control("sync", { file });
    const v2 = await egoRun(installed, { space, name, version: "1.0.1", expected: hash(updated) });
    if (v2.hash !== hash(updated))
      throw new Error("Installed v2 source differs from the updated file");
    const second = await egoRun(verify, {
      space,
      revision: "v2",
      label: fixturePage,
    });
    console.log(
      JSON.stringify({
        stage: "update-v2",
        ...second,
        sourceHash: "matched",
      }),
    );
  } finally {
    const errors = [];
    if (fixturePage)
      await egoRun(
        async ({ space, label }) => {
          const task = await taskSpace(space);
          await task.page(label).close();
          return { closed: label };
        },
        { space, label: fixturePage },
      ).catch((error) => errors.push(error));
    if (synced)
      await egoRun(uninstallFixture, { space, name }).catch((error) => errors.push(error));
    if (errors.length) throw new AggregateError(errors, "Fixture cleanup failed");
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
