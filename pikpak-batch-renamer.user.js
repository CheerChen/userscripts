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
// @version      0.1.1
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

    function parse(filename) {
        const dotIdx = filename.lastIndexOf('.');
        const ext = dotIdx > 0 ? filename.substring(dotIdx).toLowerCase() : '';
        let name = dotIdx > 0 ? filename.substring(0, dotIdx) : filename;

        const res = { number: '', rawNumber: '', part: 0, tags: [], ext, sourceSite: '' };

        const siteMatch = name.match(sitePrefixRe);
        if (siteMatch) {
            res.sourceSite = siteMatch[1].toLowerCase();
            name = name.replace(sitePrefixRe, '');
        }

        const tokens = name.split(tokenizeRe).filter(Boolean);
        if (tokens.length === 0) return res;

        let idStart = tokens.findIndex(t => hasLetter(t));
        if (idStart < 0) return res;

        let raw = tokens[idStart].toLowerCase();
        let next = idStart + 1;

        if (next < tokens.length && endsWithLetter(raw) && isPureDigits(tokens[next]) && tokens[next].length >= 3) {
            raw += tokens[next];
            next++;
        }

        for (let i = next; i < tokens.length; i++) {
            const t = tokens[i];
            const pm = t.match(partTokenRe);
            if (pm) { if (res.part === 0) res.part = parseInt(pm[1], 10); continue; }
            if (tagTokenRe.test(t)) { res.tags.push(t.toLowerCase()); continue; }
            if (isPureDigits(t) && t.length <= 2 && res.part === 0) { res.part = parseInt(t, 10); continue; }
        }

        res.tags = [...new Set(res.tags)];
        const { number, rawNumber } = extractNumber(raw);
        res.number = number;
        res.rawNumber = rawNumber;
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
        const date = doc.querySelector('time.date.published')?.getAttribute('datetime') || null;
        if (name) name = name.replace(/[\/:*?"<>|\x00-\x1F]/g, '_');
        return { title: name, date };
    }

    function buildDirectUrl(keyword) { return `https://av-wiki.net/${keyword.toLowerCase()}/`; }
    function buildSearchUrl(term) { return `https://av-wiki.net/?s=${encodeURIComponent(term)}&post_type=product`; }

    async function queryAVwiki(parsed) {
        if (!parsed.number) throw new Error('No number');

        const directResp = await httpRequest({ url: buildDirectUrl(parsed.number) });
        if (directResp.status === 200 && directResp.responseText.includes('blockquote-like')) {
            const { title, date } = parseDetailPage(directResp.responseText);
            if (title) return { title, date };
        }

        // Fallback: search
        const searchResp = await httpRequest({ url: buildSearchUrl(parsed.rawNumber) });
        const doc = new DOMParser().parseFromString(searchResp.responseText, 'text/html');
        const series = parsed.number.match(/[a-zA-Z]+/)?.[0]?.toLowerCase();
        for (const a of doc.querySelectorAll('.read-more a')) {
            if (series && a.href.toLowerCase().includes(series)) {
                const detailResp = await httpRequest({ url: a.href });
                const { title, date } = parseDetailPage(detailResp.responseText);
                if (title) return { title, date };
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
            const fmt = (b) => { const k = 1024; const s = ['B','KB','MB','GB']; const i = Math.floor(Math.log(b)/Math.log(k)); return (b/Math.pow(k,i)).toFixed(1)+' '+s[i]; };
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
                    if (!parsed.number) { sts[file.id] = 'invalid'; return; }

                    sts[file.id] = 'loading';
                    setStatuses(p => ({ ...p, ...sts }));

                    try {
                        const info = await queryAVwiki(parsed);
                        sts[file.id] = 'valid';
                        let ext = parsed.ext;
                        if (!ext && isFile && config.fixFileExtension && file.mime_type) {
                            const m = file.mime_type.match(/\/([a-z0-9]+)/);
                            if (m) ext = '.' + m[1];
                        }
                        let finalName = config.addDatePrefix && info.date ? `${info.date} ${info.title}` : info.title;
                        names[file.id] = ext ? `${finalName}${ext}` : finalName;
                    } catch { sts[file.id] = 'invalid'; }
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

    function initApp() {
        if (location.pathname === '/') return;
        const ops = document.querySelector('.file-operations');
        if (!ops) return setTimeout(initApp, 1000);
        if (ops.querySelector('.batch-rename-button')) return;

        const li = document.createElement('li');
        li.className = 'icon-with-label batch-rename-button';
        li.innerHTML = `
            <a aria-label="${t('batchRename')}" class="pp-link-button hover-able" href="javascript:void(0)">
                <span class="icon-hover-able pp-icon" style="--icon-color:var(--color-secondary-text);--icon-color-hover:var(--color-primary);display:flex;flex:0 0 24px;width:24px;height:24px">
                    <svg fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                    </svg>
                </span>
                <span class="label">${t('batchRename')}</span>
            </a>`;

        li.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            if (document.getElementById('pikpak-batch-renamer-modal')) return;
            const container = document.createElement('div');
            container.id = 'pikpak-batch-renamer-modal';
            document.body.appendChild(container);
            render(html`<${BatchRenameModal} onClose=${() => { render(null, container); container.remove(); }} />`, container);
        });

        const divider = ops.querySelector('.divider-in-operations');
        divider ? ops.insertBefore(li, divider) : ops.appendChild(li);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp);
    else setTimeout(initApp, 1000);

})();
