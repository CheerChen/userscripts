// ==UserScript==
// @name         PikPak 批量番号重命名助手
// @name:en      PikPak Batch JAV Renamer Assistant
// @name:ja      PikPak バッチJAV リネームアシスタント
// @name:zh-CN   PikPak 批量番号重命名助手
// @namespace    https://github.com/CheerChen
// @version      {{VERSION}}
// @description  Batch rename video files and folders with JAV codes in PikPak.
// @description:en Batch rename video files and folders with JAV codes in PikPak.
// @description:ja PikPakで品番付きの動画ファイルやフォルダを一括リネーム。
// @description:zh-CN 在 PikPak 中批量重命名带有番号的视频文件或者文件夹。
// @author       cheerchen37
// @match        *://*mypikpak.com/*
// @require      https://unpkg.com/react@18/umd/react.production.min.js
// @require      https://unpkg.com/react-dom@18/umd/react-dom.production.min.js
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      av-wiki.net
// @connect      api-drive.mypikpak.com
// @connect      api.dmm.com
// @icon         https://www.google.com/s2/favicons?domain=mypikpak.com
// @license      MIT
// @homepage     https://github.com/CheerChen/userscripts
// @supportURL   https://github.com/CheerChen/userscripts/issues
// @updateURL    https://raw.githubusercontent.com/CheerChen/userscripts/master/pikpak-batch-renamer/dist/pikpak-batch-renamer.user.js
// ==/UserScript==

(function () {
    'use strict';

    const { React, ReactDOM } = window;
    const { useState, useEffect, useRef } = React;
    const { createRoot } = ReactDOM;

    console.log("PikPak 批量重命名脚本已加载");

    // 获取认证头部信息（参考helper脚本）
    function getHeader() {
        let token = "";
        let captcha = "";
        for (let i = 0; i < window.localStorage.length; i++) {
            let key = window.localStorage.key(i);
            if (key === null) continue;
            if (key && key.startsWith("credentials")) {
                let tokenData = JSON.parse(window.localStorage.getItem(key));
                token = tokenData.token_type + " " + tokenData.access_token;
                continue;
            }
            if (key && key.startsWith("captcha")) {
                let tokenData = JSON.parse(window.localStorage.getItem(key));
                captcha = tokenData.captcha_token;
            }
        }
        // deviceid 格式为 "wdi10.xxxxx..."，需要提取点号后的前32位作为 x-device-id
        let deviceId = window.localStorage.getItem("deviceid") || "";
        if (deviceId.includes(".")) {
            deviceId = deviceId.split(".")[1]?.substring(0, 32) || deviceId;
        }
        return {
            Authorization: token,
            "x-device-id": deviceId,
            "x-captcha-token": captcha
        };
    }

    // 获取文件列表
    function getList(parent_id) {
        const url = `https://api-drive.mypikpak.com/drive/v1/files?thumbnail_size=SIZE_MEDIUM&limit=500&parent_id=${parent_id}&with_audit=true&filters=%7B%22phase%22%3A%7B%22eq%22%3A%22PHASE_TYPE_COMPLETE%22%7D%2C%22trashed%22%3A%7B%22eq%22%3Afalse%7D%7D`;
        return fetch(url, {
            method: "GET",
            mode: "cors",
            cache: "no-cache",
            credentials: "same-origin",
            headers: {
                "Content-Type": "application/json",
                ...getHeader()
            },
            redirect: "follow",
            referrerPolicy: "no-referrer"
        }).then(response => response.json());
    }

    // 重命名文件API
    function renameFile(fileId, newName) {
        return fetch(`https://api-drive.mypikpak.com/drive/v1/files/${fileId}`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                ...getHeader()
            },
            body: JSON.stringify({
                name: newName
            })
        }).then(async response => {
            const data = await response.json();

            // 检查是否有错误
            if (data.error || !response.ok) {
                const error = new Error(getErrorMessage(data.error, data.error_description));
                error.code = data.error;
                error.details = data;
                throw error;
            }

            return data;
        });
    }

    // 获取错误信息
    function getErrorMessage(errorCode, errorDescription) {
        // 直接使用 API 返回的错误描述
        return errorDescription || `重命名失败 (${errorCode})`;
    }

    // 根据MIME类型获取推荐的文件扩展名
    function getExtensionByMimeType(mimeType) {
        const mimeToExt = {
            // 视频格式
            'video/mp4': '.mp4',
            'video/avi': '.avi',
            'video/quicktime': '.mov',
            'video/x-msvideo': '.avi',
            'video/x-ms-wmv': '.wmv',
            'video/webm': '.webm',
            'video/x-flv': '.flv',
            'video/3gpp': '.3gp',
            'video/x-matroska': '.mkv',
            // 音频格式
            'audio/mpeg': '.mp3',
            'audio/wav': '.wav',
            'audio/x-wav': '.wav',
            'audio/flac': '.flac',
            'audio/aac': '.aac',
            'audio/ogg': '.ogg',
            'audio/webm': '.webm',
            // 图片格式
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'image/bmp': '.bmp',
            'image/svg+xml': '.svg',
            // 文档格式
            'application/pdf': '.pdf',
            'application/zip': '.zip',
            'application/x-rar-compressed': '.rar',
            'application/x-7z-compressed': '.7z',
            'text/plain': '.txt',
            // 默认二进制文件
            'application/octet-stream': '.bin'
        };

        return mimeToExt[mimeType] || '';
    }

    // {{CORE_FUNCTIONS_PLACEHOLDER}}



    // 延迟函数
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // 通用样式常量
    const STYLES = {
        overlay: {
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
        },
        modal: {
            backgroundColor: '#fff', borderRadius: '8px', padding: '24px', boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)'
        },
        header: {
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: '20px', borderBottom: '1px solid #ebeef5', paddingBottom: '16px'
        },
        button: {
            padding: '8px 16px', border: 'none', borderRadius: '4px', cursor: 'pointer'
        },
        primaryBtn: { backgroundColor: '#409eff', color: '#fff' },
        secondaryBtn: { backgroundColor: '#fff', color: '#606266', border: '1px solid #dcdfe6' },
        disabledBtn: { backgroundColor: '#c0c4cc', cursor: 'not-allowed', opacity: 0.6 },
        text: { primary: '#303133', secondary: '#606266', success: '#67c23a', danger: '#f56c6c', warning: '#e6a23c' }
    };

    // 配置存储
    const CONFIG_KEY = 'pikpak-batch-renamer-config';
    const getConfig = () => {
        try {
            return JSON.parse(localStorage.getItem(CONFIG_KEY)) || {
                addDatePrefix: false,
                fixFileExtension: true,
                useDMM: false,
                dmmApiId: '',
                dmmAffiliateId: ''
            };
        } catch {
            return {
                addDatePrefix: false,
                fixFileExtension: true,
                useDMM: false,
                dmmApiId: '',
                dmmAffiliateId: ''
            };
        }
    };
    const setConfig = (config) => {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    };

    // 内联配置面板组件
    const ConfigPanel = ({ config, onConfigChange }) => {
        const configOptions = [
            {
                key: 'addDatePrefix',
                label: '在文件名开头增加发行日期',
                desc: '启用后文件名格式为: {日期} {标题}，例如: 2025-09-12 标题名称.mp4',
                type: 'checkbox'
            },
            {
                key: 'fixFileExtension',
                label: '修复文件扩展名',
                desc: '当文件缺少扩展名时，根据文件MIME类型自动添加合适的扩展名',
                type: 'checkbox'
            },
            {
                key: 'useDMM',
                label: '使用 DMM API 查询',
                desc: '启用后将使用 DMM 官方 API 进行查询，需要配置 API ID 和 Affiliate ID',
                type: 'checkbox'
            },
            {
                key: 'dmmApiId',
                label: 'DMM API ID',
                desc: '从 DMM 官方申请的 API ID',
                type: 'text',
                placeholder: '请输入 DMM API ID',
                dependsOn: 'useDMM'
            },
            {
                key: 'dmmAffiliateId',
                label: 'DMM Affiliate ID',
                desc: '从 DMM 官方申请的 Affiliate ID',
                type: 'text',
                placeholder: '请输入 DMM Affiliate ID',
                dependsOn: 'useDMM'
            }
        ];

        const handleConfigChange = (newConfig) => {
            setConfig(newConfig); // Save to localStorage
            onConfigChange(newConfig); // Update parent component state
        };

        return React.createElement('div', {
            style: {
                padding: '12px',
                backgroundColor: '#f8f9fa',
                borderRadius: '6px',
                marginTop: '-4px',
                marginBottom: '16px',
                borderTop: '1px solid #ebeef5'
            }
        },
            configOptions.map((option, i) => {
                // 检查依赖条件
                if (option.dependsOn && !config[option.dependsOn]) {
                    return null;
                }

                return React.createElement('div', { key: `config-option-${i}` }, [
                    option.type === 'checkbox' ? [
                        React.createElement('label', { key: `option${i}`, style: { display: 'flex', alignItems: 'center', cursor: 'pointer', padding: '8px 0' } }, [
                            React.createElement('input', {
                                key: 'checkbox',
                                type: 'checkbox',
                                checked: config[option.key],
                                onChange: (e) => handleConfigChange({ ...config, [option.key]: e.target.checked }),
                                style: { marginRight: '8px' }
                            }),
                            React.createElement('span', { key: 'label', style: { fontSize: '14px', color: STYLES.text.primary } }, option.label)
                        ]),
                        React.createElement('div', { key: `desc${i}`, style: { fontSize: '12px', color: STYLES.text.secondary, marginLeft: '24px', lineHeight: '1.4', marginBottom: '12px' } }, option.desc)
                    ] : [
                        React.createElement('div', { key: `label${i}`, style: { fontSize: '14px', color: STYLES.text.primary, marginBottom: '4px' } }, option.label),
                        React.createElement('input', {
                            key: `input${i}`,
                            type: 'text',
                            value: config[option.key] || '',
                            placeholder: option.placeholder || '',
                            onChange: (e) => handleConfigChange({ ...config, [option.key]: e.target.value }),
                            style: {
                                width: '100%',
                                padding: '6px 8px',
                                border: '1px solid #dcdfe6',
                                borderRadius: '4px',
                                fontSize: '13px',
                                marginBottom: '4px'
                            }
                        }),
                        React.createElement('div', { key: `desc${i}`, style: { fontSize: '12px', color: STYLES.text.secondary, lineHeight: '1.4', marginBottom: '12px' } }, option.desc)
                    ]
                ]);
            }).filter(Boolean)
        );
    };


    // 文件项组件
    const FileItem = ({ file, selected, onSelect, validationStatus, newName, sortBy }) => {
        const statusMap = {
            valid: { icon: '✅', color: STYLES.text.success },
            invalid: { icon: '❌', color: STYLES.text.danger },
            loading: { icon: '⏳', color: STYLES.text.warning }
        };
        const status = statusMap[validationStatus] || { icon: '', color: STYLES.text.secondary };

        const formatBytes = (bytes, decimals = 2) => {
            if (!bytes || bytes === 0) return '0 Bytes';
            const k = 1024;
            const dm = decimals < 0 ? 0 : decimals;
            const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
        };

        const formatFileInfo = (item) => {
            switch (sortBy) {
                case 'size':
                    return item.size ? formatBytes(parseInt(item.size)) : 'N/A';
                case 'created_time':
                    return item.created_time ? new Date(item.created_time).toLocaleString() : 'N/A';
                case 'modified_time':
                    return item.modified_time ? new Date(item.modified_time).toLocaleString() : 'N/A';
                default:
                    return '';
            }
        };

        return React.createElement('div', {
            style: {
                display: 'flex', alignItems: 'center', padding: '8px 0',
                borderBottom: '1px solid #f0f0f0', opacity: validationStatus === 'invalid' ? 0.5 : 1
            }
        }, [
            React.createElement('input', {
                key: 'checkbox', type: 'checkbox', checked: selected,
                onChange: (e) => onSelect(file.id, e.target.checked),
                disabled: validationStatus === 'invalid', style: { marginRight: '10px' }
            }),
            React.createElement('span', {
                key: 'icon', style: { marginRight: '8px', fontSize: '16px' }
            }, file.kind === 'drive#folder' ? '📁' : '📄'),
            React.createElement('div', { key: 'content', style: { flex: 1, minWidth: 0 } }, [
                React.createElement('div', {
                    key: 'name', style: { fontWeight: '500', color: STYLES.text.primary, wordBreak: 'break-word' }
                }, file.name),
                newName && React.createElement('div', {
                    key: 'newname', style: { fontSize: '12px', color: STYLES.text.success, marginTop: '2px', wordBreak: 'break-word' }
                }, `→ ${newName}`)
            ]),
            React.createElement('span', {
                key: 'info', style: { marginLeft: '16px', fontSize: '12px', color: STYLES.text.secondary, whiteSpace: 'nowrap' }
            }, formatFileInfo(file)),
            React.createElement('span', {
                key: 'status', style: { marginLeft: '16px', color: status.color, fontSize: '16px' }
            }, status.icon)
        ]);
    };

    // 辅助函数：创建按钮
    const createButton = (key, text, onClick, styleType = 'primary', disabled = false) => {
        const btnStyle = { ...STYLES.button };
        if (disabled) Object.assign(btnStyle, STYLES.disabledBtn);
        else Object.assign(btnStyle, STYLES[styleType + 'Btn']);

        return React.createElement('button', { key, onClick, disabled, style: btnStyle }, text);
    };

    // 主模态窗口组件
    const BatchRenameModal = ({ isOpen, onClose }) => {
        const [files, setFiles] = useState([]);
        const [selectedFiles, setSelectedFiles] = useState(new Set());
        const [validationResults, setValidationResults] = useState({});
        const [newNames, setNewNames] = useState({});
        const [isValidating, setIsValidating] = useState(false);
        const [isRenaming, setIsRenaming] = useState(false);
        const [progress, setProgress] = useState({ current: 0, total: 0 });
        const [showConfirmation, setShowConfirmation] = useState(false);
        const [renameResults, setRenameResults] = useState(null);
        const [config, setConfigState] = useState(getConfig());
        const [showConfigPanel, setShowConfigPanel] = useState(false);
        const [sortBy, setSortBy] = useState('name');
        const [sortDirection, setSortDirection] = useState('asc');

        // 设置全局配置供core-functions使用
        useEffect(() => {
            window.PikPakRenamerConfig = {
                dmm: {
                    enabled: config.useDMM,
                    apiId: config.dmmApiId,
                    affiliateId: config.dmmAffiliateId
                }
            };
        }, [config.useDMM, config.dmmApiId, config.dmmAffiliateId]);

        const sortFiles = (filesToSort, currentSortBy, currentSortDirection) => {
            const sorted = [...filesToSort].sort((a, b) => {
                const aIsFolder = a.kind === 'drive#folder';
                const bIsFolder = b.kind === 'drive#folder';

                if (aIsFolder && !bIsFolder) return -1;
                if (!aIsFolder && bIsFolder) return 1;

                let aValue = a[currentSortBy];
                let bValue = b[currentSortBy];

                if (currentSortBy === 'size') {
                    aValue = parseInt(aValue || '0');
                    bValue = parseInt(bValue || '0');
                } else if (currentSortBy === 'created_time' || currentSortBy === 'modified_time') {
                    aValue = new Date(aValue).getTime();
                    bValue = new Date(bValue).getTime();
                } else {
                    aValue = aValue?.toLowerCase() || '';
                    bValue = bValue?.toLowerCase() || '';
                }

                let comparison = 0;
                if (aValue > bValue) {
                    comparison = 1;
                } else if (aValue < bValue) {
                    comparison = -1;
                }
                return currentSortDirection === 'asc' ? comparison : -comparison;
            });
            setFiles(sorted);
        };

        useEffect(() => {
            if (isOpen) {
                let parent_id = window.location.href.split("/").pop();
                if (parent_id === "all") parent_id = "";

                getList(parent_id).then(res => {
                    if (res.files) {
                        sortFiles(res.files, sortBy, sortDirection);
                    }
                }).catch(error => {
                    console.error('获取文件列表失败:', error);
                });
            }
        }, [isOpen]);

        useEffect(() => {
            sortFiles(files, sortBy, sortDirection);
        }, [sortBy, sortDirection]);

        const handleConfigChange = (newConfig) => {
            setConfigState(newConfig);
            setConfig(newConfig); // Persist to localStorage
        };

        // 选择文件
        const handleFileSelect = (fileId, selected) => {
            const newSelected = new Set(selectedFiles);
            if (selected) {
                newSelected.add(fileId);
            } else {
                newSelected.delete(fileId);
            }
            setSelectedFiles(newSelected);
        };

        // 全选/全取消
        const handleSelectAll = (selectAll) => {
            if (selectAll) {
                const validFileIds = files
                    .filter(file => validationResults[file.id] !== 'invalid')
                    .map(file => file.id);
                setSelectedFiles(new Set(validFileIds));
            } else {
                setSelectedFiles(new Set());
            }
        };

        // 验证AV番号
        const validateFiles = async () => {
            if (selectedFiles.size === 0) {
                alert('请先选择要扫描的文件');
                return;
            }

            setIsValidating(true);
            const results = {};
            const names = {};

            const selectedFilesList = files.filter(file => selectedFiles.has(file.id));
            const batchSize = 3;
            const delay_ms = 2000;

            for (let i = 0; i < selectedFilesList.length; i += batchSize) {
                const batch = selectedFilesList.slice(i, i + batchSize);

                await Promise.all(batch.map(async (file) => {
                    const isFile = file.kind !== 'drive#folder';
                    const keyword = extractKeyword(file.name, isFile);
                    if (!keyword) {
                        results[file.id] = 'invalid';
                        return;
                    }

                    results[file.id] = 'loading';
                    setValidationResults(prev => ({ ...prev, ...results }));

                    try {
                        let result;
                        if (config.useDMM && config.dmmApiId && config.dmmAffiliateId) {
                            // 使用DMM API查询
                            result = await queryDMM(keyword);
                        } else {
                            // 使用AV-wiki查询
                            result = await queryAVwiki(keyword);
                        }

                        results[file.id] = 'valid';

                        let extension = '';
                        if (isFile) {
                            const extensionMatch = file.name.match(/(\.[^.]+)$/);
                            extension = extensionMatch ? extensionMatch[1] : '';

                            if (!extension && config.fixFileExtension && file.mime_type) {
                                extension = getExtensionByMimeType(file.mime_type);
                            }
                        }

                        let finalName = config.addDatePrefix && result.date
                            ? `${result.date} ${result.title}`
                            : result.title;

                        names[file.id] = extension ? `${finalName}${extension}` : finalName;
                    } catch (error) {
                        results[file.id] = 'invalid';
                    }
                }));

                setValidationResults(prev => ({ ...prev, ...results }));
                setNewNames(prev => ({ ...prev, ...names }));

                if (i + batchSize < selectedFilesList.length) {
                    await delay(delay_ms);
                }
            }

            setIsValidating(false);
        };

        // 执行批量重命名
        const performBatchRename = async () => {
            setIsRenaming(true);
            const selectedFilesList = files.filter(file =>
                selectedFiles.has(file.id) && validationResults[file.id] === 'valid'
            );

            const total = selectedFilesList.length;
            let success = 0;
            let failed = 0;
            const failedFiles = [];

            const batchSize = 5;
            const delay_ms = 1000;

            for (let i = 0; i < selectedFilesList.length; i += batchSize) {
                const batch = selectedFilesList.slice(i, i + batchSize);

                await Promise.all(batch.map(async (file) => {
                    const newName = newNames[file.id];

                    if (file.name === newName) {
                        success++;
                        setProgress({ current: success + failed, total });
                        return;
                    }

                    try {
                        await renameFile(file.id, newName);
                        success++;
                    } catch (error) {
                        failed++;
                        failedFiles.push({
                            name: file.name,
                            error: error.message,
                            code: error.code || 'unknown'
                        });
                    }

                    setProgress({ current: success + failed, total });
                }));

                if (i + batchSize < selectedFilesList.length) {
                    await delay(delay_ms);
                }
            }

            setRenameResults({ success, failed, total, failedFiles });
            setIsRenaming(false);
        };

        // 重置状态
        const resetModal = () => {
            setFiles([]);
            setSelectedFiles(new Set());
            setValidationResults({});
            setNewNames({});
            setShowConfirmation(false);
            setRenameResults(null);
            setProgress({ current: 0, total: 0 });
            setShowConfigPanel(false);
        };

        if (!isOpen) return null;

        return React.createElement('div', { style: { ...STYLES.overlay, zIndex: 10000 } },
            React.createElement('div', {
                style: {
                    ...STYLES.modal, width: '90%', maxWidth: '800px', maxHeight: '80vh',
                    display: 'flex', flexDirection: 'column'
                }
            }, [
                React.createElement('div', { key: 'header', style: STYLES.header }, [
                    React.createElement('h2', { key: 'title', style: { margin: 0, color: STYLES.text.primary, fontSize: '18px' } },
                        renameResults ? '重命名完成' : (showConfirmation ? '确认重命名' : '批量重命名文件')),
                    React.createElement('button', {
                        key: 'close',
                        onClick: () => {
                            resetModal(); onClose();
                            if (renameResults && renameResults.success > 0) {
                                setTimeout(() => window.location.reload(), 300);
                            }
                        },
                        style: { background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: STYLES.text.secondary, padding: '4px' }
                    }, '×')
                ]),

                // 内容区域
                React.createElement('div', {
                    key: 'content',
                    style: { flex: 1, overflowY: 'auto' }
                }, [
                    // 结果显示
                    renameResults && React.createElement('div', {
                        key: 'results',
                        style: { padding: '20px', backgroundColor: '#f0f9ff', borderRadius: '6px', marginBottom: '20px' }
                    }, [
                        React.createElement('div', {
                            key: 'summary',
                            style: { fontSize: '16px', fontWeight: '500', marginBottom: '10px' }
                        }, `重命名完成！成功: ${renameResults.success}, 失败: ${renameResults.failed}, 总计: ${renameResults.total}`),
                        renameResults.failedFiles.length > 0 && React.createElement('div', {
                            key: 'failed',
                            style: { fontSize: '14px', color: '#f56c6c' }
                        }, [
                            React.createElement('div', { key: 'title' }, '失败的文件:'),
                            ...renameResults.failedFiles.map((file, index) =>
                                React.createElement('div', { key: index }, `${file.name}: ${file.error}`)
                            )
                        ])
                    ]),

                    // 确认页面
                    showConfirmation && !renameResults && React.createElement('div', {
                        key: 'confirmation'
                    }, [
                        React.createElement('div', {
                            key: 'info',
                            style: { padding: '16px', backgroundColor: '#fff7e6', borderRadius: '6px', marginBottom: '16px', border: '1px solid #ffd666' }
                        }, `即将重命名 ${Array.from(selectedFiles).filter(id => validationResults[id] === 'valid').length} 个文件，请确认后继续。`),

                        React.createElement('div', {
                            key: 'preview',
                            style: { maxHeight: '400px', overflowY: 'auto' }
                        }, files.filter(file => selectedFiles.has(file.id) && validationResults[file.id] === 'valid').map(file =>
                            React.createElement('div', {
                                key: file.id,
                                style: { padding: '8px', borderBottom: '1px solid #f0f0f0', fontSize: '14px' }
                            }, [
                                React.createElement('div', { key: 'old', style: { color: '#909399' } }, `原名: ${file.name}`),
                                React.createElement('div', { key: 'new', style: { color: '#67c23a' } }, `新名: ${newNames[file.id]}`)
                            ])
                        ))
                    ]),

                    // 文件列表
                    !showConfirmation && !renameResults && React.createElement('div', {
                        key: 'filelist'
                    }, [
                        // 工具栏
                        React.createElement('div', {
                            key: 'toolbar-wrapper',
                            style: {
                                padding: '12px',
                                backgroundColor: '#f8f9fa',
                                borderRadius: '6px',
                                marginBottom: '16px'
                            }
                        }, [
                            React.createElement('div', {
                                key: 'toolbar-main',
                                style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
                            }, [
                                React.createElement('div', { key: 'select-all', style: { display: 'flex', alignItems: 'center' } }, [
                                    React.createElement('input', {
                                        key: 'selectall-cb', type: 'checkbox',
                                        onChange: (e) => handleSelectAll(e.target.checked),
                                        style: { marginRight: '8px' }
                                    }),
                                    React.createElement('span', { key: 'label' }, '全选')
                                ]),
                                React.createElement('div', { key: 'sort-controls', style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
                                    React.createElement('select', {
                                        value: sortBy,
                                        onChange: e => setSortBy(e.target.value),
                                        style: { padding: '4px', borderRadius: '4px', border: '1px solid #dcdfe6' }
                                    }, [
                                        React.createElement('option', { value: 'name' }, '名称'),
                                        React.createElement('option', { value: 'created_time' }, '创建时间'),
                                        React.createElement('option', { value: 'modified_time' }, '修改时间'),
                                        React.createElement('option', { value: 'size' }, '大小')
                                    ]),
                                    React.createElement('select', {
                                        value: sortDirection,
                                        onChange: e => setSortDirection(e.target.value),
                                        style: { padding: '4px', borderRadius: '4px', border: '1px solid #dcdfe6' }
                                    }, [
                                        React.createElement('option', { value: 'asc' }, '升序'),
                                        React.createElement('option', { value: 'desc' }, '降序')
                                    ])
                                ]),
                                React.createElement('div', { key: 'actions', style: { display: 'flex', gap: '8px' } }, [
                                    createButton('validate',
                                        isValidating ? '扫描中...' : (selectedFiles.size === 0 ? '请选择文件' : '扫描番号'),
                                        validateFiles, 'primary', isValidating || selectedFiles.size === 0),
                                    React.createElement('button', {
                                        key: 'config-toggle', onClick: () => setShowConfigPanel(!showConfigPanel), title: '配置选项',
                                        style: { padding: '8px', backgroundColor: showConfigPanel ? '#e9ecef' : 'transparent', color: STYLES.text.secondary, border: '1px solid #dcdfe6', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }
                                    }, React.createElement('svg', { width: '16', height: '16', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2' }, [
                                        React.createElement('circle', { cx: '12', cy: '12', r: '3' }),
                                        React.createElement('path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z' })
                                    ]))
                                ])
                            ]),
                            showConfigPanel && React.createElement(ConfigPanel, {
                                key: 'config-panel',
                                config: config,
                                onConfigChange: handleConfigChange
                            })
                        ]),

                        // 文件项
                        React.createElement('div', {
                            key: 'items',
                            style: { maxHeight: '400px', overflowY: 'auto' }
                        }, files.map(file =>
                            React.createElement(FileItem, {
                                key: file.id,
                                file: file,
                                selected: selectedFiles.has(file.id),
                                onSelect: handleFileSelect,
                                validationStatus: validationResults[file.id],
                                newName: newNames[file.id],
                                sortBy: sortBy
                            })
                        ))
                    ])
                ]),

                // 底部按钮
                React.createElement('div', {
                    key: 'footer',
                    style: {
                        display: 'flex',
                        justifyContent: 'flex-end',
                        gap: '12px',
                        marginTop: '20px',
                        paddingTop: '16px',
                        borderTop: '1px solid #ebeef5'
                    }
                }, [
                    // 进度显示
                    isRenaming && React.createElement('div', {
                        key: 'progress',
                        style: {
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            color: '#606266'
                        }
                    }, `重命名进度: ${progress.current}/${progress.total}`),

                    // 按钮组
                    !renameResults && React.createElement('div', {
                        key: 'buttons',
                        style: { display: 'flex', gap: '12px' }
                    }, [
                        !showConfirmation ? [
                            createButton('cancel', '取消', () => { resetModal(); onClose(); }, 'secondary'),
                            createButton('next', '下一步', () => setShowConfirmation(true), 'primary',
                                selectedFiles.size === 0 || Object.values(validationResults).every(s => s !== 'valid'))
                        ] : [
                            createButton('back', '上一步', () => setShowConfirmation(false), 'secondary', isRenaming),
                            createButton('confirm', isRenaming ? '重命名中...' : '确认重命名',
                                performBatchRename, 'primary', isRenaming)
                        ]
                    ])
                ])
            ]));
    };


    // 等待页面加载完成后挂载React应用
    function initApp() {
        if (location.pathname === '/') return; // 不在首页显示

        // 查找现有的 file-operations 容器
        const fileOperations = document.querySelector('.file-operations');
        if (fileOperations) {
            // 检查是否已经添加过按钮
            if (fileOperations.querySelector('.batch-rename-button')) return;

            // 创建按钮HTML结构
            const batchRenameItem = document.createElement('li');
            batchRenameItem.className = 'icon-with-label batch-rename-button';
            batchRenameItem.innerHTML = `
                <a aria-label="批量重命名" class="pp-link-button hover-able" href="javascript:void(0)">
                    <span class="icon-hover-able pp-icon" style="--icon-color: var(--color-secondary-text); --icon-color-hover: var(--color-primary); display: flex; flex: 0 0 24px; width: 24px; height: 24px;">
                        <svg fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                        </svg>
                    </span>
                    <span class="label">批量重命名</span>
                </a>
            `;

            // 添加点击事件
            batchRenameItem.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                // 创建模态窗口容器
                if (!document.getElementById('pikpak-batch-renamer-modal')) {
                    const modalContainer = document.createElement('div');
                    modalContainer.id = 'pikpak-batch-renamer-modal';
                    document.body.appendChild(modalContainer);

                    const root = createRoot(modalContainer);
                    root.render(React.createElement(BatchRenameModal, {
                        isOpen: true,
                        onClose: () => {
                            root.unmount();
                            document.body.removeChild(modalContainer);
                        }
                    }));
                }
            });

            // 查找合适的插入位置（在分割线之前）
            const divider = fileOperations.querySelector('.divider-in-operations');
            if (divider) {
                fileOperations.insertBefore(batchRenameItem, divider);
            } else {
                // 如果没有分割线，添加到末尾
                fileOperations.appendChild(batchRenameItem);
            }
        } else {
            // 如果找不到 file-operations，延迟重试
            setTimeout(initApp, 1000);
        }
    }

    // 页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
    } else {
        setTimeout(initApp, 1000);
    }

})();