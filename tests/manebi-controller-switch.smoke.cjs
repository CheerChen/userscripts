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
    <ul id="course-list">
      <li><a href="/student/courses/1?lessonId=101&courseMapId=1">
        <svg aria-label="PDF"></svg><b>PDF lesson</b>
      </a></li>
      <li><a href="/student/courses/1?lessonId=102&courseMapId=1">
        <svg aria-label="動画"></svg><b>Video lesson</b>
      </a></li>
    </ul>
    <main id="content"><iframe id="player-frame"></iframe></main>
  </body></html>`,
  {
    url: 'https://tenant.manebi-learning.com/student/courses/1?courseMapId=1',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  }
);

const { window } = dom;
window.console = console;
window.document.querySelector('#player-frame').contentDocument.body.innerHTML = `
  <div data-vjs-player="true">
    <video-js id="movie-player" class="video-js vjs-paused">
      <video id="video-1" class="vjs-tech" style="visibility:hidden"></video>
    </video-js>
  </div>
`;
const initialVideo = window.document
  .querySelector('#player-frame')
  .contentDocument.querySelector('#video-1');
let playCalls = 0;
Object.defineProperty(initialVideo, 'duration', { configurable: true, value: 100 });
Object.defineProperty(initialVideo, 'paused', { configurable: true, value: true });
initialVideo.play = () => {
  playCalls += 1;
  return Promise.resolve();
};
window.eval(source);
window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

const wait = (ms = 180) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  await wait();
  assert.ok(window.document.querySelector('#manebi-speed-ctrl'));
  assert.equal(window.document.querySelector('#manebi-pdf-auto'), null);
  [...window.document.querySelectorAll('#manebi-speed-ctrl button')].at(-1).click();
  assert.equal(initialVideo.currentTime, 95);
  assert.equal(playCalls, 1);

  window.history.pushState(
    {},
    '',
    '/student/courses/1?lessonId=101&courseMapId=1'
  );
  window.document.querySelector('#content').innerHTML =
    '<ul><li><button aria-label="https://bucket.example/png/1.png"></button></li></ul>';
  await wait();
  const pdfController = window.document.querySelector('#manebi-pdf-auto');
  assert.ok(pdfController);
  assert.equal(window.document.querySelector('#manebi-speed-ctrl'), null);
  pdfController.querySelector('strong').dispatchEvent(
    new window.MouseEvent('mousedown', {
      bubbles: true,
      clientX: 10,
      clientY: 10,
    })
  );
  window.document.dispatchEvent(
    new window.MouseEvent('mousemove', {
      bubbles: true,
      clientX: 110,
      clientY: 90,
    })
  );
  window.document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  assert.equal(pdfController.style.left, '100px');
  assert.equal(pdfController.style.top, '80px');

  window.history.pushState(
    {},
    '',
    '/student/courses/1?lessonId=102&courseMapId=1'
  );
  window.document.querySelector('#content').innerHTML = `
    <div data-vjs-player="true">
      <video-js id="movie-player" class="video-js vjs-paused">
        <video id="video-2" class="vjs-tech" style="visibility:hidden"></video>
      </video-js>
    </div>
  `;
  await wait();
  assert.ok(window.document.querySelector('#manebi-speed-ctrl'));
  assert.equal(window.document.querySelector('#manebi-pdf-auto'), null);
  const video2 = window.document.querySelector('#video-2');
  [...window.document.querySelectorAll('#manebi-speed-ctrl button')]
    .find((button) => button.textContent === '2x')
    .click();
  assert.equal(video2.playbackRate, 2);

  window.history.pushState(
    {},
    '',
    '/student/courses/1?lessonId=103&courseMapId=1'
  );
  window.document.querySelector('#content').innerHTML = '<p>Quiz lesson</p>';
  await wait();
  assert.equal(window.document.querySelector('#manebi-speed-ctrl'), null);
  assert.equal(window.document.querySelector('#manebi-pdf-auto'), null);

  console.log('controller switch smoke test passed');
  window.close();
})().catch((error) => {
  console.error(error);
  window.close();
  process.exitCode = 1;
});
