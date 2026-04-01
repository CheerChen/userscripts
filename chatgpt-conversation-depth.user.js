// ==UserScript==
// @name         ChatGPT Conversation Depth
// @name:en      ChatGPT Conversation Depth
// @name:ja      ChatGPT 会話深度表示
// @name:zh-CN   ChatGPT 对话深度标记
// @name:zh-TW   ChatGPT 對話深度標記
// @name:ko      ChatGPT 대화 깊이 표시
// @name:ru      ChatGPT Глубина диалога
// @name:es      ChatGPT Profundidad de conversación
// @name:pt-BR   ChatGPT Profundidade da conversa
// @name:fr      ChatGPT Profondeur de conversation
// @name:de      ChatGPT Gesprächstiefe
// @namespace    https://github.com/CheerChen
// @version      0.6
// @description  Show conversation depth (round-trip count) as badges in the ChatGPT sidebar. Fetches conversation details via internal API (1req/5s), may trigger 429 rate-limiting with auto backoff retry. AYOR.
// @description:en  Show conversation depth (round-trip count) as badges in the ChatGPT sidebar. Fetches conversation details via internal API (1req/5s), may trigger 429 rate-limiting with auto backoff retry. AYOR.
// @description:ja  ChatGPTサイドバーに会話の深さ（往復回数）をバッジで表示。内部APIで会話詳細を取得（1req/5s）、429レート制限時は自動バックオフリトライ。自己責任で使用。
// @description:zh-CN  在 ChatGPT 左侧边栏显示每个对话的深度（来回轮数）。通过调用内部 API 逐个获取对话详情（1req/5s），可能触发 429 限流并自动退避重试。AYOR。
// @description:zh-TW  在 ChatGPT 左側邊欄顯示每個對話的深度（來回輪數）。透過呼叫內部 API 逐一取得對話詳情（1req/5s），可能觸發 429 限流並自動退避重試。AYOR。
// @description:ko  ChatGPT 사이드바에 대화 깊이(왕복 횟수)를 배지로 표시. 내부 API로 대화 상세 정보를 가져옵니다(1req/5s). 429 속도 제한 시 자동 백오프 재시도. 사용자 책임.
// @description:ru  Показывает глубину диалога (количество обменов) в боковой панели ChatGPT. Получает данные через внутренний API (1req/5s), возможно срабатывание лимита 429 с автоматическим откатом и повтором. AYOR.
// @description:es  Muestra la profundidad de conversación (número de intercambios) en la barra lateral de ChatGPT. Obtiene detalles via API interna (1req/5s), puede activar límite 429 con reintento automático. AYOR.
// @description:pt-BR  Exibe a profundidade da conversa (número de trocas) na barra lateral do ChatGPT. Busca detalhes via API interna (1req/5s), pode acionar limite 429 com retry automático. AYOR.
// @description:fr  Affiche la profondeur de conversation (nombre d'échanges) dans la barre latérale ChatGPT. Récupère les détails via l'API interne (1req/5s), peut déclencher la limite 429 avec retry automatique. AYOR.
// @description:de  Zeigt die Gesprächstiefe (Anzahl der Austausche) in der ChatGPT-Seitenleiste an. Ruft Details über interne API ab (1req/5s), kann 429-Ratenlimit auslösen mit automatischem Backoff-Retry. AYOR.
// @author       CheerChen
// @match        https://chatgpt.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=chatgpt.com
// @grant        GM_getValue
// @grant        GM_setValue
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    const CACHE_KEY = 'chatgpt_depth_cache';
    const REQUEST_INTERVAL = 5000; // 1 req/5s
    const BADGE_ATTR = 'data-depth-badge';
    const DEBUG = false;
    const log = (...args) => DEBUG && console.log('[depth]', ...args);

    // --- Cache ---

    function loadCache() {
        try {
            return JSON.parse(GM_getValue(CACHE_KEY, '{}'));
        } catch {
            return {};
        }
    }

    function saveCache(cache) {
        GM_setValue(CACHE_KEY, JSON.stringify(cache));
    }

    // --- Auth ---

    let accessToken = null;

    async function getAccessToken() {
        if (accessToken) return accessToken;
        const resp = await fetch('/api/auth/session', { credentials: 'include' });
        if (!resp.ok) throw new Error(`Failed to get session: ${resp.status}`);
        const data = await resp.json();
        accessToken = data.accessToken;
        if (!accessToken) throw new Error('No accessToken in session');
        return accessToken;
    }

    // --- API ---

    function analyzeConversation(data) {
        const mapping = data.mapping;
        let depth = 0;
        let totalTokens = 0;
        const models = new Set();
        let minTime = Infinity;
        let maxTime = -Infinity;

        for (const node of Object.values(mapping)) {
            const msg = node.message;
            if (!msg) continue;

            const role = msg.author?.role;
            const hidden = msg.metadata?.is_visually_hidden_from_conversation;

            if (role === 'user' && !hidden && (msg.content?.content_type === 'text' || msg.content?.content_type === 'multimodal_text')) {
                depth++;
            }

            if (role === 'assistant' && !hidden) {
                if (msg.metadata?.token_count) {
                    totalTokens += msg.metadata.token_count;
                }
                const model = msg.metadata?.model_slug || msg.metadata?.resolved_model_slug;
                if (model) models.add(model);
            }

            if (msg.create_time && msg.create_time > 0) {
                minTime = Math.min(minTime, msg.create_time);
                maxTime = Math.max(maxTime, msg.create_time);
            }
        }

        return {
            depth,
            totalTokens,
            models: [...models],
            timeSpan: maxTime > minTime ? maxTime - minTime : 0,
        };
    }

    function formatDuration(seconds) {
        if (seconds < 60) return `${Math.round(seconds)}s`;
        if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
        if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
        return `${(seconds / 86400).toFixed(1)}d`;
    }

    async function fetchConversationInfo(convId) {
        const token = await getAccessToken();
        const resp = await fetch(`/backend-api/conversation/${convId}`, {
            credentials: 'include',
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        return analyzeConversation(data);
    }

    // --- Queue (1 req/s throttle) ---

    const queue = [];
    let queueRunning = false;
    const inflight = new Map(); // convId -> Promise<info>

    function enqueue(convId) {
        if (inflight.has(convId)) {
            log('already inflight', convId.slice(0, 8));
            return inflight.get(convId);
        }
        const promise = new Promise((resolve, reject) => {
            queue.push({ convId, resolve, reject });
            processQueue();
        });
        inflight.set(convId, promise);
        promise.finally(() => inflight.delete(convId));
        return promise;
    }

    let backoffDelay = REQUEST_INTERVAL;

    async function processQueue() {
        if (queueRunning) return;
        queueRunning = true;
        while (queue.length > 0) {
            const item = queue.shift();
            try {
                const info = await fetchConversationInfo(item.convId);
                backoffDelay = REQUEST_INTERVAL; // reset on success
                item.resolve(info);
            } catch (e) {
                if (e.message === 'HTTP 429') {
                    queue.unshift(item); // put it back at front
                    backoffDelay = Math.min(backoffDelay * 2, 30000);
                    log('429 rate limited, backing off', backoffDelay / 1000, 's');
                    await new Promise(r => setTimeout(r, backoffDelay));
                    continue;
                }
                item.reject(e);
            }
            if (queue.length > 0) {
                await new Promise(r => setTimeout(r, backoffDelay));
            }
        }
        queueRunning = false;
    }

    // --- Tooltip ---

    const tooltip = document.createElement('div');
    tooltip.style.cssText = [
        'position:fixed',
        'z-index:99999',
        'padding:6px 10px',
        'border-radius:6px',
        'background:#1e1e2e',
        'color:#cdd6f4',
        'font-size:12px',
        'line-height:1.5',
        'white-space:pre',
        'pointer-events:none',
        'opacity:0',
        'transition:opacity 0.15s',
        'box-shadow:0 2px 8px rgba(0,0,0,0.4)',
    ].join(';');
    document.body.appendChild(tooltip);

    function showTooltip(e, info) {
        const { depth, totalTokens, models, timeSpan } = info;
        tooltip.textContent = [
            `Depth: ${depth} rounds`,
            `Tokens: ${totalTokens.toLocaleString()}`,
            `Model: ${models.join(', ') || 'unknown'}`,
            `Duration: ${timeSpan > 0 ? formatDuration(timeSpan) : 'single turn'}`,
        ].join('\n');
        tooltip.style.left = (e.clientX + 12) + 'px';
        tooltip.style.top = (e.clientY + 12) + 'px';
        tooltip.style.opacity = '1';
    }

    function hideTooltip() {
        tooltip.style.opacity = '0';
    }

    // --- DOM ---

    function createBadge(info) {
        const { depth } = info;
        const badge = document.createElement('span');
        badge.textContent = depth;
        badge.style.cssText = [
            'display:inline-flex',
            'align-items:center',
            'justify-content:center',
            'min-width:20px',
            'height:18px',
            'padding:0 5px',
            'border-radius:9px',
            'font-size:11px',
            'font-weight:600',
            'line-height:1',
            'flex-shrink:0',
            'margin-left:4px',
            'cursor:default',
            depth >= 20
                ? 'background:#ef4444;color:#fff'
                : depth >= 10
                    ? 'background:#f59e0b;color:#fff'
                    : 'background:#eab308;color:#fff',
        ].join(';');

        badge.addEventListener('mouseenter', (e) => showTooltip(e, info));
        badge.addEventListener('mouseleave', hideTooltip);

        badge.setAttribute(BADGE_ATTR, '');
        return badge;
    }

    function extractConvId(anchor) {
        const href = anchor.getAttribute('href') || '';
        const match = href.match(/\/c\/([a-f0-9-]+)/);
        return match ? match[1] : null;
    }

    function findConversationLinks() {
        return document.querySelectorAll('nav a[href^="/c/"]');
    }

    async function processLink(anchor, cache) {
        const hasBadge = !!anchor.querySelector(`[${BADGE_ATTR}]`);
        const convId = extractConvId(anchor);
        if (!convId) return;
        if (hasBadge) return;

        let info = cache[convId];
        if (typeof info === 'number') info = null;

        if (info) {
            log('cache-hit', convId.slice(0, 8));
        } else {
            log('cache-miss, enqueue', convId.slice(0, 8));
            try {
                info = await enqueue(convId);
                cache[convId] = info;
                saveCache(cache);
                log('fetched & saved', convId.slice(0, 8), 'depth:', info.depth, 'cache-size:', Object.keys(cache).length);
            } catch (e) {
                console.warn(`[depth] failed for ${convId}:`, e);
                return;
            }
        }

        if (!anchor.querySelector(`[${BADGE_ATTR}]`)) {
            const badge = createBadge(info);
            anchor.appendChild(badge);
        }
    }

    // --- Main ---

    function scanAndLabel() {
        const cache = loadCache();
        const links = findConversationLinks();
        const withBadge = document.querySelectorAll(`[${BADGE_ATTR}]`).length;
        log('scan', links.length, 'links,', withBadge, 'badged,', Object.keys(cache).length, 'cached');
        for (const link of links) {
            processLink(link, cache);
        }
    }

    let debounceTimer = null;
    function debouncedScan() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(scanAndLabel, 200);
    }

    function init() {
        scanAndLabel();

        const nav = document.querySelector('nav');
        const observer = new MutationObserver(debouncedScan);

        if (nav) {
            observer.observe(nav, { childList: true, subtree: true });
        } else {
            // nav not yet rendered, wait for it
            const bodyObserver = new MutationObserver(() => {
                const n = document.querySelector('nav');
                if (n) {
                    bodyObserver.disconnect();
                    observer.observe(n, { childList: true, subtree: true });
                    scanAndLabel();
                }
            });
            bodyObserver.observe(document.body, { childList: true, subtree: true });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
