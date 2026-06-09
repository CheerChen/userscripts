// ==UserScript==
// @name         Zoom Recording CC Extractor
// @name:en      Zoom Recording CC Extractor
// @name:ja      Zoom録画 字幕抽出ツール
// @name:zh-CN   Zoom 录像字幕提取器
// @name:zh-TW   Zoom 錄影字幕提取器
// @name:ko      Zoom 녹화 자막 추출기
// @name:ru      Zoom Запись — Извлечение субтитров
// @name:es      Zoom Grabación — Extractor de subtítulos
// @name:pt-BR   Zoom Gravação — Extrator de legendas
// @name:fr      Zoom Enregistrement — Extracteur de sous-titres
// @name:de      Zoom Aufnahme — Untertitel-Extraktor
// @namespace    https://github.com/CheerChen
// @version      1.0
// @description  Extract closed captions (VTT) from Zoom cloud recording playback pages. Intercepts CC network requests and provides download/copy UI.
// @description:en  Extract closed captions (VTT) from Zoom cloud recording playback pages. Intercepts CC network requests and provides download/copy UI.
// @description:ja  Zoomクラウド録画再生ページから字幕（VTT）を抽出。CCネットワークリクエストをインターセプトし、ダウンロード/コピーUIを提供します。
// @description:zh-CN  从 Zoom 云录像回放页面提取字幕（VTT）。拦截 CC 网络请求并提供下载/复制界面。
// @description:zh-TW  從 Zoom 雲端錄影回放頁面提取字幕（VTT）。攔截 CC 網路請求並提供下載/複製介面。
// @description:ko  Zoom 클라우드 녹화 재생 페이지에서 자막(VTT)을 추출합니다. CC 네트워크 요청을 가로채고 다운로드/복사 UI를 제공합니다.
// @description:ru  Извлечение субтитров (VTT) со страниц воспроизведения облачных записей Zoom. Перехватывает сетевые запросы CC и предоставляет интерфейс скачивания/копирования.
// @description:es  Extraer subtítulos (VTT) de las páginas de reproducción de grabaciones en la nube de Zoom. Intercepta solicitudes de red CC y proporciona una interfaz de descarga/copia.
// @description:pt-BR  Extrair legendas (VTT) das páginas de reprodução de gravações na nuvem do Zoom. Intercepta solicitações de rede CC e fornece interface de download/cópia.
// @description:fr  Extraire les sous-titres (VTT) des pages de lecture des enregistrements cloud Zoom. Intercepte les requêtes réseau CC et fournit une interface de téléchargement/copie.
// @description:de  Untertitel (VTT) von Zoom-Cloud-Aufnahme-Wiedergabeseiten extrahieren. Fängt CC-Netzwerkanfragen ab und bietet eine Download-/Kopier-Oberfläche.
// @author       cheerchen37
// @match        https://*.zoom.us/rec/play/*
// @match        https://*.zoom.us/rec/share/*
// @grant        none
// @icon         https://www.google.com/s2/favicons?domain=zoom.us
// @license      MIT
// @homepage     https://github.com/CheerChen/userscripts
// @supportURL   https://github.com/CheerChen/userscripts/issues
// ==/UserScript==

(function () {
    'use strict';

    // Intercept XMLHttpRequest to capture VTT responses
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
        this._zmUrl = url;
        return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
        if (this._zmUrl && this._zmUrl.includes('type=cc')) {
            this.addEventListener('load', function () {
                handleCCResponse(this.response, this._zmUrl);
            });
        }
        return origSend.apply(this, arguments);
    };

    // Also intercept fetch
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : input.url;
        if (url && url.includes('type=cc')) {
            return origFetch.apply(this, arguments).then(response => {
                const cloned = response.clone();
                cloned.text().then(text => handleCCResponse(text, url));
                return response;
            });
        }
        return origFetch.apply(this, arguments);
    };

    let captured = false;

    function handleCCResponse(data, url) {
        if (captured) return;
        captured = true;

        let text = typeof data === 'string' ? data : '';
        if (data instanceof ArrayBuffer) {
            text = new TextDecoder('utf-8').decode(data);
        }

        // If still garbled, try decoding as gzip via DecompressionStream
        if (text && !text.startsWith('WEBVTT') && !text.includes('-->')) {
            tryDecompress(data, url);
            return;
        }

        showResult(text, url);
    }

    async function tryDecompress(data, url) {
        try {
            // Re-fetch with explicit handling
            const resp = await fetch(url, { credentials: 'include' });
            const text = await resp.text();
            showResult(text, url);
        } catch (e) {
            console.error('[Zoom CC Extractor] Decompress failed:', e);
            // Fall back to showing raw
            showResult(typeof data === 'string' ? data : 'Failed to decode', url);
        }
    }

    function showResult(text, url) {
        console.log('[Zoom CC Extractor] Captured CC text:');
        console.log(text);

        // Create floating UI
        const panel = document.createElement('div');
        panel.style.cssText =
            'position:fixed;top:10px;right:10px;width:500px;max-height:80vh;' +
            'background:#1a1a2e;color:#e0e0e0;border:2px solid #0f3460;border-radius:8px;' +
            'z-index:999999;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        // Header
        const header = document.createElement('div');
        header.style.cssText =
            'padding:10px 15px;background:#0f3460;border-radius:6px 6px 0 0;' +
            'display:flex;justify-content:space-between;align-items:center;cursor:move;';
        header.innerHTML = '<span style="font-weight:bold;color:#e94560;">Zoom CC Extractor</span>';

        // Buttons
        const btnGroup = document.createElement('div');

        const downloadVttBtn = createButton('Download VTT', () => downloadFile(text, 'zoom_cc.vtt', 'text/vtt'));
        const downloadTxtBtn = createButton('Download TXT', () => downloadFile(vttToPlainText(text), 'zoom_cc.txt', 'text/plain'));
        const copyBtn = createButton('Copy Text', () => {
            navigator.clipboard.writeText(vttToPlainText(text));
            copyBtn.textContent = 'Copied!';
            setTimeout(() => (copyBtn.textContent = 'Copy Text'), 1500);
        });
        const closeBtn = createButton('X', () => panel.remove());
        closeBtn.style.marginLeft = '8px';
        closeBtn.style.background = '#e94560';

        btnGroup.append(downloadVttBtn, downloadTxtBtn, copyBtn, closeBtn);
        header.append(btnGroup);

        // Content
        const content = document.createElement('pre');
        content.style.cssText = 'padding:15px;overflow:auto;max-height:calc(80vh - 50px);margin:0;white-space:pre-wrap;word-break:break-word;';
        content.textContent = text;

        panel.append(header, content);
        document.body.append(panel);

        // Drag
        let isDragging = false, offsetX, offsetY;
        header.addEventListener('mousedown', e => {
            isDragging = true;
            offsetX = e.clientX - panel.offsetLeft;
            offsetY = e.clientY - panel.offsetTop;
        });
        document.addEventListener('mousemove', e => {
            if (!isDragging) return;
            panel.style.left = (e.clientX - offsetX) + 'px';
            panel.style.top = (e.clientY - offsetY) + 'px';
            panel.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => (isDragging = false));
    }

    function createButton(label, onClick) {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.cssText =
            'margin-left:5px;padding:3px 8px;background:#16213e;color:#e0e0e0;' +
            'border:1px solid #0f3460;border-radius:4px;cursor:pointer;font-size:11px;';
        btn.addEventListener('click', onClick);
        return btn;
    }

    function downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    function vttToPlainText(vtt) {
        return vtt
            .split('\n')
            .filter(line => {
                const trimmed = line.trim();
                // Skip WEBVTT header, timestamps, sequence numbers, NOTE, STYLE, empty lines
                if (!trimmed) return false;
                if (trimmed === 'WEBVTT') return false;
                if (/^\d+$/.test(trimmed)) return false;
                if (/-->/.test(trimmed)) return false;
                if (/^NOTE\b/.test(trimmed)) return false;
                if (/^STYLE\b/.test(trimmed)) return false;
                return true;
            })
            .map(line => line.replace(/<[^>]+>/g, '').trim()) // strip VTT tags like <v Speaker>
            .filter(Boolean)
            .join('\n');
    }

    // Also add a manual trigger button in case auto-intercept misses it
    function addManualButton() {
        const btn = document.createElement('button');
        btn.textContent = 'Extract CC';
        btn.style.cssText =
            'position:fixed;bottom:20px;right:20px;z-index:999998;padding:10px 20px;' +
            'background:#e94560;color:white;border:none;border-radius:8px;cursor:pointer;' +
            'font-size:14px;font-weight:bold;box-shadow:0 2px 10px rgba(233,69,96,0.4);';
        btn.addEventListener('click', async () => {
            btn.textContent = 'Fetching...';
            btn.disabled = true;
            try {
                // Find CC URL from page or use known pattern
                const ccUrl = findCCUrl();
                if (!ccUrl) {
                    alert('Could not find CC URL. Check console for details.');
                    btn.textContent = 'Extract CC';
                    btn.disabled = false;
                    return;
                }
                const resp = await fetch(ccUrl, { credentials: 'include' });
                const text = await resp.text();
                captured = false;
                showResult(text, ccUrl);
            } catch (e) {
                console.error('[Zoom CC Extractor]', e);
                alert('Failed: ' + e.message);
            }
            btn.textContent = 'Extract CC';
            btn.disabled = false;
        });
        document.body.append(btn);
    }

    function findCCUrl() {
        // Try to find the CC URL from network entries via PerformanceObserver
        const entries = performance.getEntriesByType('resource');
        for (const entry of entries) {
            if (entry.name.includes('type=cc') || entry.name.includes('/vtt')) {
                return entry.name;
            }
        }
        // Try to extract from current page URL pattern
        const params = new URLSearchParams(window.location.search);
        // Fallback: prompt user
        const url = prompt('[Zoom CC Extractor] Paste the CC/VTT URL:');
        return url || null;
    }

    // Wait for page to load, then add button
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', addManualButton);
    } else {
        addManualButton();
    }
})();
