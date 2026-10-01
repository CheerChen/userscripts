// ==UserScript==
// @name         Teams Transcript Extractor
// @name:en      Teams Transcript Extractor
// @name:ja      Teams 文字起こし抽出ツール
// @name:zh-CN   Teams 会议转录提取器
// @name:zh-TW   Teams 會議轉錄提取器
// @name:ko      Teams 회의 대화록 추출기
// @namespace    https://github.com/CheerChen
// @version      1.2.0
// @description  Export full transcripts from the Teams recap list, recap toolbar, and SharePoint Stream using the meeting's OneDrive transcript API.
// @description:en  Export full transcripts from the Teams recap list, recap toolbar, and SharePoint Stream using the meeting's OneDrive transcript API.
// @description:ja  Teams録画のSharePoint Streamページから、ページ自身のOneDrive文字起こしAPI経由で全文を抽出します。ダウンロードボタンがブロックされていても動作します。
// @description:zh-CN  从 Teams 会议回顾列表、详情工具栏或 SharePoint Stream 导出完整会议转录，无需打开专用录像链接。
// @description:zh-TW  透過頁面自身的 OneDrive 轉錄 API，從 Teams 錄影的 SharePoint Stream 頁面提取完整會議轉錄。即使下載按鈕被停用也可用。
// @description:ko  페이지 자체의 OneDrive 대화록 API를 통해 Teams 녹화의 SharePoint Stream 페이지에서 전체 회의 대화록을 추출합니다. 다운로드 버튼이 차단되어 있어도 작동합니다.
// @author       cheerchen37
// @match        *://*/_layouts/15/stream.aspx*
// @match        *://*/*/_layouts/15/stream.aspx*
// @match        *://*/_layouts/15/streamembed.aspx*
// @match        *://*/*/_layouts/15/streamembed.aspx*
// @match        *://*/_layouts/15/xplatplugins.aspx*
// @match        *://*/*/_layouts/15/xplatplugins.aspx*
// @match        https://teams.cloud.microsoft/*
// @match        https://teams.microsoft.com/*
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      sharepoint.com
// @run-at       document-idle
// @icon         https://www.google.com/s2/favicons?domain=teams.microsoft.com
// @license      MIT
// @homepage     https://github.com/CheerChen/userscripts
// @supportURL   https://github.com/CheerChen/userscripts/issues
// @updateURL    https://raw.githubusercontent.com/CheerChen/userscripts/master/teams-transcript-extractor.user.js
// ==/UserScript==

// The transcript lives in SharePoint-hosted documents: stream.aspx (recording page),
// streamembed.aspx + xplatplugins.aspx (the two OOPIFs inside a Teams recap).
// Verified 2026-09: the recap iframes load from <tenant>-my.sharepoint.com under a
// /personal/<user>/ prefix, and the Teams top page cannot read the iframe URL
// (src attr unset, contentWindow cross-origin) — so matching the _layouts path on
// any host / any prefix is required. The g_fileInfo guard no-ops elsewhere.
// Teams top-page entry points instead read meeting identities from React props.
(function () {
    'use strict';

    const PAGE = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const TAG = '[Teams Transcript]';
    const log = (...a) => console.log(TAG, ...a);
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // ---------- extraction method 1: OneDrive transcript API ----------

    function itemBase() {
        const fi = PAGE.g_fileInfo;
        const u = fi && fi['.spItemUrl'];
        return u ? u.replace('/_api/v2.0/', '/_api/v2.1/').split('?')[0] : null;
    }

    // "00:12:34.5678" -> seconds
    function offsetToSec(s) {
        const m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(s || '');
        return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
    }

    // Teams exposes exact recording/transcript identities in its React props.
    // Use the manager's real request API across origins; ordinary fetch still
    // serves standalone SharePoint pages and their embedded players.
    function transcriptContext(value, title) {
        const raw = value?.sitePath || value?.url;
        if (!raw) return null;
        let url;
        try { url = new URL(raw); } catch { return null; }
        if (url.protocol !== 'https:' || !url.hostname.endsWith('.sharepoint.com')) return null;
        const match = /^(.*\/_api\/v2\.[01]\/drives\/[^/]+\/items\/[^/]+)(?:\/versions\/[^/]+)?\/media\/transcripts\/([^/]+)\/content$/.exec(url.pathname);
        if (!match) return null;
        return {
            base: url.origin + match[1].replace('/_api/v2.0/', '/_api/v2.1/'),
            transcriptId: match[2], title,
            recordingFile: value.recordingFile || null,
        };
    }

    function requestJson(url) {
        if (new URL(url).origin === location.origin) {
            return fetch(url).then(async response => {
                if (!response.ok) throw new Error('transcript HTTP ' + response.status);
                return response.json();
            });
        }
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== 'function') return reject(new Error('GM_xmlhttpRequest is unavailable'));
            GM_xmlhttpRequest({
                method: 'GET', url, anonymous: false, timeout: 30000,
                onload: response => {
                    try {
                        if (response.status < 200 || response.status >= 300) throw new Error('transcript HTTP ' + response.status);
                        resolve(JSON.parse(response.responseText));
                    } catch (error) { reject(error); }
                },
                onerror: () => reject(new Error('SharePoint transcript request failed')),
                ontimeout: () => reject(new Error('SharePoint transcript request timed out')),
                onabort: () => reject(new Error('SharePoint transcript request was cancelled')),
            });
        });
    }

    async function extractViaApi(context) {
        const base = context?.base || itemBase();
        if (!base) throw new Error('g_fileInfo.spItemUrl not found (not a Stream recording page)');
        const list = ((await requestJson(base + '?select=media/transcripts&$expand=media/transcripts')).media || {}).transcripts || [];
        if (!list.length) throw new Error('recording has no transcripts');
        const t = context?.transcriptId ? list.find(x => x.id === context.transcriptId) : list.find(x => x.isDefault) || list[0];
        if (!t) throw new Error('The selected meeting transcript is no longer available');
        const data = await requestJson(base + '/media/transcripts/' + encodeURIComponent(t.id) + '/streamContent?format=json');
        const speech = (data.entries || []).map(e => ({
            kind: 'speech',
            sec: offsetToSec(e.startOffset),
            speaker: e.speakerDisplayName || '',
            text: e.text || '',
            speakerId: e.speakerId || null,
            roomId: e.roomId || null,
        }));
        const events = (data.events || []).map(e => ({
            kind: 'system',
            sec: offsetToSec(e.startOffset),
            speaker: '',
            text: `${e.eventType}${e.userDisplayName ? ' by ' + e.userDisplayName : ''}`,
            eventType: e.eventType,
            user: e.userDisplayName || null,
        }));
        // API entries are already in display order; events slot in by offset.
        const entries = [...speech, ...events]
            .map((e, i) => ({ ...e, i }))
            .sort((a, b) => (a.sec ?? 0) - (b.sec ?? 0) || a.i - b.i)
            .map(({ i, ...e }) => e);
        log(`api: ${speech.length} utterances, ${events.length} events (transcript ${t.id}, ${list.length} available)`);
        return {
            method: 'api', entries, complete: true,
            transcripts: list.map(x => ({ id: x.id, displayName: x.displayName, languageTag: x.languageTag, isDefault: x.isDefault, source: x.source })),
            used: t.id,
        };
    }

    // ---------- extraction method 2: DOM scroll harvest (fallback) ----------

    // aria-label = "<Speaker> <time>" where <time> follows the UI language:
    //   ja "1 時間 2 分間 3 秒間", zh "1 小时 2 分钟 3 秒", en "1 hour 2 minutes 3 seconds".
    const H = '(?:時間|小时|小時|hours?|hrs?)';
    const M = '(?:分間|分钟|分鐘|分|minutes?|mins?)';
    const S = '(?:秒間|秒|seconds?|secs?)';
    const TIME_RE = new RegExp(`\\s*(?:(\\d+)\\s*${H})?\\s*(?:(\\d+)\\s*${M})?\\s*(?:(\\d+)\\s*${S})?\\s*$`, 'i');

    function parseAriaLabel(s) {
        if (!s || !s.trim()) return { speaker: '', sec: null };
        const m = s.match(TIME_RE);
        const speaker = s.slice(0, m.index).trim();
        if (!m[1] && !m[2] && !m[3]) return { speaker, sec: null };
        return { speaker, sec: +(m[1] || 0) * 3600 + +(m[2] || 0) * 60 + +(m[3] || 0) };
    }

    async function extractViaDom({ step = 300 } = {}) {
        const scroller = document.getElementById('scrollToTargetTargetedFocusZone');
        if (!scroller) throw new Error('dom: no transcript scroller (#scrollToTargetTargetedFocusZone) — is the transcript panel open?');
        const harvest = new Map();
        const collect = () => {
            let setsize = 0;
            for (const el of document.querySelectorAll('[aria-posinset]')) {
                setsize = +el.getAttribute('aria-setsize') || setsize;
                const pos = +el.getAttribute('aria-posinset');
                if (harvest.has(pos)) continue;
                let p = el.parentElement, group = null;
                for (let i = 0; i < 5 && p; i++) {
                    if (p.getAttribute && p.getAttribute('role') === 'group') { group = p; break; }
                    p = p.parentElement;
                }
                harvest.set(pos, {
                    pos,
                    ariaLabel: group ? (group.getAttribute('aria-label') || '') : '',
                    text: (el.textContent || '').trim(),
                });
            }
            return { collected: harvest.size, setsize };
        };
        scroller.scrollTop = 0;
        await sleep(400);
        let st = collect();
        if (!st.setsize) throw new Error('dom: aria-setsize is 0 — is the transcript panel expanded?');
        log(`dom: setsize=${st.setsize}`);
        let still = 0;
        for (let i = 0; i < 5000 && st.collected < st.setsize; i++) {
            const b = scroller.scrollTop;
            scroller.scrollTop = b + step;
            await sleep(150);
            st = collect();
            if (scroller.scrollTop === b) { if (++still >= 3) break; await sleep(400); } else still = 0;
        }
        const items = [...harvest.values()].sort((a, b) => a.pos - b.pos);
        const have = new Set(items.map(e => e.pos));
        const missing = [];
        for (let i = 1; i <= st.setsize; i++) if (!have.has(i)) missing.push(i);
        const entries = items.map(e => {
            const { speaker, sec } = parseAriaLabel(e.ariaLabel);
            // No speaker AND no timestamp -> system line (e.g. "X started transcription").
            return { kind: !speaker && sec == null ? 'system' : 'speech', sec, speaker, text: e.text, pos: e.pos, ariaLabel: e.ariaLabel };
        });
        log(`dom: collected ${items.length}/${st.setsize}, missing ${missing.length}`);
        return { method: 'dom', entries, setsize: st.setsize, missing, complete: missing.length === 0 };
    }

    // ---------- formatting ----------

    function cleanRecordingName(name) {
        if (!name) return null;
        return name
            .replace(/-\d{8}_\d{6}.*$/, '')
            .replace(/-(Meeting Recording|会議の録音|会议录制).*$/i, '')
            .replace(/\.(mp4|vtt|txt|json)$/i, '')
            .trim() || null;
    }

    function fmtTime(sec) {
        if (sec == null) return '--:--';
        const t = Math.floor(sec);
        const hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = t % 60;
        const p = (n) => String(n).padStart(2, '0');
        return hh > 0 ? `${hh}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
    }

    function formatText(result, title) {
        const out = [];
        let cur = null;
        const flush = () => { if (cur) { out.push(`[${fmtTime(cur.sec)}] ${cur.speaker} / ${cur.texts.join(' ')}`); cur = null; } };
        for (const e of result.entries) {
            if (e.kind === 'system') { flush(); out.push(`[${fmtTime(e.sec)}] (system) / ${e.text}`); continue; }
            // Empty speaker on a real utterance = Teams could not attribute it (shared room mic).
            const label = e.speaker || '(話者不明)';
            if (cur && cur.speaker === label) cur.texts.push(e.text);
            else { flush(); cur = { speaker: label, sec: e.sec, texts: [e.text] }; }
        }
        flush();
        const speech = result.entries.filter(e => e.kind === 'speech').length;
        const cov = result.method === 'dom'
            ? `${result.entries.length}/${result.setsize} list items, missing ${result.missing.length}`
            : `${speech} utterances (complete, via API)`;
        const header =
            `# Teams meeting transcript\n` +
            `# Title: ${title}\n` +
            `# Method: ${result.method} — ${cov}\n` +
            `# Timestamps relative to recording start (mm:ss / h:mm:ss)\n` +
            `# Speaker "(話者不明)" = utterance Teams could not attribute (typically same-room attendees)\n` +
            `# Consecutive same-speaker entries merged onto one line\n\n`;
        return header + out.join('\n') + '\n';
    }

    // Real "姓 名（Romaji）" names, to help map anonymized @1..@N / (話者不明) to people.
    const NAME_RE = /([^\s、。（）()]+(?:\s+[^\s、。（）()]+)?（[A-Za-z][A-Za-z .'-]*）)/g;

    function identityHints(result) {
        const names = new Set();
        for (const e of result.entries) {
            if (e.speaker && !/^@\d+$/.test(e.speaker)) names.add(e.speaker);
            if (e.user) names.add(e.user);
            for (const m of (e.text || '').matchAll(NAME_RE)) names.add(m[1].trim());
        }
        return {
            note: 'Best-effort, NOT a full attendee list. Anonymized @1..@N and (話者不明) are usually people sharing a room mic; roomAccountHolders is whoever joined the room device.',
            namesSeen: [...names],
            roomUtterances: result.entries.filter(e => e.roomId).length,
            roomAccountHolders: [...new Set(result.entries.filter(e => /^RoomAttribution/.test(e.eventType || '')).map(e => e.user).filter(Boolean))],
        };
    }

    // ---------- UI (Fluent-styled to match the Stream page) ----------

    const UI_FONT = '"Segoe UI","Segoe UI Web (West European)",-apple-system,BlinkMacSystemFont,"Yu Gothic UI","Microsoft YaHei",sans-serif';
    const PRIMARY = '#5b5fc7';      // Stream/Teams theme purple
    const PRIMARY_HOVER = '#4f52b2';
    const TRIGGER_BG = '#d83b01';        // Fluent orange — stands out next to the purple Share button
    const TRIGGER_BG_HOVER = '#b33401';

    function fluentBtn(text, primary) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.style.cssText =
            'min-width:96px;height:32px;padding:0 16px;border-radius:4px;cursor:pointer;' +
            `font:600 14px ${UI_FONT};` +
            (primary
                ? `background:${PRIMARY};color:#fff;border:1px solid transparent;`
                : 'background:#fff;color:#242424;border:1px solid #d1d1d1;');
        const normal = b.style.background, hover = primary ? PRIMARY_HOVER : '#f5f5f5';
        b.addEventListener('mouseenter', () => (b.style.background = hover));
        b.addEventListener('mouseleave', () => (b.style.background = normal));
        return b;
    }

    function downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    async function copyText(text, btn) {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            // Clipboard API can be blocked inside the Teams recap OOPIF.
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.append(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }
        const prev = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => (btn.textContent = prev), 1500);
    }

    function safeFilename(s) {
        return (s || 'teams-transcript').replace(/[\\/:*?"<>|]/g, '_');
    }

    function showResult(result, title, context) {
        const txt = formatText(result, title);
        const json = JSON.stringify({
            title,
            recordingFile: context ? context.recordingFile : (PAGE.g_fileInfo || {}).name || null,
            method: result.method,
            apiError: result.apiError || null,
            transcripts: result.transcripts || null,
            setsize: result.setsize,
            missing: result.missing,
            identityHints: identityHints(result),
            entries: result.entries,
        }, null, 2);
        const base = safeFilename(title);

        const overlay = document.createElement('div');
        overlay.style.cssText =
            'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:2147483646;' +
            'display:flex;align-items:center;justify-content:center;';

        const dlg = document.createElement('div');
        dlg.setAttribute('role', 'dialog');
        dlg.setAttribute('aria-modal', 'true');
        dlg.setAttribute('aria-label', title);
        dlg.dataset.teamsTranscriptResult = 'true';
        dlg.style.cssText =
            'background:#fff;border-radius:8px;overflow:hidden;display:flex;flex-direction:column;' +
            'width:min(760px,92vw);max-height:82vh;' +
            'box-shadow:0 14px 28px rgba(0,0,0,.24),0 0 8px rgba(0,0,0,.12);' +
            `font-family:${UI_FONT};color:#242424;`;

        // Header: dialog title + coverage subtitle + close icon button
        const head = document.createElement('div');
        head.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;padding:18px 24px 4px;gap:16px;';
        const headText = document.createElement('div');
        headText.style.minWidth = '0';
        const hTitle = document.createElement('div');
        hTitle.style.cssText = 'font-size:20px;font-weight:600;line-height:28px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        hTitle.textContent = title;
        const speech = result.entries.filter(e => e.kind === 'speech').length;
        const meta = result.method === 'dom'
            ? `${result.entries.length}/${result.setsize} items, missing ${result.missing.length}`
            : `${speech} utterances`;
        const hMeta = document.createElement('div');
        hMeta.style.cssText = 'font-size:12px;color:#605e5c;margin-top:2px;';
        hMeta.textContent = `Teams transcript — ${result.method} · ${meta}` +
            (result.apiError ? ` · api failed: ${result.apiError}` : '');
        headText.append(hTitle, hMeta);
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.style.cssText =
            'background:transparent;border:none;cursor:pointer;width:32px;height:32px;' +
            'border-radius:4px;font-size:16px;color:#605e5c;flex:none;line-height:1;';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('mouseenter', () => (closeBtn.style.background = '#f5f5f5'));
        closeBtn.addEventListener('mouseleave', () => (closeBtn.style.background = 'transparent'));
        head.append(headText, closeBtn);

        // Body: transcript text
        const content = document.createElement('pre');
        content.style.cssText =
            'margin:12px 24px;padding:14px 16px;flex:1;overflow:auto;' +
            'border:1px solid #edebe9;border-radius:6px;background:#faf9f8;' +
            'font:12px/1.55 Consolas,Monaco,"Courier New",monospace;color:#323130;' +
            'white-space:pre-wrap;word-break:break-word;';
        content.textContent = txt;

        // Footer: Fluent action buttons
        const foot = document.createElement('div');
        foot.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;padding:0 24px 20px;';
        const copyBtn = fluentBtn('Copy TXT', true);
        copyBtn.addEventListener('click', () => copyText(txt, copyBtn));
        const dlTxtBtn = fluentBtn('Download TXT');
        dlTxtBtn.addEventListener('click', () => downloadFile(txt, `${base}.transcript.txt`, 'text/plain'));
        const dlJsonBtn = fluentBtn('Download JSON');
        dlJsonBtn.addEventListener('click', () => downloadFile(json, `${base}.raw.json`, 'application/json'));
        foot.append(copyBtn, dlTxtBtn, dlJsonBtn);

        dlg.append(head, content, foot);
        overlay.append(dlg);
        document.body.append(overlay);

        const close = () => overlay.remove();
        closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        document.addEventListener('keydown', function onKey(e) {
            if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
        });
    }

    function showError(err) {
        console.error(TAG, err);
        const div = document.createElement('div');
        div.style.cssText =
            'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
            'padding:10px 16px;max-width:560px;background:#fff;color:#a4262c;' +
            'border:1px solid #edebe9;border-left:4px solid #a4262c;border-radius:4px;' +
            `box-shadow:0 4px 12px rgba(0,0,0,.18);font:13px ${UI_FONT};`;
        div.textContent = 'Transcript extraction failed: ' + err.message;
        document.body.append(div);
        setTimeout(() => div.remove(), 8000);
    }

    // ---------- trigger button ----------

    const LABEL = (() => {
        const lang = (document.documentElement.lang || navigator.language || '').toLowerCase();
        if (lang.startsWith('ja')) return { idle: '文字起こし', busy: '抽出中…' };
        if (lang.startsWith('zh')) return lang.includes('tw') || lang.includes('hk')
            ? { idle: '提取轉錄', busy: '擷取中…' }
            : { idle: '提取转录', busy: '提取中…' };
        return { idle: 'Transcript', busy: 'Extracting…' };
    })();

    async function run(labelEl, btn, resolveContext) {
        btn.disabled = true;
        labelEl.textContent = LABEL.busy;
        try {
            const context = resolveContext ? resolveContext() : null;
            if (resolveContext && !context) throw new Error('No accessible transcript for this meeting');
            let result, apiError = null;
            try {
                result = await extractViaApi(context);
            } catch (e) {
                // A different meeting's virtualized DOM must never replace a
                // failed request for the item explicitly selected in Teams.
                if (context) throw e;
                apiError = e.message;
                log('api failed:', e.message, '— falling back to DOM harvest');
                result = await extractViaDom();
            }
            const fi = PAGE.g_fileInfo || {};
            const title = context?.title || fi.title || cleanRecordingName(fi.name) || 'teams-transcript';
            showResult({ ...result, apiError }, title, context);
        } catch (e) {
            showError(e);
        }
        btn.disabled = false;
        labelEl.textContent = LABEL.idle;
    }

    function transcriptIcon() {
        // Teams enforces Trusted Types: build SVG nodes without innerHTML.
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        for (const [key, value] of Object.entries({ width: '16', height: '16', viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
        for (const [y, width] of [[3, 9], [6.5, 12], [10, 11], [13.5, 6]]) {
            const rect = document.createElementNS(ns, 'rect');
            for (const [key, value] of Object.entries({ x: 2, y, width, height: 1.5, rx: 0.75 })) rect.setAttribute(key, String(value));
            svg.append(rect);
        }
        return svg;
    }

    function reactProp(element, key) {
        const fiberKey = PAGE.Object.keys(element).find(name => name.startsWith('__reactFiber$'));
        for (let fiber = fiberKey && PAGE.Reflect.get(element, fiberKey), depth = 0; fiber && depth < 24; fiber = fiber.return, depth++) {
            if (fiber.memoizedProps?.[key]) return fiber.memoizedProps[key];
        }
        return null;
    }

    function meetingContext(item) {
        const meeting = reactProp(item, 'meeting');
        const transcript = meeting?.transcripts?.find(transcript => transcript.hasPermission !== false);
        return transcriptContext(transcript, meeting?.subject);
    }

    function detailContext(button) {
        const recap = reactProp(button, 'selectedRecap');
        if (!recap) return null;
        const title = reactProp(button, 'subject') || document.title.split(' | ').slice(1, -1).join(' | ') || cleanRecordingName(recap.url ? decodeURIComponent(new URL(recap.url).pathname.split('/').pop()) : '');
        return transcriptContext({ ...recap, recordingFile: recap.url ? decodeURIComponent(new URL(recap.url).pathname.split('/').pop()) : null }, title);
    }

    function teamsButton(donor, kind, resolveContext) {
        const button = donor.cloneNode(false);
        for (const attr of [...button.attributes]) {
            if (!['type', 'class', 'style'].includes(attr.name)) button.removeAttribute(attr.name);
        }
        button.type = 'button';
        button.dataset.teamsTranscriptTrigger = kind;
        button.setAttribute('aria-label', LABEL.idle);
        button.title = LABEL.idle;
        button.style.cssText += `;background:${TRIGGER_BG};color:#fff;border-color:transparent;display:inline-flex;align-items:center;gap:6px;margin-left:8px;`;
        const icon = document.createElement('span');
        icon.style.cssText = 'display:flex;';
        icon.append(transcriptIcon());
        const label = document.createElement('span');
        label.textContent = LABEL.idle;
        button.append(icon, label);
        button.addEventListener('click', event => {
            event.stopPropagation();
            run(label, button, resolveContext);
        });
        button.addEventListener('keydown', event => event.stopPropagation());
        return button;
    }

    function startTeams() {
        const reconcile = () => {
            for (const item of document.querySelectorAll('[data-tid="podcast-meeting-item"]')) {
                const existing = item.querySelector('[data-teams-transcript-trigger]');
                if (!meetingContext(item)) { existing?.remove(); continue; }
                if (existing) continue;
                const donor = item.querySelector('button[data-tid="view-recap-button"]') || [...item.querySelectorAll('button')].at(-1);
                if (donor) donor.after(teamsButton(donor, 'list', () => meetingContext(item)));
            }
            const donor = document.querySelector('[data-tid="recap-open-in-stream-button"]');
            if (donor && detailContext(donor) && !donor.parentElement.querySelector('[data-teams-transcript-trigger="detail"]')) {
                donor.after(teamsButton(donor, 'detail', () => detailContext(donor)));
            }
        };
        let timer;
        new MutationObserver(() => {
            if (timer) return;
            timer = setTimeout(() => { timer = null; reconcile(); }, 100);
        }).observe(document.documentElement, { childList: true, subtree: true });
        reconcile();
    }

    // Insert into the SharePoint command bar, before Microsoft's own button group
    // (Teams / Share). Clone the primary ("Share") button's ms-OverflowSet-item —
    // falling back to the first item — so the generated root-XX classes come
    // along; cloneNode does not copy listeners, so only our own handler is
    // attached. Falls back to a floating button when the command bar never
    // appears (e.g. inside the recap xplatplugins.aspx iframe).
    function addTriggerButton() {
        const group = document.querySelector('.ms-CommandBar-secondaryCommand');
        const primaryBtn = group && group.querySelector('.ms-Button--primary');
        const donorItem = group && (primaryBtn
            ? primaryBtn.closest('.ms-OverflowSet-item')
            : group.querySelector('.ms-OverflowSet-item'));
        if (donorItem) {
            const item = donorItem.cloneNode(true);
            item.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'));
            const btn = item.querySelector('button');
            // Strip donor identity: keep class/type/tabindex/style, drop
            // name, role, aria-*, data-automationid.
            for (const a of [...btn.attributes]) {
                if (!['class', 'type', 'tabindex', 'data-is-focusable', 'style'].includes(a.name)) {
                    btn.removeAttribute(a.name);
                }
            }
            btn.classList.remove('ms-Button--hasMenu');
            btn.title = 'Extract transcript';
            btn.setAttribute('aria-label', 'Extract transcript');
            // Repaint the (primary) donor to orange with white text. Inline
            // background beats the generated :hover rule, so hover is manual.
            btn.style.background = TRIGGER_BG;
            btn.style.color = '#fff';
            btn.addEventListener('mouseenter', () => (btn.style.background = TRIGGER_BG_HOVER));
            btn.addEventListener('mouseleave', () => (btn.style.background = TRIGGER_BG));
            item.querySelector('.ms-Button-menuIcon')?.remove();
            const iconSlot = item.querySelector('.ms-Button-icon');
            if (iconSlot) {
                // The donor glyph is a font ::before; clear classes so it
                // disappears, then drop in the SVG.
                iconSlot.className = '';
                iconSlot.removeAttribute('style');
                iconSlot.style.cssText = 'display:flex;align-items:center;margin-right:4px;';
                iconSlot.replaceChildren(transcriptIcon());
            }
            const labelEl = item.querySelector('.ms-Button-label');
            if (labelEl) labelEl.textContent = LABEL.idle;
            btn.addEventListener('click', () => run(labelEl || btn, btn));
            group.prepend(item);
            return;
        }

        // No command bar (e.g. recap OOPIF) — floating fallback.
        const btn = document.createElement('button');
        btn.type = 'button';
        const labelEl = document.createElement('span');
        labelEl.textContent = LABEL.idle;
        const icon = document.createElement('i');
        icon.style.cssText = 'display:flex;align-items:center;';
        icon.append(transcriptIcon());
        btn.append(icon, labelEl);
        btn.style.cssText =
            'position:fixed;bottom:20px;right:20px;z-index:2147483646;padding:10px 18px;' +
            `background:${TRIGGER_BG};color:#fff;border:none;border-radius:6px;cursor:pointer;` +
            `font:600 14px ${UI_FONT};box-shadow:0 2px 8px rgba(0,0,0,.25);` +
            'display:flex;align-items:center;gap:8px;';
        btn.addEventListener('click', () => run(labelEl, btn));
        document.body.append(btn);
    }

    // xplatplugins.aspx hosts many recap plugins; only pages where SharePoint
    // actually exposes g_fileInfo + .spItemUrl are real recording players.
    // The command bar also renders late, so poll for both before injecting.
    (async () => {
        if (/^teams\.(cloud\.microsoft|microsoft\.com)$/.test(location.hostname)) {
            startTeams();
            return;
        }
        let haveFile = false;
        for (let i = 0; i < 240; i++) {
            const file = itemBase();
            if (file) haveFile = true;
            if (file && document.querySelector('.ms-CommandBar-secondaryCommand')) { addTriggerButton(); return; }
            // g_fileInfo present but command bar absent for ~30s -> floating fallback
            if (file && i > 60) { addTriggerButton(); return; }
            await sleep(500);
        }
        if (!haveFile) log('g_fileInfo.spItemUrl not found after 120s — no trigger button added');
    })();
})();
