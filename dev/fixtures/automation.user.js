// ==UserScript==
// @name         Userscripts ScriptCat Automation Fixture
// @namespace    https://github.com/CheerChen/userscripts/dev
// @version      1.0.0
// @match        http://127.0.0.1:8642/__fixture*
// @match        http://localhost:8642/__fixture*
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==
(function () {
  "use strict";
  const version = "v1";
  GM_setValue("automation-version", version);
  const button = document.createElement("button");
  button.id = "automation-export";
  button.textContent = "Export " + version;
  button.onclick = () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.textContent = "Export modal " + GM_getValue("automation-version");
    document.body.append(dialog);
  };
  document.getElementById("fixture").append(button);
  GM_xmlhttpRequest({
    method: "GET",
    url: "http://127.0.0.1:8642/__fixture/data",
    onload: (response) => {
      if (
        response.status === 200 &&
        JSON.parse(response.responseText).fixture === "gm-request-ok"
      ) {
        document.documentElement.dataset.gmRequest = "ok";
        document.documentElement.dataset.scriptcatVersion = version;
        unsafeWindow.__scriptcatFixtureVersion = version;
      }
    },
    onerror: () => {
      document.documentElement.dataset.gmRequest = "error";
    },
  });
})();
