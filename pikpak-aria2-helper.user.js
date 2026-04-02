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
// @version      0.1.0
// @description  Push PikPak files and folders to Aria2 for downloading.
// @description:en Push PikPak files and folders to Aria2 for downloading.
// @description:ja PikPakのファイルとフォルダをAria2にプッシュしてダウンロードします。
// @description:zh-CN 将 PikPak 文件和文件夹推送到 Aria2 进行下载。
// @description:zh-TW 將 PikPak 檔案和資料夾推送到 Aria2 進行下載。
// @description:ko PikPak 파일과 폴더를 Aria2로 푸시하여 다운로드합니다.
// @description:ru Отправка файлов и папок PikPak в Aria2 для скачивания.
// @description:es Enviar archivos y carpetas de PikPak a Aria2 para descargar.
// @description:pt-BR Enviar arquivos e pastas do PikPak para o Aria2 para download.
// @description:fr Envoyer les fichiers et dossiers PikPak vers Aria2 pour le téléchargement.
// @description:de PikPak-Dateien und -Ordner zum Herunterladen an Aria2 senden.
// @author       cheerchen37
// @match        *://*mypikpak.com/*
// @match        *://*mypikpak.net/*
// @match        *://*pikpak.me/*
// @require      https://unpkg.com/preact@10/dist/preact.umd.js
// @require      https://unpkg.com/preact@10/hooks/dist/hooks.umd.js
// @require      https://unpkg.com/htm@3/dist/htm.umd.js
// @grant        GM_xmlhttpRequest
// @connect      *
// @icon         https://www.google.com/s2/favicons?domain=mypikpak.com
// @license      MIT
// @homepage     https://github.com/CheerChen/userscripts
// @supportURL   https://github.com/CheerChen/userscripts/issues
// ==/UserScript==

(function () {
    'use strict';

    const { h, render } = preact;
    const { useState, useEffect } = preactHooks;
    const html = htm.bind(h);

    // ─── i18n ───

    const i18n = {
        zh: {
            aria2Download: 'Aria2 下载',
            pushToAria2: '推送到 Aria2',
            configAria2: '配置 Aria2',
            selectAll: '全选',
            name: '名称', size: '大小', createdTime: '创建时间', modifiedTime: '修改时间',
            asc: '升序', desc: '降序',
            selectFiles: '请先选择要推送的文件',
            configFirst: '请先配置 Aria2',
            pushing: '推送中...',
            pushBtn: n => `推送到 Aria2 (${n})`,
            progress: (c, t, s, f) => `推送进度: ${c}/${t} (成功: ${s}, 失败: ${f})`,
            pushDone: (s, f) => f === 0 ? `推送完成！成功 ${s} 个文件` : `推送完成：成功 ${s}，失败 ${f}`,
            scanning: name => `正在扫描文件夹: ${name}`,
            preparing: t => `准备推送 ${t} 个文件`,
            connected: 'Aria2 连接正常', disconnected: 'Aria2 连接失败',
            testing: '正在测试连接...', unknown: '连接状态未知',
            testBtn: '测试连接', testingBtn: '测试中...',
            rpcUrl: 'RPC 地址', rpcUrlHint: 'Aria2 RPC 服务地址，通常是 http://127.0.0.1:6800/jsonrpc',
            rpcToken: 'RPC 密钥', rpcTokenHint: '如果 Aria2 设置了 rpc-secret，请在此填写',
            rpcTokenPlaceholder: '没有请留空',
            downloadPath: '下载路径', downloadPathHint: '文件保存路径，例如 /downloads/ 或 D:\\Downloads\\',
            customParams: '其他参数', customParamsHint: '额外参数，以分号分隔，如 user-agent=Mozilla;split=10',
            save: '保存', cancel: '取消',
        },
        en: {
            aria2Download: 'Aria2 Download',
            pushToAria2: 'Push to Aria2',
            configAria2: 'Configure Aria2',
            selectAll: 'Select All',
            name: 'Name', size: 'Size', createdTime: 'Created', modifiedTime: 'Modified',
            asc: 'Asc', desc: 'Desc',
            selectFiles: 'Please select files first',
            configFirst: 'Please configure Aria2 first',
            pushing: 'Pushing...',
            pushBtn: n => `Push to Aria2 (${n})`,
            progress: (c, t, s, f) => `Progress: ${c}/${t} (Success: ${s}, Failed: ${f})`,
            pushDone: (s, f) => f === 0 ? `Done! ${s} file(s) pushed` : `Done: ${s} success, ${f} failed`,
            scanning: name => `Scanning folder: ${name}`,
            preparing: t => `Preparing ${t} file(s)`,
            connected: 'Aria2 connected', disconnected: 'Aria2 connection failed',
            testing: 'Testing connection...', unknown: 'Connection unknown',
            testBtn: 'Test', testingBtn: 'Testing...',
            rpcUrl: 'RPC URL', rpcUrlHint: 'Aria2 RPC address, usually http://127.0.0.1:6800/jsonrpc',
            rpcToken: 'RPC Token', rpcTokenHint: 'Fill in if Aria2 has rpc-secret configured',
            rpcTokenPlaceholder: 'Leave empty if none',
            downloadPath: 'Download Path', downloadPathHint: 'e.g. /downloads/ or D:\\Downloads\\',
            customParams: 'Extra Params', customParamsHint: 'Semicolon-separated, e.g. user-agent=Mozilla;split=10',
            save: 'Save', cancel: 'Cancel',
        },
    };

    const lang = (navigator.language || '').startsWith('zh') ? 'zh' : 'en';
    const t = key => i18n[lang][key];

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
        return fetch(`https://api-drive.mypikpak.com/drive/v1/files?thumbnail_size=SIZE_MEDIUM&limit=500&parent_id=${parentId}&with_audit=true&filters=${encodeURIComponent('{"phase":{"eq":"PHASE_TYPE_COMPLETE"},"trashed":{"eq":false}}')}`, {
            headers: { 'Content-Type': 'application/json', ...getHeader() },
        }).then(r => r.json());
    }

    function getDownloadUrl(fileId) {
        return fetch(`https://api-drive.mypikpak.com/drive/v1/files/${fileId}?`, {
            headers: { 'Content-Type': 'application/json', ...getHeader() },
        }).then(r => r.json());
    }

    // ─── Aria2 RPC ───

    function rpcCall(rpcUrl, data) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST', url: rpcUrl,
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify(data),
                onload: res => {
                    try { resolve(JSON.parse(res.responseText)); }
                    catch { reject(new Error('Invalid response')); }
                },
                onerror: e => reject(new Error(e.statusText || 'Network error')),
            });
        });
    }

    // ─── Config ───

    const CONFIG_KEY = 'pikpak-aria2-helper-config';
    const defaultConfig = { rpcUrl: 'http://127.0.0.1:6800/jsonrpc', rpcToken: '', downloadPath: '', customParams: '', sortBy: 'name', sortDir: 'asc' };
    const getConfig = () => { try { return { ...defaultConfig, ...JSON.parse(localStorage.getItem(CONFIG_KEY)) }; } catch { return { ...defaultConfig }; } };
    const saveConfig = c => localStorage.setItem(CONFIG_KEY, JSON.stringify(c));

    // ─── Helpers ───

    const delay = ms => new Promise(r => setTimeout(r, ms));
    const colors = { secondary: '#606266', success: '#67c23a', danger: '#f56c6c', blue: '#409eff' };

    const formatBytes = b => {
        if (!b || b <= 0) return '';
        const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(b) / Math.log(k));
        return (b / Math.pow(k, i)).toFixed(1) + ' ' + s[i];
    };

    const sortFiles = (list, by, dir) => [...list].sort((a, b) => {
        const af = a.kind === 'drive#folder', bf = b.kind === 'drive#folder';
        if (af !== bf) return af ? -1 : 1;
        let av = a[by], bv = b[by];
        if (by === 'size') { av = parseInt(av || '0'); bv = parseInt(bv || '0'); }
        else if (by.includes('time')) { av = new Date(av).getTime(); bv = new Date(bv).getTime(); }
        else { av = (av || '').toLowerCase(); bv = (bv || '').toLowerCase(); }
        const c = av > bv ? 1 : av < bv ? -1 : 0;
        return dir === 'asc' ? c : -c;
    });

    function testAria2(rpcUrl, rpcToken) {
        const payload = { jsonrpc: '2.0', method: 'aria2.getVersion', id: 1, params: rpcToken ? [`token:${rpcToken}`] : [] };
        return rpcCall(rpcUrl, payload).then(r => !!(r && r.result));
    }

    // ─── Components ───

    function Toast({ message, type }) {
        if (!message) return null;
        const bg = { success: 'rgba(103,194,58,.9)', error: 'rgba(245,108,108,.9)', warning: 'rgba(230,162,60,.9)', info: 'rgba(64,158,255,.9)' };
        const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
        return html`<div style="position:fixed;top:30px;left:50%;transform:translateX(-50%);padding:15px 20px;background:${bg[type] || bg.info};color:#fff;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.15);font-size:14px;z-index:10001;display:flex;align-items:center;gap:10px">
            <span style="font-size:18px;font-weight:bold">${icons[type] || icons.info}</span>
            <span>${message}</span>
        </div>`;
    }

    function ConnectionStatus({ status, onTest, testing }) {
        const cfg = { connected: { color: colors.success, text: t('connected') }, disconnected: { color: colors.danger, text: t('disconnected') },
            testing: { color: '#e6a23c', text: t('testing') }, unknown: { color: '#909399', text: t('unknown') } };
        const s = cfg[status] || cfg.unknown;
        return html`<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:#f8f9fa;border-radius:8px;margin-bottom:16px;border:1px solid #e9ecef">
            <div style="display:flex;align-items:center;gap:8px">
                <div style="width:10px;height:10px;border-radius:50%;background:${s.color};box-shadow:0 0 0 2px ${s.color}33" />
                <span style="font-size:14px;color:#666">${s.text}</span>
            </div>
            <button onClick=${onTest} disabled=${testing}
                style="padding:6px 12px;font-size:12px;border:1px solid #dcdfe6;border-radius:4px;background:#fff;color:#666;cursor:${testing ? 'not-allowed' : 'pointer'};opacity:${testing ? 0.6 : 1}">
                ${testing ? t('testingBtn') : t('testBtn')}</button>
        </div>`;
    }

    function FileItem({ file, selected, onSelect, status, sortBy }) {
        const icons = { success: '✅', error: '❌', downloading: '⏳' };
        const info = () => {
            if (sortBy === 'size') return file.size && parseInt(file.size) > 0 ? formatBytes(parseInt(file.size)) : '';
            if (sortBy === 'created_time' || sortBy === 'modified_time') return file[sortBy] ? new Date(file[sortBy]).toLocaleString() : '';
            return file.size && parseInt(file.size) > 0 ? formatBytes(parseInt(file.size)) : '';
        };
        return html`<div style="display:flex;align-items:center;padding:10px 0;border-bottom:1px solid #f0f0f0">
            <input type="checkbox" checked=${selected} onChange=${e => onSelect(file.id, e.target.checked)} style="margin-right:12px" />
            <span style="margin-right:10px;font-size:18px">${file.kind === 'drive#folder' ? '📁' : '📄'}</span>
            <div style="flex:1;min-width:0;font-weight:500;word-break:break-word">${file.name}</div>
            <span style="margin-left:16px;font-size:12px;color:${colors.secondary};white-space:nowrap">${info()}</span>
            ${status && html`<span style="margin-left:12px;font-size:16px">${icons[status] || ''}</span>`}
        </div>`;
    }

    function ConfigPanel({ config, onSave, onClose }) {
        const [local, setLocal] = useState(config);
        const [connStatus, setConnStatus] = useState('unknown');
        const [testing, setTesting] = useState(false);

        const doTest = async () => {
            if (!local.rpcUrl) return;
            setTesting(true); setConnStatus('testing');
            try { setConnStatus(await testAria2(local.rpcUrl, local.rpcToken) ? 'connected' : 'disconnected'); }
            catch { setConnStatus('disconnected'); }
            finally { setTesting(false); }
        };

        useEffect(() => { if (local.rpcUrl) doTest(); }, []);

        const handleSave = () => {
            const c = { ...local };
            if (c.downloadPath && !/[/\\]$/.test(c.downloadPath)) c.downloadPath += '/';
            saveConfig(c); onSave(c); onClose();
        };

        const field = (key, label, hint, placeholder) => html`
            <div style="margin-bottom:16px">
                <label style="display:block;margin-bottom:6px;font-weight:500">${label}</label>
                <input type="text" value=${local[key]} placeholder=${placeholder || ''}
                    onInput=${e => setLocal({ ...local, [key]: e.target.value })}
                    style="width:100%;padding:8px 12px;border:1px solid #dcdfe6;border-radius:4px;font-size:14px;box-sizing:border-box" />
                <div style="font-size:12px;color:${colors.secondary};margin-top:4px">${hint}</div>
            </div>`;

        return html`<div style="position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10000">
            <div style="background:#fff;border-radius:8px;padding:24px;box-shadow:0 10px 25px rgba(0,0,0,.2);width:90%;max-width:500px;max-height:80vh;display:flex;flex-direction:column">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;border-bottom:1px solid #ebeef5;padding-bottom:16px">
                    <h2 style="margin:0;font-size:18px">${t('configAria2')}</h2>
                    <button onClick=${onClose} style="background:none;border:none;font-size:24px;cursor:pointer;color:${colors.secondary}">×</button>
                </div>
                <${ConnectionStatus} status=${connStatus} onTest=${doTest} testing=${testing} />
                <div style="flex:1;overflow-y:auto">
                    ${field('rpcUrl', t('rpcUrl'), t('rpcUrlHint'), 'http://127.0.0.1:6800/jsonrpc')}
                    ${field('rpcToken', t('rpcToken'), t('rpcTokenHint'), t('rpcTokenPlaceholder'))}
                    ${field('downloadPath', t('downloadPath'), t('downloadPathHint'), '/downloads/')}
                    ${field('customParams', t('customParams'), t('customParamsHint'), 'user-agent=xxx;split=10')}
                </div>
                <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:20px;padding-top:16px;border-top:1px solid #ebeef5">
                    <button onClick=${onClose} style="padding:8px 16px;border:1px solid #dcdfe6;border-radius:4px;cursor:pointer;background:#fff">${t('cancel')}</button>
                    <button onClick=${handleSave} style="padding:8px 16px;border:none;border-radius:4px;cursor:pointer;background:${colors.blue};color:#fff">${t('save')}</button>
                </div>
            </div>
        </div>`;
    }

    function Aria2Modal({ onClose }) {
        const [files, setFiles] = useState([]);
        const [selected, setSelected] = useState(new Set());
        const [statuses, setStatuses] = useState({});
        const [pushing, setPushing] = useState(false);
        const [showConfig, setShowConfig] = useState(false);
        const [config, setConfigState] = useState(getConfig());
        const [toast, setToast] = useState(null);
        const [connStatus, setConnStatus] = useState('unknown');
        const [testing, setTesting] = useState(false);
        const [progress, setProgress] = useState({ cur: 0, total: 0, success: 0, failed: 0 });
        const [sortBy, setSortBy_] = useState(config.sortBy || 'name');
        const [sortDir, setSortDir_] = useState(config.sortDir || 'asc');

        const setSortBy = v => { setSortBy_(v); const c = { ...config, sortBy: v }; saveConfig(c); setConfigState(c); };
        const setSortDir = v => { setSortDir_(v); const c = { ...config, sortDir: v }; saveConfig(c); setConfigState(c); };

        const showToastMsg = (message, type = 'info') => {
            setToast({ message, type });
            setTimeout(() => setToast(null), 3000);
        };

        const doTest = async () => {
            if (!config.rpcUrl) return;
            setTesting(true); setConnStatus('testing');
            try { setConnStatus(await testAria2(config.rpcUrl, config.rpcToken) ? 'connected' : 'disconnected'); }
            catch { setConnStatus('disconnected'); }
            finally { setTesting(false); }
        };

        useEffect(() => {
            let pid = location.pathname.split('/').pop();
            if (pid === 'all') pid = '';
            getList(pid).then(r => r.files && setFiles(sortFiles(r.files, sortBy, sortDir))).catch(console.error);
            setTimeout(doTest, 500);
        }, []);

        useEffect(() => { setFiles(f => sortFiles(f, sortBy, sortDir)); }, [sortBy, sortDir]);

        const toggleSelect = (id, on) => setSelected(s => { const n = new Set(s); on ? n.add(id) : n.delete(id); return n; });
        const selectAll = on => setSelected(on ? new Set(files.map(f => f.id)) : new Set());

        const getAllFiles = async () => {
            const allFiles = [], folders = [];
            for (const id of selected) {
                const f = files.find(x => x.id === id);
                if (!f) continue;
                f.kind === 'drive#folder' ? folders.push({ id: f.id, name: f.name, path: f.name }) : allFiles.push({ ...f, path: '' });
            }
            while (folders.length > 0) {
                const folder = folders.shift();
                showToastMsg(t('scanning')(folder.name), 'info');
                try {
                    const res = await getList(folder.id);
                    if (res.files) for (const f of res.files) {
                        f.kind === 'drive#folder'
                            ? folders.push({ id: f.id, name: f.name, path: `${folder.path}/${f.name}` })
                            : allFiles.push({ ...f, path: folder.path });
                    }
                } catch (e) { console.error('Folder scan failed:', folder.name, e); }
            }
            return allFiles;
        };

        const pushToAria = async () => {
            if (selected.size === 0) return showToastMsg(t('selectFiles'), 'warning');
            if (!config.rpcUrl) { showToastMsg(t('configFirst'), 'error'); setShowConfig(true); return; }

            setPushing(true);
            const filesToPush = await getAllFiles();
            let success = 0, failed = 0;
            setProgress({ cur: 0, total: filesToPush.length, success: 0, failed: 0 });
            showToastMsg(t('preparing')(filesToPush.length), 'info');

            for (let i = 0; i < filesToPush.length; i++) {
                const file = filesToPush[i];
                try {
                    const dl = await getDownloadUrl(file.id);
                    if (dl.error_description) throw new Error(dl.error_description);

                    const params = [[ dl.web_content_link ], { out: dl.name }];
                    if (config.downloadPath) params[1].dir = config.downloadPath + (file.path || '');
                    if (config.customParams) config.customParams.split(';').forEach(p => {
                        const [k, v] = p.split('=');
                        if (k && v) params[1][k] = v;
                    });
                    if (config.rpcToken) params.unshift(`token:${config.rpcToken}`);

                    const res = await rpcCall(config.rpcUrl, { id: Date.now(), jsonrpc: '2.0', method: 'aria2.addUri', params });
                    if (res.result) { success++; setStatuses(p => ({ ...p, [file.id]: 'success' })); }
                    else throw new Error(res.error?.message || 'Unknown error');
                } catch {
                    failed++; setStatuses(p => ({ ...p, [file.id]: 'error' }));
                }
                setProgress({ cur: i + 1, total: filesToPush.length, success, failed });
                if (i < filesToPush.length - 1) await delay(100);
            }

            showToastMsg(t('pushDone')(success, failed), failed === 0 ? 'success' : success === 0 ? 'error' : 'warning');
            setPushing(false);
        };

        if (showConfig) return html`<${ConfigPanel} config=${config} onSave=${c => setConfigState(c)} onClose=${() => setShowConfig(false)} />`;

        return html`
            <div style="position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10000"
                 onClick=${e => e.target === e.currentTarget && onClose()}>
                <${Toast} ...${{ ...toast }} />
                <div style="background:#fff;border-radius:8px;padding:24px;box-shadow:0 10px 25px rgba(0,0,0,.2);width:90%;max-width:800px;max-height:80vh;display:flex;flex-direction:column"
                     onClick=${e => e.stopPropagation()}>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;border-bottom:1px solid #ebeef5;padding-bottom:16px">
                        <h2 style="margin:0;font-size:18px">${t('pushToAria2')}</h2>
                        <button onClick=${onClose} style="background:none;border:none;font-size:24px;cursor:pointer;color:${colors.secondary}">×</button>
                    </div>

                    <${ConnectionStatus} status=${connStatus} onTest=${doTest} testing=${testing} />

                    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:#f8f9fa;border-radius:6px;margin-bottom:16px">
                        <label style="display:flex;align-items:center">
                            <input type="checkbox" checked=${selected.size === files.length && files.length > 0}
                                onChange=${e => selectAll(e.target.checked)} style="margin-right:8px" />
                            ${t('selectAll')}
                        </label>
                        <div style="display:flex;align-items:center;gap:8px">
                            <select value=${sortBy} onChange=${e => setSortBy(e.target.value)}
                                style="padding:4px 8px;border-radius:4px;border:1px solid #dcdfe6">
                                <option value="name">${t('name')}</option>
                                <option value="size">${t('size')}</option>
                                <option value="created_time">${t('createdTime')}</option>
                                <option value="modified_time">${t('modifiedTime')}</option>
                            </select>
                            <select value=${sortDir} onChange=${e => setSortDir(e.target.value)}
                                style="padding:4px 8px;border-radius:4px;border:1px solid #dcdfe6">
                                <option value="asc">${t('asc')}</option>
                                <option value="desc">${t('desc')}</option>
                            </select>
                        </div>
                    </div>

                    <div style="flex:1;overflow-y:auto;max-height:400px">
                        ${files.map(f => html`<${FileItem} key=${f.id} file=${f} selected=${selected.has(f.id)}
                            onSelect=${toggleSelect} status=${statuses[f.id]} sortBy=${sortBy} />`)}
                    </div>

                    ${pushing && html`<div style="padding:12px;background:#f0f9ff;border-radius:6px;margin-top:16px">
                        ${t('progress')(progress.cur, progress.total, progress.success, progress.failed)}</div>`}

                    <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:20px;padding-top:16px;border-top:1px solid #ebeef5">
                        <button onClick=${() => setShowConfig(true)}
                            style="padding:8px 16px;border:1px solid #dcdfe6;border-radius:4px;cursor:pointer;background:#fff">${t('configAria2')}</button>
                        <button onClick=${pushToAria} disabled=${pushing || selected.size === 0}
                            style="padding:8px 16px;border:none;border-radius:4px;cursor:pointer;color:#fff;background:${pushing || selected.size === 0 ? '#c0c4cc' : colors.blue}">
                            ${pushing ? t('pushing') : t('pushBtn')(selected.size)}</button>
                    </div>
                </div>
            </div>`;
    }

    // ─── Init ───

    function initApp() {
        if (location.pathname === '/') return;
        const ops = document.querySelector('.file-operations');
        if (!ops) return setTimeout(initApp, 1000);
        if (ops.querySelector('.aria2-helper-button')) return;

        const li = document.createElement('li');
        li.className = 'icon-with-label aria2-helper-button';
        li.innerHTML = `
            <a aria-label="${t('aria2Download')}" class="pp-link-button hover-able" href="javascript:void(0)">
                <span class="icon-hover-able pp-icon" style="--icon-color:var(--color-secondary-text);--icon-color-hover:var(--color-primary);display:flex;flex:0 0 24px;width:24px;height:24px">
                    <svg fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                    </svg>
                </span>
                <span class="label">${t('aria2Download')}</span>
            </a>`;

        li.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            if (document.getElementById('pikpak-aria2-helper-modal')) return;
            const container = document.createElement('div');
            container.id = 'pikpak-aria2-helper-modal';
            document.body.appendChild(container);
            render(html`<${Aria2Modal} onClose=${() => { render(null, container); container.remove(); }} />`, container);
        });

        const divider = ops.querySelector('.divider-in-operations');
        divider ? ops.insertBefore(li, divider) : ops.appendChild(li);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp);
    else setTimeout(initApp, 1000);

})();
