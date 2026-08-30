// ==UserScript==
// @name         Tripo3D Model Downloader (Lite)
// @name:en      Tripo3D Model Downloader (Lite)
// @name:ja      Tripo3D モデルダウンローダー (Lite)
// @name:zh-CN   Tripo3D 模型下载器 (Lite)
// @namespace    https://github.com/CheerChen
// @version      1.0.0
// @description  Passively capture model (GLB/GLTF) download URLs on Tripo3D Studio via network interception, with a one-click download button. No DOM polling.
// @description:en Passively capture model (GLB/GLTF) download URLs on Tripo3D Studio via network interception, with a one-click download button. No DOM polling.
// @description:ja Tripo3D Studioでネットワーク傍受によりモデル（GLB/GLTF）のダウンロードURLをパッシブに取得。ワンクリックでダウンロード。DOMポーリングなし。
// @description:zh-CN 在 Tripo3D Studio 通过网络拦截被动捕获模型（GLB/GLTF）下载链接，提供一键下载按钮，无需轮询 DOM。
// @author       cheerchen37
// @match        https://studio.tripo3d.ai/*
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// @icon         https://www.google.com/s2/favicons?domain=tripo3d.ai
// @license      MIT
// @homepage     https://github.com/CheerChen/userscripts
// @supportURL   https://github.com/CheerChen/userscripts/issues
// @updateURL    https://raw.githubusercontent.com/CheerChen/userscripts/master/tripo3d-model-downloader-lite.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ── Config ──────────────────────────────────────────────────
    const GLB_PATTERNS = ['.glb', '.gltf', '/model?', '/download?', 'cloudfront.net', 'tripo3d.ai/model'];
    const API_PATTERNS = ['api.tripo3d.ai', '/api/', '/task/', '/model/', '/export', '/download'];
    const MODEL_KEYS = ['model_url', 'glb_url', 'file_url', 'pbr_model', 'base_model',
        'download_url', 'export_url', 'result_url', 'output_url', 'mesh_url'];

    // ── State ───────────────────────────────────────────────────
    const urls = []; // [{url, source, time}] newest first
    let primary = null;

    function isModelUrl(u) {
        if (!u || typeof u !== 'string') return false;
        const l = u.toLowerCase();
        return GLB_PATTERNS.some(p => l.includes(p));
    }
    function isApiUrl(u) {
        if (!u || typeof u !== 'string') return false;
        const l = u.toLowerCase();
        return API_PATTERNS.some(p => l.includes(p));
    }

    function capture(url, source) {
        if (!url || !url.startsWith('http') || urls.some(e => e.url === url)) return;
        urls.unshift({ url, source, time: Date.now() });
        if (urls.length > 20) urls.length = 20;
        // Prefer PBR > plain GLB > base
        if (!primary || url.includes('pbr_model')) primary = url;
        console.log(`[Tripo-Lite] ${source}: ${url.slice(0, 80)}`);
        render();
    }

    // Shallow scan — API responses are flat JSON, no need for deep recursion.
    function scanShallow(obj, source, depth) {
        depth = depth || 0;
        if (depth > 5 || !obj || typeof obj !== 'object') return;
        for (const key in obj) {
            if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
            const v = obj[key];
            if (typeof v === 'string' && v.startsWith('http')) {
                const kl = key.toLowerCase();
                if (MODEL_KEYS.some(k => kl.includes(k)) && isModelUrl(v)) {
                    capture(v, source + ':' + key);
                }
            } else if (typeof v === 'object' && v !== null) {
                scanShallow(v, source, depth + 1);
            }
        }
    }

    // ── 1. Fetch hook ───────────────────────────────────────────
    const _fetch = window.fetch;
    window.fetch = function (...args) {
        const url = args[0]?.url || String(args[0]);
        if (isModelUrl(url)) capture(url, 'fetch');
        return _fetch.apply(this, args).then(res => {
            if (isApiUrl(url) && !isModelUrl(url)) {
                const ct = res.headers.get('content-type') || '';
                if (ct.includes('json')) {
                    res.clone().json().then(d => scanShallow(d, 'api')).catch(() => {});
                }
            }
            return res;
        });
    };

    // ── 2. PerformanceObserver ──────────────────────────────────
    try {
        new PerformanceObserver(list => {
            for (const e of list.getEntries()) {
                if (isModelUrl(e.name)) capture(e.name, 'resource');
            }
        }).observe({ entryTypes: ['resource'] });
    } catch (e) {}

    // Also catch resources that already loaded before script injection
    try {
        for (const e of performance.getEntriesByType('resource')) {
            if (isModelUrl(e.name)) capture(e.name, 'resource-history');
        }
    } catch (e) {}

    // ── 3. Download ─────────────────────────────────────────────
    function filenameFromUrl(url) {
        const name = url.split('?')[0].split('/').pop();
        return (name && name.length > 3) ? name : `tripo_${Date.now()}.glb`;
    }

    function download(url) {
        GM_xmlhttpRequest({
            method: 'GET',
            url,
            responseType: 'blob',
            timeout: 120000,
            headers: { 'Referer': location.href, 'Origin': location.origin },
            onload(r) {
                if (r.status === 200) {
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(r.response);
                    a.download = filenameFromUrl(url);
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
                    toast('Download started');
                } else {
                    toast(`HTTP ${r.status} — URL may have expired, refresh the page`, true);
                }
            },
            onerror: () => toast('Network error', true),
            ontimeout: () => toast('Timed out — file may be too large', true),
        });
    }

    // ── 4. UI ───────────────────────────────────────────────────
    let btn, badge, menu;

    function toast(msg, isErr) {
        const t = document.createElement('div');
        t.textContent = msg;
        t.style.cssText = `position:fixed;top:20px;right:20px;z-index:2147483647;
            padding:10px 18px;border-radius:10px;font:13px -apple-system,BlinkMacSystemFont,sans-serif;
            color:#fff;background:${isErr ? '#e53935' : '#2e7d32'};box-shadow:0 4px 14px rgba(0,0,0,.25);
            transition:opacity .3s`;
        document.body.appendChild(t);
        setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
    }

    function build() {
        // Shadow DOM so site styles can't leak in
        const host = document.createElement('div');
        host.id = 'tripo-lite-host';
        host.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483646';
        const shadow = host.attachShadow({ mode: 'closed' });

        shadow.innerHTML = `
            <style>
                * { margin:0; padding:0; box-sizing:border-box;
                    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
                .btn {
                    display:flex; align-items:center; gap:8px;
                    padding:11px 20px; border:none; border-radius:12px; cursor:pointer;
                    font-size:14px; font-weight:600; color:#fff;
                    background:#333; transition:all .2s; user-select:none;
                    box-shadow:0 2px 10px rgba(0,0,0,.2);
                }
                .btn.ready { background:#2e7d32; box-shadow:0 2px 12px rgba(46,125,50,.4); }
                .btn.ready:hover { background:#388e3c; transform:translateY(-1px); }
                .btn:not(.ready):hover { background:#444; }
                .dot {
                    width:8px;height:8px;border-radius:50%;background:#888;flex-shrink:0;
                }
                .btn.ready .dot { background:#a5d6a7; animation:pulse 2s infinite; }
                @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
                .menu {
                    display:none; position:absolute; bottom:100%; right:0; margin-bottom:8px;
                    background:#fff; border-radius:12px; overflow:hidden;
                    box-shadow:0 8px 30px rgba(0,0,0,.18); min-width:280px; max-width:400px;
                }
                .menu.open { display:block; }
                .item {
                    display:block; width:100%; padding:10px 16px; border:none; background:none;
                    text-align:left; cursor:pointer; font-size:12px; color:#333;
                    border-bottom:1px solid #f0f0f0; white-space:nowrap; overflow:hidden;
                    text-overflow:ellipsis;
                }
                .item:hover { background:#f5f5f5; }
                .item:last-child { border-bottom:none; }
                .item .tag { color:#888; margin-right:6px; }
                .item .src { color:#bbb; font-size:10px; }
            </style>
            <div class="menu" id="menu"></div>
            <button class="btn" id="btn">
                <span class="dot"></span>
                <span id="label">Waiting…</span>
            </button>
        `;

        document.body.appendChild(host);
        btn = shadow.getElementById('btn');
        badge = shadow.getElementById('label');
        menu = shadow.getElementById('menu');

        btn.addEventListener('click', () => {
            if (!primary) {
                toast('No model URL captured yet — load a model first', true);
                return;
            }
            if (urls.filter(e => isModelUrl(e.url)).length > 1) {
                menu.classList.toggle('open');
            } else {
                download(primary);
            }
        });

        menu.addEventListener('click', e => {
            const item = e.target.closest('.item');
            if (item) {
                download(item.dataset.url);
                menu.classList.remove('open');
            }
        });

        // Close menu on outside click
        document.addEventListener('click', e => {
            if (!host.contains(e.target)) menu.classList.remove('open');
        });

        render();
    }

    function render() {
        if (!btn) return;
        const modelUrls = urls.filter(e => isModelUrl(e.url));
        if (modelUrls.length === 0) {
            btn.classList.remove('ready');
            badge.textContent = 'Waiting…';
            return;
        }
        btn.classList.add('ready');
        badge.textContent = modelUrls.length > 1
            ? `Download (${modelUrls.length})`
            : 'Download GLB';

        // Populate menu
        menu.innerHTML = modelUrls.map(e => {
            const tag = e.url.includes('pbr_model') ? 'PBR'
                : e.url.includes('base_model') ? 'Base' : 'GLB';
            const short = e.url.length > 50 ? e.url.slice(0, 47) + '…' : e.url;
            return `<button class="item" data-url="${e.url}" title="${e.url}">
                <span class="tag">[${tag}]</span>${short}
                <span class="src">${e.source}</span>
            </button>`;
        }).join('');
    }

    if (document.body) build();
    else document.addEventListener('DOMContentLoaded', build);

})();
