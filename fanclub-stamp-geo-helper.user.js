// ==UserScript==
// @name         Fanclub Stamp Geo Helper
// @name:en      Fanclub Stamp Geo Helper
// @name:ja      ファンクラブ スタンプ位置ヘルパー
// @name:zh-CN    Fanclub 会场定位打卡辅助
// @namespace    https://github.com/CheerChen
// @version      1.2.0
// @description  Overrides geolocation with the live venue coordinates on the stamp page so the stamp button works away from the venue. Venue names are geocoded on demand; confirmed results are cached locally.
// @description:en Overrides geolocation with the live venue coordinates on the stamp page so the stamp button works away from the venue. Venue names are geocoded on demand; confirmed results are cached locally.
// @description:ja スタンプページで位置情報を公演会場の座標に差し替え、会場以外でもスタンプを獲得できるようにします。会場名はオンデマンドでジオコーディングし、確認済みの結果はローカルにキャッシュします。
// @description:zh-CN 在打卡页把定位替换为公演会场坐标，不在会场也能盖章。会场名按需地理编码，确认过的结果缓存在本地。
// @author       cheerchen37
// @match        https://fanclub.mizukinana.jp/stamp*
// @icon         https://www.google.com/s2/favicons?domain=fanclub.mizukinana.jp
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-start
// @noframes
// @license      MIT
// @homepage     https://github.com/CheerChen/userscripts
// @supportURL   https://github.com/CheerChen/userscripts/issues
// @updateURL    https://raw.githubusercontent.com/CheerChen/userscripts/master/fanclub-stamp-geo-helper.user.js
// ==/UserScript==
(function () {
    'use strict';
    // Config
    const API_SUGGEST = 'https://api.transit.ls8h.com/api/v1/places/suggest';
    const API_STAMPS = 'https://fccms2.mizukinana.jp/wp-json/moddpress2/v1/stamp';
    const API_MY_STAMP = 'https://fccms2.mizukinana.jp/user/my_stamp';
    const CACHE_KEY = 'venueCacheV1';
    const ENABLED_KEY = 'enabled';
    const BACKEND_HOST = 'https://fccms2.mizukinana.jp';
    const SUGGEST_LIMIT = 5;
    const AUTO_ACCEPT_MIN = 6;      // score needed to auto-accept a candidate
    const AUTO_ACCEPT_GAP = 2;      // min score gap over the runner-up
    // Rough prefecture bounding boxes (JIS code -> [latMin, latMax, lngMin, lngMax]).
    // Only used to reject geocode hits in the wrong region, not for precision.
    const PREF_BBOX = {
        '1':[41.3,45.6,139.3,145.9], '2':[40.2,41.6,139.5,141.7], '3':[38.7,40.5,140.6,142.1], '4':[37.8,39,140.3,141.7],
        '5':[38.9,40.6,139.8,141], '6':[37.7,39.2,139.5,140.5], '7':[36.7,37.9,139.2,141.1], '8':[35.7,36.9,139.7,140.9],
        '9':[36.2,37.1,139.3,140.4], '10':[36,37.2,138.4,139.8], '11':[35.7,36.3,138.7,139.9], '12':[34.9,36.1,139.7,140.9],
        '13':[35.5,35.95,138.85,139.95], '14':[35.1,35.7,138.9,139.8], '15':[36.6,38.6,137.6,139.9], '16':[36.2,36.9,136.7,137.8],
        '17':[36,37.9,136.2,137.4], '18':[35.3,36.3,135.6,136.9], '19':[35.2,35.9,138.1,139.1], '20':[35.2,37,137.3,138.7],
        '21':[35.1,36.5,136.2,137.8], '22':[34.5,35.7,137.4,139.2], '23':[34.5,35.4,136.7,137.9], '24':[33.7,35.2,135.9,136.9],
        '25':[34.9,35.7,135.7,136.5], '26':[34.8,35.8,134.9,136.1], '27':[34.2,35.1,135,135.8], '28':[34,35.7,134.2,135.5],
        '29':[33.9,34.8,135.5,136.4], '30':[33.4,34.4,135,136.1], '31':[35.1,35.7,133.2,134.6], '32':[34.3,36.4,131.6,133.4],
        '33':[34.2,35.4,133.2,134.5], '34':[34,35.2,132,133.6], '35':[33.7,34.8,130.8,132.3], '36':[33.5,34.3,133.6,134.9],
        '37':[34,34.6,133.4,134.4], '38':[32.9,34.4,132,133.6], '39':[32.7,34,132.4,134.4], '40':[33,34.1,129.9,131.2],
        '41':[32.9,33.6,129.7,130.5], '42':[32.5,34.8,128.3,130.4], '43':[32,33.2,129.8,131.3], '44':[32.7,33.8,130.8,132.1],
        '45':[31.3,32.8,130.6,131.9], '46':[30.9,32.4,129.8,131.2], '47':[25.8,27,127.5,128.6],
    };
    // Page-realm geolocation patch. Must run before the SPA hydrates, so the
    // site's own getCurrentPosition call resolves to our coordinates.
    const W = unsafeWindow;
    const geoState = W.__stampGeoHelper = { enabled: false, lat: 0, lng: 0, ready: false };
    const fakePosition = () => ({
        coords: { latitude: geoState.lat, longitude: geoState.lng, accuracy: 15,
            altitude: null, altitudeAccuracy: null, heading: null, speed: null },
        timestamp: Date.now(),
    });
    try {
        const geo = W.navigator.geolocation;
        const origGet = geo.getCurrentPosition.bind(geo);
        const origWatch = geo.watchPosition.bind(geo);
        geo.getCurrentPosition = (onOk, onErr, opts) => {
            if (!geoState.enabled || !geoState.ready) return origGet(onOk, onErr, opts);
            setTimeout(() => onOk(fakePosition()), 250);
        };
        geo.watchPosition = function (onOk, onErr, opts) {
            if (geoState.enabled && geoState.ready) {
                setTimeout(() => onOk(fakePosition()), 250);
                return 0;
            }
            return origWatch(onOk, onErr, opts);
        };
    } catch (e) {
        console.warn('[stamp-geo] geolocation patch failed', e);
    }
    // Venue name -> weighted query graph.
    //
    // Parallel rewrites keep alternatives that a lossy linear chain cannot. Generic-only
    // queries are penalized because the live API returns same-named venues in other prefectures.
    const ORG_PREFIX = /^(国立|県立|都立|府立|市立|町立|村立|県営|都営|市営|[^\s]{1,5}県[立営]|[^\s]{1,5}都[立営]|[^\s]{1,5}府[立営]|[^\s]{1,5}市[立営]|株式会社|（株）|\(株\)|一般財団法人|公益財団法人|財団法人|学校法人|独立行政法人)+/;
    // Longer forms must precede their substrings (JS alternation is ordered).
    const GENERIC_WORDS = 'メインアリーナ|サブアリーナ|アリーナ|体育センター|体育館|芸術文化交流館|文化交流館|市民会館|県民会館|都民会館|産業振興センター|市民センター|センターホール|メインホール|センター|競技場|野球場|球場|ドーム|スタジアム|劇場|会議場|展示場|パビリオン|ターミナル|ホテル|ホール|会館|広場';
    const GENERIC_ALL = new RegExp(GENERIC_WORDS, 'g');
    const GENERIC_MIDDLE = new RegExp(`(?:${GENERIC_WORDS})(?!$)`, 'g');
    const TRAILING_HALL = /(メインホール|大ホール|中ホール|小ホール|ホール)$/;
    const STRIP_CHARS = /[\s&・,、.()（）\[\]]+/g;
    const normalizeVenue = s => (s || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    // Distinctive name cores: what remains after generic facility words are
    // removed. "国立代々木競技場 第一体育館" -> ["代々木", "第一"],
    // "いわき芸術文化交流館アリオス" -> ["いわき", "アリオス"].
    function extractAnchors(text) {
        const rest = (text || '').replace(ORG_PREFIX, '').replace(GENERIC_ALL, '\u0000');
        const frags = rest.split(/[\u0000 ]/).map(s => s.replace(STRIP_CHARS, '')).filter(s => s.length >= 2);
        return [...new Set(frags)];
    }
    // A hypothesis is "generic-only" when nothing distinctive survives:
    // e.g. "第一体育館" -> ordinal + facility word only. Such queries hit
    // same-named facilities elsewhere, so their candidates get penalized.
    function isGenericQuery(text) {
        const rest = (text || '').replace(ORG_PREFIX, '').replace(GENERIC_ALL, '')
            .replace(/第?[一二三四五六七八九十百\d]+/g, '').replace(STRIP_CHARS, '');
        return rest.length === 0;
    }
    const replaceVariant = (pattern, min = 0) => s => {
        const text = s.replace(pattern, '');
        return text !== s && text.length >= min ? [text] : [];
    };
    const REWRITES = [
        [1, s => s.includes(' ') ? [s.replace(/\s+/g, '')] : []],
        [1, replaceVariant(ORG_PREFIX)],
        [2, replaceVariant(GENERIC_MIDDLE)],
        [2, replaceVariant(TRAILING_HALL, 2)],
        [3, s => {
            const tk = s.split(' ');
            return tk.length < 2 ? [] : tk.map((_, i) => tk.filter((__, j) => j !== i).join(' ')).filter(t => t.length >= 2);
        }],
        [5, s => {
            const tk = s.split(' ').map(t => t.replace(ORG_PREFIX, '')).filter(t => t.length >= 2);
            return tk.length > 1 ? tk : [];
        }],
    ];
    const MAX_HYPOTHESES = 20, MAX_HYP_COST = 9;
    // BFS over the rewrite graph, lowest cumulative cost first.
    function buildHypotheses(raw) {
        const norm = normalizeVenue(raw);
        const root = { text: norm, cost: 0 };
        const map = new Map([[norm, root]]);
        const queue = [root];
        while (queue.length) {
            queue.sort((a, b) => a.cost - b.cost);
            const node = queue.shift();
            for (const [stepCost, apply] of REWRITES) {
                for (const t of apply(node.text)) {
                    const cost = node.cost + stepCost;
                    if (cost > MAX_HYP_COST) continue;
                    const ex = map.get(t);
                    if (ex && ex.cost <= cost) continue;
                    const h = { text: t, cost };
                    map.set(t, h);
                    if (!ex) queue.push(h);
                }
            }
        }
        return [...map.values()]
            .sort((a, b) => a.cost - b.cost)
            .slice(0, MAX_HYPOTHESES)
            .map(h => ({ ...h, generic: isGenericQuery(h.text) }));
    }
    // Candidate scoring: prefecture is a hard filter; name anchors, LCS, kind and API
    // weight add confidence; rewrite cost and generic-only queries subtract it.
    function inPrefecture(prefCode, lat, lng) {
        const box = PREF_BBOX[String(prefCode)];
        if (!box || lat == null || lng == null) return null; // unknown: cannot verify
        return lat >= box[0] && lat <= box[1] && lng >= box[2] && lng <= box[3];
    }
    // Longest-common-substring ratio between two name strings.
    function nameSim(candidateName, other) {
        const a = normalizeVenue(candidateName).replace(/\s+/g, '');
        const b = other.replace(/\s+/g, '');
        if (!a || !b) return 0;
        const dp = new Uint16Array(b.length + 1);
        let best = 0;
        for (let i = 0; i < a.length; i++) {
            for (let j = b.length - 1; j >= 0; j--) {
                dp[j + 1] = a[i] === b[j] ? dp[j] + 1 : 0;
                if (dp[j + 1] > best) best = dp[j + 1];
            }
        }
        return best / b.length;
    }
    const VENUE_DESC = /施設|ホール|アリーナ|会館|theatre|hall|arena|stadium|dome|スタジアム/i;
    const KIND_SCORE = { place: 1.5, address: 1, stop: 0.5 };
    function anchorScore(placeName, anchors) {
        if (!anchors.length) return 0;
        const n = normalizeVenue(placeName).replace(/\s+/g, '');
        const ratio = anchors.filter(a => n.includes(a)).length / anchors.length;
        return ratio === 1 ? 5 : ratio >= 0.5 ? 2.5 : 0;
    }
    function scoreCandidate(entry, anchors, hyps) {
        const p = entry.place;
        let s = anchorScore(p.name, anchors);
        let best = 0;
        for (const h of hyps) best = Math.max(best, nameSim(p.name || '', h.text));
        s += best * 3;
        s += KIND_SCORE[p.kind] || 0;
        if (VENUE_DESC.test(p.description || '')) s += 1.5;
        s += Math.min(p.weight || 0, 20) / 10;
        s -= entry.minCost * 0.6;
        if (entry.generic) s -= 2;
        return s;
    }
    // Network (via the page realm so cookies/CORS behave exactly like the site's)
    async function fetchJSON(url) {
        const r = await W.fetch(url, { credentials: 'include' });
        if (!r.ok) throw new Error(`${r.status} ${url}`);
        return r.json();
    }
    async function suggest(q) {
        const url = `${API_SUGGEST}?q=${encodeURIComponent(q)}&limit=${SUGGEST_LIMIT}`;
        const r = await W.fetch(url);
        if (!r.ok) return [];
        return (await r.json()).places || [];
    }
    // Persistent venue cache: the "dictionary" that builds itself at runtime.
    // { [normalizedVenue]: { lat, lng, name, src: 'auto'|'manual', ts } }
    function loadCache() { try { return GM_getValue(CACHE_KEY, {}) || {}; } catch (e) { return {}; } }
    const saveCache = cache => GM_setValue(CACHE_KEY, cache);
    // Panel state + rendering
    const view = {
        status: 'loading',   // loading|none|login|nocheck|resolving|choose|manual|resolved|error
        event: null,
        events: [],          // full stamp list for the history modal
        myMap: {},           // event id -> my_stamp entry (has image_path)
        acquired: null,      // my_stamp entry for the active event
        venueNorm: '',
        coord: null,         // {lat,lng,name,src}
        candidates: [],      // scored candidates for the chooser
        rejected: [],        // candidates that failed the prefecture check
        message: '',
        enabled: GM_getValue(ENABLED_KEY, true),
        manualError: '',
        historyOpen: false,
        detailsOpen: false,
        collapsed: false,
    };
    // Stamp images use the cookie-authenticated WP host; the SPA host does not serve /wp-content/*.
    const imgUrl = path => (path || '').replace(/^https?:\/\/[^/]+/, BACKEND_HOST);
    const fmt = (lat, lng) => `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
    const mapsLink = venue => `https://www.google.com/maps/search/${encodeURIComponent(venue)}`;
    const srcBadge = src => ({ cache: 'キャッシュ', auto: '自動解決', manual: '手動' }[src] || src);
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
    function jstWallParts(s) {
        const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
        if (!m) return null;
        const [, year, month, day, hour, minute] = m;
        const weekday = '日月火水木金土'[new Date(Date.UTC(+year, +month - 1, +day)).getUTCDay()];
        return { year, month: String(+month), day: String(+day), hour, minute, weekday };
    }
    function fmtPeriod(from, to) {
        const a = jstWallParts(from);
        const b = jstWallParts(to);
        if (!a || !b) return [from, to].filter(Boolean).join(' → ');
        const aDate = `${a.year}/${a.month}/${a.day}（${a.weekday}）`;
        const bDate = `${b.year}/${b.month}/${b.day}（${b.weekday}）`;
        const aTime = `${a.hour}:${a.minute}`;
        const bTime = `${b.hour}:${b.minute}`;
        const sameDay = a.year === b.year && a.month === b.month && a.day === b.day;
        return sameDay ? `${aDate} ${aTime}–${bTime}` : `${aDate} ${aTime} → ${bDate} ${bTime}`;
    }
    function eventDayLabel(title) {
        const m = String(title || '').match(/day\s*(\d+)\s*$/i);
        return m ? `DAY ${m[1]}` : '';
    }
    function renderManualForm() {
        return `<div class="sg-manual"><input id="sg-manual" type="text" aria-label="会場座標" placeholder="lat,lng または Google Maps URL">
            <button class="sg-btn" id="sg-manual-btn" type="button">設定</button></div>${view.manualError ? `<div class="sg-field-error">${esc(view.manualError)}</div>` : ''}`;
    }
    // History includes every event and the cookie-authenticated image when collected.
    function eventWindowStatus(e) {
        const now = Date.now();
        if (now < parseJST(e.valid_from).getTime()) return 'upcoming';
        if (now > parseJST(e.valid_to).getTime()) return 'ended';
        return 'active';
    }
    function renderModal() {
        const rows = view.events.map(e => {
            const st = eventWindowStatus(e);
            const mine = view.myMap[e.id];
            const thumb = mine && mine.image_path
                ? `<img class="sg-thumb" src="${esc(imgUrl(mine.image_path))}" loading="lazy" alt="">`
                : `<div class="sg-thumb sg-thumb-empty">?</div>`;
            return `<div class="sg-row sg-st-${st}">${thumb}<div class="sg-row-main">
                <div class="sg-row-title">${esc(e.title)}</div><div class="sg-row-period"><span>獲得期間</span>
                <strong>${esc(fmtPeriod(e.valid_from, e.valid_to))}</strong></div><div class="sg-row-sub">${esc(e.venue)}</div></div>
                <span class="sg-chip ${mine ? 'sg-chip-got' : 'sg-chip-missing'}">${mine ? '獲得済み' : '未獲得'}</span></div>`;
        }).join('');
        return `<div id="sg-modal" class="${view.historyOpen ? 'sg-open' : ''}"><div class="sg-modal-card">
            <div class="sg-modal-head">スタンプ履歴 <span id="sg-modal-close">×</span></div><div class="sg-modal-body">${rows}</div></div></div>`;
    }
    function render() {
        const root = document.getElementById('stamp-geo-panel');
        if (!root) return;
        const e = view.event;
        let body = '';
        let detailBody = '';
        let showDetails = false;
        if (view.status === 'loading') {
            body = `<div class="sg-empty">読み込み中…</div>`;
        } else if (view.status === 'login') {
            body = `<div class="sg-empty">未ログインです。<br><span>ログイン後に再読み込みしてください。</span></div>`;
        } else if (view.status === 'none') {
            body = `<div class="sg-empty">現在獲得できるスタンプはありません</div>`;
        } else if (view.status === 'error') {
            body = `<div class="sg-empty sg-empty-error">読み込みに失敗しました<br><span>${esc(view.message)}</span></div>`;
        } else {
            const day = eventDayLabel(e.title);
            const stampImg = view.acquired?.image_path
                ? `<img class="sg-stamp-img" src="${esc(imgUrl(view.acquired.image_path))}" alt="">` : '';
            body += `<section class="sg-event">${stampImg}<div class="sg-event-main"><div class="sg-event-title">${esc(e.venue)}</div>
                <div class="sg-event-period">${esc(fmtPeriod(e.valid_from, e.valid_to))}${day ? ` <span>· ${day}</span>` : ''}</div></div>
                <span class="sg-chip ${view.acquired ? 'sg-chip-got' : 'sg-chip-missing'}">${view.acquired ? '獲得済み' : '未獲得'}</span></section>`;
            if (view.status === 'nocheck') {
                body += `<section class="sg-helper sg-helper-ready"><div><strong>位置チェックなし</strong>
                    <span>このスタンプはそのまま獲得できます</span></div></section>`;
            } else if (view.status === 'resolving') {
                body += `<section class="sg-helper sg-helper-loading"><span class="sg-pulse" aria-hidden="true"></span>
                    <div><strong>会場を検索中</strong><span>位置情報を準備しています</span></div></section>`;
            } else if (view.status === 'resolved' && view.coord) {
                body += `<section class="sg-helper ${view.enabled ? 'sg-helper-ready' : 'sg-helper-off'}"><div>
                    <strong>${view.enabled ? '会場位置を使用中' : '位置情報の差し替えはオフ'}</strong><span>${esc(view.coord.name)}</span></div>
                    <label class="sg-switch" title="位置情報の差し替え"><input type="checkbox" id="sg-on" ${view.enabled ? 'checked' : ''}>
                    <span aria-hidden="true"></span></label></section>`;
                showDetails = true;
                detailBody += `<dl class="sg-detail-list">
                    <div><dt>会場</dt><dd>${esc(view.coord.name)}</dd></div>
                    <div><dt>座標</dt><dd>${fmt(view.coord.lat, view.coord.lng)}</dd></div>
                    <div><dt>解決方法</dt><dd>${esc(srcBadge(view.coord.src))}</dd></div>
                </dl><div class="sg-detail-heading">座標を上書き</div>${renderManualForm()}`;
            } else if (view.status === 'choose') {
                body += `<section class="sg-recovery"><strong>会場を特定できませんでした</strong><span>正しい会場を選んでください</span>
                    <div class="sg-cands">${view.candidates.map((c, i) => `<label class="sg-cand"><input type="radio" name="sg-cand" value="${i}" ${i === 0 ? 'checked' : ''}>
                        <span><strong>${esc(c.name)}</strong>${c.description ? `<small>${esc(c.description.slice(0, 50))}</small>` : ''}</span>
                    </label>`).join('')}</div>
                    <button class="sg-btn sg-btn-wide" id="sg-use-cand" type="button">この会場を使う</button></section>`;
                showDetails = true;
                detailBody += `<div class="sg-detail-heading">座標を手動で設定</div>${renderManualForm()}`;
            } else if (view.status === 'manual') {
                body += `<section class="sg-recovery"><strong>会場が見つかりませんでした</strong>
                    <span>Google Maps の URL または座標を入力してください</span>${renderManualForm()}</section>`;
            }
            if (view.rejected.length) {
                showDetails = true;
                detailBody += `<div class="sg-detail-note">県外のため除外: ${view.rejected.map(c => esc(c.name)).join(' / ')}</div>`;
            }
            if (showDetails && view.detailsOpen) {
                body += `<section class="sg-detail-panel">${detailBody}</section>`;
            }
        }
        const tools = [
            e ? `<a href="${mapsLink(e.venue)}" target="_blank" rel="noopener">Google Maps</a>` : '',
            showDetails ? `<button type="button" id="sg-details" aria-expanded="${view.detailsOpen}">詳細</button>` : '',
            `<button type="button" id="sg-history">スタンプ履歴</button>`,
        ].filter(Boolean).join('');
        body += `<nav class="sg-tools" aria-label="補助メニュー">${tools}</nav>`;
        root.innerHTML = `<div class="sg-head">STAMP HELPER <button type="button" id="sg-fold" aria-label="パネルを${view.collapsed ? '開く' : '閉じる'}">${view.collapsed ? '+' : '−'}</button></div><div class="sg-body" ${view.collapsed ? 'hidden' : ''}>${body}</div>${renderModal()}`;
        bind(root);
    }
    function bind(root) {
        root.onchange = ev => {
            if (ev.target.id !== 'sg-on') return;
            view.enabled = ev.target.checked;
            GM_setValue(ENABLED_KEY, view.enabled);
            applyGeo();
            render();
        };
        root.onclick = ev => {
            if (ev.target.id === 'sg-modal') {
                view.historyOpen = false;
                render();
                return;
            }
            const id = ev.target.closest('button, #sg-modal-close')?.id;
            if (id === 'sg-use-cand') {
                const sel = root.querySelector('input[name="sg-cand"]:checked');
                if (!sel) return;
                const c = view.candidates[Number(sel.value)];
                resolveDone({ lat: c.lat, lng: c.lon, name: c.name, src: 'manual' });
            } else if (id === 'sg-manual-btn') {
                const p = parseManual(root.querySelector('#sg-manual').value);
                if (p) {
                    view.manualError = '';
                    resolveDone({ lat: p[0], lng: p[1], name: `${view.venueNorm}（手動）`, src: 'manual' });
                    return;
                }
                view.manualError = '座標を解析できません。"35.66,139.70" 形式か地図URLを貼ってください';
            } else if (id === 'sg-history') view.historyOpen = true;
            else if (id === 'sg-details') {
            view.detailsOpen = !view.detailsOpen;
            } else if (id === 'sg-modal-close') view.historyOpen = false;
            else if (id === 'sg-fold') view.collapsed = !view.collapsed;
            else return;
            render();
        };
    }
    // Accepts "lat,lng", Google Maps "@lat,lng" / "?q=lat,lng" / "!3d..!4d.." URLs.
    function parseManual(v) {
        v = (v || '').trim();
        let m = v.match(/^(-?\d{1,2}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)$/);
        if (!m) m = v.match(/[@?](?:q=)?(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/);
        if (!m) m = v.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/);
        if (!m) return null;
        const lat = +m[1], lng = +m[2];
        if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
        return [lat, lng];
    }
    function applyGeo() {
        if (view.enabled && view.coord) {
            geoState.lat = view.coord.lat;
            geoState.lng = view.coord.lng;
            geoState.ready = true;
        }
        geoState.enabled = view.enabled;
    }
    function resolveDone(coord) {
        view.coord = coord;
        view.status = 'resolved';
        const cache = loadCache();
        cache[view.venueNorm] = { lat: coord.lat, lng: coord.lng, name: coord.name, src: coord.src, ts: Date.now() };
        saveCache(cache);
        applyGeo();
        render();
    }
    // Cache -> weighted queries -> prefecture filter -> confidence; ambiguous results fall back to the user.
    async function resolveVenue(ev) {
        const norm = normalizeVenue(ev.venue);
        view.venueNorm = norm;
        const cached = loadCache()[norm];
        if (cached && cached.lat != null) {
            resolveDone({ lat: cached.lat, lng: cached.lng, name: cached.name || norm, src: 'cache' });
            return;
        }
        const anchors = extractAnchors(norm);
        const hyps = buildHypotheses(ev.venue);
        // key -> { place, minCost, generic }
        const candMap = new Map();
        const evaluate = () => {
            const scored = [], rejected = [];
            for (const c of candMap.values()) {
                const p = c.place;
                const inPref = inPrefecture(ev.prefecture, p.lat, p.lon);
                if (inPref === false) { rejected.push(p); continue; }
                scored.push({ ...p, _score: scoreCandidate(c, anchors, hyps), _verified: inPref === true });
            }
            scored.sort((a, b) => b._score - a._score);
            return { scored, rejected };
        };
        let decided = null;
        for (const h of hyps) {
            let places = [];
            try { places = await suggest(h.text); } catch (e) { /* keep widening */ }
            for (const p of places) {
                const k = `${p.name}|${p.lat}|${p.lon}`;
                const c = candMap.get(k) || { place: p, minCost: h.cost, generic: true };
                c.minCost = Math.min(c.minCost, h.cost);
                c.generic = c.generic && h.generic;
                candMap.set(k, c);
            }
            const { scored, rejected } = evaluate();
            view.candidates = scored;
            view.rejected = rejected;
            const top = scored[0];
            const gap = scored.length > 1 ? top._score - scored[1]._score : Infinity;
            // A confident candidate ends the search: verified in-prefecture,
            // high absolute score, clearly ahead of the runner-up.
            if (top && top._verified && top._score >= AUTO_ACCEPT_MIN && gap >= AUTO_ACCEPT_GAP) {
                decided = top;
                break;
            }
            if (candMap.size >= 25) break;
        }
        if (decided) {
            resolveDone({ lat: decided.lat, lng: decided.lon, name: decided.name, src: 'auto' });
        } else if (view.candidates.length) {
            view.status = 'choose';
        } else {
            view.status = 'manual';
        }
        render();
    }
    // Boot: wait for DOM, fetch the stamp list, find the in-window event.
    // valid_from/valid_to are JST wall times.
    const parseJST = s => new Date(s.replace(' ', 'T') + '+09:00');
    async function boot() {
        if (!/^\/stamp\/?$/.test(location.pathname)) return;
        injectStyle();
        const panel = document.createElement('div');
        panel.id = 'stamp-geo-panel';
        document.body.appendChild(panel);
        render();
        let data;
        try {
            data = await fetchJSON(API_STAMPS);
        } catch (e) {
            view.status = 'error';
            view.message = String(e);
            render();
            return;
        }
        if (data.meta && data.meta.is_authenticated === false) {
            view.status = 'login';
            render();
            return;
        }
        view.events = data.stamp || [];
        try {
            const mine = await fetchJSON(API_MY_STAMP);
            for (const s of mine.stamp || []) view.myMap[s.id] = s;
        } catch (e) { /* non-fatal */ }
        const now = Date.now();
        const active = view.events.find(s =>
            s.valid_from && s.valid_to &&
            parseJST(s.valid_from).getTime() <= now && now <= parseJST(s.valid_to).getTime()
        );
        if (!active) {
            view.status = 'none';
            render();
            return;
        }
        view.event = active;
        view.acquired = view.myMap[active.id] || null;
        if (active.distance_check === false) {
            view.status = 'nocheck';
            render();
            return;
        }
        view.status = 'resolving';
        render();
        await resolveVenue(active);
    }
    // Styles
    function injectStyle() {
        // Mirrors the site's white card, rhombus header, and blue stamp palette.
        const css = `
            #stamp-geo-panel{position:fixed;right:12px;bottom:12px;z-index:99999;width:340px;max-width:calc(100vw - 24px);background:#fff;color:#131313;border-radius:16px;border:1px solid #d2e9f6;font:13px/1.6 Roboto,"Noto Sans JP","Hiragino Kaku Gothic ProN",sans-serif;box-shadow:0 6px 24px rgba(19,60,100,.18);overflow:hidden;}
            #stamp-geo-panel .sg-head{padding:8px 14px;font-weight:700;color:#32689a;letter-spacing:.08em;font-family:Anton,Roboto,"Noto Sans JP",sans-serif;display:flex;justify-content:space-between;cursor:default;background-image:linear-gradient(135deg,#d2e9f6 25%,transparent 0),linear-gradient(225deg,#d2e9f6 25%,transparent 0),linear-gradient(45deg,#d2e9f6 25%,transparent 0),linear-gradient(315deg,#d2e9f6 25%,#bbddf5 0);background-position:8px 0,8px 0,0 0,0 0;background-repeat:repeat;background-size:10px 10px;}
            #stamp-geo-panel .sg-head #sg-fold{border:0;padding:0 4px;background:transparent;color:#32689a;cursor:pointer;font:inherit;line-height:1;}
            #stamp-geo-panel .sg-body{padding:12px 14px 10px;}
            #stamp-geo-panel .sg-empty{padding:14px 4px 16px;text-align:center;font-weight:600;}
            #stamp-geo-panel .sg-empty span{color:#7a8791;font-size:12px;font-weight:400;}
            #stamp-geo-panel .sg-empty-error{color:#b52b45;}
            #stamp-geo-panel .sg-event{display:flex;align-items:flex-start;gap:10px;}
            #stamp-geo-panel .sg-event-main{flex:1;min-width:0;}
            #stamp-geo-panel .sg-event-title{font-size:14px;font-weight:700;line-height:1.45;overflow-wrap:anywhere;}
            #stamp-geo-panel .sg-event-period{margin-top:3px;color:#637585;font-size:11px;font-variant-numeric:tabular-nums;}
            #stamp-geo-panel .sg-event-period span{color:#32689a;font-weight:700;white-space:nowrap;}
            #stamp-geo-panel .sg-stamp-img{width:48px;height:48px;object-fit:cover;flex-shrink:0;border-radius:50%;border:2px solid #60beff;background:#f4faff;}
            #stamp-geo-panel .sg-helper{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;padding:9px 10px;border-radius:10px;border:1px solid rgba(50,104,154,.12);}
            #stamp-geo-panel .sg-helper > div{display:flex;flex-direction:column;min-width:0;}
            #stamp-geo-panel .sg-helper strong{color:#244e73;font-size:12px;}
            #stamp-geo-panel .sg-helper span{color:#70808d;font-size:11px;overflow-wrap:anywhere;}
            #stamp-geo-panel .sg-helper-ready{background:#f0f8fe;}
            #stamp-geo-panel .sg-helper-off{background:#f5f7f8;border-color:#e1e7eb;}
            #stamp-geo-panel .sg-helper-off strong{color:#63717c;}
            #stamp-geo-panel .sg-helper-loading{justify-content:flex-start;background:#f7fbfe;}
            #stamp-geo-panel .sg-pulse{width:8px;height:8px;flex-shrink:0;border-radius:50%;background:#60beff;box-shadow:0 0 0 4px rgba(96,190,255,.18);}
            #stamp-geo-panel .sg-switch{position:relative;width:40px;height:22px;flex-shrink:0;cursor:pointer;}
            #stamp-geo-panel .sg-switch input{position:absolute;opacity:0;pointer-events:none;}
            #stamp-geo-panel .sg-switch > span{position:absolute;inset:0;border-radius:999px;background:#b8c3cb;transition:background .15s ease;}
            #stamp-geo-panel .sg-switch > span::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .15s ease;}
            #stamp-geo-panel .sg-switch input:checked + span{background:#32689a;}
            #stamp-geo-panel .sg-switch input:checked + span::after{transform:translateX(18px);}
            #stamp-geo-panel .sg-switch input:focus-visible + span{outline:2px solid #60beff;outline-offset:2px;}
            #stamp-geo-panel .sg-recovery{margin-top:12px;padding:10px;border-radius:10px;background:#f7f9fb;border:1px solid #e2e9ee;}
            #stamp-geo-panel .sg-recovery > strong{display:block;color:#334b5e;}
            #stamp-geo-panel .sg-recovery > span{display:block;color:#73818c;font-size:11px;}
            #stamp-geo-panel .sg-cands{margin:8px 0;}
            #stamp-geo-panel .sg-cand{display:flex;gap:6px;align-items:flex-start;padding:6px;border-radius:8px;cursor:pointer;}
            #stamp-geo-panel .sg-cand:hover{background:#edf5fb;}
            #stamp-geo-panel .sg-cand input{margin-top:3px;accent-color:#32689a;}
            #stamp-geo-panel .sg-cand > span{min-width:0;}
            #stamp-geo-panel .sg-cand strong{display:block;font-size:12px;}
            #stamp-geo-panel .sg-cand small{display:block;color:#7c8993;font-size:10px;}
            #stamp-geo-panel .sg-btn{position:relative;top:0;padding:5px 16px;border:0;border-radius:999px;background:#32689a;color:#fff;cursor:pointer;font-size:13px;box-shadow:0 2px 3px rgba(0,0,0,.25),0 3px #264e74;transition:top .15s ease,box-shadow .15s ease;}
            #stamp-geo-panel .sg-btn:hover{top:2px;box-shadow:0 1px 2px rgba(0,0,0,.25),0 1px #264e74;}
            #stamp-geo-panel .sg-btn-wide{width:100%;}
            #stamp-geo-panel .sg-manual{display:flex;gap:6px;margin-top:7px;}
            #stamp-geo-panel .sg-manual input{flex:1;min-width:0;padding:4px 10px;border:1px solid #bcd6ec;border-radius:999px;background:#fff;color:#131313;font-size:12px;outline:none;}
            #stamp-geo-panel .sg-manual input:focus{border-color:#60beff;}
            #stamp-geo-panel .sg-field-error{margin-top:4px;color:#b52b45;font-size:11px;}
            #stamp-geo-panel .sg-detail-panel{margin-top:9px;padding:9px 10px;border-radius:9px;background:#f5f7f8;color:#536575;font-size:11px;}
            #stamp-geo-panel .sg-detail-list{margin:0;}
            #stamp-geo-panel .sg-detail-list > div{display:grid;grid-template-columns:60px 1fr;gap:6px;}
            #stamp-geo-panel .sg-detail-list dt{color:#89959e;}
            #stamp-geo-panel .sg-detail-list dd{margin:0;overflow-wrap:anywhere;}
            #stamp-geo-panel .sg-detail-heading{margin-top:7px;color:#334b5e;font-weight:700;}
            #stamp-geo-panel .sg-detail-list + .sg-detail-heading{padding-top:7px;border-top:1px solid #e1e7eb;}
            #stamp-geo-panel .sg-detail-note{margin-top:6px;color:#82909a;overflow-wrap:anywhere;}
            #stamp-geo-panel .sg-tools{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:11px;padding-top:8px;border-top:1px solid #edf2f5;font-size:11px;}
            #stamp-geo-panel .sg-tools a,#stamp-geo-panel .sg-tools button{border:0;padding:2px 0;background:transparent;color:#4b86b4;cursor:pointer;font:inherit;text-decoration:none;white-space:nowrap;}
            #stamp-geo-panel .sg-tools a:hover,#stamp-geo-panel .sg-tools button:hover{color:#245f8d;text-decoration:underline;}
            #stamp-geo-panel .sg-chip{flex-shrink:0;align-self:flex-start;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;}
            #stamp-geo-panel .sg-chip-got{background:#32689a;color:#fff;}
            #stamp-geo-panel .sg-chip-missing{background:#fff;color:#8a98a5;border:1px solid #c9dcec;}
            /* history modal */ #stamp-geo-panel #sg-modal{display:none;position:fixed;inset:0;z-index:100000;background:rgba(19,19,19,.4);}
            #stamp-geo-panel #sg-modal.sg-open{display:flex;align-items:center;justify-content:center;}
            #stamp-geo-panel .sg-modal-card{width:480px;max-width:calc(100vw - 32px);max-height:78vh;display:flex;flex-direction:column;background:#fff;border-radius:20px;overflow:hidden;border:1px solid #d2e9f6;box-shadow:0 12px 40px rgba(19,60,100,.3);}
            #stamp-geo-panel .sg-modal-head{padding:10px 16px;font-weight:700;color:#32689a;letter-spacing:.08em;display:flex;justify-content:space-between;background-image:linear-gradient(135deg,#d2e9f6 25%,transparent 0),linear-gradient(225deg,#d2e9f6 25%,transparent 0),linear-gradient(45deg,#d2e9f6 25%,transparent 0),linear-gradient(315deg,#d2e9f6 25%,#bbddf5 0);background-position:8px 0,8px 0,0 0,0 0;background-repeat:repeat;background-size:10px 10px;}
            #stamp-geo-panel .sg-modal-head #sg-modal-close{cursor:pointer;font-size:18px;line-height:1;padding:0 4px;}
            #stamp-geo-panel .sg-modal-body{overflow-y:auto;padding:8px 12px;}
            #stamp-geo-panel .sg-row{display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid #eef4fa;}
            #stamp-geo-panel .sg-row:last-child{border-bottom:0;}
            #stamp-geo-panel .sg-st-active{margin:2px 0;padding:8px;background:#f0f8fe;border-radius:10px;border-bottom-color:transparent;}
            #stamp-geo-panel .sg-st-ended .sg-row-title{color:#687785;}
            #stamp-geo-panel .sg-thumb{width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid #60beff;flex-shrink:0;background:#f4faff;}
            #stamp-geo-panel .sg-thumb-empty{display:grid;place-items:center;color:#bbb;border:1px dashed #c9dcec;font-size:16px;}
            #stamp-geo-panel .sg-row-main{flex:1;min-width:0;}
            #stamp-geo-panel .sg-row-title{font-weight:600;font-size:13px;}
            #stamp-geo-panel .sg-row-sub{color:#888;font-size:12px;}
            #stamp-geo-panel .sg-row-period{display:flex;flex-wrap:wrap;gap:2px 7px;margin-top:1px;color:#53697c;font-size:12px;font-variant-numeric:tabular-nums;}
            #stamp-geo-panel .sg-row-period > span{color:#8a98a5;font-size:10px;letter-spacing:.04em;}
            #stamp-geo-panel .sg-row-period strong{font-weight:600;}
            @media (max-width:420px){
            #stamp-geo-panel .sg-modal-body{padding-inline:8px;}
            #stamp-geo-panel .sg-row{gap:8px;}
            #stamp-geo-panel .sg-thumb{width:40px;height:40px;}
            #stamp-geo-panel .sg-row-period{display:block;}
            #stamp-geo-panel .sg-row-period > span{display:block;}
            }
        `;
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
