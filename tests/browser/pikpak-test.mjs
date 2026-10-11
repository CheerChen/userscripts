import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {control, root} from '../../tools/scriptcat.mjs';
import {egoRun, installed, uninstallFixture} from './ego-test.mjs';

const space = Number(process.argv[2]);
if (!Number.isInteger(space) || space < 1) throw new Error('Usage: npm run test:pikpak -- <space-id>');
const records = [];
let failOnce = '', gate = null, scanFailure = false, connectionFailure = false;
const item = (id, name, folder = false) => ({id, name, kind: folder ? 'drive#folder' : 'drive#file'});
const files = [item('f-one','One.txt'), item('f-two','Two.txt'), item('d-root','Folder',true), item('f-nested','Nested.txt'), item('f-more','More.txt'), item('d-sub','Sub',true), item('f-deep','Deep.txt')];
// Holds every addUri until release(), so Stop/selection changes happen mid-request.
const holdRpc = () => {let release;const held=new Promise(resolve=>{release=resolve;});gate={held,release:()=>{gate=null;release();}};};
const json = (res, value, status = 200) => {res.writeHead(status, {'content-type':'application/json'});res.end(JSON.stringify(value));};
const server = http.createServer(async (req,res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/jsonrpc') {
    let body = ''; for await (const chunk of req) body += chunk;
    const call = JSON.parse(body);
    if (call.method === 'aria2.getVersion') return json(res,connectionFailure?{jsonrpc:'2.0',id:call.id,error:{code:1,message:'Fixture connection failed'}}:{jsonrpc:'2.0',id:call.id,result:{version:'fixture'}});
    if (call.method !== 'aria2.addUri') return json(res,{error:{message:'Unsupported fixture method'}});
    // Memory only. Real signed links are never logged, saved, or downloaded.
    records.push(call);
    if (gate) await gate.held; // Held until the test releases it; no timing race.
    const uri = call.params.at(-2)[0];
    if (failOnce && uri.endsWith('/'+failOnce)) {failOnce='';return json(res,{jsonrpc:'2.0',id:call.id,error:{code:1,message:'Fixture rejected'}});}
    return json(res,{jsonrpc:'2.0',id:call.id,result:'fixture-gid-'+records.length});
  }
  if (url.pathname === '/drive/v1/files') {
    if (scanFailure) return json(res,{error:'fixture-scan-error'},503);
    const parent=url.searchParams.get('parent_id'), token=url.searchParams.get('page_token');
    if (parent==='d-root') return json(res, token ? {files:[files[3],files[4],files[5]]} : {files:[files[3]],next_page_token:'second'});
    if (parent==='d-sub') return json(res,{files:[files[6]]});
    return json(res,{files:[]});
  }
  if (url.pathname.startsWith('/drive/v1/files/')) {
    const f=files.find(f=>f.id===url.pathname.split('/').pop());
    return json(res,f?{...f,web_content_link:'https://downloads.example.test/'+f.id}:{error:'missing'},f?200:404);
  }
  if (url.pathname.startsWith('/drive/')) {
    const html=`<!doctype html><html><head><title>PikPak public fixture</title><style>li.row{padding:12px;list-style:none}.context-menu{display:none}.context-menu.show{display:block}.file-operations{display:flex;gap:20px}.pp-checkbox{display:inline-block;width:20px;height:20px;border:1px solid gray}</style></head><body><div id="app"><div class="list-wrap grid"><ol>${files.slice(0,3).map(f=>`<li id="${f.id}" class="row grid ${f.kind==='drive#folder'?'folder':''}" data-file-event><span class="pp-checkbox"></span> ${f.name}</li>`).join('')}</ol></div><div class="file-explorer-operation-box"><ul class="file-operations"><li>Native operation</li></ul></div></div><div><ul class="context-menu"><li data-group="core">Native menu item</li></ul></div><script>
      const header=document.createElement('div');header.className='header-bar-right';header.innerHTML='<button class="setting-icon">Gear</button><div class="menu-popover"><ul class="menu"><li>Settings</li></ul></div>';document.body.prepend(header);
      const all=${JSON.stringify(files)},store={selectedIds:[],getFileById:id=>all.find(f=>f.id===id)};
      document.querySelector('#app').__vue_app__={config:{globalProperties:{$pinia:{_s:new Map([['file',store]])}}}};
      window.fixtureSelect=ids=>{store.selectedIds=ids;document.querySelectorAll('li.row').forEach(n=>n.classList.toggle('selected',ids.includes(n.id)))};
      document.querySelectorAll('li.row').forEach(row=>{row.addEventListener('click',e=>{const ids=e.metaKey?[...new Set([...store.selectedIds,row.id])]:[row.id];fixtureSelect(ids)});row.addEventListener('contextmenu',e=>{e.preventDefault();if(!store.selectedIds.includes(row.id))fixtureSelect([row.id]);document.querySelector('.context-menu').classList.add('show')})});
      document.addEventListener('click',e=>{if(!e.target.closest('.context-menu'))document.querySelector('.context-menu').classList.remove('show')});
      localStorage.setItem('credentials_fixture',JSON.stringify({token_type:'Bearer',access_token:'public-fixture-token'}));
    </script></body></html>`;
    res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});res.end(html);return;
  }
  res.writeHead(404);res.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const source=await readFile(resolve(root,'pikpak-aria2-helper.user.js'),'utf8');
const version=source.match(/^\/\/ @version\s+(\S+)/m)[1];
// ScriptCat refuses an update whose localized @description is empty for a locale it already has.
const locales=key=>[...source.matchAll(new RegExp('^// @'+key+':(\\S+)[ \\t]+\\S','gm'))].map(m=>m[1]).sort();
assert.deepEqual(locales('description'),locales('name'),'Every localized @name needs a non-empty localized @description');
const hash=value=>createHash('sha256').update(value).digest('hex');
let real, fixturePage, fixtureSynced = false, testError;
const fixtureName='Userscripts PikPak Browser Fixture', fixtureFile='tests/browser/.generated/pikpak.user.js';

async function configure(label, value) {
  return egoRun(async ({space,label,value})=>{
    const p=(await taskSpace(space)).page(label);
    if(!await p.evaluate(()=>!!document.querySelector('#pikpak-aria2-settings'))) {if(!await p.evaluate(()=>!!document.querySelector('[data-pah-config=gear] a')?.getClientRects().length))await p.click('loc=css:.header-bar-right .setting-icon');await p.click('loc=css:[data-pah-config=gear] a');}
    await p.waitForFunction(()=>document.activeElement?.getAttribute('name')==='rpcUrl',undefined,{timeout:3000});
    const original=await p.evaluate(()=>Object.fromEntries([...document.querySelectorAll('#pikpak-aria2-settings input')].map(n=>[n.name,n.value])));
    const ui=await p.evaluate(()=>{
      const dialog=document.querySelector('#pikpak-aria2-settings .setting-dialog'),r=dialog?.getBoundingClientRect(),tab=document.querySelector('.pah-settings-tab')?.getBoundingClientRect();
      return {modal:document.querySelector('#pikpak-aria2-settings [role=dialog]')?.getAttribute('aria-modal')==='true',nativeStyle:!!dialog,toolbarSettings:document.querySelectorAll('[data-pah-config=toolbar]').length,iconOnly:!!document.querySelector('[data-pah-send=toolbar] svg')&&!document.querySelector('[data-pah-send=toolbar] a').textContent.trim(),
        // Host .el-dialog rules add top:50%/translateY; the dialog must still be centered and fully visible.
        centered:!!r&&Math.abs(r.top+r.height/2-innerHeight/2)<=2&&Math.abs(r.left+r.width/2-innerWidth/2)<=2&&r.top>=0&&r.bottom<=innerHeight,fullTab:!!tab&&Math.abs(tab.height-r.height)<=1,
        activeTab:getComputedStyle(document.querySelector('.pah-settings-tab .active')).color};
    });
    if(!ui.modal||!ui.nativeStyle||ui.toolbarSettings||!ui.iconOnly||!ui.centered||!ui.fullTab||ui.activeTab!=='rgb(48, 110, 255)')throw new Error('Settings/toolbar UI regression '+JSON.stringify(ui));
    for(const [key,text] of Object.entries(value)) await p.fill('loc=css:#pikpak-aria2-settings input[name='+key+']',text);
    await p.click('loc=css:#pikpak-aria2-settings [data-pah-test]');
    await p.waitForFunction(()=>/连接成功|Connected/.test(document.querySelector('[data-pah-settings-feedback]')?.textContent),undefined,{timeout:10000});
    await p.click('loc=css:#pikpak-aria2-settings button[type=submit]');
    return original;
  },{space,label,value});
}
async function done(label, expected, tone) {
  return egoRun(async ({space,label,expected,tone})=>{
    const p=(await taskSpace(space)).page(label);
    await p.waitForFunction(expected=>{
      const n=document.querySelector('[data-pah-counts]');if(!n)return false;
      const counts=JSON.parse(n.dataset.pahCounts);
      return Object.entries(expected).every(([k,v])=>counts[k]===v)&&!!document.querySelector('[data-pah-close]');
    },expected,{timeout:15000});
    const ui=await p.evaluate(()=>{const head=document.querySelector('#pikpak-aria2-progress [data-pah-tone]');return {tone:head?.dataset.pahTone,icon:head?.querySelector('[data-pah-icon]')?.dataset.pahIcon,text:document.querySelector('#pikpak-aria2-progress').textContent};});
    if(tone&&(ui.tone!==tone||ui.icon!==tone)||/不代表|not download completion/.test(ui.text))throw new Error('Result status regression '+JSON.stringify({tone:ui.tone,icon:ui.icon}));
    return true;
  },{space,label,expected,tone});
}
// Multi-item sends wait for one explicit confirmation before any submission.
async function confirmSend(label, accept, count) {
  return egoRun(async ({space,label,accept,count})=>{
    const p=(await taskSpace(space)).page(label);
    await p.waitForSelector('loc=css:#pikpak-aria2-confirm [role=alertdialog]',{timeout:10000});
    const text=await p.evaluate(()=>document.querySelector('#pikpak-aria2-confirm-message').textContent);
    if(!text.includes(String(count)))throw new Error('Confirmation does not state the item count');
    await p.click('loc=css:#pikpak-aria2-confirm '+(accept?'[data-pah-dialog-confirm]':'[data-pah-dialog-cancel]'));
    await p.waitForFunction(()=>!document.querySelector('#pikpak-aria2-confirm'));
    return true;
  },{space,label,accept,count});
}
async function waitForRecords(count) {
  const until=Date.now()+10000;
  while(records.length<count&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,20));
  if(records.length<count)throw new Error('Mock RPC did not receive the expected request');
}
async function fixtureSelection(ids, menu=false) {
  await egoRun(async ({space,label,ids,menu})=>{
    const p=(await taskSpace(space)).page(label);
    await p.evaluate(({ids,menu})=>{window.fixtureSelect(ids);document.querySelector('.context-menu').classList.toggle('show',menu);},{ids,menu});
    await p.waitForSelector('loc=css:[data-pah-send='+(menu?'context':'toolbar')+'] a');
    await p.click('loc=css:[data-pah-send='+(menu?'context':'toolbar')+'] a');
    if(menu)await p.waitForFunction(()=>!document.querySelector('.context-menu.show'),undefined,{timeout:3000});
    return true;
  },{space,label:fixturePage,ids,menu});
  if(ids.length>1)await confirmSend(fixturePage,true,ids.length);
}
try {
  if(!(await control('status')).connected) throw new Error('ScriptCat is disconnected');
  await control('sync',{file:'pikpak-aria2-helper.user.js'});
  const loaded=await egoRun(installed,{space,name:'PikPak Aria2 助手',version,expected:hash(source)});
  assert.equal(loaded.hash,hash(source),'Production installed-source mismatch');
  real=await egoRun(async ({space})=>{
    const task=await taskSpace(space),tab=(await task.tabs()).find(t=>/^https:\/\/mypikpak\.com\/drive\//.test(t.url));
    if(!tab)throw new Error('Keep logged-in PikPak open');
    const p=tab.label?task.page(tab.label):await task.adopt(tab.page),url=await p.url();
    const original=await p.evaluate(()=>({ids:[...document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('file').selectedIds],view:document.querySelector('.list-wrap')?.classList.contains('grid')?'grid':'list'}));
    const epoch=await p.evaluate(()=>performance.timeOrigin);await p.reload();
    await p.waitForFunction(t=>performance.timeOrigin!==t,epoch,{timeout:15000});await p.waitForLoadState();
    await p.waitForFunction(()=>!!document.querySelector('[data-pah-send=toolbar] a'),undefined,{timeout:10000});
    return {label:p.label,url,...original};
  },{space});
  // Read-only navigation to find files; nothing is submitted to a real aria2.
  await egoRun(async ({space,label})=>{
    const p=(await taskSpace(space)).page(label);
    const enough=()=>document.querySelectorAll('li.row[data-file-event]:not(.folder)').length>1;
    if(!await p.evaluate(enough)){
      // No account-specific names: open visible folders in order until one holds two files.
      const start=await p.url();
      const ids=await p.evaluate(()=>[...document.querySelectorAll('li.row.folder[data-file-event]')].map(n=>n.id).filter(Boolean).slice(0,8));
      let found=false;
      for(const id of ids){
        await p.dblclick('loc=css:li.row[id="'+id+'"]');
        await p.waitForFunction(id=>location.pathname.endsWith('/'+id),id,{timeout:15000});
        found=await p.waitForFunction(enough,undefined,{timeout:5000}).then(()=>true,()=>false);
        if(found)break;
        await p.goto(start);
        await p.waitForFunction(()=>!!document.querySelector('li.row[data-file-event]'),undefined,{timeout:15000});
      }
      if(!found)throw new Error('No visible folder holds two files for the real browser check');
    }
    await p.click('loc=css:li.row[data-file-event]:not(.folder) >> nth=0',{button:'right'});
    await p.waitForSelector('loc=css:[data-pah-send=context] a');
    const ui=await p.evaluate(()=>{
      const item=document.querySelector('.context-menu.show [data-pah-send=context]'),native=item.parentElement.querySelector('li:not([data-pah-send])');
      const toolbar=document.querySelector('.file-explorer-operation-box .file-operations');
      return {group:item.dataset.group,height:getComputedStyle(item.querySelector('a')).height,nativeHeight:getComputedStyle(native.querySelector('a')).height,separator:getComputedStyle(item,'::after').height,toolbarSettings:document.querySelectorAll('.file-explorer-operation-box [data-pah-config]').length,
        menuFirst:item.parentElement.firstElementChild===item,toolbarFirst:toolbar.firstElementChild===toolbar.querySelector('[data-pah-send=toolbar]')};
    });
    if(ui.group!=='aria2'||ui.height!==ui.nativeHeight||ui.separator!=='1px'||ui.toolbarSettings||!ui.menuFirst||!ui.toolbarFirst)throw new Error('Native menu grouping or toolbar regression '+JSON.stringify(ui));
    await p.hover('loc=css:.context-menu.show li:not([data-pah-send]) >> nth=0');
    const nativeHover=await p.evaluate(()=>getComputedStyle(document.querySelector('.context-menu.show li:not([data-pah-send])')).backgroundColor);
    await p.hover('loc=css:.context-menu.show [data-pah-send=context]');
    if(!await p.evaluate(color=>getComputedStyle(document.querySelector('.context-menu.show [data-pah-send=context]')).backgroundColor===color,nativeHover))throw new Error('Context menu hover does not match native items');
    return true;
  },{space,label:real.label});
  real.config=await configure(real.label,{rpcUrl:base+'/jsonrpc',rpcToken:'public-fixture-secret',downloadPath:'/fixture/',customParams:'split=2;user-agent=Fixture=Agent'});
  records.length=0;
  const target=await egoRun(async ({space,label})=>{
    const p=(await taskSpace(space)).page(label);
    await p.press('loc=css:body','Escape');
    await p.evaluate(()=>document.querySelector('[data-pah-close]')?.click()); // The panel can cover rows.
    await p.click('loc=css:li.row[data-file-event]:not(.folder) >> nth=0',{button:'right'});
    await p.waitForSelector('loc=css:[data-pah-send=context] a');
    const name=await p.evaluate(()=>{const s=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('file');return s.getFileById(s.selectedIds[0]).name;});
    const ids=await p.evaluate(()=>JSON.stringify(document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('file').selectedIds));
    await p.click('loc=css:[data-pah-send=context] a');
    // Sending closes PikPak's menu like a native item and keeps the selection.
    await p.waitForFunction(()=>!document.querySelector('.context-menu.show'),undefined,{timeout:3000});
    if(await p.evaluate(()=>JSON.stringify(document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('file').selectedIds))!==ids)throw new Error('Closing the context menu changed the selection');
    return name;
  },{space,label:real.label});
  await done(real.label,{sent:1,failed:0},'success');
  assert.equal(records.length,1);
  assert.equal(records[0].params[0],'token:public-fixture-secret');
  assert.ok(records[0].params.at(-1).out===target.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,''),'Real target filename does not match');
  assert.equal(records[0].params.at(-1)['user-agent'],'Fixture=Agent');
  assert.equal(new URL(records[0].params.at(-2)[0]).protocol,'https:');
  records.length=0;
  await egoRun(async ({space,label})=>{
    const p=(await taskSpace(space)).page(label);
    await p.press('loc=css:body','Escape');
    await p.evaluate(()=>document.querySelector('[data-pah-close]')?.click()); // The panel can cover rows.
    await p.click('loc=css:li.row[data-file-event]:not(.folder) >> nth=0');
    await p.keyboard.down('Meta');try{await p.click('loc=css:li.row[data-file-event]:not(.folder) >> nth=1');}finally{await p.keyboard.up('Meta');}
    await p.waitForFunction(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('file').selectedIds.length===2);
    await p.click('loc=css:[data-pah-send=toolbar] a');
    return true;
  },{space,label:real.label});
  await confirmSend(real.label,false,2);
  await new Promise(resolve=>setTimeout(resolve,500));assert.equal(records.length,0,'Cancelled confirmation submitted tasks');
  await egoRun(async ({space,label})=>{await (await taskSpace(space)).page(label).click('loc=css:[data-pah-send=toolbar] a');return true;},{space,label:real.label});
  await confirmSend(real.label,true,2);
  await done(real.label,{sent:2,failed:0},'success');assert.equal(records.length,2);

  const fixtureSource=source.replace(/^\/\/ @name(?::[^\s]+)?\s+.*$/gm,'// @name         '+fixtureName)
    .replace(/^\/\/ @match\s+.*\n/gm,'')
    .replace('// @grant        unsafeWindow','// @match        '+base+'/drive/*\n// @grant        unsafeWindow')
    .replace('https://api-drive.mypikpak.com/drive/v1/files',base+'/drive/v1/files');
  await mkdir(resolve(root,'tests/browser/.generated'),{recursive:true});
  await writeFile(resolve(root,fixtureFile),fixtureSource);
  fixtureSynced=true;
  await control('sync',{file:fixtureFile});
  const fixture=await egoRun(installed,{space,name:fixtureName,version,expected:hash(fixtureSource)});
  assert.equal(fixture.hash,hash(fixtureSource));
  fixturePage=await egoRun(async ({space,url})=>{const p=await (await taskSpace(space)).newPage();await p.goto(url);await p.waitForSelector('loc=css:[data-pah-config=gear] a');return p.label;},{space,url:base+'/drive/all'});
  await configure(fixturePage,{rpcUrl:base+'/jsonrpc',rpcToken:'public-fixture-secret',downloadPath:'/',customParams:'split=2'});

  records.length=0;
  await fixtureSelection(['d-root','f-nested'],true);
  await done(fixturePage,{sent:3,failed:0});assert.equal(records.length,3);
  assert.deepEqual(records.map(r=>r.params.at(-1).dir),['/Folder','/Folder','/Folder/Sub']);
  assert.deepEqual(records.map(r=>r.params.at(-1).out),['Nested.txt','More.txt','Deep.txt']);

  // Native selection changes during a job must not change the snapshotted batch.
  records.length=0;holdRpc();failOnce='f-two';
  await fixtureSelection(['f-one','f-two']);
  await waitForRecords(1);
  await egoRun(async ({space,label})=>{await (await taskSpace(space)).page(label).evaluate(()=>window.fixtureSelect(['d-root']));return true;},{space,label:fixturePage});
  gate.release();
  await done(fixturePage,{sent:1,failed:1},'error');
  assert.deepEqual(records.map(r=>r.params.at(-1).out),['One.txt','Two.txt']);
  await egoRun(async ({space,label})=>{await (await taskSpace(space)).page(label).click('loc=css:[data-pah-retry]');return true;},{space,label:fixturePage});
  await done(fixturePage,{sent:2,failed:0},'success');assert.equal(records.length,3);assert.equal(records[2].params.at(-1).out,'Two.txt');

  // A failed folder scan must submit nothing, rather than silently omit files.
  records.length=0;scanFailure=true;
  await fixtureSelection(['d-root']);await done(fixturePage,{sent:0},'error');assert.equal(records.length,0);scanFailure=false;
  await egoRun(async ({space,label})=>{await (await taskSpace(space)).page(label).click('loc=css:[data-pah-retry]');return true;},{space,label:fixturePage});
  await done(fixturePage,{sent:3,failed:0});assert.equal(records.length,3);

  records.length=0;holdRpc();
  await fixtureSelection(['f-one','f-two']);
  await waitForRecords(1);
  await egoRun(async ({space,label})=>{await (await taskSpace(space)).page(label).click('loc=css:[data-pah-stop]');return true;},{space,label:fixturePage});
  await done(fixturePage,{uncertain:1,pending:1},'warning');gate.release();assert.equal(records.length,1);
  await egoRun(async ({space,label})=>{await (await taskSpace(space)).page(label).click('loc=css:[data-pah-retry]');return true;},{space,label:fixturePage});
  await done(fixturePage,{sent:1,uncertain:1,pending:0});assert.equal(records.length,2);assert.equal(records[1].params.at(-1).out,'Two.txt');

  await configure(fixturePage,{rpcUrl:base+'/jsonrpc',rpcToken:'public-fixture-secret',downloadPath:'D:\\Downloads\\',customParams:'split=2'});
  records.length=0;await fixtureSelection(['d-root']);await done(fixturePage,{sent:3,failed:0});
  assert.deepEqual(records.map(r=>r.params.at(-1).dir),['D:\\Downloads\\Folder','D:\\Downloads\\Folder','D:\\Downloads\\Folder\\Sub']);

  // Pinia adapter failure is closed: no fallback to visible/all directory items.
  records.length=0;
  await egoRun(async ({space,label})=>{const p=(await taskSpace(space)).page(label);await p.evaluate(()=>{document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('file').selectedIds=['missing'];});await p.click('loc=css:[data-pah-send=toolbar] a');return true;},{space,label:fixturePage});
  await done(fixturePage,{sent:0});assert.equal(records.length,0);
  // Host rerender and view switch must remount exactly one native entry.
  await egoRun(async ({space,label})=>{
    const p=(await taskSpace(space)).page(label);
    await p.evaluate(()=>{const el=document.querySelector('.file-explorer-operation-box .file-operations');el.querySelectorAll('[data-pah-send],[data-pah-config]').forEach(n=>n.remove());document.querySelector('.list-wrap').className='list-wrap list';});
    await p.waitForFunction(()=>document.querySelectorAll('[data-pah-send=toolbar]').length===1);
    return true;
  },{space,label:fixturePage});
  // Even previously verified settings are refused when the RPC goes offline.
  records.length=0;connectionFailure=true;
  await fixtureSelection(['f-one']);
  // A refusal shows a notice first; settings open only from its explicit action.
  await egoRun(async ({space,label})=>{
    const p=(await taskSpace(space)).page(label);
    await p.waitForSelector('loc=css:#pikpak-aria2-notice [role=alertdialog]');
    const state=await p.evaluate(()=>({settings:!!document.querySelector('#pikpak-aria2-settings'),focus:document.activeElement?.hasAttribute('data-pah-dialog-confirm'),message:!!document.querySelector('#pikpak-aria2-notice-message')?.textContent.trim(),icon:!!document.querySelector('#pikpak-aria2-notice [data-pah-icon=error]')}));
    if(state.settings||!state.focus||!state.message||!state.icon)throw new Error('Refusal notice regression '+JSON.stringify(state));
    await p.click('loc=css:#pikpak-aria2-notice [data-pah-dialog-cancel]');
    await p.waitForFunction(()=>!document.querySelector('#pikpak-aria2-notice')&&!document.querySelector('#pikpak-aria2-settings'));
    return true;
  },{space,label:fixturePage});
  await fixtureSelection(['f-one']);
  await egoRun(async ({space,label})=>{
    const p=(await taskSpace(space)).page(label);
    await p.waitForSelector('loc=css:#pikpak-aria2-notice [role=alertdialog]');
    await p.click('loc=css:#pikpak-aria2-notice [data-pah-dialog-confirm]');
    await p.waitForSelector('loc=css:#pikpak-aria2-settings [role=alert]');
    if(await p.evaluate(()=>!!document.querySelector('#pikpak-aria2-notice')||document.activeElement?.name!=='rpcUrl'))throw new Error('Notice to settings handoff regression');
    return true;
  },{space,label:fixturePage});
  assert.equal(records.length,0);connectionFailure=false;
  // Changing connection settings after a successful test invalidates its proof.
  await egoRun(async ({space,label})=>{const p=(await taskSpace(space)).page(label);await p.fill('loc=css:#pikpak-aria2-settings input[name=rpcToken]','changed');await p.click('loc=css:#pikpak-aria2-settings button[type=submit]');await p.waitForFunction(()=>!document.querySelector('#pikpak-aria2-settings'));return true;},{space,label:fixturePage});
  await fixtureSelection(['f-one']);
  await egoRun(async ({space,label})=>{const p=(await taskSpace(space)).page(label);await p.waitForSelector('loc=css:#pikpak-aria2-notice [role=alertdialog]');await p.press('loc=css:#pikpak-aria2-notice [data-pah-dialog-confirm]','Escape');await p.waitForFunction(()=>!document.querySelector('#pikpak-aria2-notice')&&!document.querySelector('#pikpak-aria2-settings'));return true;},{space,label:fixturePage});
  assert.equal(records.length,0);
  console.log(JSON.stringify({sourceHash:'matched',real:{contextTarget:'verified',multiSelection:'verified',menuGrouping:'verified',leadingEntries:'verified',menuCloses:'verified',multiConfirm:'verified',resultIcons:'verified',nativeHover:'verified',iconToolbar:'verified',gearSettings:'verified',nativeStyleModal:'verified',centeredModal:'verified',rpc:'loopback mock only'},synthetic:{pagination:'verified',nestedPaths:'verified',deduplication:'verified',offscreenSelection:'verified',snapshot:'verified',retry:'verified',scanFailure:'verified',cancellation:'verified',adapterFailure:'verified',remount:'verified',connectionGate:'verified',refusalNotice:'verified',changedSettingsGate:'verified'}}));
} catch(error) {
  testError=error;
  throw error;
} finally {
  const cleanups=[];
  if(real?.config) cleanups.push(async()=>egoRun(async({space,label,value})=>{
    const p=(await taskSpace(space)).page(label);
    // A failure may leave a notice/confirmation or the context menu over the gear entry.
    await p.evaluate(()=>{for(const n of document.querySelectorAll('.pah-message'))n.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));});
    await p.waitForFunction(()=>!document.querySelector('.pah-message'),undefined,{timeout:3000});
    await p.evaluate(()=>{for(const e of [new PointerEvent('pointerdown',{bubbles:true}),new MouseEvent('click',{bubbles:true})])document.body.dispatchEvent(e);});
    if(!await p.evaluate(()=>!!document.querySelector('#pikpak-aria2-settings'))) {if(!await p.evaluate(()=>!!document.querySelector('[data-pah-config=gear] a')?.getClientRects().length))await p.click('loc=css:.header-bar-right .setting-icon');await p.click('loc=css:[data-pah-config=gear] a');}
    for(const [key,text] of Object.entries(value))await p.fill('loc=css:#pikpak-aria2-settings input[name='+key+']',text);
    await p.click('loc=css:#pikpak-aria2-settings button[type=submit]');
    await p.waitForFunction(()=>!document.querySelector('#pikpak-aria2-settings'));
    await p.evaluate(()=>document.querySelector('[data-pah-close]')?.click());return true;
  },{space,label:real.label,value:real.config}));
  if(real) cleanups.push(async()=>egoRun(async({space,label,url,ids})=>{
    const p=(await taskSpace(space)).page(label);await p.goto(url);
    await p.waitForFunction(()=>!!document.querySelector('.list-wrap li.row[data-file-event]'));
    await p.evaluate(ids=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('file').setSelectedIds(ids),ids);return true;
  },{space,...real}));
  if(fixturePage)cleanups.push(async()=>egoRun(async({space,label})=>{await (await taskSpace(space)).page(label).close();return true;},{space,label:fixturePage}));
  if(fixtureSynced)cleanups.push(async()=>egoRun(uninstallFixture,{space,name:fixtureName}));
  const errors=[];for(const cleanup of cleanups)try{await cleanup();}catch(e){errors.push(e);}
  gate?.release();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  records.length=0;
  if(errors.length)throw new AggregateError([...(testError?[testError]:[]),...errors],'Browser test cleanup failed');
}
