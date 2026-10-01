// ==UserScript==
// @name         Confluence Jira Title Copy
// @name:en      Confluence Jira Title Copy
// @name:ja      Confluence Jira タイトルコピー
// @name:zh-CN   Confluence Jira 复制标题和链接
// @description  Add buttons to copy title and link of a Confluence/Jira page, and to copy as filename
// @description:en Add buttons to copy title and link of a Confluence/Jira page, and to copy as filename
// @description:ja ボタンをクリックして、タイトルテキスト+リンクをマークダウン形式でコピーし、ファイル名としてコピーします。
// @description:zh-CN 点击按钮以markdown格式复制标题文本+链接，以及复制为文件名
// @namespace    https://github.com/CheerChen
// @version      0.9.0
// @author      cheerchen37
// @license     MIT
// @match        *://*.atlassian.net/*
// @grant        none
// @icon         https://www.google.com/s2/favicons?domain=atlassian.net
// @homepage     https://github.com/CheerChen/userscripts
// @supportURL   https://github.com/CheerChen/userscripts/issues
// @updateURL    https://raw.githubusercontent.com/CheerChen/userscripts/master/confluence-jira-title-copy.user.js
// ==/UserScript==

(function () {
    'use strict';
    // The top document owns readable same-origin frames, including about:blank.
    // Cross-origin Atlassian frames run their own matched userscript.
    try {
        if (window.parent !== window && window.parent.location.origin === location.origin) return;
    } catch { /* This cross-origin child owns its own entry point. */ }
    const JIRA_TITLE = ['h1[data-testid="issue.views.issue-base.foundation.summary.heading"]',
        '#summary-val', 'h1[data-test-id="issue-title"]', '.issue-header h1',
        '.jira-issue-header h1', '.ghx-detail-title h1', '.ghx-detail-title'];
    const WIKI_TITLE = ['#title-text', '[data-testid="page-title"]',
        '[data-test-id="content-title"]', '[data-testid="title-text"]', 'h1.PageTitle',
        '.confluence-page-title', '.aui-page-header-main h1',
        '#content-header-container h1', '#main-content h1', 'h1.pagetitle'];
    const visible = node => {
        if (!node?.isConnected || !node.getClientRects().length || node.closest('[inert], [aria-hidden="true"]')) return false;
        const style = node.ownerDocument.defaultView.getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden';
    };
    const text = node => node?.textContent.trim().replace(/\s+/g, ' ') || '';
    function issueKey(url) {
        for (const name of ['selectedIssue', 'issueKey', 'modal']) {
            const value = url.searchParams.get(name);
            if (/^[A-Z][A-Z0-9]*-\d+$/i.test(value || '')) return value.toUpperCase();
        }
        return url.pathname.match(/\/browse\/([A-Z][A-Z0-9]*-\d+)/i)?.[1].toUpperCase() || '';
    }
    function documents() {
        const result = [];
        function visit(doc, parentUrl, depth) {
            if (depth > 8 || result.some(entry => entry.doc === doc)) return;
            let url;
            const inherited = /^about:(blank|srcdoc)$/.test(doc.URL);
            try { url = new URL(inherited ? parentUrl : doc.URL); }
            catch { return; }
            result.push({doc, url, inherited});
            for (const frame of doc.querySelectorAll('iframe')) {
                if (!visible(frame)) continue;
                try { if (frame.contentDocument) visit(frame.contentDocument, url.href, depth + 1); }
                catch { /* Matched child script owns cross-origin content. */ }
            }
        }
        visit(document, location.href, 0);
        return result;
    }
    function contextFor({doc, url, inherited}) {
        const key = issueKey(url), wiki = /\/(wiki|confluence|display)(\/|$)/.test(url.pathname);
        if (!key && !wiki) return null; // Never select an arbitrary board card.
        let element;
        for (const selector of wiki ? WIKI_TITLE : JIRA_TITLE) {
            const candidates = [...doc.querySelectorAll(selector)].filter(node => visible(node) && text(node));
            element = candidates.find(node => node.closest('[role="dialog"], [aria-modal="true"]')) || candidates[0];
            if (element) break;
        }
        let title = text(element);
        if (!title) {
            if (inherited) return null; // Frame shells need a real visible title.
            const dedicated = key || /\/(pages\/\d+|display\/[^/]+\/[^/]+|viewpage\.action)/.test(url.pathname);
            if (!dedicated) return null;
            title = doc.title.replace(/\s*[-|]\s*(JIRA|Confluence)\s*$/i, '').trim();
            if (key && /^\[[A-Z][A-Z0-9]*-\d+\]/i.test(title) && !title.toUpperCase().startsWith('[' + key + ']')) return null;
            if (key) title = title.replace(new RegExp('^\\[' + key + '\\]\\s*', 'i'), '');
            if (!title || /^(Jira|Confluence|Atlassian|Loading[.…]*)$/i.test(title)) return null;
        }
        if (key) url = new URL('/browse/' + key, url.origin);
        else {
            const canonical = doc.querySelector('link[rel="canonical"]')?.href;
            if (canonical) {
                try {
                    const candidate = new URL(canonical, url.href);
                    if (candidate.origin === url.origin && /\/(wiki|confluence|display)\//.test(candidate.pathname)) url = candidate;
                } catch { /* Preserve the current document URL. */ }
            }
            url.hash = '';
            for (const name of [...url.searchParams.keys()]) if (name !== 'pageId') url.searchParams.delete(name);
        }
        return {title, key, url: url.href, element, doc};
    }
    function currentContext() {
        const contexts = documents().map(contextFor).filter(Boolean);
        return contexts.find(context => context.element) || contexts[0] || null;
    }
    const style = document.createElement('style');
    style.textContent = [
        '[data-title-copy-toolbar]{display:inline-flex;align-items:center;gap:6px;margin:8px 0;flex-wrap:wrap}',
        '[data-title-copy-toolbar][data-placement="floating"]{position:fixed;right:20px;bottom:20px;z-index:2147483647;padding:8px;background:white;border-radius:6px;box-shadow:0 2px 12px #0003}',
        '[data-title-copy-toolbar] button{font:12px/1.4 system-ui,sans-serif;padding:6px 10px;border:0;border-radius:4px;background:#0052cc;color:white;cursor:pointer}',
        '[data-title-copy-toolbar] button:hover{background:#0747a6}',
        '[data-title-copy-toolbar] button:focus-visible{outline:2px solid #4c9aff;outline-offset:2px}',
        '[data-title-copy-toolbar] button:disabled{opacity:.55;cursor:default}',
        '[data-title-copy-toolbar] [role="status"]{font:12px system-ui,sans-serif;color:#172b4d}',
    ].join('\n');
    (document.head || document.documentElement).append(style);
    const bar = document.createElement('div');
    bar.dataset.titleCopyToolbar = 'true';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Copy page title');
    const feedback = document.createElement('span');
    feedback.id = 'copyFeedback';
    feedback.setAttribute('role', 'status');
    let feedbackTimer, timer, anchor;
    for (const [id, label, format] of [
        ['customCopyButton', 'Copy Title & Link', 'markdown'],
        ['customCopyFilenameButton', 'Copy as Filename', 'filename'],
    ]) {
        const button = document.createElement('button');
        button.id = id;
        button.type = 'button';
        button.textContent = label;
        button.dataset.titleCopyFormat = format;
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation(); // Do not open Jira's inline title editor.
            copy(format, button);
        });
        for (const event of ['pointerdown', 'mousedown', 'keydown']) {
            button.addEventListener(event, event => event.stopPropagation());
        }
        bar.append(button);
    }
    bar.append(feedback);
    async function writeClipboard(value) {
        try {
            if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
            await navigator.clipboard.writeText(value);
            return;
        } catch { /* Sandboxed frames may require the legacy copy path. */ }
        const textarea = document.createElement('textarea'), focused = document.activeElement;
        const selection = document.getSelection();
        const ranges = selection ? Array.from({length: selection.rangeCount}, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
        textarea.value = value;
        textarea.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none';
        document.body.append(textarea);
        try {
            textarea.select();
            if (!document.execCommand('copy')) throw new Error('Clipboard permission denied');
        } finally {
            textarea.remove();
            focused?.focus({preventScroll: true});
            if (selection) { selection.removeAllRanges(); for (const range of ranges) selection.addRange(range); }
        }
    }
    async function copy(format, button) {
        // Resolve at click time, never capture a previous SPA page's identity.
        const context = currentContext();
        if (!context) return showFeedback('Title not ready');
        const value = format === 'filename'
            ? (context.key ? context.key + ' ' : '') + context.title.replace(/[\\/:*?"<>|[\]{}#%&+,;=@^\x60~]/g, '-').replace(/\s+/g, ' ').trim()
            : '[' + context.title.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]') + '](' + context.url.replace(/\(/g, '%28').replace(/\)/g, '%29') + ')';
        button.disabled = true;
        try { await writeClipboard(value); showFeedback('Copied!'); }
        catch { showFeedback('Copy failed — check clipboard permission'); }
        finally { button.disabled = false; }
    }
    function showFeedback(message) {
        clearTimeout(feedbackTimer);
        feedback.textContent = message;
        feedbackTimer = setTimeout(() => { feedback.textContent = ''; }, 2000);
    }
    const observed = new WeakSet();
    function reconcile() {
        for (const {doc} of documents()) {
            if (observed.has(doc)) continue;
            observed.add(doc);
            new MutationObserver(schedule).observe(doc.documentElement, {childList: true, subtree: true, characterData: true});
            doc.addEventListener('load', schedule, true);
        }
        const context = currentContext();
        if (!context || !document.body) { bar.remove(); anchor = null; return; }
        const nextAnchor = context.doc === document && context.element
            ? context.element.closest('[data-testid="issue-field-summary.ui.issue-field-summary-inline-edit--container"]') || context.element.closest('form') || context.element
            : null;
        const placement = nextAnchor ? 'inline' : 'floating';
        if (!bar.isConnected || anchor !== nextAnchor || bar.dataset.placement !== placement) {
            bar.dataset.placement = placement;
            if (nextAnchor) nextAnchor.after(bar); else document.body.append(bar);
            anchor = nextAnchor;
        }
    }
    function schedule() {
        if (timer) return;
        timer = setTimeout(() => { timer = null; reconcile(); }, 100);
    }
    window.addEventListener('popstate', schedule);
    window.addEventListener('hashchange', schedule);
    // Cover pushState without replacing Atlassian's own history methods.
    let lastUrl = location.href;
    setInterval(() => { if (location.href !== lastUrl) { lastUrl = location.href; schedule(); } }, 500);
    reconcile();
})();
