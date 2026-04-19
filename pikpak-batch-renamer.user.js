// ==UserScript==
// @name         PikPak Batch JAV Renamer Assistant
// @name:en      PikPak Batch JAV Renamer Assistant
// @name:ja      PikPak バッチJAV リネームアシスタント
// @name:zh-CN   PikPak 批量番号重命名助手
// @name:zh-TW   PikPak 批量番號重命名助手
// @name:ko      PikPak 일괄 JAV 이름 변경 도우미
// @name:ru      PikPak Пакетное переименование JAV
// @name:es      PikPak Renombrador JAV por lotes
// @name:pt-BR   PikPak Renomeador JAV em lote
// @name:fr      PikPak Renommeur JAV par lots
// @name:de      PikPak JAV-Batch-Umbenennung
// @namespace    https://github.com/CheerChen
// @version      0.1.3
// @description  Batch rename video files and folders with JAV codes in PikPak.
// @description:en Batch rename video files and folders with JAV codes in PikPak.
// @description:ja PikPakで品番付きの動画ファイルやフォルダを一括リネーム。
// @description:zh-CN 在 PikPak 中批量重命名带有番号的视频文件或者文件夹。
// @description:zh-TW 在 PikPak 中批量重新命名帶有番號的影片檔案或資料夾。
// @description:ko PikPak에서 JAV 코드가 포함된 비디오 파일과 폴더를 일괄 이름 변경합니다.
// @description:ru Пакетное переименование видеофайлов и папок с кодами JAV в PikPak.
// @description:es Renombrar por lotes archivos de video y carpetas con códigos JAV en PikPak.
// @description:pt-BR Renomear em lote arquivos de vídeo e pastas com códigos JAV no PikPak.
// @description:fr Renommer par lots les fichiers vidéo et dossiers avec des codes JAV dans PikPak.
// @description:de Batch-Umbenennung von Videodateien und Ordnern mit JAV-Codes in PikPak.
// @author       cheerchen37
// @match        *://*mypikpak.com/*
// @match        *://*mypikpak.net/*
// @match        *://*pikpak.me/*
// @require      https://unpkg.com/preact@10/dist/preact.umd.js
// @require      https://unpkg.com/preact@10/hooks/dist/hooks.umd.js
// @require      https://unpkg.com/htm@3/dist/htm.umd.js
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      av-wiki.net
// @connect      api-drive.mypikpak.com
// @icon         https://www.google.com/s2/favicons?domain=mypikpak.com
// @license      MIT
// @homepage     https://github.com/CheerChen/userscripts
// @supportURL   https://github.com/CheerChen/userscripts/issues
// @updateURL    https://raw.githubusercontent.com/CheerChen/userscripts/master/pikpak-batch-renamer.user.js
// ==/UserScript==

(function () {
    'use strict';

    const { h, render } = preact;
    const { useState, useEffect } = preactHooks;
    const html = htm.bind(h);

    // ─── Parser (ported from bangou/parser/parser.go) ───

    const sitePrefixRe = /^([a-zA-Z0-9.-]+)@/;
    const tokenizeRe = /[^a-zA-Z0-9]+/;
    const partTokenRe = /^part(\d+)$/i;
    const tagTokenRe = /^(8k|4k|vr)$/i;
    const heyzoRe = /^(heyzo)(\d{4})(?:\D|$)/i;
    const mgstageRe = /^(\d{3,4}[a-zA-Z]{2,6})(\d{3,6})(?:\D|$)/i;
    const standardRe = /^\d*([a-zA-Z]{2,6})(\d{3,6})(?:\D|$)/i;
    const DEBUG_KEY = 'pikpak-batch-renamer-debug';
    const FLOAT_BUTTON_POS_KEY = 'pikpak-batch-renamer-fab-pos';
    const commonDomainTokenRe = /^(com|net|org|me|cn|jp|tv|xyz|club)$/i;

    const DEBUG_ENABLED = (() => {
        try {
            const v = localStorage.getItem(DEBUG_KEY);
            if (v == null) return true; // default on for troubleshooting parser/query mismatches
            return v === '1' || v === 'true';
        } catch {
            return true;
        }
    })();

    function debugLog(label, payload) {
        if (!DEBUG_ENABLED) return;
        if (payload === undefined) console.log(`[PBR] ${label}`);
        else console.log(`[PBR] ${label}`, payload);
    }

    function debugRawHtml(label, url, resp) {
        return;
    }

    function trimLeadingZeros(s) {
        let n = parseInt(s, 10);
        if (isNaN(n)) return s;
        let out = String(n);
        while (out.length < 3) out = '0' + out;
        return out;
    }

    function hasLetter(s) { return /[a-zA-Z]/.test(s); }
    function endsWithLetter(s) { return s.length > 0 && /[a-zA-Z]$/.test(s); }
    function isPureDigits(s) { return s.length > 0 && /^\d+$/.test(s); }

    function extractNumber(raw) {
        const rules = [
            { re: heyzoRe, fmt: m => m[1].toUpperCase() + '-' + m[2] },
            { re: mgstageRe, fmt: m => m[1].toUpperCase() + '-' + trimLeadingZeros(m[2]) },
            { re: standardRe, fmt: m => m[1].toUpperCase() + '-' + trimLeadingZeros(m[2]) },
        ];
        for (const { re, fmt } of rules) {
            const m = raw.match(re);
            if (!m || m.length <= 2) continue;
            // find end of capture group 2 to get rawMatch
            const fullMatch = m[0];
            const rawMatch = raw.substring(0, raw.indexOf(fullMatch) + fullMatch.replace(/\D$/, '').length);
            return { number: fmt(m), rawNumber: rawMatch.toLowerCase() };
        }
        return { number: '', rawNumber: '' };
    }

    function parseNumberParts(number) {
        const m = number.match(/^([0-9]*[A-Z]+)-(\d+)$/);
        if (!m) return null;
        return { series: m[1].replace(/^\d+/, '').toLowerCase(), numRaw: m[2], num: parseInt(m[2], 10) };
    }

    function extractExt(filename) {
        const m = filename.match(/\.([a-z0-9]{2,5})$/i);
        if (!m) return { ext: '', base: filename };
        if (partTokenRe.test(m[1])) return { ext: '', base: filename }; // ".part1" is a split marker, not extension
        const ext = '.' + m[1].toLowerCase();
        return { ext, base: filename.substring(0, filename.length - ext.length) };
    }

    function isLikelyWrappedCode(nameLower, number) {
        const p = parseNumberParts(number);
        if (!p) return false;
        const noPad = String(p.num);
        const re = new RegExp(`[\\(\\[]\\d*${p.series}[-_ ]*0*${noPad}[\\)\\]]`, 'i');
        return re.test(nameLower);
    }

    function scoreCandidate({ raw, number, idx, tokens, nameLower }) {
        const p = parseNumberParts(number);
        if (!p) return -999;

        let score = 0;
        if (p.series.length >= 4) score += 3;
        if (p.num >= 1000) score += 2;
        if (idx > 0) score += 1;
        if (isLikelyWrappedCode(nameLower, number)) score += 4;
        if (nameLower.includes(`@${raw}@`)) score -= 6;
        if (/^\d+[A-Z]+-/.test(number)) score -= 2;

        const next = (tokens[idx + 1] || '').toLowerCase();
        if (commonDomainTokenRe.test(next)) score -= 6;
        if (/^(www|com|net|org|me)$/.test(raw)) score -= 8;
        return score;
    }

    function buildNumberTokens(tokens, idx) {
        const t = (tokens[idx] || '').toLowerCase();
        if (!t || !hasLetter(t)) return [];
        if (partTokenRe.test(t) || tagTokenRe.test(t)) return [];
        const out = [t];
        // e.g. "1155crvr00238" -> additionally try "crvr00238"
        const withoutVendorPrefix = t.match(/^\d{3,4}([a-z]{2,6}\d{3,6})$/i)?.[1];
        if (withoutVendorPrefix) out.push(withoutVendorPrefix.toLowerCase());
        const next = tokens[idx + 1];
        if (next && endsWithLetter(t) && isPureDigits(next) && next.length >= 3) out.push(t + next);
        return out;
    }

    function parse(filename) {
        const { ext, base } = extractExt(filename);
        let name = base;

        const res = { number: '', rawNumber: '', part: 0, tags: [], ext, sourceSite: '' };

        const siteMatch = name.match(sitePrefixRe);
        if (siteMatch) {
            res.sourceSite = siteMatch[1].toLowerCase();
            name = name.replace(sitePrefixRe, '');
        }

        const tokens = name.split(tokenizeRe).filter(Boolean);
        if (tokens.length === 0) return res;

        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            const pm = t.match(partTokenRe);
            if (pm) { if (res.part === 0) res.part = parseInt(pm[1], 10); continue; }
            if (tagTokenRe.test(t)) { res.tags.push(t.toLowerCase()); continue; }
            if (isPureDigits(t) && t.length <= 2 && res.part === 0) { res.part = parseInt(t, 10); continue; }
        }

        res.tags = [...new Set(res.tags)];

        const candidates = [];
        const seen = new Set();
        const nameLower = name.toLowerCase();

        for (let i = 0; i < tokens.length; i++) {
            for (const raw of buildNumberTokens(tokens, i)) {
                const { number, rawNumber } = extractNumber(raw);
                if (!number) continue;
                const key = `${number}|${rawNumber}|${i}`;
                if (seen.has(key)) continue;
                seen.add(key);
                candidates.push({
                    idx: i,
                    raw,
                    number,
                    rawNumber,
                    score: scoreCandidate({ raw, number, idx: i, tokens, nameLower }),
                });
            }
        }

        candidates.sort((a, b) => b.score - a.score || a.idx - b.idx);
        if (candidates[0]) {
            res.number = candidates[0].number;
            res.rawNumber = candidates[0].rawNumber;
        }

        debugLog('parse', {
            filename,
            tokens,
            selected: { number: res.number, rawNumber: res.rawNumber, part: res.part, tags: res.tags, ext: res.ext },
            candidates: candidates.map(c => ({ idx: c.idx, raw: c.raw, number: c.number, rawNumber: c.rawNumber, score: c.score })),
        });
        return res;
    }

    // ─── PikPak API ───

    function getHeader() {
        let token = '', captcha = '';
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key) continue;
            if (key.startsWith('credentials')) {
                const d = JSON.parse(localStorage.getItem(key));
                token = d.token_type + ' ' + d.access_token;
            }
            if (key.startsWith('captcha')) {
                const d = JSON.parse(localStorage.getItem(key));
                captcha = d.captcha_token;
            }
        }
        let deviceId = localStorage.getItem('deviceid') || '';
        if (deviceId.includes('.')) deviceId = deviceId.split('.')[1]?.substring(0, 32) || deviceId;
        return { Authorization: token, 'x-device-id': deviceId, 'x-captcha-token': captcha };
    }

    function getList(parentId) {
        const url = `https://api-drive.mypikpak.com/drive/v1/files?thumbnail_size=SIZE_MEDIUM&limit=500&parent_id=${parentId}&with_audit=true&filters=${encodeURIComponent('{"phase":{"eq":"PHASE_TYPE_COMPLETE"},"trashed":{"eq":false}}')}`;
        return fetch(url, {
            headers: { 'Content-Type': 'application/json', ...getHeader() },
        }).then(r => r.json());
    }

    function renameFile(fileId, newName) {
        return fetch(`https://api-drive.mypikpak.com/drive/v1/files/${fileId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...getHeader() },
            body: JSON.stringify({ name: newName }),
        }).then(async r => {
            const data = await r.json();
            if (data.error || !r.ok) {
                const err = new Error(data.error_description || t('renameFailed')(data.error));
                err.code = data.error;
                throw err;
            }
            return data;
        });
    }

    // ─── AV-wiki Query ───

    function httpRequest(opts) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: opts.method || 'GET',
                url: opts.url,
                headers: opts.headers || {},
                onload: r => resolve({ status: r.status, responseText: r.responseText }),
                onerror: e => reject(new Error(e.statusText || 'Network error')),
                ontimeout: () => reject(new Error('Request timeout')),
            });
        });
    }

    function parseDetailPage(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        let name = doc.querySelector('.blockquote-like p')?.textContent || null;
        if (!name) {
            const entry = doc.querySelector('.entry-title');
            if (entry) {
                const clone = entry.cloneNode(true);
                clone.querySelectorAll('.entry-subtitle, span').forEach(n => n.remove());
                name = clone.textContent || null;
            }
        }
        const date =
            doc.querySelector('time.date.published')?.getAttribute('datetime') ||
            doc.querySelector('meta[property="article:published_time"]')?.getAttribute('content')?.slice(0, 10) ||
            null;
        if (name) name = name.trim();
        if (name) name = name.replace(/[\/:*?"<>|\x00-\x1F]/g, '_');
        return { title: name, date };
    }

    function buildDirectUrl(keyword) { return `https://av-wiki.net/${keyword.toLowerCase()}/`; }
    function buildSearchUrl(term) { return `https://av-wiki.net/?s=${encodeURIComponent(term)}&post_type=product`; }

    function buildDirectUrlCandidates(parsed) {
        const urls = [];
        const seen = new Set();
        const add = slug => {
            if (!slug) return;
            const url = `https://av-wiki.net/${slug.toLowerCase()}/`;
            if (seen.has(url)) return;
            seen.add(url);
            urls.push(url);
        };

        const fromNumber = parsed.number.toLowerCase();
        add(fromNumber);

        const raw = (parsed.rawNumber || '').toLowerCase();
        const rawMatch = raw.match(/^(\d*[a-z]{2,10})(\d{1,6})$/);
        if (rawMatch) {
            const series = rawMatch[1];
            const num = String(parseInt(rawMatch[2], 10));
            add(`${series}-${num}`);
            add(`${series}-${rawMatch[2]}`);
        }

        return urls;
    }

    function buildSearchTerms(parsed) {
        const terms = [];
        const seen = new Set();
        const add = term => {
            if (!term) return;
            if (seen.has(term)) return;
            seen.add(term);
            terms.push(term);
        };

        add(parsed.number);
        add(parsed.number?.toLowerCase());
        add(parsed.rawNumber);

        const raw = (parsed.rawNumber || '').toLowerCase();
        const rawMatch = raw.match(/^(\d*[a-z]{2,10})(\d{1,6})$/);
        if (rawMatch) {
            const series = rawMatch[1];
            const num = String(parseInt(rawMatch[2], 10));
            add(`${series}-${num}`);
            add(`${series}-${rawMatch[2]}`);
        }

        return terms;
    }

    function extractSlug(url) {
        try {
            const path = new URL(url).pathname;
            return path.split('/').filter(Boolean)[0] || '';
        } catch {
            return '';
        }
    }

    function numberMentionVariants(number) {
        const p = parseNumberParts(number);
        if (!p) return [];
        const noPad = String(p.num);
        const pad3 = noPad.padStart(3, '0');
        return [...new Set([`${p.series}${noPad}`, `${p.series}${pad3}`, `${p.series}${p.numRaw}`])];
    }

    function containsExpectedNumber(text, number) {
        const norm = (text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
        return numberMentionVariants(number).some(v => norm.includes(v));
    }

    function isSameNumberBySlug(slug, number) {
        const p = parseNumberParts(number);
        if (!p) return false;
        const m = slug.toLowerCase().match(/^(\d*[a-z]{2,6})[-_]?0*(\d{1,6})(?:$|[-_])/);
        if (!m) return false;
        const series = m[1].replace(/^\d+/, '');
        const num = parseInt(m[2], 10);
        return series === p.series && num === p.num;
    }

    function extractSearchResultLinks(doc) {
        const selectors = [
            '.read-more a[href^="https://av-wiki.net/"]',
            '.archive-list .read-more a[href^="https://av-wiki.net/"]',
            '.archive-list a[href^="https://av-wiki.net/"][title]',
            '.column-flex .archive-list a[href^="https://av-wiki.net/"][title]',
        ];

        const links = [];
        const seen = new Set();
        for (const selector of selectors) {
            for (const a of doc.querySelectorAll(selector)) {
                const href = a.href;
                if (!href) continue;
                if (!/^https:\/\/av-wiki\.net\/[^/?#]+\/?$/i.test(href)) continue;
                if (seen.has(href)) continue;
                seen.add(href);
                links.push(href);
            }
        }
        return links;
    }

    async function queryAVwiki(parsed) {
        if (!parsed.number) throw new Error('No number');

        const directUrls = buildDirectUrlCandidates(parsed);
        debugLog('direct-candidates', { number: parsed.number, rawNumber: parsed.rawNumber, directUrls });
        for (const directUrl of directUrls) {
            const directResp = await httpRequest({ url: directUrl });
            debugRawHtml('direct', directUrl, directResp);
            if (directResp.status !== 200) continue;

            const { title, date } = parseDetailPage(directResp.responseText);
            debugLog('direct-parse', { number: parsed.number, directUrl, title, date });
            if (title && containsExpectedNumber(title, parsed.number)) return { title, date };
        }

        // Fallback: search
        const searchTerms = buildSearchTerms(parsed);
        debugLog('search-terms', { number: parsed.number, rawNumber: parsed.rawNumber, searchTerms });
        for (const searchTerm of searchTerms) {
            const searchUrl = buildSearchUrl(searchTerm);
            const searchResp = await httpRequest({ url: searchUrl });
            debugRawHtml('search', searchUrl, searchResp);
            const doc = new DOMParser().parseFromString(searchResp.responseText, 'text/html');

            const links = extractSearchResultLinks(doc);
            debugLog('search-candidates', { number: parsed.number, searchTerm, links });

            for (const link of links) {
                const slug = extractSlug(link);
                const matchedBySlug = isSameNumberBySlug(slug, parsed.number);
                debugLog('search-link-check', { link, slug, number: parsed.number, searchTerm, matchedBySlug });
                if (!matchedBySlug) continue;

                const detailResp = await httpRequest({ url: link });
                debugRawHtml('search-detail', link, detailResp);
                if (detailResp.status === 200) {
                    const { title, date } = parseDetailPage(detailResp.responseText);
                    debugLog('search-detail-parse', { link, title, date });
                    if (title && containsExpectedNumber(title, parsed.number)) return { title, date };
                }
            }
        }
        throw new Error('Not found');
    }

    // ─── Config ───

    const CONFIG_KEY = 'pikpak-batch-renamer-config';
    const defaultConfig = { addDatePrefix: false, fixFileExtension: true, sortBy: 'name', sortDir: 'asc' };
    const getConfig = () => { try { return { ...defaultConfig, ...JSON.parse(localStorage.getItem(CONFIG_KEY)) }; } catch { return { ...defaultConfig }; } };
    const setConfig = c => localStorage.setItem(CONFIG_KEY, JSON.stringify(c));

    // ─── i18n ───

    const i18n = {
        zh: {
            batchRename: '批量重命名',
            batchRenameFiles: '批量重命名文件',
            confirmRename: '确认重命名',
            renameComplete: '重命名完成',
            selectAll: '全选',
            name: '名称',
            createdTime: '创建时间',
            modifiedTime: '修改时间',
            size: '大小',
            asc: '升序',
            desc: '降序',
            selectFiles: '请选择文件',
            scanning: '扫描中...',
            scanCodes: '扫描番号',
            config: '配置选项',
            addDatePrefix: '在文件名开头增加发行日期',
            addDatePrefixDesc: '启用后文件名格式为: 2025-09-12 标题名称.mp4',
            fixExt: '修复文件扩展名',
            fixExtDesc: '当文件缺少扩展名时，根据文件名信息自动补充',
            aboutToRename: n => `即将重命名 ${n} 个文件，请确认后继续。`,
            original: '原名',
            newName: '新名',
            progress: (cur, total) => `重命名进度: ${cur}/${total}`,
            cancel: '取消',
            next: '下一步',
            back: '上一步',
            confirming: '确认重命名',
            renaming: '重命名中...',
            resultSummary: (s, f, t) => `重命名完成！成功: ${s}, 失败: ${f}, 总计: ${t}`,
            failedFiles: '失败的文件:',
            renameFailed: code => `重命名失败 (${code})`,
        },
        en: {
            batchRename: 'Batch Rename',
            batchRenameFiles: 'Batch Rename Files',
            confirmRename: 'Confirm Rename',
            renameComplete: 'Rename Complete',
            selectAll: 'Select All',
            name: 'Name',
            createdTime: 'Created',
            modifiedTime: 'Modified',
            size: 'Size',
            asc: 'Asc',
            desc: 'Desc',
            selectFiles: 'Select files',
            scanning: 'Scanning...',
            scanCodes: 'Scan Codes',
            config: 'Settings',
            addDatePrefix: 'Prepend release date to filename',
            addDatePrefixDesc: 'Format: 2025-09-12 Title.mp4',
            fixExt: 'Fix file extension',
            fixExtDesc: 'Auto-add extension when missing based on file info',
            aboutToRename: n => `About to rename ${n} file(s). Please confirm.`,
            original: 'From',
            newName: 'To',
            progress: (cur, total) => `Renaming: ${cur}/${total}`,
            cancel: 'Cancel',
            next: 'Next',
            back: 'Back',
            confirming: 'Confirm Rename',
            renaming: 'Renaming...',
            resultSummary: (s, f, t) => `Done! Success: ${s}, Failed: ${f}, Total: ${t}`,
            failedFiles: 'Failed files:',
            renameFailed: code => `Rename failed (${code})`,
        },
    };

    const lang = (navigator.language || '').startsWith('zh') ? 'zh' : 'en';
    const t = key => i18n[lang][key];

    // ─── Styles ───

    const colors = { primary: '#303133', secondary: '#606266', success: '#67c23a', danger: '#f56c6c', warning: '#e6a23c', blue: '#409eff' };

    // ─── Components ───

    const delay = ms => new Promise(r => setTimeout(r, ms));

    function ConfigPanel({ config, onChange }) {
        const toggle = key => { const c = { ...config, [key]: !config[key] }; setConfig(c); onChange(c); };
        return html`
            <div style="padding:12px;background:#f8f9fa;border-radius:6px;margin-bottom:16px;border-top:1px solid #ebeef5">
                <label style="display:flex;align-items:center;cursor:pointer;padding:4px 0">
                    <input type="checkbox" checked=${config.addDatePrefix} onChange=${() => toggle('addDatePrefix')} style="margin-right:8px" />
                    <span style="font-size:14px">${t('addDatePrefix')}</span>
                </label>
                <div style="font-size:12px;color:${colors.secondary};margin-left:24px;margin-bottom:8px">
                    ${t('addDatePrefixDesc')}
                </div>
                <label style="display:flex;align-items:center;cursor:pointer;padding:4px 0">
                    <input type="checkbox" checked=${config.fixFileExtension} onChange=${() => toggle('fixFileExtension')} style="margin-right:8px" />
                    <span style="font-size:14px">${t('fixExt')}</span>
                </label>
                <div style="font-size:12px;color:${colors.secondary};margin-left:24px">
                    ${t('fixExtDesc')}
                </div>
            </div>`;
    }

    function FileItem({ file, selected, onSelect, status, newName, sortBy }) {
        const icons = { valid: '✅', invalid: '❌', loading: '⏳' };
        const formatInfo = f => {
            const fmt = (b) => { const k = 1024; const s = ['B', 'KB', 'MB', 'GB']; const i = Math.floor(Math.log(b) / Math.log(k)); return (b / Math.pow(k, i)).toFixed(1) + ' ' + s[i]; };
            if (sortBy === 'size') return f.size && parseInt(f.size) > 0 ? fmt(parseInt(f.size)) : '';
            if (sortBy === 'created_time' || sortBy === 'modified_time') return f[sortBy] ? new Date(f[sortBy]).toLocaleString() : '';
            return '';
        };
        return html`
            <div style="display:flex;align-items:center;padding:8px 0;border-bottom:1px solid #f0f0f0;opacity:${status === 'invalid' ? 0.5 : 1}">
                <input type="checkbox" checked=${selected} onChange=${e => onSelect(file.id, e.target.checked)}
                    disabled=${status === 'invalid'} style="margin-right:10px" />
                <span style="margin-right:8px">${file.kind === 'drive#folder' ? '📁' : '📄'}</span>
                <div style="flex:1;min-width:0">
                    <div style="font-weight:500;word-break:break-word">${file.name}</div>
                    ${newName && html`<div style="font-size:12px;color:${colors.success};margin-top:2px;word-break:break-word">→ ${newName}</div>`}
                </div>
                <span style="margin-left:16px;font-size:12px;color:${colors.secondary};white-space:nowrap">${formatInfo(file)}</span>
                <span style="margin-left:16px;font-size:16px">${icons[status] || ''}</span>
            </div>`;
    }

    function BatchRenameModal({ onClose }) {
        const [files, setFiles] = useState([]);
        const [selected, setSelected] = useState(new Set());
        const [statuses, setStatuses] = useState({});
        const [newNames, setNewNames] = useState({});
        const [validating, setValidating] = useState(false);
        const [renaming, setRenaming] = useState(false);
        const [progress, setProgress] = useState({ cur: 0, total: 0 });
        const [confirm, setConfirm] = useState(false);
        const [results, setResults] = useState(null);
        const [config, setConfigState] = useState(getConfig());
        const [showConfig, setShowConfig] = useState(false);
        const [sortBy, setSortBy_] = useState(config.sortBy || 'name');
        const [sortDir, setSortDir_] = useState(config.sortDir || 'asc');
        const setSortBy = v => { setSortBy_(v); const c = { ...config, sortBy: v }; setConfig(c); setConfigState(c); };
        const setSortDir = v => { setSortDir_(v); const c = { ...config, sortDir: v }; setConfig(c); setConfigState(c); };

        const sortFiles = (list, by, dir) => {
            return [...list].sort((a, b) => {
                const af = a.kind === 'drive#folder', bf = b.kind === 'drive#folder';
                if (af !== bf) return af ? -1 : 1;
                let av = a[by], bv = b[by];
                if (by === 'size') { av = parseInt(av || '0'); bv = parseInt(bv || '0'); }
                else if (by.includes('time')) { av = new Date(av).getTime(); bv = new Date(bv).getTime(); }
                else { av = (av || '').toLowerCase(); bv = (bv || '').toLowerCase(); }
                const c = av > bv ? 1 : av < bv ? -1 : 0;
                return dir === 'asc' ? c : -c;
            });
        };

        useEffect(() => {
            let pid = location.pathname.split('/').pop();
            if (pid === 'all') pid = '';
            getList(pid).then(r => r.files && setFiles(sortFiles(r.files, sortBy, sortDir))).catch(console.error);
        }, []);

        useEffect(() => { setFiles(f => sortFiles(f, sortBy, sortDir)); }, [sortBy, sortDir]);

        const toggleSelect = (id, on) => setSelected(s => { const n = new Set(s); on ? n.add(id) : n.delete(id); return n; });
        const selectAll = on => setSelected(on ? new Set(files.filter(f => statuses[f.id] !== 'invalid').map(f => f.id)) : new Set());

        const validateFiles = async () => {
            if (selected.size === 0) return alert(t('selectFiles'));
            setValidating(true);
            const sts = {}, names = {};
            const list = files.filter(f => selected.has(f.id));

            for (let i = 0; i < list.length; i += 3) {
                const batch = list.slice(i, i + 3);
                await Promise.all(batch.map(async file => {
                    const isFile = file.kind !== 'drive#folder';
                    const parsed = parse(file.name);
                    if (!parsed.number) {
                        debugLog('validate-invalid-no-number', { file: file.name, parsed });
                        sts[file.id] = 'invalid';
                        return;
                    }

                    sts[file.id] = 'loading';
                    setStatuses(p => ({ ...p, ...sts }));

                    try {
                        const info = await queryAVwiki(parsed);
                        debugLog('validate-hit', { file: file.name, parsed, info });
                        sts[file.id] = 'valid';
                        let ext = parsed.ext;
                        if (!ext && isFile && config.fixFileExtension && file.mime_type) {
                            const m = file.mime_type.match(/\/([a-z0-9]+)/);
                            if (m) ext = '.' + m[1];
                        }
                        let finalName = config.addDatePrefix && info.date ? `${info.date} ${info.title}` : info.title;
                        names[file.id] = ext ? `${finalName}${ext}` : finalName;
                    } catch (e) {
                        debugLog('validate-miss', { file: file.name, parsed, error: e?.message || String(e) });
                        sts[file.id] = 'invalid';
                    }
                }));
                setStatuses(p => ({ ...p, ...sts }));
                setNewNames(p => ({ ...p, ...names }));
                if (i + 3 < list.length) await delay(2000);
            }
            setValidating(false);
        };

        const performRename = async () => {
            setRenaming(true);
            const list = files.filter(f => selected.has(f.id) && statuses[f.id] === 'valid');
            let success = 0, failed = 0;
            const failedFiles = [];

            for (let i = 0; i < list.length; i += 5) {
                const batch = list.slice(i, i + 5);
                await Promise.all(batch.map(async file => {
                    const nn = newNames[file.id];
                    if (file.name === nn) { success++; }
                    else {
                        try { await renameFile(file.id, nn); success++; }
                        catch (e) { failed++; failedFiles.push({ name: file.name, error: e.message }); }
                    }
                    setProgress({ cur: success + failed, total: list.length });
                }));
                if (i + 5 < list.length) await delay(1000);
            }
            setResults({ success, failed, total: list.length, failedFiles });
            setRenaming(false);
        };

        const reset = () => { onClose(); if (results?.success > 0) setTimeout(() => location.reload(), 300); };
        const validCount = Array.from(selected).filter(id => statuses[id] === 'valid').length;

        return html`
            <div style="position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10000"
                 onClick=${e => e.target === e.currentTarget && reset()}>
                <div style="background:#fff;border-radius:8px;padding:24px;box-shadow:0 10px 25px rgba(0,0,0,.2);width:90%;max-width:800px;max-height:80vh;display:flex;flex-direction:column"
                     onClick=${e => e.stopPropagation()}>

                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;border-bottom:1px solid #ebeef5;padding-bottom:16px">
                        <h2 style="margin:0;font-size:18px">${results ? t('renameComplete') : confirm ? t('confirmRename') : t('batchRenameFiles')}</h2>
                        <button onClick=${reset} style="background:none;border:none;font-size:24px;cursor:pointer;color:${colors.secondary}">×</button>
                    </div>

                    <div style="flex:1;overflow-y:auto">
                        ${results && html`
                            <div style="padding:20px;background:#f0f9ff;border-radius:6px;margin-bottom:20px">
                                <div style="font-size:16px;font-weight:500;margin-bottom:10px">
                                    ${t('resultSummary')(results.success, results.failed, results.total)}
                                </div>
                                ${results.failedFiles.length > 0 && html`
                                    <div style="font-size:14px;color:${colors.danger}">
                                        <div>${t('failedFiles')}</div>
                                        ${results.failedFiles.map(f => html`<div key=${f.name}>${f.name}: ${f.error}</div>`)}
                                    </div>`}
                            </div>`}

                        ${confirm && !results && html`
                            <div>
                                <div style="padding:16px;background:#fff7e6;border-radius:6px;margin-bottom:16px;border:1px solid #ffd666">
                                    ${t('aboutToRename')(validCount)}
                                </div>
                                <div style="max-height:400px;overflow-y:auto">
                                    ${files.filter(f => selected.has(f.id) && statuses[f.id] === 'valid').map(f => html`
                                        <div key=${f.id} style="padding:8px;border-bottom:1px solid #f0f0f0;font-size:14px">
                                            <div style="color:#909399">${t('original')}: ${f.name}</div>
                                            <div style="color:${colors.success}">${t('newName')}: ${newNames[f.id]}</div>
                                        </div>`)}
                                </div>
                            </div>`}

                        ${!confirm && !results && html`
                            <div>
                                <div style="padding:12px;background:#f8f9fa;border-radius:6px;margin-bottom:16px">
                                    <div style="display:flex;justify-content:space-between;align-items:center">
                                        <label style="display:flex;align-items:center">
                                            <input type="checkbox" onChange=${e => selectAll(e.target.checked)} style="margin-right:8px" />
                                            ${t('selectAll')}
                                        </label>
                                        <div style="display:flex;align-items:center;gap:8px">
                                            <select value=${sortBy} onChange=${e => setSortBy(e.target.value)}
                                                style="padding:4px;border-radius:4px;border:1px solid #dcdfe6">
                                                <option value="name">${t('name')}</option>
                                                <option value="created_time">${t('createdTime')}</option>
                                                <option value="modified_time">${t('modifiedTime')}</option>
                                                <option value="size">${t('size')}</option>
                                            </select>
                                            <select value=${sortDir} onChange=${e => setSortDir(e.target.value)}
                                                style="padding:4px;border-radius:4px;border:1px solid #dcdfe6">
                                                <option value="asc">${t('asc')}</option>
                                                <option value="desc">${t('desc')}</option>
                                            </select>
                                            <button onClick=${validateFiles} disabled=${validating || selected.size === 0}
                                                style="padding:8px 16px;border:none;border-radius:4px;cursor:pointer;background:${validating || selected.size === 0 ? '#c0c4cc' : colors.blue};color:#fff">
                                                ${validating ? t('scanning') : selected.size === 0 ? t('selectFiles') : t('scanCodes')}
                                            </button>
                                            <button onClick=${() => setShowConfig(!showConfig)}
                                                style="padding:8px 12px;background:${showConfig ? '#e9ecef' : 'transparent'};border:1px solid #dcdfe6;border-radius:4px;cursor:pointer;font-size:13px"
                                                >${t('config')}</button>
                                        </div>
                                    </div>
                                    ${showConfig && html`<${ConfigPanel} config=${config} onChange=${c => setConfigState(c)} />`}
                                </div>
                                <div style="max-height:400px;overflow-y:auto">
                                    ${files.map(f => html`<${FileItem} key=${f.id} file=${f} selected=${selected.has(f.id)}
                                        onSelect=${toggleSelect} status=${statuses[f.id]} newName=${newNames[f.id]} sortBy=${sortBy} />`)}
                                </div>
                            </div>`}
                    </div>

                    <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:20px;padding-top:16px;border-top:1px solid #ebeef5">
                        ${renaming && html`<div style="flex:1;color:${colors.secondary}">${t('progress')(progress.cur, progress.total)}</div>`}
                        ${!results && !confirm && [
                html`<button onClick=${reset} style="padding:8px 16px;border:1px solid #dcdfe6;border-radius:4px;cursor:pointer;background:#fff">${t('cancel')}</button>`,
                html`<button onClick=${() => setConfirm(true)} disabled=${validCount === 0}
                                style="padding:8px 16px;border:none;border-radius:4px;cursor:pointer;background:${validCount === 0 ? '#c0c4cc' : colors.blue};color:#fff">${t('next')}</button>`
            ]}
                        ${!results && confirm && [
                html`<button onClick=${() => setConfirm(false)} disabled=${renaming}
                                style="padding:8px 16px;border:1px solid #dcdfe6;border-radius:4px;cursor:pointer;background:#fff">${t('back')}</button>`,
                html`<button onClick=${performRename} disabled=${renaming}
                                style="padding:8px 16px;border:none;border-radius:4px;cursor:pointer;background:${renaming ? '#c0c4cc' : colors.blue};color:#fff">
                                ${renaming ? t('renaming') : t('confirming')}</button>`
            ]}
                    </div>
                </div>
            </div>`;
    }

    // ─── Init ───

    function openBatchRenameModal() {
        if (document.getElementById('pikpak-batch-renamer-modal')) return;
        const container = document.createElement('div');
        container.id = 'pikpak-batch-renamer-modal';
        document.body.appendChild(container);
        render(html`<${BatchRenameModal} onClose=${() => { render(null, container); container.remove(); }} />`, container);
    }

    function isFabVisible() {
        return location.pathname !== '/';
    }

    function loadFabPosition() {
        try {
            const saved = JSON.parse(localStorage.getItem(FLOAT_BUTTON_POS_KEY) || 'null');
            if (!saved || typeof saved.left !== 'number' || typeof saved.top !== 'number') return null;
            return saved;
        } catch {
            return null;
        }
    }

    function saveFabPosition(pos) {
        try {
            localStorage.setItem(FLOAT_BUTTON_POS_KEY, JSON.stringify(pos));
        } catch { }
    }

    function clampFabPosition(left, top, width, height) {
        const pad = 12;
        const maxLeft = Math.max(pad, window.innerWidth - width - pad);
        const maxTop = Math.max(pad, window.innerHeight - height - pad);
        return {
            left: Math.min(Math.max(pad, left), maxLeft),
            top: Math.min(Math.max(pad, top), maxTop),
        };
    }

    function applyFabPosition(button, pos) {
        const rect = button.getBoundingClientRect();
        const next = clampFabPosition(pos.left, pos.top, rect.width, rect.height);
        button.style.left = `${next.left}px`;
        button.style.top = `${next.top}px`;
        button.style.right = 'auto';
        button.style.bottom = 'auto';
        return next;
    }

    function mountFloatingButton() {
        if (document.getElementById('pikpak-batch-renamer-fab')) return;

        const button = document.createElement('div');
        button.id = 'pikpak-batch-renamer-fab';
        button.className = 'menu-box';
        button.style.cssText = [
            'position:fixed',
            'right:20px',
            'bottom:24px',
            'z-index:9999',
            'display:flex',
            'justify-content:flex-end',
            'align-items:center',
            'cursor:grab',
            'user-select:none',
            '-webkit-user-select:none',
            'touch-action:none',
        ].join(';');
        button.innerHTML = `
            <div class="control-button" style="
                display:flex;
                align-items:center;
                justify-content:center;
                width:64px;
                height:64px;
                border-radius:20px;
                background:#306eff;
                border:1px solid rgba(48,110,255,.28);
                box-shadow:0 12px 30px rgba(48,110,255,.28);
                transition:transform var(--transition,0.2s cubic-bezier(0.645, 0.045, 0.355, 1)), box-shadow var(--transition,0.2s cubic-bezier(0.645, 0.045, 0.355, 1)), background var(--transition,0.2s cubic-bezier(0.645, 0.045, 0.355, 1));
            ">
                <div class="transfer-entry" aria-label="${t('batchRename')}" title="${t('batchRename')}" style="
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    width:28px;
                    height:28px;
                    color:#fff;
                ">
                    <svg fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width:24px;height:24px">
                        <path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                    </svg>
                </div>
            </div>`;
        const controlButton = button.querySelector('.control-button');
        if (controlButton) {
            controlButton.addEventListener('mouseenter', () => {
                controlButton.style.transform = 'translateY(-1px)';
                controlButton.style.boxShadow = '0 16px 34px rgba(48,110,255,.34)';
                controlButton.style.background = '#4a80ff';
            });
            controlButton.addEventListener('mouseleave', () => {
                controlButton.style.transform = 'translateY(0)';
                controlButton.style.boxShadow = '0 12px 30px rgba(48,110,255,.28)';
                controlButton.style.background = '#306eff';
            });
        }

        let pointerId = null;
        let startX = 0;
        let startY = 0;
        let originLeft = 0;
        let originTop = 0;
        let dragging = false;

        const onPointerMove = e => {
            if (e.pointerId !== pointerId) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (!dragging && Math.hypot(dx, dy) >= 6) {
                dragging = true;
                button.style.cursor = 'grabbing';
            }
            if (!dragging) return;
            const next = applyFabPosition(button, { left: originLeft + dx, top: originTop + dy });
            saveFabPosition(next);
        };

        const finishPointer = e => {
            if (e.pointerId !== pointerId) return;
            if (button.hasPointerCapture(pointerId)) button.releasePointerCapture(pointerId);
            button.style.cursor = 'grab';
            const wasDragging = dragging;
            pointerId = null;
            dragging = false;
            if (!wasDragging) openBatchRenameModal();
        };

        button.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            const rect = button.getBoundingClientRect();
            pointerId = e.pointerId;
            startX = e.clientX;
            startY = e.clientY;
            originLeft = rect.left;
            originTop = rect.top;
            dragging = false;
            button.setPointerCapture(pointerId);
            e.preventDefault();
        });
        button.addEventListener('pointermove', onPointerMove);
        button.addEventListener('pointerup', finishPointer);
        button.addEventListener('pointercancel', finishPointer);
        button.addEventListener('lostpointercapture', e => {
            if (e.pointerId !== pointerId) return;
            pointerId = null;
            dragging = false;
            button.style.cursor = 'grab';
        });

        document.body.appendChild(button);
        const savedPos = loadFabPosition();
        if (savedPos) {
            const next = applyFabPosition(button, savedPos);
            saveFabPosition(next);
        }
        button.style.display = isFabVisible() ? 'flex' : 'none';

        const syncVisibility = () => {
            button.style.display = isFabVisible() ? 'flex' : 'none';
            if (button.style.display !== 'none') {
                const rect = button.getBoundingClientRect();
                const next = clampFabPosition(rect.left, rect.top, rect.width, rect.height);
                button.style.left = `${next.left}px`;
                button.style.top = `${next.top}px`;
                button.style.right = 'auto';
                button.style.bottom = 'auto';
                saveFabPosition(next);
            }
        };

        window.addEventListener('resize', syncVisibility);
        window.addEventListener('popstate', syncVisibility);

        const { pushState, replaceState } = history;
        history.pushState = function (...args) {
            const out = pushState.apply(this, args);
            syncVisibility();
            return out;
        };
        history.replaceState = function (...args) {
            const out = replaceState.apply(this, args);
            syncVisibility();
            return out;
        };
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountFloatingButton);
    else setTimeout(mountFloatingButton, 1000);

})();
