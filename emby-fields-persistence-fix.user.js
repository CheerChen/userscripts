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
// @version      1.0.0
// @description  Prevents Emby from resetting Show Fields when switching views. Intercepts localStorage to backup and restore field settings.
// @description:en  Prevents Emby from resetting Show Fields when switching views. Intercepts localStorage to backup and restore field settings.
// @description:ja  Emby がビュー切替時に表示フィールドをリセットするのを防ぎます。localStorage を傍受してフィールド設定をバックアップ・復元します。
// @description:zh-CN  防止 Emby 在切换视图时重置「显示字段」设置，通过拦截 localStorage 自动备份和恢复字段配置。
// @description:zh-TW  防止 Emby 在切換檢視時重置「顯示欄位」設定，透過攔截 localStorage 自動備份和還原欄位設定。
// @description:ko  Emby가 뷰 전환 시 표시 필드를 초기화하는 것을 방지합니다. localStorage를 가로채 필드 설정을 백업 및 복원합니다.
// @description:ru  Предотвращает сброс полей отображения Emby при переключении видов. Перехватывает localStorage для резервного копирования и восстановления настроек полей.
// @description:es  Evita que Emby restablezca los campos de visualización al cambiar de vista. Intercepta localStorage para respaldar y restaurar la configuración de campos.
// @description:pt-BR  Impede que o Emby redefina os campos de exibição ao alternar visualizações. Intercepta o localStorage para fazer backup e restaurar as configurações de campos.
// @description:fr  Empêche Emby de réinitialiser les champs d'affichage lors du changement de vue. Intercepte localStorage pour sauvegarder et restaurer les paramètres de champs.
// @description:de  Verhindert, dass Emby die Anzeigefelder beim Wechseln der Ansicht zurücksetzt. Fängt localStorage ab, um Feldeinstellungen zu sichern und wiederherzustellen.
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
    });
})();