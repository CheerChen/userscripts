import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { control, root } from "./scriptcat.mjs";
import { egoRun, installed } from "./ego-test.mjs";

const space = Number(process.argv[2]);
if (!Number.isInteger(space) || space < 1)
  throw new Error("Usage: npm --prefix dev run test:teams:entries -- <ego-space-id>");
const source = await readFile(resolve(root, "teams-transcript-extractor.user.js"), "utf8");
await control("sync", {file: "teams-transcript-extractor.user.js", watch: true});
const loaded = await egoRun(installed, {space, name: "Teams 会议转录提取器", version: source.match(/^\/\/\s*@version\s+(\S+)/m)[1]});
if (loaded.hash !== createHash("sha256").update(source).digest("hex"))
  throw new Error("Installed Teams source differs from repository");

const downloadDir = await mkdtemp(resolve(tmpdir(), "teams-export-test-"));
try {
const result = await egoRun(async ({space, downloadDir}) => {
  const task = await taskSpace(space);
  const tab = (await task.tabs()).find(tab => /^https:\/\/teams\.(cloud\.microsoft|microsoft\.com)\//.test(tab.url));
  if (!tab) throw new Error("Keep an authenticated Teams page open");
  const page = tab.label ? task.page(tab.label) : await task.adopt(tab.page);
  await page.reload();
  await page.waitForSelector('button[aria-label="会议回顾 (⌃ ⇧ 7)"]');
  await page.click('loc=css:button[aria-label="会议回顾 (⌃ ⇧ 7)"]');
  await page.waitForSelector('[data-teams-transcript-trigger="list"]');
  const selections = await page.evaluate(() => [...document.querySelectorAll('[data-tid="podcast-meeting-item"]')].map((item,index) => {
    item.dataset.entryTestIndex=String(index);
    const key = Object.keys(item).find(key => key.startsWith('__reactFiber$'));
    let fiber = item[key], meeting;
    for(let depth=0; fiber && depth<24; fiber=fiber.return,depth++) if(fiber.memoizedProps?.meeting){meeting=fiber.memoizedProps.meeting;break;}
    return {index,title:meeting?.subject,recordings:meeting?.recordings?.length || 0,hasButton:!!item.querySelector('[data-teams-transcript-trigger="list"]')};
  }).filter(item => item.hasButton));
  const target = selections.find(item => item.recordings);
  if (!target) throw new Error("Need a recap with recording and transcript");
  const origin = await page.url();
  async function checkModal(expectedTitle, downloadFiles=false) {
    await page.waitForSelector('[data-teams-transcript-result]');
    const result = await page.evaluate(() => {
      const dialog=document.querySelector('[data-teams-transcript-result]');
      return {title:dialog.getAttribute('aria-label'),count:Number(dialog.querySelector('pre').textContent.match(/(\d+) utterances \(complete, via API\)/)?.[1]),actions:[...dialog.querySelectorAll('button')].map(button=>button.textContent)};
    });
    if (result.title !== expectedTitle || !result.count || !['Copy TXT','Download TXT','Download JSON'].every(label=>result.actions.includes(label))) throw new Error('Export title, API count, or actions did not match');
    if(downloadFiles) {
      for(const [label,filename] of [['Download TXT','transcript.txt'],['Download JSON','transcript.json']]) {
        const pending=page.waitForEvent('download',{timeout:10000});
        await page.click(`loc=css:[data-teams-transcript-result] button:text-is("${label}")`);
        const download=await pending;
        await download.saveAs(`${downloadDir}/${filename}`);
      }
    }
    await page.click('loc=css:[data-teams-transcript-result] button[aria-label="Close"]');
    return {method:'api',utterances:result.count,title:'matched',actions:'ok'};
  }
  await page.click(`loc=css:[data-entry-test-index="${target.index}"] [data-teams-transcript-trigger="list"]`);
  const list = await checkModal(target.title);
  if(await page.url()!==origin || !(await page.evaluate(()=>!!document.querySelector('[data-tid="podcast-meeting-item"]')))) throw new Error('List export navigated away');
  // A second meeting verifies live selection rather than the previous API context.
  const second=selections.find(item=>item.title!==target.title && !item.recordings) || selections.find(item=>item.title!==target.title);
  if (!second) throw new Error('Need a second meeting to check selection isolation');
  await page.click(`loc=css:[data-entry-test-index="${second.index}"] [data-teams-transcript-trigger="list"]`);
  const other = await checkModal(second.title);
  await page.click(`loc=css:[data-entry-test-index="${target.index}"] button >> nth=3`);
  await page.waitForSelector('[data-teams-transcript-trigger="detail"]');
  const placement=await page.evaluate(()=>{
    const button=document.querySelector('[data-teams-transcript-trigger="detail"]');
    return document.querySelectorAll('[data-teams-transcript-trigger="detail"]').length===1 && button.previousElementSibling?.dataset.tid==='recap-open-in-stream-button' && !!button.parentElement.querySelector('[data-tid="recap-share-button"]');
  });
  if(!placement) throw new Error('Detail button missing, duplicated, or outside native toolbar');
  await page.click('loc=css:[data-teams-transcript-trigger="detail"]');
  const detail=await checkModal(target.title,true);
  if(detail.utterances!==list.utterances) throw new Error('Detail selected a different transcript');
  return {sourceHash:'matched',list:{...list,stayedOnList:true},otherMeeting:{...other,transcriptOnly:!second.recordings},detail:{...detail,toolbar:'adjacent',duplicates:0}};
}, {space, downloadDir});
const txt = await readFile(resolve(downloadDir, "transcript.txt"), "utf8");
const json = JSON.parse(await readFile(resolve(downloadDir, "transcript.json"), "utf8"));
if(json.method !== "api" || json.entries.filter(entry=>entry.kind==='speech').length !== result.detail.utterances || !txt.includes(json.title) || !txt.includes(`${result.detail.utterances} utterances`))
  throw new Error('Downloaded TXT/JSON did not match the modal');
console.log(JSON.stringify({...result,downloads:{txt:'verified',json:'verified'}}));
} finally {
  // Meeting data is checked only in a private temporary directory, never the repo.
  await rm(downloadDir, {recursive:true,force:true});
}
