import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { control, root } from "../../tools/scriptcat.mjs";
import { egoRun, installed, uninstallFixture } from "./ego-test.mjs";
import { clipboardText, clearClipboardForTest, withMacClipboard } from "./clipboard-guard.mjs";
import { inIframe } from "./iframe.mjs";

const space = Number(process.argv[2]);
if (!Number.isInteger(space) || space < 1)
  throw new Error("Usage: npm run test:atlassian -- <ego-space-id>");
if (!process.argv.includes("--clipboard-preserved")) {
  console.log((await withMacClipboard(process.execPath, [fileURLToPath(import.meta.url), String(space), "--clipboard-preserved"])).trim());
} else {
  await main();
}

async function main() {
  const source = await readFile(resolve(root, "confluence-jira-title-copy.user.js"), "utf8");
  const fixture = "tests/browser/.generated/atlassian.user.js";
  let fixturePage, real, fixtureSynced = false;
  const fixtureName = "Userscripts Atlassian Browser Fixture";
  const hash = value => createHash("sha256").update(value).digest("hex");
  const markdown = (title, url) => '[' + title.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]') + '](' + url.replace(/\(/g, '%28').replace(/\)/g, '%29') + ')';
  async function copied(label, expected, selector = "#customCopyButton") {
    await clearClipboardForTest();
    const click = await egoRun(async ({space, label, selector}) => {
      const page = (await taskSpace(space)).page(label);
      await page.cdp("Page.bringToFront");
      await page.waitForFunction(()=>document.hasFocus(),undefined,{timeout:5000});
      await page.waitForFunction(async selector => {
        if(!document.querySelector(selector)) return true; // Cross-site child is checked separately.
        let previous='', stable=0;
        const deadline=Date.now()+5000;
        while(Date.now()<deadline) {
          const button=document.querySelector(selector);
          if(button) {
            const rect=button.getBoundingClientRect(), hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
            const position=[rect.x,rect.y,rect.width,rect.height].join(',');
            stable=position===previous && (hit===button || button.contains(hit)) ? stable+1 : 0;
            previous=position;
            if(stable>=4) return true;
          }
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        return false;
      },selector,{timeout:10000});
      await page.click("loc=css:" + selector);
      return await page.evaluate(()=>({feedback:document.querySelector('#copyFeedback')?.textContent || 'no feedback',buttons:document.querySelectorAll('#customCopyButton').length}));
    }, {space, label, selector});
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if ((await clipboardText()) === expected) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const actual = await clipboardText();
    const status = await egoRun(async ({space,label}) => (await taskSpace(space)).page(label).evaluate(()=>({feedback:document.querySelector('#copyFeedback')?.textContent || 'no feedback'})), {space,label});
    throw new Error("Clipboard mismatch: " + JSON.stringify({actualLength:actual.length,expectedLength:expected.length,click,...status}));
  }
  try {
    await control("sync", {file: "confluence-jira-title-copy.user.js"});
    const loaded = await egoRun(installed, {space, name: "Confluence Jira 复制标题和链接", version: source.match(/^\/\/\s*@version\s+(\S+)/m)[1], expected: hash(source)});
    if (loaded.hash !== hash(source)) throw new Error("Installed production source mismatch");
    real = await egoRun(async ({space}) => {
      const task = await taskSpace(space);
      const tab = (await task.tabs()).find(tab => /\.atlassian\.net\/browse\/[A-Z][A-Z0-9]*-\d+/i.test(tab.url));
      if (!tab) throw new Error("Keep an authenticated Jira issue open in the authorized space");
      const page = tab.label ? task.page(tab.label) : await task.adopt(tab.page);
      const original = await page.url();
      const timeOrigin = await page.evaluate(()=>performance.timeOrigin);
      await page.reload();
      await page.waitForFunction(previous=>performance.timeOrigin!==previous,timeOrigin,{timeout:15000});
      await page.waitForLoadState('load');
      await page.waitForSelector("#customCopyButton");
      await page.waitForSelector('h1[data-testid="issue.views.issue-base.foundation.summary.heading"]');
      const state = await page.evaluate(() => {
        const title = document.querySelector('h1[data-testid="issue.views.issue-base.foundation.summary.heading"]').textContent.trim().replace(/\s+/g, ' ');
        const links = [...document.querySelectorAll('a[href]')].map(a=>a.href);
        const other = links.find(href=>new URL(href).origin===location.origin && /\/browse\/[A-Z][A-Z0-9]*-\d+$/i.test(new URL(href).pathname) && new URL(href).pathname!==location.pathname);
        const wiki = links.find(href=>/\.atlassian\.net$/.test(new URL(href).hostname) && /\/wiki\/.*(pages\/\d+|viewpage\.action)/.test(new URL(href).pathname));
        return {title, url:location.origin+location.pathname, other, wiki,
          buttons:document.querySelectorAll('#customCopyButton').length,
          insideEditor:!!document.querySelector('#customCopyButton').closest('form')};
      });
      if(state.buttons!==1 || state.insideEditor) throw new Error("Real page entry is duplicated or inside the title editor");
      return {...state, label:page.label, original};
    }, {space});
    await copied(real.label, markdown(real.title, real.url));
    let navigation = "not available";
    if (real.other) {
      const next = await egoRun(async ({space,label,url,previousTitle}) => {
        const page=(await taskSpace(space)).page(label);
        // Follow a real read-only issue link; do not open any edit controls.
        await page.click('loc=href:' + new URL(url).pathname + ' >> nth=0');
        await page.waitForFunction(({url,previousTitle})=>location.pathname===new URL(url).pathname &&
          !!document.querySelector('h1[data-testid="issue.views.issue-base.foundation.summary.heading"]')?.textContent.trim() &&
          document.querySelector('h1[data-testid="issue.views.issue-base.foundation.summary.heading"]').textContent.trim().replace(/\s+/g,' ')!==previousTitle,
          {url,previousTitle}, {timeout:15000});
        await page.waitForSelector('#customCopyButton');
        return await page.evaluate(()=>({title:document.querySelector('h1[data-testid="issue.views.issue-base.foundation.summary.heading"]').textContent.trim().replace(/\s+/g,' '),url:location.origin+location.pathname}));
      }, {space,label:real.label,url:real.other,previousTitle:real.title});
      await copied(real.label, markdown(next.title,next.url));
      navigation="verified";
    }
    let wiki = 'not available';
    if (real.wiki) {
      const state = await egoRun(async ({space,label,url})=>{
        const page=(await taskSpace(space)).page(label);
        await page.goto(url);
        await page.waitForSelector('#customCopyButton');
        return await page.evaluate(()=>{
          const heading=document.querySelector('#title-text, h1[data-testid="page-title"], h1[data-test-id="content-title"], #main-content h1');
          if(!heading?.textContent.trim()) throw new Error('Real wiki page has no independently readable title');
          const link=new URL(document.querySelector('link[rel=canonical]')?.href || location.href);
          link.hash='';
          for(const key of [...link.searchParams.keys()]) if(key!=='pageId') link.searchParams.delete(key);
          return {title:heading.textContent.trim().replace(/\s+/g,' '),url:link.href};
        });
      },{space,label:real.label,url:real.wiki});
      await copied(real.label,markdown(state.title,state.url));
      wiki='verified';
    }

    const fixtureSource = source.replace(/^\/\/ (@name(?::[^\s]+)?)\s+.*$/gm, "// $1         " + fixtureName)
      .replace(/^\/\/ @(updateURL|downloadURL)\s+.*\n?/gm, "")
      .replace("// @match        *://*.atlassian.net/*", "// @match        http://127.0.0.1:8642/__fixture/atlassian/*\n// @match        http://localhost:8642/__fixture/atlassian/*");
    await mkdir(resolve(root,"tests/browser/.generated"),{recursive:true});
    await writeFile(resolve(root,fixture),fixtureSource);
    fixtureSynced = true;
    await control("sync",{file:fixture});
    const loadedFixture=await egoRun(installed,{space,name:fixtureName,version:source.match(/^\/\/\s*@version\s+(\S+)/m)[1],expected:hash(fixtureSource)});
    if(loadedFixture.hash!==hash(fixtureSource)) throw new Error("Installed fixture source mismatch");
    fixturePage=await egoRun(async ({space})=>{
      const page=await (await taskSpace(space)).newPage();
      await page.goto("http://127.0.0.1:8642/__fixture/atlassian/jira?selectedIssue=DEMO-1");
      await page.waitForSelector('#customCopyButton');
      return page.label;
    },{space});
    await copied(fixturePage,markdown("Demo issue [one]","http://127.0.0.1:8642/browse/DEMO-1"));
    await egoRun(async ({space,label})=>{
      const page=(await taskSpace(space)).page(label);
      await page.evaluate(()=>{
        const heading=document.querySelector('h1'), replacement=heading.cloneNode(false);
        replacement.textContent="Demo issue two";
        heading.replaceWith(replacement);
        history.pushState(null,"","?selectedIssue=DEMO-2");
        document.querySelector('[data-title-copy-toolbar]').remove();
      });
      await page.waitForSelector('#customCopyButton');
      return {remounted:true};
    },{space,label:fixturePage});
    await copied(fixturePage,markdown("Demo issue two","http://127.0.0.1:8642/browse/DEMO-2"));
    await copied(fixturePage,"DEMO-2 Demo issue two","#customCopyFilenameButton");
    await egoRun(async ({space,label})=>{
      const page=(await taskSpace(space)).page(label);
      await page.evaluate(()=>{
        const dialog=document.createElement('div'), heading=document.querySelector('h1').cloneNode(false);
        dialog.setAttribute('role','dialog');
        heading.textContent='Demo issue dialog';
        dialog.append(heading);
        document.body.append(dialog);
        history.pushState(null,'','?selectedIssue=DEMO-3');
      });
      await page.waitForFunction(()=>!!document.querySelector('[role=dialog] #customCopyButton'));
      return true;
    },{space,label:fixturePage});
    await copied(fixturePage,markdown('Demo issue dialog','http://127.0.0.1:8642/browse/DEMO-3'));
    await egoRun(async ({space,label})=>{
      const page=(await taskSpace(space)).page(label);
      await page.goto("http://127.0.0.1:8642/__fixture/atlassian/wiki/spaces/DEMO/pages/1?mode=same");
      await page.waitForSelector('#customCopyButton');
      const state=await page.evaluate(()=>({count:document.querySelectorAll('#customCopyButton').length,placement:document.querySelector('[data-title-copy-toolbar]').dataset.placement}));
      if(state.count!==1 || state.placement!=="floating") throw new Error("Nested same-origin frame entry is missing or duplicated");
      return state;
    },{space,label:fixturePage});
    await copied(fixturePage,markdown("Demo wiki [one]","http://127.0.0.1:8642/__fixture/atlassian/wiki/spaces/DEMO/pages/1"));
    await egoRun(async ({space,label})=>{
      const page=(await taskSpace(space)).page(label);
      await page.goto("http://127.0.0.1:8642/__fixture/atlassian/wiki/spaces/DEMO/pages/1?mode=blank");
      await page.waitForSelector('#customCopyButton');
      return true;
    },{space,label:fixturePage});
    await copied(fixturePage,markdown("Demo wiki [one]","http://127.0.0.1:8642/__fixture/atlassian/wiki/spaces/DEMO/pages/1"));
    await egoRun(async ({space,label})=>{
      const page=(await taskSpace(space)).page(label);
      await page.goto("http://127.0.0.1:8642/__fixture/atlassian/wiki/spaces/DEMO/pages/1?mode=cross");
      return {navigated:true};
    },{space,label:fixturePage});
    await egoRun(inIframe,{space,label:fixturePage,path:"/__fixture/atlassian/",expression:`(async()=>{const deadline=Date.now()+10000;while(Date.now()<deadline){if(document.querySelector('#customCopyButton'))return true;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Fixture entry missing')})()`});
    await copied(fixturePage,markdown("Demo wiki [one]","http://localhost:8642/__fixture/atlassian/wiki/spaces/DEMO/pages/1"));
    console.log(JSON.stringify({sourceHash:"matched",realJira:{clipboard:"verified",navigation},realWiki:wiki,synthetic:{spa:"verified",remount:"verified",filename:"verified",dialogSelection:"verified",nestedSameOrigin:"verified",srcdoc:"verified",crossSite:"verified"},clipboard:"restored by guard"}));
  } finally {
    const errors=[];
    if(fixturePage) await egoRun(async ({space,label})=>{await (await taskSpace(space)).page(label).close();return true;},{space,label:fixturePage}).catch(error=>errors.push(error));
    if(real) await egoRun(async ({space,label,url})=>{const page=(await taskSpace(space)).page(label);await page.goto(url);return true;},{space,label:real.label,url:real.original}).catch(error=>errors.push(error));
    // Leave no generated fixture installed in ScriptCat.
    if(fixtureSynced) await egoRun(uninstallFixture,{space,name:fixtureName}).catch(error=>errors.push(error));
    if(errors.length) throw new AggregateError(errors,"Atlassian test cleanup failed");
  }
}
