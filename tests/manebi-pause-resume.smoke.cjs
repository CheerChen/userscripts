const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'manebi-learning-helper.user.js'),
  'utf8'
);
const dom = new JSDOM(
  `<!doctype html><html><head></head><body>
    <ul>
      <li id="lesson">
        <a href="/student/courses/1?lessonId=101">
          <svg aria-label="PDF"></svg><b>PDF lesson</b>
        </a>
      </li>
    </ul>
    <div id="viewer"><ul>${[1, 2, 3, 4]
      .map(
        (page) =>
          `<li><button aria-label="https://bucket.example/png/${page}.png"></button></li>`
      )
      .join('')}</ul></div>
  </body></html>`,
  {
    url: 'https://tenant.manebi-learning.com/student/courses/1?lessonId=101',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  }
);

const { window } = dom;
window.console = console;
window.setTimeout = (callback, milliseconds, ...args) =>
  setTimeout(callback, Math.min(milliseconds, 3), ...args);

const clickedPages = [];
let pausedOnce = false;
for (const [index, button] of [
  ...window.document.querySelectorAll('#viewer button'),
].entries()) {
  const page = index + 1;
  button.addEventListener('click', () => {
    clickedPages.push(page);
    if (page === 2 && !pausedOnce) {
      pausedOnce = true;
      window.document.querySelector('#manebi-pdf-auto .pause').click();
    }
    if (page === 4) {
      window.document
        .querySelector('#lesson')
        .insertAdjacentHTML(
          'afterbegin',
          '<svg aria-label="完了" data-testid="CheckCircleIcon"></svg>'
        );
    }
  });
}

window.eval(source);
window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const controller = window.document.querySelector('#manebi-pdf-auto');
  controller.querySelector('.run').click();
  await wait(100);

  assert.deepEqual(clickedPages, [1, 2]);
  assert.equal(controller.querySelector('.status').textContent, 'Paused — 2/4 pages viewed');
  assert.equal(controller.querySelector('.run').textContent, 'Resume');
  assert.equal(controller.querySelector('.pause').disabled, true);
  assert.deepEqual(
    JSON.parse(window.sessionStorage.getItem('manebi-pdf-auto-progress')),
    { lessonId: 101, nextPage: 2, totalPages: 4 }
  );

  controller.querySelector('.run').click();
  await wait(100);

  assert.deepEqual(clickedPages, [1, 2, 3, 4]);
  assert.equal(controller.querySelector('.status').textContent, 'All 1 PDF lessons completed');
  assert.equal(controller.querySelector('.run').textContent, 'Run remaining');
  assert.equal(window.sessionStorage.getItem('manebi-pdf-auto-progress'), null);

  console.log('pause/resume smoke test passed');
  window.close();
})().catch((error) => {
  console.error(error);
  window.close();
  process.exitCode = 1;
});
