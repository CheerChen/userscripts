import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { control, root } from "./scriptcat.mjs";

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
        return reject(new Error(JSON.stringify({ code, stderr, stdout })));
      accept(JSON.parse(line.slice(7)));
    });
  });
}

export async function installed({ space, name, version }) {
  const task = await taskSpace(space);
  const tab = (await task.tabs()).find((tab) =>
    /chrome-extension:\/\/(ndcooeababalnlpkfedmmbbbgkljhpjf|jaehimmlecjmebpekkipmpmbpfhdacom)\/src\/options.html/.test(
      tab.url,
    ),
  );
  if (!tab)
    throw new Error("Keep the ScriptCat options page open in this task space");
  const page = tab.label ? task.page(tab.label) : await task.adopt(tab.page);
  await page.goto(tab.url.split("#")[0]);
  await page.waitForFunction(
    ({ name, version }) =>
      [...document.querySelectorAll("tr")].some(
        (row) =>
          row.textContent.includes(name) && row.textContent.includes(version),
      ),
    { name, version },
    { timeout: 15000 },
  );
  const link = await page.evaluate(
    (name) =>
      [...document.querySelectorAll("a")].find(
        (a) => a.textContent.trim() === name,
      )?.href,
    name,
  );
  if (!link) throw new Error("Installed script has no editor link");
  await page.goto(link);
  await page.waitForSelector("loc=css:.monaco-editor", { state: "visible" });
  return await page.evaluate(async () => {
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
      page: location.href,
    };
  });
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
    throw new Error("Usage: npm --prefix dev run test:ego -- <ego-space-id>");
  let fixturePage;
  const file = "dev/.generated/live.user.js";
  try {
    if (!(await control("status")).connected)
      throw new Error("ScriptCat WebSocket is not connected");
    const template = (
      await readFile(resolve(root, "dev/fixtures/automation.user.js"), "utf8")
    ).replace(
      "Userscripts ScriptCat Automation Fixture",
      "Userscripts ScriptCat Watched E2E Fixture",
    );
    const name = "Userscripts ScriptCat Watched E2E Fixture";
    await mkdir(resolve(root, "dev/.generated"), { recursive: true });
    await writeFile(resolve(root, file), template);
    await control("sync", { file, watch: true });
    const { createHash } = await import("node:crypto");
    const hash = (source) => createHash("sha256").update(source).digest("hex");
    const v1 = await egoRun(installed, { space, name, version: "1.0.0" });
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
    // Write a generated test artifact; the watcher alone must deliver this update.
    const beforeUpdate = (await control("status")).lastSent.at;
    await writeFile(resolve(root, file), updated);
    const deadline = Date.now() + 10000;
    while (
      (await control("status")).lastSent.at === beforeUpdate &&
      Date.now() < deadline
    )
      await new Promise((accept) => setTimeout(accept, 100));
    if ((await control("status")).lastSent.at === beforeUpdate)
      throw new Error("Watcher did not send the update");
    const v2 = await egoRun(installed, { space, name, version: "1.0.1" });
    if (v2.hash !== hash(updated))
      throw new Error("Installed v2 source differs from the watched file");
    const second = await egoRun(verify, {
      space,
      revision: "v2",
      label: fixturePage,
    });
    console.log(
      JSON.stringify({
        stage: "watch-update-v2",
        ...second,
        sourceHash: "matched",
      }),
    );
  } finally {
    await control("unwatch", { file }).catch(() => {});
    if (fixturePage)
      await egoRun(
        async ({ space, label }) => {
          const task = await taskSpace(space);
          await task.page(label).close();
          return { closed: label };
        },
        { space, label: fixturePage },
      );
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
