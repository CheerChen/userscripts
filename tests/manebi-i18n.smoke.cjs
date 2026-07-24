const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'manebi-learning-helper.user.js'),
  'utf8'
);

const translations = [
  ['en-US', 'PDF Auto', 'Run remaining', 'Pause', 'Speed Control', 'Skip to End'],
  ['zh-CN', 'PDF 自动浏览', '浏览未完成项', '暂停', '播放速度', '跳至结尾'],
  ['ja-JP', 'PDF自動閲覧', '未完了分を閲覧', '一時停止', '再生速度', '末尾へ移動'],
  ['fr-FR', 'PDF Auto', 'Run remaining', 'Pause', 'Speed Control', 'Skip to End'],
];

function createDom(language, body, url) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${body}</body></html>`, {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  Object.defineProperty(dom.window.navigator, 'language', {
    configurable: true,
    value: language,
  });
  dom.window.console = { ...console, log() {} };
  dom.window.eval(source);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  return dom;
}

for (const [language, pdfTitle, runLabel, pauseLabel, speedTitle, skipLabel] of translations) {
  const pdfDom = createDom(
    language,
    `<a href="/student/courses/1?lessonId=101"><svg aria-label="PDF"></svg></a>
     <ul><li><button aria-label="https://bucket.example/png/1.png"></button></li></ul>`,
    'https://tenant.manebi-learning.com/student/courses/1?lessonId=101'
  );
  assert.equal(
    pdfDom.window.document.querySelector('#manebi-pdf-auto strong').textContent,
    `📄 ${pdfTitle}`
  );
  assert.equal(
    pdfDom.window.document.querySelector('#manebi-pdf-auto .run').textContent,
    runLabel
  );
  assert.equal(
    pdfDom.window.document.querySelector('#manebi-pdf-auto .pause').textContent,
    pauseLabel
  );
  pdfDom.window.close();

  const videoDom = createDom(
    language,
    `<div data-vjs-player="true"><video-js class="video-js"><video></video></video-js></div>`,
    'https://tenant.manebi-learning.com/student/courses/1?courseMapId=1'
  );
  assert.equal(
    videoDom.window.document.querySelector('#manebi-speed-ctrl div').textContent,
    `⚡ ${speedTitle}`
  );
  assert.equal(
    [...videoDom.window.document.querySelectorAll('#manebi-speed-ctrl button')].at(-1)
      .textContent,
    `⏭ ${skipLabel}`
  );
  videoDom.window.close();
}

console.log('i18n smoke test passed');
