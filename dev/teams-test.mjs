import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { control, root } from "./scriptcat.mjs";
import { egoRun, installed } from "./ego-test.mjs";

const space = Number(process.argv[2]);
if (!Number.isInteger(space) || space < 1)
  throw new Error("Usage: npm --prefix dev run test:teams -- <ego-space-id>");
const source = await readFile(
  resolve(root, "teams-transcript-extractor.user.js"),
  "utf8",
);
const version = source.match(/^\/\/\s*@version\s+(\S+)/m)[1];
await control("sync", {
  file: "teams-transcript-extractor.user.js",
  watch: true,
});
const loaded = await egoRun(installed, {
  space,
  name: "Teams 会议转录提取器",
  version,
});
if (loaded.hash !== createHash("sha256").update(source).digest("hex"))
  throw new Error("Installed Teams source differs from repository");

console.log(
  JSON.stringify(
    await egoRun(
      async ({ space }) => {
        const task = await taskSpace(space);
        const tab = (await task.tabs()).find((tab) =>
          /^https:\/\/teams\.(cloud\.microsoft|microsoft\.com)\//.test(tab.url),
        );
        if (!tab)
          throw new Error("Open a Teams meeting recap in this task space");
        const page = tab.label
          ? task.page(tab.label)
          : await task.adopt(tab.page);
        await page.url(); // Resolve the page's target before looking for descendants.
        const target = (await task.cdp("Target.getTargets")).targetInfos.find(
          (target) =>
            target.type === "iframe" &&
            target.parentId === page.targetId &&
            /\/_layouts\/15\/xplatplugins.aspx/.test(target.url),
        );
        if (!target)
          throw new Error("Current Teams page has no transcript recap iframe");
        const { sessionId } = await page.cdp("Target.attachToTarget", {
          targetId: target.targetId,
          flatten: false,
        });
        let id = 200;
        async function command(method, params, timeout = 10000) {
          const requestId = ++id;
          await page.cdp("Target.sendMessageToTarget", {
            sessionId,
            message: JSON.stringify({ id: requestId, method, params }),
          });
          const deadline = Date.now() + timeout;
          while (Date.now() < deadline) {
            const event = (await page.events()).find(
              (event) =>
                event.method === "Target.receivedMessageFromTarget" &&
                event.params.sessionId === sessionId &&
                JSON.parse(event.params.message).id === requestId,
            );
            if (event) {
              const message = JSON.parse(event.params.message);
              if (message.error || message.result?.exceptionDetails)
                throw new Error(
                  JSON.stringify(
                    message.error || message.result.exceptionDetails,
                  ),
                );
              return message.result;
            }
            await new Promise((accept) => setTimeout(accept, 100));
          }
          throw new Error(`${method} timed out`);
        }
        try {
          // Real document navigation lets ScriptCat own @match, sandbox, and @run-at.
          const oldOrigin = (
            await command("Runtime.evaluate", {
              expression: "performance.timeOrigin",
              returnByValue: true,
            })
          ).result.value;
          await command("Runtime.evaluate", {
            expression: "setTimeout(() => location.reload(), 0); true",
            returnByValue: true,
          });
          const navigationDeadline = Date.now() + 10000;
          let navigated = false;
          while (Date.now() < navigationDeadline) {
            try {
              const probe = await command("Runtime.evaluate", {
                expression: "performance.timeOrigin",
                returnByValue: true,
              });
              if (probe.result.value !== oldOrigin) {
                navigated = true;
                break;
              }
            } catch (error) {
              if (!/context|navigation/i.test(error.message)) throw error;
            }
            await new Promise((accept) => setTimeout(accept, 100));
          }
          if (!navigated) throw new Error("Recap iframe did not reload");
          const result = await command(
            "Runtime.evaluate",
            {
              expression: `(async()=>{
        const deadline=Date.now()+45000;
        let button;
        while(Date.now()<deadline){
          button=[...document.querySelectorAll('button')].find(button=>/^(提取转录|提取轉錄|文字起こし|Transcript)$/.test(button.textContent.trim()));
          if(button)break;
          await new Promise(accept=>setTimeout(accept,250));
        }
        if(!button)throw new Error('ScriptCat did not render the transcript trigger');
        button.click();
        const exportDeadline=Date.now()+10000;
        while(Date.now()<exportDeadline){
          const dialog=document.querySelector('[role=dialog]');
          const text=dialog?.querySelector('pre')?.textContent;
          if(text){
            const count=text.match(/(\\d+) utterances \\(complete, via API\\)/)?.[1];
            if(!count)throw new Error('Export did not complete via API');
            const hasActions=['Copy TXT','Download TXT','Download JSON'].every(label=>[...dialog.querySelectorAll('button')].some(button=>button.textContent===label));
            if(!hasActions)throw new Error('Export actions missing');
            dialog.querySelector('button[aria-label=Close]').click();
            return {method:'api',utterances:Number(count),modal:'ok',actions:'ok',frame:'xplatplugins.aspx'};
          }
          await new Promise(accept=>setTimeout(accept,100));
        }
        throw new Error('Export modal did not appear');
      })()`,
              awaitPromise: true,
              returnByValue: true,
            },
            56000,
          );
          return { ...result.result.value, sourceHash: "matched" };
        } finally {
          await page.cdp("Target.detachFromTarget", { sessionId });
        }
      },
      { space },
    ),
  ),
);
