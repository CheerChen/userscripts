const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const source = fs.readFileSync(
  path.join(__dirname, "..", "manebi-learning-helper.user.js"),
  "utf8",
);

const dom = new JSDOM(
  `<!doctype html>
  <body>
    <div id="course-list">
      <ul>
        <li id="lesson-101">
          <a href="/student/courses/1000?lessonId=101&courseMapId=2000">
            <svg aria-label="PDF"></svg><b>PDF 1</b>
          </a>
        </li>
        <li id="lesson-102">
          <a href="/student/courses/1000?lessonId=102&courseMapId=2000">
            <svg aria-label="PDF"></svg><b>PDF 2</b>
          </a>
        </li>
      </ul>
    </div>
    <div id="viewer"></div>
  </body>`,
  {
    url: "https://tenant.manebi-learning.com/student/courses/1000?lessonId=101&courseMapId=2000",
    runScripts: "outside-only",
  },
);

const { window } = dom;
const nativeAttachShadow = window.Element.prototype.attachShadow;
window.Element.prototype.attachShadow = function attachOpenShadow(options) {
  return nativeAttachShadow.call(this, { ...options, mode: "open" });
};
window.Request = global.Request;
window.setTimeout = (callback, milliseconds, ...args) =>
  setTimeout(callback, Math.min(milliseconds, 3), ...args);

const reportedPages = [];
window.fetch = async (_url, init) => {
  const body = JSON.parse(init.body);
  reportedPages.push(body.watchedPage);
  const pageCount = body.lessonId === 101 ? 2 : 1;
  const completed = body.watchedPage === pageCount;
  if (completed) {
    const listItem = window.document.querySelector(`#lesson-${body.lessonId}`);
    if (!listItem.querySelector('[aria-label="完了"]')) {
      listItem.insertAdjacentHTML(
        "afterbegin",
        '<svg aria-label="完了" data-testid="CheckCircleIcon"></svg>',
      );
    }
  }
  const payload = {
    historyStatus: completed ? 2 : 1,
    lessonHistoryId: 9001,
    watchedTimeForRanking: 0,
    courseCompletionStatusForRanking: false,
  };
  return {
    status: 200,
    clone() {
      return this;
    },
    async json() {
      return payload;
    },
  };
};

function reportPage(lessonId, watchedPage) {
  return window.fetch("https://api.manebi-learning.com/api/slide", {
    method: "POST",
    body: JSON.stringify({
      lessonId,
      courseHistoryId: 9001,
      watchedPage,
      courseMapId: 2000,
    }),
  });
}

function renderViewer(lessonId) {
  const pageCount = lessonId === 101 ? 2 : 1;
  let currentPage = 1;
  const viewer = window.document.querySelector("#viewer");
  viewer.innerHTML = `
    <ul>${Array.from(
      { length: pageCount },
      (_, index) =>
        `<li><button type="button" aria-label="https://bucket.example/png/${
          index + 1
        }.png"></button></li>`,
    ).join("")}</ul>
    <span id="counter">1 / ${pageCount}</span>
  `;

  for (const [index, button] of [
    ...viewer.querySelectorAll("button"),
  ].entries()) {
    button.addEventListener("click", () => {
      const nextPage = index + 1;
      if (nextPage === currentPage) return;
      currentPage = nextPage;
      viewer.querySelector("#counter").textContent =
        `${nextPage} / ${pageCount}`;
      void reportPage(lessonId, nextPage);
    });
  }
}

renderViewer(101);
for (const anchor of window.document.querySelectorAll("#course-list a")) {
  anchor.addEventListener("click", (event) => {
    event.preventDefault();
    const url = new URL(anchor.href);
    const lessonId = Number(url.searchParams.get("lessonId"));
    window.history.pushState({}, "", url.pathname + url.search);
    renderViewer(lessonId);
    setTimeout(() => {
      void reportPage(lessonId, 1);
    }, 0);
  });
}

window.eval(source);
window.document.dispatchEvent(new window.Event("DOMContentLoaded"));

setTimeout(async () => {
  await reportPage(101, 1);

  const host = window.document.querySelector("#manebi-pdf-auto");
  assert.ok(host, "panel host should be installed");
  const root = host;
  root.querySelector(".run").click();

  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.deepEqual(reportedPages, [1, 2, 1]);
  assert.equal(
    root.querySelector(".status").textContent,
    "All 2 PDF lessons completed",
  );
  assert.equal(root.querySelector(".run").disabled, false);
  assert.equal(root.querySelector(".pause").disabled, true);

  await new Promise((resolve) => setTimeout(resolve, 150));
  dom.window.close();
  process.stdout.write("smoke test passed\n");
}, 0);
