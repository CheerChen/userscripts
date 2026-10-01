// Synthetic public data only. Production userscript code is installed by
// ScriptCat separately; these pages provide DOM/iframe/navigation scenarios.
export function atlassianFixture(url) {
  const mode = url.searchParams.get("mode");
  const wiki = url.pathname.includes("/wiki/");
  let content;
  if (mode === "blank") {
    content = '<iframe title="Srcdoc page" style="width:700px;height:400px" srcdoc="&lt;main&gt;&lt;h1 data-testid=page-title&gt;Demo wiki [one]&lt;/h1&gt;&lt;/main&gt;"></iframe>';
  } else if (mode === "same" || mode === "inner") {
    const child = new URL(url);
    child.searchParams.set("mode", mode === "same" ? "inner" : "leaf");
    content = `<iframe title="Nested page" style="width:700px;height:400px" src="${child.href}"></iframe>`;
  } else if (mode === "cross") {
    const child = new URL(url);
    child.hostname = "localhost";
    child.searchParams.set("mode", "leaf");
    content = `<iframe title="Cross-site page" style="width:700px;height:400px" src="${child.href}"></iframe>`;
  } else {
    const heading = wiki
      ? '<h1 data-testid="page-title">Demo wiki [one]</h1>'
      : '<form><h1 data-testid="issue.views.issue-base.foundation.summary.heading">Demo issue [one]</h1></form>';
    content = `<main id="main-content">${heading}</main>`;
  }
  return `<!doctype html><html><head><title>Atlassian</title></head><body>${content}</body></html>`;
}
