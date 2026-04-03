// ==UserScript==
// @name         Emby Show Fields Persistence Fix
// @name:en      Emby Show Fields Persistence Fix
// @name:ja      Emby 表示フィールド永続化修正
// @name:zh-CN   Emby 显示字段持久化修复
// @name:zh-TW   Emby 顯示欄位持久化修復
// @name:ko      Emby 표시 필드 지속성 수정
// @name:ru      Emby Исправление сохранения полей отображения
// @name:es      Emby Corrección de persistencia de campos
// @name:pt-BR   Emby Correção de persistência de campos
// @name:fr      Emby Correction de persistance des champs
// @name:de      Emby Anzeigefelder-Persistenz-Fix
// @namespace    https://github.com/CheerChen
// @version      1.3.0
// @description  Prevents Emby from resetting Show Fields when switching views. Intercepts localStorage to backup and restore field settings. Supports copying field config across libraries.
// @description:en  Prevents Emby from resetting Show Fields when switching views. Intercepts localStorage to backup and restore field settings. Supports copying field config across libraries.
// @description:ja  Emby がビュー切替時に表示フィールドをリセットするのを防ぎます。localStorage を傍受してフィールド設定をバックアップ・復元します。ライブラリ間での設定コピーにも対応。
// @description:zh-CN  防止 Emby 在切换视图时重置「显示字段」设置，通过拦截 localStorage 自动备份和恢复字段配置。支持跨媒体库复制字段配置。
// @description:zh-TW  防止 Emby 在切換檢視時重置「顯示欄位」設定，透過攔截 localStorage 自動備份和還原欄位設定。支援跨媒體庫複製欄位設定。
// @description:ko  Emby가 뷰 전환 시 표시 필드를 초기화하는 것을 방지합니다. localStorage를 가로채 필드 설정을 백업 및 복원합니다. 라이브러리 간 설정 복사를 지원합니다.
// @description:ru  Предотвращает сброс полей отображения Emby при переключении видов. Перехватывает localStorage для резервного копирования и восстановления настроек полей. Поддерживает копирование настроек между библиотеками.
// @description:es  Evita que Emby restablezca los campos de visualización al cambiar de vista. Intercepta localStorage para respaldar y restaurar la configuración de campos. Permite copiar configuración entre bibliotecas.
// @description:pt-BR  Impede que o Emby redefina os campos de exibição ao alternar visualizações. Intercepta o localStorage para fazer backup e restaurar as configurações de campos. Suporta copiar configurações entre bibliotecas.
// @description:fr  Empêche Emby de réinitialiser les champs d'affichage lors du changement de vue. Intercepte localStorage pour sauvegarder et restaurer les paramètres de champs. Permet de copier les paramètres entre bibliothèques.
// @description:de  Verhindert, dass Emby die Anzeigefelder beim Wechseln der Ansicht zurücksetzt. Fängt localStorage ab, um Feldeinstellungen zu sichern und wiederherzustellen. Unterstützt das Kopieren von Feldkonfigurationen zwischen Bibliotheken.
// @author       cheerchen37
// @match        *://*/web/index.html*
// @grant        none
// @run-at       document-start
// @icon         https://www.google.com/s2/favicons?domain=emby.media
// @license      MIT
// @homepage     https://github.com/CheerChen/userscripts
// @supportURL   https://github.com/CheerChen/userscripts/issues
// ==/UserScript==

(function () {
    'use strict';

    const BACKUP_PREFIX = '__emby_fields_fix::';
    const FIELDS_SUFFIX = '-fields';
    const DEFAULT_FIELDS = 'Name,ProductionYear';

    // 判断是否是 fields key: {userId}-{libraryId}-{page}-{type}-fields
    function isFieldsKey(key) {
        return typeof key === 'string' && key.endsWith(FIELDS_SUFFIX);
    }

    function backupKey(key) {
        return BACKUP_PREFIX + key;
    }

    const originalSetItem = Storage.prototype.setItem;
    const originalGetItem = Storage.prototype.getItem;

    Storage.prototype.setItem = function (key, value) {
        if (this === localStorage && isFieldsKey(key)) {
            const prev = originalGetItem.call(this, key);
            const backup = originalGetItem.call(this, backupKey(key));

            // 如果新值是默认值（被重置），但我们有更丰富的备份，就阻止写入并恢复
            if (
                value === DEFAULT_FIELDS &&
                prev &&
                prev !== DEFAULT_FIELDS
            ) {
                console.log(
                    '%c[Fields Fix] 阻止重置:',
                    'color: #f90; font-weight: bold',
                    key,
                    '\n  被丢弃:', value,
                    '\n  保留:', prev
                );
                // 确保备份是最新的
                originalSetItem.call(this, backupKey(key), prev);
                return; // 不执行写入，保留当前值
            }

            // 如果新值也是默认值，但之前没有非默认值，检查备份
            if (
                value === DEFAULT_FIELDS &&
                (!prev || prev === DEFAULT_FIELDS) &&
                backup &&
                backup !== DEFAULT_FIELDS
            ) {
                console.log(
                    '%c[Fields Fix] 从备份恢复:',
                    'color: #0f0; font-weight: bold',
                    key,
                    '\n  恢复为:', backup
                );
                originalSetItem.call(this, key, backup);
                return;
            }

            // 正常写入（用户主动修改），同时更新备份
            if (value !== DEFAULT_FIELDS) {
                originalSetItem.call(this, backupKey(key), value);
                console.log(
                    '%c[Fields Fix] 备份已更新:',
                    'color: #0ff;',
                    key,
                    '→',
                    value
                );
            }
        }

        originalSetItem.call(this, key, value);
    };

    // 页面加载时检查所有已有的 fields key，确保备份存在
    window.addEventListener('DOMContentLoaded', () => {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (isFieldsKey(key) && !key.startsWith(BACKUP_PREFIX)) {
                const val = localStorage.getItem(key);
                const bk = localStorage.getItem(backupKey(key));
                if (val && val !== DEFAULT_FIELDS && (!bk || bk === DEFAULT_FIELDS)) {
                    originalSetItem.call(localStorage, backupKey(key), val);
                }
                // 如果当前值是默认但备份有内容，恢复
                if (
                    (!val || val === DEFAULT_FIELDS) &&
                    bk &&
                    bk !== DEFAULT_FIELDS
                ) {
                    originalSetItem.call(localStorage, key, bk);
                    console.log(
                        '%c[Fields Fix] 页面加载恢复:',
                        'color: #0f0; font-weight: bold',
                        key,
                        '→',
                        bk
                    );
                }
            }
        }
        console.log('%c[Fields Fix] 已激活', 'color: #0f0; font-size: 14px');
        initCopyUI();
    });

    // ===================== 跨媒体库复制配置 UI =====================

    const i18n = {
        zh: {
            title: '复制显示字段配置',
            source: '复制来源',
            target: '应用到',
            applyAll: '应用到全部',
            apply: '复制配置',
            close: '关闭',
            success: '已复制 {n} 条配置',
            noSource: '请选择来源媒体库',
            noTarget: '请选择目标媒体库',
            noConfig: '来源媒体库没有已保存的字段配置',
        },
        en: {
            title: 'Copy Field Config',
            source: 'Copy from',
            target: 'Apply to',
            applyAll: 'Apply to All',
            apply: 'Copy Config',
            close: 'Close',
            success: 'Copied {n} config(s)',
            noSource: 'Please select a source library',
            noTarget: 'Please select target libraries',
            noConfig: 'Source library has no saved field config',
        }
    };

    function getLang() {
        const lang = (navigator.language || '').toLowerCase();
        return lang.startsWith('zh') ? 'zh' : 'en';
    }

    function t(key) {
        return i18n[getLang()][key] || i18n.en[key];
    }

    // 从 localStorage keys 中提取所有 libraryId
    function parseFieldsEntries() {
        const entries = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (isFieldsKey(key) && !key.startsWith(BACKUP_PREFIX)) {
                entries.push({ key, value: localStorage.getItem(key) });
            }
        }
        return entries;
    }

    // 从 fields key 中提取 libraryId（key 的第二段）
    // key 格式: {userId}-{libraryId}-{page}-{type}-fields
    // Emby ID 通常是无连字符的 hex 字符串，用 - 分隔各段
    function extractSegments(key) {
        // 去掉 -fields 后缀，按 - 拆分
        const body = key.replace(/-fields$/, '');
        const parts = body.split('-');
        // Emby ID 是 32 位 hex，找到前两个匹配的段作为 userId 和 libraryId
        // 简化处理：假设格式固定，取 parts[0] 为 userId, parts[1] 为 libraryId
        // 后续为 page-type
        if (parts.length < 3) return null;
        return {
            userId: parts[0],
            libraryId: parts[1],
            rest: parts.slice(2).join('-'), // page-type
        };
    }

    function getUniqueLibraryIds() {
        const entries = parseFieldsEntries();
        const libIds = new Set();
        for (const { key } of entries) {
            const seg = extractSegments(key);
            if (seg) libIds.add(seg.libraryId);
        }
        return [...libIds];
    }

    // 通过 Emby API 获取媒体库名称
    async function fetchLibraryNames() {
        const map = {};
        try {
            if (typeof ApiClient === 'undefined' || !ApiClient.getJSON || !ApiClient.getUrl) return map;
            const views = await ApiClient.getJSON(ApiClient.getUrl('Library/VirtualFolders'));
            if (Array.isArray(views)) {
                for (const v of views) {
                    const id = v.ItemId || v.Id;
                    if (id) map[String(id)] = v.Name;
                }
            }
        } catch (e) {
            console.warn('[Fields Fix] 获取媒体库名称失败:', e);
        }
        return map;
    }

    function copyFieldsConfig(sourceLibId, targetLibIds) {
        const entries = parseFieldsEntries();
        let count = 0;
        for (const { key, value } of entries) {
            const seg = extractSegments(key);
            if (!seg || seg.libraryId !== sourceLibId) continue;
            if (value === DEFAULT_FIELDS) continue;
            for (const targetId of targetLibIds) {
                if (targetId === sourceLibId) continue;
                const newKey = key.replace(
                    `${seg.userId}-${seg.libraryId}-`,
                    `${seg.userId}-${targetId}-`
                );
                localStorage.setItem(newKey, value);
                count++;
            }
        }
        return count;
    }

    // ===================== UI 渲染 =====================

    const INJECT_ID = 'emby-fields-copy-btn';
    const OVERLAY_ID = 'emby-fields-copy-overlay';

    function initCopyUI() {
        // 监听 .btnViewSettings 出现，在旁边注入按钮
        const observer = new MutationObserver(() => {
            const settingsBtns = document.querySelectorAll('.btnViewSettings');
            for (const settingsBtn of settingsBtns) {
                if (settingsBtn.parentElement.querySelector('#' + INJECT_ID)) continue;
                injectCopyButton(settingsBtn);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function injectCopyButton(settingsBtn) {
        const btn = document.createElement('button');
        btn.id = INJECT_ID;
        btn.type = 'button';
        btn.title = t('title');
        btn.className = 'fab fab-mini paper-icon-button-light';
        btn.innerHTML = '<i class="md-icon button-icon">content_copy</i>';
        settingsBtn.after(btn);

        btn.addEventListener('click', () => {
            openOverlay().catch(e =>
                console.warn('[Fields Fix] 面板加载失败:', e)
            );
        });
    }

    async function openOverlay() {
        // 切换：已有则关闭
        const existing = document.getElementById(OVERLAY_ID);
        if (existing) { existing.remove(); return; }

        const nameMap = await fetchLibraryNames();
        const allApiIds = Object.keys(nameMap);
        const sourceIds = getUniqueLibraryIds().filter(id => nameMap[id]);
        const targetIds = allApiIds;
        const getName = (id) => nameMap[id];

        // 遮罩
        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        Object.assign(overlay.style, {
            position: 'fixed',
            inset: '0',
            background: 'rgba(0,0,0,0.6)',
            zIndex: '9999999',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
        });
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        const panel = document.createElement('div');
        Object.assign(panel.style, {
            background: '#1c1c1e',
            borderRadius: '12px',
            padding: '24px',
            minWidth: '340px',
            maxWidth: '420px',
            color: '#e0e0e0',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        });

        // 标题
        const title = document.createElement('h3');
        title.textContent = t('title');
        Object.assign(title.style, { margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600' });
        panel.appendChild(title);

        // 来源选择
        const srcLabel = document.createElement('div');
        srcLabel.textContent = t('source');
        Object.assign(srcLabel.style, { fontSize: '13px', color: '#aaa', marginBottom: '6px' });
        panel.appendChild(srcLabel);

        const srcSelect = document.createElement('select');
        Object.assign(srcSelect.style, {
            width: '100%',
            padding: '8px',
            borderRadius: '6px',
            border: '1px solid #444',
            background: '#2c2c2e',
            color: '#e0e0e0',
            fontSize: '14px',
            marginBottom: '16px',
            outline: 'none',
        });
        const placeholderOpt = document.createElement('option');
        placeholderOpt.value = '';
        placeholderOpt.textContent = '—';
        srcSelect.appendChild(placeholderOpt);
        for (const id of sourceIds) {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = getName(id);
            srcSelect.appendChild(opt);
        }
        panel.appendChild(srcSelect);

        // 目标选择
        const tgtLabel = document.createElement('div');
        tgtLabel.textContent = t('target');
        Object.assign(tgtLabel.style, { fontSize: '13px', color: '#aaa', marginBottom: '6px' });
        panel.appendChild(tgtLabel);

        const checkboxContainer = document.createElement('div');
        Object.assign(checkboxContainer.style, {
            maxHeight: '180px',
            overflowY: 'auto',
            marginBottom: '16px',
            padding: '4px 0',
        });

        const checkboxes = [];
        for (const id of targetIds) {
            const row = document.createElement('label');
            Object.assign(row.style, {
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 8px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
            });
            row.addEventListener('mouseenter', () => row.style.background = 'rgba(255,255,255,0.05)');
            row.addEventListener('mouseleave', () => row.style.background = 'transparent');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = id;
            const span = document.createElement('span');
            span.textContent = getName(id);
            row.appendChild(cb);
            row.appendChild(span);
            checkboxContainer.appendChild(row);
            checkboxes.push(cb);
        }
        panel.appendChild(checkboxContainer);

        // 源选择变化时禁用对应目标
        srcSelect.addEventListener('change', () => {
            for (const cb of checkboxes) {
                cb.disabled = cb.value === srcSelect.value;
                if (cb.disabled) cb.checked = false;
            }
        });

        // 按钮区
        const btnRow = document.createElement('div');
        Object.assign(btnRow.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' });

        const makeBtnStyle = (bg) => ({
            padding: '8px 16px',
            borderRadius: '6px',
            border: 'none',
            background: bg,
            color: '#fff',
            fontSize: '13px',
            cursor: 'pointer',
            fontWeight: '500',
        });

        const applyAllBtn = document.createElement('button');
        applyAllBtn.textContent = t('applyAll');
        Object.assign(applyAllBtn.style, makeBtnStyle('#555'));
        applyAllBtn.addEventListener('click', () => {
            for (const cb of checkboxes) {
                if (!cb.disabled) cb.checked = true;
            }
        });

        const applyBtn = document.createElement('button');
        applyBtn.textContent = t('apply');
        Object.assign(applyBtn.style, makeBtnStyle('#0060df'));

        const closeBtn = document.createElement('button');
        closeBtn.textContent = t('close');
        Object.assign(closeBtn.style, makeBtnStyle('#333'));
        closeBtn.addEventListener('click', () => overlay.remove());

        // 消息提示
        const msg = document.createElement('div');
        Object.assign(msg.style, {
            fontSize: '13px',
            marginTop: '12px',
            minHeight: '20px',
            textAlign: 'center',
        });

        applyBtn.addEventListener('click', () => {
            const sourceId = srcSelect.value;
            if (!sourceId) { msg.textContent = t('noSource'); msg.style.color = '#f90'; return; }
            const selectedIds = checkboxes.filter(cb => cb.checked && !cb.disabled).map(cb => cb.value);
            if (!selectedIds.length) { msg.textContent = t('noTarget'); msg.style.color = '#f90'; return; }
            const count = copyFieldsConfig(sourceId, selectedIds);
            if (count === 0) {
                msg.textContent = t('noConfig');
                msg.style.color = '#f90';
            } else {
                msg.textContent = t('success').replace('{n}', count);
                msg.style.color = '#4caf50';
            }
        });

        btnRow.appendChild(applyAllBtn);
        btnRow.appendChild(applyBtn);
        btnRow.appendChild(closeBtn);
        panel.appendChild(btnRow);
        panel.appendChild(msg);

        overlay.appendChild(panel);
        document.body.appendChild(overlay);
    }
})();