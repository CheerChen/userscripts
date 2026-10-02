// ==UserScript==
// @name         PikPak Aria2 Helper
// @name:en      PikPak Aria2 Helper
// @name:ja      PikPak Aria2 ヘルパー
// @name:zh-CN   PikPak Aria2 助手
// @name:zh-TW   PikPak Aria2 助手
// @name:ko      PikPak Aria2 도우미
// @name:ru      PikPak Aria2 Помощник
// @name:es      PikPak Aria2 Ayudante
// @name:pt-BR   PikPak Aria2 Auxiliar
// @name:fr      PikPak Aria2 Assistant
// @name:de      PikPak Aria2 Helfer
// @namespace    https://github.com/CheerChen
// @version      0.3.0
// @description  Send PikPak's native selection to aria2 from the context menu or selection toolbar.
// @description:en Send PikPak's native selection to aria2 from the context menu or selection toolbar.
// @description:ja PikPakの選択したファイルを右クリックメニューまたは操作バーからaria2に送信します。
// @description:zh-CN 从 PikPak 原生右键菜单和多选操作栏发送文件或文件夹到 aria2。
// @description:zh-TW 從 PikPak 原生右鍵選單和多選操作列傳送檔案或資料夾到 aria2。
// @author       cheerchen37
// @match        *://mypikpak.com/*
// @match        *://*.mypikpak.com/*
// @match        *://mypikpak.net/*
// @match        *://*.mypikpak.net/*
// @match        *://pikpak.me/*
// @match        *://*.pikpak.me/*
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      *
// @icon         https://www.google.com/s2/favicons?domain=mypikpak.com
// @license      MIT
// @homepage     https://github.com/CheerChen/userscripts
// @supportURL   https://github.com/CheerChen/userscripts/issues
// ==/UserScript==

(() => {
    'use strict';
    if (window.top !== window.self) return;
    const page = unsafeWindow;
    const KEY = 'pikpak-aria2-helper-config';
    const defaults = { rpcUrl: 'http://127.0.0.1:6800/jsonrpc', rpcToken: '', downloadPath: '', customParams: '' };
    const zh = navigator.language.startsWith('zh');
    const tr = (cn, en) => zh ? cn : en;
    const label = tr('发送到 aria2', 'Send to aria2');
    let busy = false, job = null, panel = null, settings = null, noticeReason = '', scheduled = false;

    function node(tag, attrs = {}, text = '') {
        const el = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
        el.textContent = text;
        return el;
    }
    function button(text, action, attrs = {}) {
        const el = node('button', { type: 'button', ...attrs }, text);
        el.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); action(); });
        return el;
    }
    function config() {
        let saved = GM_getValue(KEY, null);
        if (!saved) {
            try { saved = JSON.parse(page.localStorage.getItem(KEY)); } catch { /* No legacy configuration. */ }
            if (saved) GM_setValue(KEY, saved);
        }
        return { ...defaults, ...saved };
    }
    function options(value) {
        const url = new URL(value.rpcUrl);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
            throw new Error(tr('RPC 地址必须是 HTTP(S)，密钥请填在独立字段', 'Use an HTTP(S) RPC URL; put the token in its own field'));
        const extra = {};
        for (const part of value.customParams.split(';').filter(x => x.trim())) {
            const at = part.indexOf('='), key = part.slice(0, at).trim(), val = part.slice(at + 1).trim();
            if (at < 1 || !key || !val || ['out', 'dir', '__proto__', 'constructor', 'prototype'].includes(key))
                throw new Error(tr('额外参数格式为 key=value；out 和 dir 由脚本管理', 'Use key=value options; out and dir are managed by the script'));
            extra[key] = val;
        }
        return { ...value, rpcUrl: url.href, extra };
    }
    // Keep the coupling to PikPak's private Vue/Pinia state in one adapter.
    function selection() {
        if (!location.pathname.startsWith('/drive/') || /\/trash(?:\/|$)/.test(location.pathname))
            throw new Error(tr('此页面不支持发送', 'Sending is not supported on this page'));
        const store = page.document.querySelector('#app')?.__vue_app__?.config.globalProperties?.$pinia?._s?.get('file');
        if (!store || !Array.isArray(store.selectedIds) || typeof store.getFileById !== 'function')
            throw new Error(tr('无法读取 PikPak 原生选择，请刷新页面；没有发送任何文件', 'Cannot read native selection. Reload the page; nothing was sent'));
        const ids = [...new Set(store.selectedIds)];
        if (!ids.length) throw new Error(tr('请先在 PikPak 列表中选择文件', 'Select files in PikPak first'));
        return ids.map(id => {
            const f = typeof id === 'string' && store.getFileById(id);
            if (!f || f.id !== id || !f.name || !['drive#file', 'drive#folder'].includes(f.kind))
                throw new Error(tr('选中项无法完整解析，已停止发送', 'Cannot resolve every selected item; sending was stopped'));
            return { id: f.id, name: f.name, kind: f.kind };
        });
    }
    function auth() {
        let token = '', captcha = '';
        const storage = page.localStorage;
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            try {
                const value = JSON.parse(storage.getItem(key));
                if (key.startsWith('credentials') && value?.access_token) token = value.token_type + ' ' + value.access_token;
                if (key.startsWith('captcha') && value?.captcha_token) captcha = value.captcha_token;
            } catch { /* Unrelated storage entry. */ }
        }
        if (!token) throw new Error(tr('PikPak 登录已失效', 'PikPak authentication is unavailable'));
        let device = storage.getItem('deviceid') || '';
        if (device.includes('.')) device = device.split('.')[1]?.substring(0, 32) || device;
        return { Authorization: token, 'x-device-id': device, 'x-captcha-token': captcha };
    }
    function request(url, { body, headers = {}, signal, timeout = 20000 } = {}) {
        return new Promise((resolve, reject) => {
            let handle;
            const abortError = () => Object.assign(new Error(tr('已取消', 'Cancelled')), { uncertain: !!body, cancelled: true });
            const abort = () => { handle?.abort(); reject(abortError()); };
            if (signal?.aborted) return reject(abortError());
            const finish = fn => value => { signal?.removeEventListener('abort', abort); fn(value); };
            handle = GM_xmlhttpRequest({
                method: body ? 'POST' : 'GET', url, timeout,
                headers: { 'Content-Type': 'application/json', ...headers },
                ...(body ? { data: JSON.stringify(body) } : {}),
                onload: finish(res => {
                    if (res.status < 200 || res.status >= 300) return reject(Object.assign(new Error(`HTTP ${res.status}`), { uncertain: !!body }));
                    try { resolve(JSON.parse(res.responseText)); } catch { reject(Object.assign(new Error(tr('响应格式错误', 'Invalid response')), { uncertain: !!body })); }
                }),
                onerror: finish(() => reject(Object.assign(new Error(tr('网络错误', 'Network error')), { uncertain: !!body }))),
                ontimeout: finish(() => reject(Object.assign(new Error(tr('请求超时', 'Request timed out')), { uncertain: !!body }))),
                onabort: finish(() => reject(abortError())),
            });
            signal?.addEventListener('abort', abort, { once: true });
        });
    }
    async function api(path, signal) {
        const res = await request('https://api-drive.mypikpak.com/drive/v1/files' + path, { headers: auth(), signal });
        if (res.error || res.error_description) throw new Error(tr('PikPak 文件请求失败', 'PikPak file request failed'));
        return res;
    }
    function segment(name) {
        const clean = String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '');
        if (!clean || /^\.+$/.test(clean)) return '_';
        return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean) ? '_' + clean : clean;
    }
    async function expand(roots, signal) {
        const files = [], seen = new Set(), folders = [];
        const add = (f, path) => {
            if (!f?.id || !f.name || !['drive#file', 'drive#folder'].includes(f.kind)) throw new Error(tr('目录数据不完整', 'Incomplete folder data'));
            if (seen.has(f.id)) return;
            seen.add(f.id);
            if (seen.size > 100000) throw new Error(tr('任务过大，请缩小选择范围', 'Too many items; select a smaller batch'));
            f.kind === 'drive#folder' ? folders.push({ id: f.id, path: [...path, segment(f.name)] }) : files.push({ id: f.id, name: f.name, path, status: 'pending' });
        };
        // A selected folder owns descendants also selected separately, preserving paths.
        for (const f of roots.filter(f => f.kind === 'drive#folder')) add(f, []);
        for (let index = 0; index < folders.length; index++) {
            const folder = folders[index];
            job.message = tr('正在展开文件夹…', 'Scanning folders…'); paint();
            let token = ''; const tokens = new Set();
            do {
                if (signal.aborted) throw Object.assign(new Error(tr('已取消', 'Cancelled')), { cancelled: true });
                const query = new URLSearchParams({ parent_id: folder.id, limit: '500', with_audit: 'true', filters: JSON.stringify({ phase: { eq: 'PHASE_TYPE_COMPLETE' }, trashed: { eq: false } }) });
                if (token) query.set('page_token', token);
                const res = await api('?' + query, signal);
                if (!Array.isArray(res.files)) throw new Error(tr('目录响应缺少文件列表', 'Folder response has no file list'));
                for (const f of res.files) add(f, folder.path);
                token = res.next_page_token || '';
                if (typeof token !== 'string') throw new Error(tr('目录分页格式异常', 'Invalid folder pagination token'));
                if (token && tokens.has(token)) throw new Error(tr('目录分页异常', 'Repeated folder pagination token'));
                tokens.add(token);
            } while (token);
        }
        for (const f of roots.filter(f => f.kind === 'drive#file')) add(f, []);
        return files;
    }
    function directory(base, path) {
        const sep = base.includes('\\') ? '\\' : '/';
        if (!path.length) return base;
        const prefix = base ? base.replace(/[/\\]+$/g, '') + sep : '';
        return prefix + path.join(sep);
    }
    async function send(roots, cfg, retry = false) {
        if (busy) return;
        busy = true;
        if (!retry) job = { roots, cfg, files: [], message: '', scanFailed: false };
        job.state = 'running';
        const controller = new AbortController(); job.controller = controller;
        try {
            if (!retry || job.scanFailed) { job.scanFailed = true; job.files = await expand(roots, controller.signal); job.scanFailed = false; }
            const pending = job.files.filter(f => ['pending', 'failed'].includes(f.status));
            for (const file of pending) {
                if (controller.signal.aborted) break;
                job.message = tr('正在提交到 aria2…', 'Submitting to aria2…'); paint();
                try {
                    const detail = await api('/' + encodeURIComponent(file.id), controller.signal);
                    if (detail.id !== file.id || !detail.name || !detail.web_content_link || new URL(detail.web_content_link).protocol !== 'https:')
                        throw new Error(tr('文件详情或下载链接无效', 'Invalid file detail or download URL'));
                    const opts = { ...cfg.extra, out: segment(detail.name) };
                    const dir = directory(cfg.downloadPath, file.path);
                    if (dir) opts.dir = dir;
                    const params = [[detail.web_content_link], opts];
                    if (cfg.rpcToken) params.unshift('token:' + cfg.rpcToken);
                    const call = { jsonrpc: '2.0', id: Date.now() + '-' + file.id, method: 'aria2.addUri', params };
                    const result = await request(cfg.rpcUrl, { body: call, signal: controller.signal });
                    if (result.jsonrpc !== '2.0' || result.id !== call.id) throw Object.assign(new Error(tr('aria2 响应无法匹配请求', 'Cannot match the aria2 response to the request')), { uncertain: true });
                    if (result.error) throw new Error(tr('aria2 拒绝了任务，请检查设置', 'aria2 rejected the task; check settings'));
                    if (typeof result.result !== 'string' || !result.result) throw Object.assign(new Error(tr('aria2 响应无法确认', 'Cannot confirm the aria2 response')), { uncertain: true });
                    file.status = 'sent'; file.error = '';
                } catch (e) {
                    file.status = e.uncertain ? 'uncertain' : e.cancelled ? 'pending' : 'failed';
                    file.error = e.message;
                    if (e.cancelled) break;
                }
                paint();
            }
            job.state = controller.signal.aborted ? 'stopped' : 'done';
            job.message = controller.signal.aborted ? tr('已停止；已提交的任务不会撤回', 'Stopped; submitted tasks are not removed') : '';
        } catch (e) { job.state = 'error'; job.message = e.message; }
        finally { busy = false; paint(); reconcile(); }
    }
    async function fingerprint(cfg) {
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([cfg.rpcUrl, cfg.rpcToken])));
        return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    async function testConnection(cfg, signal) {
        const result = await request(cfg.rpcUrl, { timeout: 5000, signal, body: { jsonrpc: '2.0', id: 'connection-test', method: 'aria2.getVersion', params: cfg.rpcToken ? ['token:' + cfg.rpcToken] : [] } });
        if (result.error || result.id !== 'connection-test' || result.jsonrpc !== '2.0' || !result.result?.version)
            throw new Error(tr('连接失败，请检查地址和密钥', 'Connection failed; check URL and token'));
    }
    async function start(retry = false) {
        if (busy || document.getElementById('pikpak-aria2-confirm')) return;
        let roots, cfg;
        try {
            roots = retry ? job.roots : selection();
        } catch (e) {
            job = { roots: [], files: [], message: e.message, state: 'error' }; paint(); return;
        }
        busy = true; reconcile();
        try {
            cfg = options(config());
            if (cfg.verifiedRpc !== await fingerprint(cfg)) throw new Error(tr('aria2 设置尚未通过连接测试，请测试成功后保存。', 'aria2 settings have not passed a connection test. Test them successfully and save.'));
            await testConnection(cfg); // Recheck availability before any file API/addUri.
            busy = false; reconcile();
            // Multiple selected items are confirmed once; retries reuse the confirmed batch.
            if (!retry && roots.length > 1 && !await confirmBatch(roots)) return;
            if (busy) return;
            if (retry) job.cfg = cfg;
            void send(roots, cfg, retry);
        } catch (e) {
            busy = false; reconcile();
            showNotice(tr('没有发送任何任务。', 'No tasks were sent. ') + e.message);
        }
    }
    function paint() {
        if (!job) return;
        if (!panel?.isConnected) {
            panel = node('section', { id: 'pikpak-aria2-progress', class: 'pah-card', 'aria-label': label });
            document.body.append(panel);
        }
        panel.replaceChildren();
        const counts = { sent: 0, failed: 0, pending: 0, uncertain: 0 };
        for (const f of job.files) counts[f.status]++;
        const tone = busy ? 'running' : job.state === 'error' || counts.failed ? 'error'
            : job.state === 'stopped' || counts.uncertain || counts.pending || !job.files.length ? 'warning' : 'success';
        const text = job.state !== 'done' ? job.message
            : counts.failed ? tr(`${counts.failed} 项提交失败`, `${counts.failed} failed to submit`)
            : counts.uncertain ? tr(`${counts.uncertain} 项未能确认是否提交`, `${counts.uncertain} could not be confirmed`)
            : !job.files.length ? tr('所选文件夹中没有可发送的文件', 'The selected folders contain no files to send')
            : tr(`已提交 ${counts.sent} 个任务到 aria2`, `Submitted ${counts.sent} tasks to aria2`);
        const title = node('div', { class: 'pah-card-title', 'data-pah-tone': tone });
        if (tone !== 'running') title.append(icon(tone));
        title.append(node('strong', {}, label));
        const message = node('p', { role: 'status', 'aria-live': 'polite' }, text);
        const summary = node('p', { 'data-pah-counts': JSON.stringify(counts) }, tr(`共 ${job.files.length} · 已提交 ${counts.sent} · 失败 ${counts.failed} · 待发送 ${counts.pending} · 未确认 ${counts.uncertain}`, `${job.files.length} total · ${counts.sent} submitted · ${counts.failed} failed · ${counts.pending} pending · ${counts.uncertain} unconfirmed`));
        panel.append(title, message, summary);
        if (counts.uncertain) panel.append(node('p', {}, tr('未确认的任务可能已被接收；请先检查 aria2，脚本不会自动重发。', 'Unconfirmed tasks may have been accepted. Check aria2 first; they are not automatically retried.')));
        const errors = job.files.filter(f => ['failed', 'uncertain'].includes(f.status));
        if (errors.length) {
            const details = node('details'), list = node('ul');
            details.append(node('summary', {}, tr('失败详情', 'Failure details')));
            for (const f of errors) list.append(node('li', {}, f.name + ': ' + f.error));
            details.append(list); panel.append(details);
        }
        const actions = node('div', { class: 'pah-actions' });
        if (busy) actions.append(button(tr('停止', 'Stop'), () => job.controller.abort(), { 'data-pah-stop': '' }));
        else {
            if (job.roots.length && (counts.failed || counts.pending || job.scanFailed)) actions.append(button(tr('重试未发送项', 'Retry unsent items'), () => void start(true), { 'data-pah-retry': '' }));
            actions.append(button(tr('关闭', 'Close'), () => { panel.remove(); panel = null; job = null; }, { 'data-pah-close': '' }));
        }
        actions.append(button(tr('设置', 'Settings'), showSettings, { 'data-pah-settings': '' }));
        panel.append(actions);
    }
    // Shared modal behavior: scroll lock, focus containment, Tab cycling, Escape/backdrop close.
    function modal(root, backdrop, dialog, initial, onClose) {
        const previousFocus = document.activeElement, oldOverflow = document.body.style.overflow;
        const state = { closed: false };
        const containFocus = e => {
            if (!state.closed && !dialog.contains(e.target)) queueMicrotask(() => {
                if (!state.closed && !dialog.contains(document.activeElement)) initial().focus({ preventScroll: true });
            });
        };
        state.close = () => {
            if (state.closed) return;
            state.closed = true;
            document.removeEventListener('focusin', containFocus, true);
            root.remove(); document.body.style.overflow = oldOverflow; onClose();
            if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        };
        root.addEventListener('keydown', e => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); state.close(); }
            if (e.key === 'Tab') {
                const nodes = [...dialog.querySelectorAll('input,button,a[href]')].filter(n => !n.disabled && n.getClientRects().length);
                const first = nodes[0], last = nodes.at(-1);
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        });
        backdrop.addEventListener('click', e => { if (e.target === backdrop) state.close(); });
        document.body.style.overflow = 'hidden';
        document.body.append(root);
        document.addEventListener('focusin', containFocus, true);
        initial().focus({ preventScroll: true });
        requestAnimationFrame(() => { if (!state.closed) initial().focus({ preventScroll: true }); });
        return state;
    }
    // Preflight refusals explain the problem first; settings open only on request.
    // PikPak-style (Element Plus) message box; resolves true only for the confirm action.
    function messageBox({ id, tone, title, message, confirm }) {
        return new Promise(resolve => {
            let m, accepted = false;
            const root = node('div', { id, class: 'el-overlay is-message-box pah-message' });
            const backdrop = node('div', { class: 'el-overlay-message-box' });
            const box = node('div', { class: 'el-message-box pp-message-box pah-message-box', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': id + '-title', 'aria-describedby': id + '-message', tabindex: '-1' });
            const header = node('div', { class: 'el-message-box__header' }), heading = node('div', { class: 'el-message-box__title' });
            if (tone) heading.append(icon(tone));
            heading.append(node('span', { id: id + '-title' }, title));
            const content = node('div', { class: 'el-message-box__content' }), container = node('div', { class: 'el-message-box__container' }), body = node('div', { class: 'el-message-box__message' });
            body.append(node('p', { id: id + '-message', class: 'pah-message-text' }, message));
            container.append(body); content.append(container);
            const btns = node('div', { class: 'el-message-box__btns' });
            const cancel = button(tr('取消', 'Cancel'), () => m.close(), { class: 'el-button pp-message-box__cancel', 'data-pah-dialog-cancel': '' });
            const ok = button(confirm, () => { accepted = true; m.close(); }, { class: 'el-button el-button--primary', 'data-pah-dialog-confirm': '' });
            const closeButton = button('', () => m.close(), { class: 'el-message-box__headerbtn', 'aria-label': tr('关闭', 'Close') });
            closeButton.append(icon('close'));
            header.append(heading, closeButton); btns.append(cancel, ok); box.append(header, content, btns); backdrop.append(box); root.append(backdrop);
            m = modal(root, backdrop, box, () => ok, () => resolve(accepted));
        });
    }
    // Preflight refusals explain the problem first; settings open only on request.
    function showNotice(reason) {
        if (settings?.isConnected) return showSettings(reason);
        noticeReason = reason;
        const open = document.getElementById('pikpak-aria2-notice');
        if (open) { open.querySelector('.pah-message-text').textContent = reason; return; }
        void messageBox({ id: 'pikpak-aria2-notice', tone: 'error', title: tr('无法发送到 aria2', 'Cannot send to aria2'), message: reason, confirm: tr('前往设置', 'Open settings') })
            .then(ok => { if (ok) showSettings(noticeReason); });
    }
    function confirmBatch(roots) {
        const folders = roots.filter(f => f.kind === 'drive#folder').length;
        return messageBox({
            id: 'pikpak-aria2-confirm', title: tr('确认发送到 aria2', 'Send to aria2?'), confirm: tr('发送', 'Send'),
            message: tr(`将发送选中的 ${roots.length} 项`, `Send the ${roots.length} selected items`)
                + (folders ? tr(`，其中 ${folders} 个文件夹会展开发送全部文件。`, `; ${folders} folders will be expanded and all their files sent.`) : tr('。', '.')),
        });
    }
    function showSettings(reason = '') {
        if (settings?.isConnected) {
            if (reason) { const feedback = settings.querySelector('[data-pah-settings-feedback]'); feedback.textContent = reason; feedback.setAttribute('role', 'alert'); }
            return;
        }
        const cfg = config();
        settings = node('div', { id: 'pikpak-aria2-settings', class: 'el-overlay el-modal-dialog' });
        const overlay = node('div', { class: 'el-overlay-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pah-settings-title' });
        const dialog = node('div', { class: 'el-dialog pp-popover setting-dialog pah-settings-dialog', tabindex: '-1' });
        const body = node('div', { class: 'el-dialog__body' }), layout = node('div', { class: 'pp-popover__content pah-settings-layout' });
        const tab = node('aside', { class: 'pah-settings-tab' }), active = node('div', { class: 'active' });
        active.append(node('span', {}, 'aria2'));
        tab.append(node('h5', {}, tr('设置', 'Settings')), active);
        const content = node('div', { class: 'pah-settings-content' });
        content.append(node('h5', { id: 'pah-settings-title', class: 'pah-settings-title' }, tr('aria2 设置', 'aria2 settings')));
        const form = node('form'), inputs = {};
        for (const [key, title, type] of [
            ['rpcUrl', tr('RPC 地址', 'RPC URL'), 'url'], ['rpcToken', tr('RPC 密钥', 'RPC token'), 'password'],
            ['downloadPath', tr('下载目录（在 aria2 主机上）', 'Download directory (on aria2 host)'), 'text'], ['customParams', tr('其他参数（key=value;key=value）', 'Extra options (key=value;key=value)'), 'text'],
        ]) {
            const wrap = node('div', { class: 'pah-settings-subsection' }), fieldLabel = node('label', { for: 'pah-' + key }, title);
            const inputWrap = node('div', { class: 'el-input' }), inner = node('div', { class: 'el-input__wrapper' });
            const input = node('input', { id: 'pah-' + key, class: 'el-input__inner', name: key, type, autocomplete: 'off' });
            input.value = cfg[key] || ''; inputs[key] = input;
            inner.append(input); inputWrap.append(inner); wrap.append(fieldLabel, inputWrap); form.append(wrap);
        }
        const feedback = node('p', { id: 'pah-settings-feedback', role: reason ? 'alert' : 'status', 'data-pah-settings-feedback': '', 'aria-live': 'polite' }, reason || tr('发送前需测试连接成功并保存。', 'Test the connection successfully and save before sending.'));
        for (const input of Object.values(inputs)) input.setAttribute('aria-describedby', feedback.id);
        const read = () => options(Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, k === 'rpcToken' ? el.value : el.value.trim()])));
        let tested = cfg.verifiedRpc || '', revision = 0, testController;
        for (const key of ['rpcUrl', 'rpcToken']) inputs[key].addEventListener('input', () => {
            tested = ''; revision++; testController?.abort();
            feedback.setAttribute('role', 'status');
            feedback.textContent = tr('连接参数已更改，请重新测试。', 'Connection settings changed; test again.');
        });
        let m;
        const actions = node('div', { class: 'pah-settings-actions' });
        const save = node('button', { type: 'submit', class: 'el-button el-button--primary' }, tr('保存', 'Save'));
        form.addEventListener('submit', async e => {
            e.preventDefault();
            try {
                const value = read(), stamp = await fingerprint(value);
                if (m.closed) return;
                value.verifiedRpc = tested === stamp ? stamp : '';
                delete value.extra; GM_setValue(KEY, value); m.close();
            } catch (e) { feedback.setAttribute('role', 'alert'); feedback.textContent = e.message; }
        });
        actions.append(save, button(tr('测试连接', 'Test connection'), async () => {
            testController?.abort(); testController = new AbortController();
            const controller = testController, current = revision;
            tested = '';
            feedback.setAttribute('role', 'status');
            feedback.textContent = tr('测试中…', 'Testing…');
            try {
                const value = read();
                await testConnection(value, controller.signal);
                const stamp = await fingerprint(value);
                if (m.closed || revision !== current || controller !== testController) return;
                tested = stamp;
                feedback.textContent = tr('连接成功', 'Connected');
            } catch (e) { if (!m.closed && revision === current && controller === testController) { feedback.setAttribute('role', 'alert'); feedback.textContent = e.message; } }
        }, { 'data-pah-test': '', class: 'el-button' }));
        const closeButton = button('', () => m.close(), { 'data-pah-settings-close': '', class: 'pah-settings-close', 'aria-label': tr('关闭 aria2 设置', 'Close aria2 settings') });
        closeButton.append(icon('close'));
        form.append(feedback, actions); content.append(form); layout.append(tab, content, closeButton); body.append(layout); dialog.append(body); overlay.append(dialog); settings.append(overlay);
        m = modal(settings, overlay, dialog, () => inputs.rpcUrl, () => { testController?.abort(); settings = null; });
    }
    function scope(from, to) {
        for (const attr of from?.attributes || []) if (attr.name.startsWith('data-v-')) to.setAttribute(attr.name, '');
    }
    const glyphs = {
        send: 'M21 3 9 15M21 3l-5 18-7-6-6-6 18-6Z', close: 'M6 6l12 12M6 18 18 6',
        success: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM8 12.5l2.7 2.7L16 9.5',
        error: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM9.5 9.5l5 5M14.5 9.5l-5 5',
        warning: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7.5v5.5M12 16.5v.01',
    };
    const toneColors = { success: 'var(--el-color-success,#54cfad)', error: 'var(--color-error,#ff663b)', warning: 'var(--el-color-warning,#e6a23c)' };
    function icon(kind = 'send', template) {
        const wrap = node('span', { class: 'pp-icon', 'data-pah-icon': kind });
        scope(template, wrap);
        const color = toneColors[kind];
        wrap.style.cssText = color ? `--icon-color:${color};--icon-color-hover:${color};color:${color};flex:0 0 24px;width:24px;height:24px;display:flex`
            : '--icon-color:var(--color-secondary-text);--icon-color-hover:var(--color-primary);flex:0 0 24px;width:24px;height:24px;display:flex';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(svg.namespaceURI, 'path');
        path.setAttribute('d', glyphs[kind]);
        path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', kind === 'send' ? '1.8' : '2'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
        svg.append(path); wrap.append(svg); return wrap;
    }
    function inject(container, kind) {
        const existing = container.querySelector(':scope > [data-pah-send]');
        if (existing) { if (container.firstElementChild !== existing) container.prepend(existing); return; }
        const template = container.querySelector('li:not([data-pah-send])');
        const item = node('li', { 'data-pah-send': kind, 'data-group': 'aria2', class: 'aria2-helper-button' }); scope(template, item);
        const link = node('a', { href: '#', role: 'button', title: label, 'aria-label': label, class: 'pp-link-button' }); scope(template?.querySelector('a'), link);
        link.append(icon('send', template?.querySelector('.pp-icon')));
        if (kind === 'context') { const text = node('span', { class: 'pah-send-label' }, label); scope(template?.querySelector('a>span:last-child'), text); link.append(text); }
        const activate = () => {
            void start(); // Snapshots the selection synchronously, before the menu closes.
            // PikPak closes its context menu on an outside press+click, ignoring clicks within the
            // current one's task, so replay both on body in the next task. The selection is kept.
            if (kind === 'context') setTimeout(() => { for (const e of [new PointerEvent('pointerdown', { bubbles: true }), new MouseEvent('click', { bubbles: true })]) document.body.dispatchEvent(e); });
        };
        link.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); activate(); });
        link.addEventListener('keydown', e => { if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); activate(); } });
        item.addEventListener('pointerdown', e => e.stopPropagation());
        item.addEventListener('mousedown', e => e.stopPropagation());
        item.append(link); container.prepend(item);
    }
    function injectSettings(container) {
        if (container.querySelector('[data-pah-config]')) return;
        const template = container.querySelector('li');
        const configItem = node('li', { 'data-pah-config': 'gear' }); scope(template, configItem);
        const configLink = node('a', { href: '#', role: 'button', 'aria-label': tr('aria2 设置', 'aria2 settings'), class: 'pp-link-button' }, tr('aria2 设置', 'aria2 settings'));
        configLink.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); showSettings(); });
        configLink.addEventListener('keydown', e => { if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); showSettings(); } });
        configItem.addEventListener('pointerdown', e => e.stopPropagation());
        configItem.addEventListener('mousedown', e => e.stopPropagation());
        scope(template?.querySelector('a') || template, configLink);
        configItem.append(configLink); container.append(configItem);
    }
    function reconcile() {
        const supported = location.pathname.startsWith('/drive/') && !/\/trash(?:\/|$)/.test(location.pathname);
        document.querySelectorAll('.menu-popover > .menu').forEach(injectSettings);
        if (!supported) { document.querySelectorAll('[data-pah-send]').forEach(n => n.remove()); return; }
        document.querySelectorAll('.file-explorer-operation-box .file-operations').forEach(el => inject(el, 'toolbar'));
        // Vue teleports the file menu to body; it is not under .menu-box.
        document.querySelectorAll('.context-menu.show:not(.transfer-context-menu):has(li[data-group])').forEach(el => inject(el, 'context'));
        document.querySelectorAll('[data-pah-send] a').forEach(a => {
            a.setAttribute('aria-disabled', String(busy));
            const text = busy ? tr('正在检查或发送…', 'Checking or sending…') : label;
            a.setAttribute('aria-label', text); a.setAttribute('title', text);
        });
    }
    function schedule() {
        if (scheduled) return;
        scheduled = true;
        setTimeout(() => { scheduled = false; reconcile(); }, 80);
    }
    const style = node('style', { id: 'pikpak-aria2-style' });
    style.textContent = `
        .pah-card{position:fixed;right:20px;bottom:20px;z-index:10000;width:min(390px,calc(100vw - 40px));max-height:65vh;overflow:auto;padding:18px;border:1px solid #8885;border-radius:12px;box-shadow:0 8px 30px #0003;background:var(--el-bg-color,#fff);color:var(--color-primary-text,#222);font:14px/1.5 system-ui}.pah-card p{margin:10px 0}.pah-card-title{display:flex;align-items:center;gap:8px}.pah-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.pah-actions button{padding:7px 12px;border:1px solid #8886;border-radius:6px;cursor:pointer;background:transparent;color:inherit}.pah-card details li{overflow-wrap:anywhere}
        .aria2-helper-button>a{cursor:pointer;white-space:nowrap}.aria2-helper-button>a[aria-disabled=true]{opacity:.5;cursor:wait}
        .context-menu [data-pah-send=context]{position:relative;border-radius:4px;padding:0 10px;margin-bottom:8px}.context-menu [data-pah-send=context]::after{content:"";position:absolute;bottom:-4px;left:0;right:0;height:1px;background:var(--el-border-color-light,#e3e7eb)}.context-menu [data-pah-send=context]:hover{background:var(--color-hover,#f2f3f4)}.context-menu [data-pah-send=context]>a{display:flex;height:44px;justify-content:flex-start}.pah-send-label{margin-left:12px;text-align:left}
        .file-explorer-operation-box [data-pah-send=toolbar] .pp-icon{display:flex;width:24px;height:24px}.file-explorer-operation-box [data-pah-send=toolbar]>a{width:24px;height:24px}
        #pikpak-aria2-settings,.pah-message{position:fixed;inset:0;z-index:10002;background:rgba(0,0,0,.6);font:14px/21px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--color-primary-text,#000)}
        #pikpak-aria2-settings .el-overlay-dialog{position:fixed;inset:0;overflow:auto}
        #pikpak-aria2-settings .pah-settings-dialog{position:relative;top:50%;transform:translateY(-50%);margin:0 auto;padding:0;width:960px;max-width:calc(100% - 24px);height:640px;max-height:95%;border-radius:16px;box-shadow:0 4px 16px #0000001a;background:var(--el-bg-color,#fff);overflow:hidden}
        #pikpak-aria2-settings .el-dialog__body{display:flex;padding:0!important;height:100%;background:none}.pah-settings-layout{display:flex!important;align-items:stretch!important;height:100%;position:relative;width:100%;margin:0!important;overflow:hidden}
        .pah-settings-tab{box-sizing:border-box;width:180px;height:100%;flex-shrink:0;padding:32px 12px;color:var(--color-primary-text,#000);background:var(--color-active,#f2f3f4)}.pah-settings-tab h5{font-size:18px;font-weight:600;line-height:27px;margin:0 0 11px 16px}.pah-settings-tab .active{box-sizing:border-box;display:flex;align-items:center;min-height:44px;padding:0 16px;border-radius:4px;color:var(--color-primary,#306eff);background:rgba(48,110,255,.1)}
        .pah-settings-content{box-sizing:border-box;flex:1;min-width:0;height:100%;overflow:auto;padding:32px 24px}.pah-settings-title{margin:0 0 26px;font-size:14px;font-weight:600;line-height:20px;color:var(--color-primary-text,#000)}.pah-settings-subsection{margin-top:32px}.pah-settings-subsection label{display:block;margin-bottom:12px}
        .pah-settings-subsection .el-input{display:inline-flex;width:360px;max-width:100%;font-size:14px;line-height:32px}.pah-settings-subsection .el-input__wrapper{box-sizing:border-box;display:inline-flex;flex:1;align-items:center;padding:1px 11px;border-radius:4px;box-shadow:0 0 0 1px var(--el-border-color,#dcdfe6) inset;background:var(--el-bg-color,#fff);transition:box-shadow .2s}.pah-settings-subsection .el-input__wrapper:hover{box-shadow:0 0 0 1px var(--el-border-color-hover,#c0c4cc) inset}.pah-settings-subsection .el-input__wrapper:focus-within{box-shadow:0 0 0 1px var(--color-primary,#306eff) inset}.pah-settings-subsection .el-input__inner{box-sizing:border-box;width:100%;min-width:0;height:30px;padding:0;border:0;outline:none;background:transparent;font:inherit;color:inherit}
        :where(#pikpak-aria2-settings,.pah-message) :where(.el-button){box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:36px;padding:8px 15px;border:1px solid var(--el-border-color,#dcdfe6);border-radius:4px;background:var(--el-bg-color,#fff);color:var(--color-primary-text,#000);font-family:inherit;font-size:14px;font-weight:500;line-height:14px;cursor:pointer}:where(#pikpak-aria2-settings,.pah-message) :where(.el-button--primary){border-color:var(--color-primary,#306eff);border-radius:6px;background:var(--color-primary,#306eff);color:#fff}
        .pah-settings-actions{display:flex;gap:12px;margin-top:24px}.pah-settings-actions .el-button+.el-button{margin-left:0}
        #pah-settings-feedback{min-height:20px;margin:24px 0 0;font-size:13px;line-height:20px;color:var(--color-secondary-text,#666)}#pah-settings-feedback[role=alert]{color:var(--color-error,#ff663b)}
        .pah-settings-close{position:absolute;right:32px;top:32px;border:0;background:transparent;padding:0;cursor:pointer;color:var(--color-secondary-text,#666)}.pah-settings-close:hover{color:var(--color-primary,#306eff)}
        .pah-message{z-index:10003}.pah-message .el-overlay-message-box{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto}
        .pah-message .pah-message-box{position:relative;box-sizing:border-box;width:340px;max-width:100%;padding:24px;border-radius:16px;background:var(--el-bg-color,#fff);box-shadow:0 12px 32px 4px #0000000a,0 8px 20px #00000014;text-align:left;overflow-wrap:anywhere}
        .pah-message .el-message-box__header{padding:0 32px 8px 0}.pah-message .el-message-box__title{display:flex;align-items:center;gap:8px}.pah-message .el-message-box__title span{font-size:18px;font-weight:600;line-height:25px;color:var(--color-primary-text,#000)}
        .pah-message .el-message-box__headerbtn{position:absolute;right:20px;top:24px;width:24px;height:24px;padding:0;border:0;background:transparent;cursor:pointer;color:var(--color-secondary-text,#666)}.pah-message .el-message-box__headerbtn:hover{color:var(--color-primary,#306eff)}
        .pah-message .el-message-box__content{padding:0;color:var(--color-secondary-text,#666);font-size:14px;line-height:20px}.pah-message .el-message-box__message p{margin:0}
        .pah-message .el-message-box__btns{display:flex;justify-content:flex-end;gap:12px;padding:24px 0 0}.pah-message .el-message-box__btns .el-button{margin:0}.pah-message .el-message-box__btns .el-button--primary{min-width:100px}.pah-message .pp-message-box__cancel{color:var(--color-secondary-text,#666)}
        [data-pah-config=gear]>a{height:100%;justify-content:flex-start;display:flex}.menu-popover [data-pah-config=gear]:hover{background:var(--color-hover,#f2f3f4)}
        @media(max-width:768px){#pikpak-aria2-settings .pah-settings-dialog{width:100%;max-width:100%;height:100%;max-height:none;border-radius:0}}@media(max-width:600px){.pah-settings-tab{width:108px;padding:28px 8px}.pah-settings-tab h5{margin-left:8px}.pah-settings-content{padding:28px 16px}.pah-settings-close{right:12px;top:12px}}
    `;
    document.head.append(style);
    style.textContent += '.pah-card :focus-visible,#pikpak-aria2-settings :focus-visible:not(input),.pah-message :focus-visible,.aria2-helper-button>a:focus-visible,[data-pah-config]>a:focus-visible{outline:2px solid var(--color-primary,#1677ff);outline-offset:3px}';
    GM_registerMenuCommand(tr('aria2 设置', 'aria2 settings'), () => showSettings());
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    setInterval(schedule, 1000); // SPA route changes and production Vue rerenders.
    document.addEventListener('contextmenu', schedule, true);
    schedule();
})();
