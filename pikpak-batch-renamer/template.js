// ==UserScript==
// @name         PikPak 批量番号重命名助手
// @name:en      PikPak Batch JAV Renamer Assistant
// @name:ja      PikPak バッチJAV リネームアシスタント
// @name:zh-CN   PikPak 批量番号重命名助手
// @namespace    https://github.com/CheerChen
// @version      {{VERSION}}
// @description  Batch rename files and folders in PikPak with AV-wiki integration. Adds a button to open modal for selecting files, validating AV numbers, and batch renaming with progress tracking.
// @description:en Batch rename files and folders in PikPak with AV-wiki integration. Adds a button to open modal for selecting files, validating AV numbers, and batch renaming with progress tracking.
// @description:ja PikPakでAV-wiki統合による一括ファイル・フォルダーリネーム。ファイル選択、AV番号検証、進捗追跡付き一括リネーム用のモーダルを開くボタンを追加。
// @description:zh-CN 在PikPak中批量重命名文件和文件夹，集成AV-wiki。添加按钮打开模态窗口进行文件选择、AV番号验证和批量重命名，并提供进度跟踪。
// @author       cheerchen37
// @match        *://*mypikpak.com/*
// @require      https://unpkg.com/react@18/umd/react.production.min.js
// @require      https://unpkg.com/react-dom@18/umd/react-dom.production.min.js
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      av-wiki.net
// @connect      api-drive.mypikpak.com
// @icon         https://www.google.com/s2/favicons?domain=mypikpak.com
// @license      MIT
// @homepage     https://github.com/CheerChen/userscripts
// @supportURL   https://github.com/CheerChen/userscripts/issues
// @updateURL    https://raw.githubusercontent.com/CheerChen/userscripts/master/pikpak-batch-renamer/dist/pikpak-batch-renamer.user.js
// ==/UserScript==

(function() {
    'use strict';

    const { React, ReactDOM } = window;
    const { useState, useEffect, useRef } = React;
    const { createRoot } = ReactDOM;

    console.log("PikPak 批量重命名脚本已加载");

    // 获取认证头部信息（参考helper脚本）
    function getHeader() {
        let token = "";
        let captcha = "";
        for (let i = 0; i < 40; i++) {
            let key = window.localStorage.key(i);
            if (key === null) break;
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
        return {
            Authorization: token,
            "x-device-id": window.localStorage.getItem("deviceid"),
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

    // 配置存储
    const CONFIG_KEY = 'pikpak-batch-renamer-config';
    const getConfig = () => {
        try {
            return JSON.parse(localStorage.getItem(CONFIG_KEY)) || { addDatePrefix: false, fixFileExtension: true };
        } catch {
            return { addDatePrefix: false, fixFileExtension: true };
        }
    };
    const setConfig = (config) => {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    };

    // 配置对话框组件
    const ConfigDialog = ({ isOpen, onClose, config, onConfigChange }) => {
        if (!isOpen) return null;

        return React.createElement('div', {
            style: {
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                zIndex: 10001,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
            }
        }, React.createElement('div', {
            style: {
                backgroundColor: '#fff',
                borderRadius: '8px',
                padding: '24px',
                width: '400px',
                boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)'
            }
        }, [
            // 标题栏
            React.createElement('div', {
                key: 'header',
                style: {
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '20px',
                    borderBottom: '1px solid #ebeef5',
                    paddingBottom: '16px'
                }
            }, [
                React.createElement('h3', {
                    key: 'title',
                    style: { margin: 0, color: '#303133', fontSize: '16px' }
                }, '重命名配置'),
                React.createElement('button', {
                    key: 'close',
                    onClick: onClose,
                    style: {
                        background: 'none',
                        border: 'none',
                        fontSize: '20px',
                        cursor: 'pointer',
                        color: '#909399',
                        padding: '4px'
                    }
                }, '×')
            ]),

            // 配置项
            React.createElement('div', {
                key: 'content',
                style: { marginBottom: '20px' }
            }, [
                React.createElement('label', {
                    key: 'option1',
                    style: {
                        display: 'flex',
                        alignItems: 'center',
                        cursor: 'pointer',
                        padding: '8px 0'
                    }
                }, [
                    React.createElement('input', {
                        key: 'checkbox1',
                        type: 'checkbox',
                        checked: config.addDatePrefix,
                        onChange: (e) => onConfigChange({ ...config, addDatePrefix: e.target.checked }),
                        style: { marginRight: '8px' }
                    }),
                    React.createElement('span', {
                        key: 'label1',
                        style: { fontSize: '14px', color: '#303133' }
                    }, '在文件名开头增加发行日期'),
                ]),
                React.createElement('div', {
                    key: 'desc1',
                    style: {
                        fontSize: '12px',
                        color: '#909399',
                        marginLeft: '24px',
                        lineHeight: '1.4',
                        marginBottom: '12px'
                    }
                }, '启用后文件名格式为: {日期} {标题}，例如: 2025-09-12 标题名称.mp4'),
                
                React.createElement('label', {
                    key: 'option2',
                    style: {
                        display: 'flex',
                        alignItems: 'center',
                        cursor: 'pointer',
                        padding: '8px 0'
                    }
                }, [
                    React.createElement('input', {
                        key: 'checkbox2',
                        type: 'checkbox',
                        checked: config.fixFileExtension,
                        onChange: (e) => onConfigChange({ ...config, fixFileExtension: e.target.checked }),
                        style: { marginRight: '8px' }
                    }),
                    React.createElement('span', {
                        key: 'label2',
                        style: { fontSize: '14px', color: '#303133' }
                    }, '修复文件扩展名'),
                ]),
                React.createElement('div', {
                    key: 'desc2',
                    style: {
                        fontSize: '12px',
                        color: '#909399',
                        marginLeft: '24px',
                        lineHeight: '1.4'
                    }
                }, '当文件缺少扩展名时，根据文件MIME类型自动添加合适的扩展名')
            ]),

            // 底部按钮
            React.createElement('div', {
                key: 'footer',
                style: {
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '12px',
                    paddingTop: '16px',
                    borderTop: '1px solid #ebeef5'
                }
            }, [
                React.createElement('button', {
                    key: 'cancel',
                    onClick: onClose,
                    style: {
                        padding: '8px 16px',
                        backgroundColor: '#fff',
                        color: '#606266',
                        border: '1px solid #dcdfe6',
                        borderRadius: '4px',
                        cursor: 'pointer'
                    }
                }, '取消'),
                React.createElement('button', {
                    key: 'save',
                    onClick: () => {
                        setConfig(config);
                        onClose();
                    },
                    style: {
                        padding: '8px 16px',
                        backgroundColor: '#409eff',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer'
                    }
                }, '保存')
            ])
        ]));
    };

    // 文件项组件
    const FileItem = ({ file, selected, onSelect, validationStatus, newName }) => {
        const getStatusIcon = () => {
            switch (validationStatus) {
                case 'valid': return '✅';
                case 'invalid': return '❌';
                case 'loading': return '⏳';
                default: return '';
            }
        };

        const getStatusColor = () => {
            switch (validationStatus) {
                case 'valid': return '#67c23a';
                case 'invalid': return '#f56c6c';
                case 'loading': return '#e6a23c';
                default: return '#606266';
            }
        };

        return React.createElement('div', {
            style: {
                display: 'flex',
                alignItems: 'center',
                padding: '8px 0',
                borderBottom: '1px solid #f0f0f0',
                opacity: validationStatus === 'invalid' ? 0.5 : 1
            }
        }, [
            React.createElement('input', {
                key: 'checkbox',
                type: 'checkbox',
                checked: selected,
                onChange: (e) => onSelect(file.id, e.target.checked),
                disabled: validationStatus === 'invalid',
                style: { marginRight: '10px' }
            }),
            React.createElement('span', {
                key: 'icon',
                style: { marginRight: '8px', fontSize: '16px' }
            }, file.kind === 'drive#folder' ? '📁' : '📄'),
            React.createElement('div', {
                key: 'content',
                style: { flex: 1, minWidth: 0 }
            }, [
                React.createElement('div', {
                    key: 'name',
                    style: { 
                        fontWeight: '500',
                        color: '#303133',
                        wordBreak: 'break-word'
                    }
                }, file.name),
                newName && React.createElement('div', {
                    key: 'newname',
                    style: {
                        fontSize: '12px',
                        color: '#67c23a',
                        marginTop: '2px',
                        wordBreak: 'break-word'
                    }
                }, `→ ${newName}`)
            ]),
            React.createElement('span', {
                key: 'status',
                style: { 
                    marginLeft: '8px',
                    color: getStatusColor(),
                    fontSize: '16px'
                }
            }, getStatusIcon())
        ]);
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
        const [showConfigDialog, setShowConfigDialog] = useState(false);
        const [config, setConfig] = useState(getConfig());

        // 加载文件列表
        useEffect(() => {
            if (isOpen) {
                let parent_id = window.location.href.split("/").pop();
                if (parent_id === "all") parent_id = "";
                
                getList(parent_id).then(res => {
                    if (res.files) {
                        // 排序：文件夹优先，然后各自按 a-z 排序
                        const sortedFiles = res.files.sort((a, b) => {
                            const aIsFolder = a.kind === 'drive#folder';
                            const bIsFolder = b.kind === 'drive#folder';
                            
                            // 文件夹总是排在文件前面
                            if (aIsFolder && !bIsFolder) return -1;
                            if (!aIsFolder && bIsFolder) return 1;
                            
                            // 同类型内按文件名 a-z 排序
                            return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
                        });
                        setFiles(sortedFiles);
                    }
                }).catch(error => {
                    console.error('获取文件列表失败:', error);
                });
            }
        }, [isOpen]);

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
            
            // 只处理选中的文件
            const selectedFilesList = files.filter(file => selectedFiles.has(file.id));
            const batchSize = 3; // 批量大小
            const delay_ms = 2000; // 延迟2秒

            for (let i = 0; i < selectedFilesList.length; i += batchSize) {
                const batch = selectedFilesList.slice(i, i + batchSize);
                
                // 处理当前批次
                await Promise.all(batch.map(async (file) => {
                    const isFile = file.kind !== 'drive#folder';
                    const keyword = extractKeyword(file.name, isFile);
                    if (!keyword) {
                        results[file.id] = 'invalid';
                        return;
                    }

                    results[file.id] = 'loading';
                    setValidationResults({...results});

                    try {
                        const result = await queryAVwiki(keyword);
                        results[file.id] = 'valid';
                        
                        // 根据文件类型处理扩展名
                        let extension = '';
                        if (isFile) {
                            // 对于文件，先尝试保留原始扩展名
                            const extensionMatch = file.name.match(/(\.[^.]+)$/);
                            extension = extensionMatch ? extensionMatch[1] : '';
                            
                            // 如果没有扩展名且启用了修复扩展名功能
                            if (!extension && config.fixFileExtension && file.mime_type) {
                                extension = getExtensionByMimeType(file.mime_type);
                            }
                        }
                        
                        // 根据配置决定是否添加日期前缀
                        let finalName;
                        if (config.addDatePrefix && result.date) {
                            finalName = `${result.date} ${result.title}`;
                        } else {
                            finalName = result.title;
                        }
                        
                        names[file.id] = extension ? `${finalName}${extension}` : finalName;
                    } catch (error) {
                        results[file.id] = 'invalid';
                    }
                }));

                setValidationResults({...results});
                setNewNames({...names});

                // 如果不是最后一批，则延迟
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

            const batchSize = 5; // 重命名批量大小
            const delay_ms = 1000; // 延迟1秒

            for (let i = 0; i < selectedFilesList.length; i += batchSize) {
                const batch = selectedFilesList.slice(i, i + batchSize);
                
                await Promise.all(batch.map(async (file) => {
                    const newName = newNames[file.id];
                    
                    // 如果新名字和原名字相同，跳过
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

                // 如果不是最后一批，则延迟
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
        };

        if (!isOpen) return null;

        return React.createElement('div', {
            style: {
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                zIndex: 10000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
            }
        }, React.createElement('div', {
            style: {
                backgroundColor: '#fff',
                borderRadius: '8px',
                padding: '24px',
                width: '90%',
                maxWidth: '800px',
                maxHeight: '80vh',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)'
            }
        }, [
            // 标题栏
            React.createElement('div', {
                key: 'header',
                style: {
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '20px',
                    borderBottom: '1px solid #ebeef5',
                    paddingBottom: '16px'
                }
            }, [
                React.createElement('h2', {
                    key: 'title',
                    style: { margin: 0, color: '#303133', fontSize: '18px' }
                }, renameResults ? '重命名完成' : (showConfirmation ? '确认重命名' : '批量重命名文件')),
                React.createElement('button', {
                    key: 'close',
                    onClick: () => {
                        resetModal();
                        onClose();
                        // 如果有重命名结果，强制刷新页面
                        if (renameResults && renameResults.success > 0) {
                            setTimeout(() => {
                                window.location.reload();
                            }, 300);
                        }
                    },
                    style: {
                        background: 'none',
                        border: 'none',
                        fontSize: '24px',
                        cursor: 'pointer',
                        color: '#909399',
                        padding: '4px'
                    }
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
                    style: {
                        padding: '20px',
                        backgroundColor: '#f0f9ff',
                        borderRadius: '6px',
                        marginBottom: '20px'
                    }
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
                        style: {
                            padding: '16px',
                            backgroundColor: '#fff7e6',
                            borderRadius: '6px',
                            marginBottom: '16px',
                            border: '1px solid #ffd666'
                        }
                    }, `即将重命名 ${Array.from(selectedFiles).filter(id => validationResults[id] === 'valid').length} 个文件，请确认后继续。`),
                    
                    React.createElement('div', {
                        key: 'preview',
                        style: { maxHeight: '400px', overflowY: 'auto' }
                    }, files.filter(file => selectedFiles.has(file.id) && validationResults[file.id] === 'valid').map(file =>
                        React.createElement('div', {
                            key: file.id,
                            style: {
                                padding: '8px',
                                borderBottom: '1px solid #f0f0f0',
                                fontSize: '14px'
                            }
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
                        key: 'toolbar',
                        style: {
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '16px',
                            padding: '12px',
                            backgroundColor: '#f8f9fa',
                            borderRadius: '6px'
                        }
                    }, [
                        React.createElement('div', {
                            key: 'select',
                            style: { display: 'flex', alignItems: 'center' }
                        }, [
                            React.createElement('input', {
                                key: 'selectall',
                                type: 'checkbox',
                                onChange: (e) => handleSelectAll(e.target.checked),
                                style: { marginRight: '8px' }
                            }),
                            React.createElement('span', { key: 'label' }, '全选')
                        ]),
                        React.createElement('div', {
                            key: 'buttons',
                            style: { display: 'flex', gap: '8px' }
                        }, [
                            React.createElement('button', {
                                key: 'validate',
                                onClick: validateFiles,
                                disabled: isValidating || selectedFiles.size === 0,
                                style: {
                                    padding: '8px 16px',
                                    backgroundColor: (isValidating || selectedFiles.size === 0) ? '#c0c4cc' : '#409eff',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: (isValidating || selectedFiles.size === 0) ? 'not-allowed' : 'pointer',
                                    opacity: (isValidating || selectedFiles.size === 0) ? 0.6 : 1
                                }
                            }, isValidating ? '扫描中...' : (selectedFiles.size === 0 ? '请选择文件' : '扫描番号')),
                            React.createElement('button', {
                                key: 'config',
                                onClick: () => setShowConfigDialog(true),
                                title: '配置选项',
                                style: {
                                    padding: '8px',
                                    backgroundColor: 'transparent',
                                    color: '#909399',
                                    border: '1px solid #dcdfe6',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'all 0.3s ease'
                                },
                                onMouseEnter: function(e) {
                                    e.target.style.backgroundColor = '#f5f7fa';
                                    e.target.style.color = '#409eff';
                                },
                                onMouseLeave: function(e) {
                                    e.target.style.backgroundColor = 'transparent';
                                    e.target.style.color = '#909399';
                                }
                            }, React.createElement('svg', {
                                width: '16',
                                height: '16',
                                viewBox: '0 0 24 24',
                                fill: 'none',
                                stroke: 'currentColor',
                                strokeWidth: '2'
                            }, [
                                React.createElement('circle', { key: 'c1', cx: '12', cy: '12', r: '3' }),
                                React.createElement('path', { key: 'p1', d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z' })
                            ]))
                        ])
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
                            newName: newNames[file.id]
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
                        React.createElement('button', {
                            key: 'cancel',
                            onClick: () => {
                                resetModal();
                                onClose();
                            },
                            style: {
                                padding: '10px 20px',
                                backgroundColor: '#fff',
                                color: '#606266',
                                border: '1px solid #dcdfe6',
                                borderRadius: '4px',
                                cursor: 'pointer'
                            }
                        }, '取消'),
                        React.createElement('button', {
                            key: 'next',
                            onClick: () => setShowConfirmation(true),
                            disabled: selectedFiles.size === 0 || Object.keys(validationResults).length === 0,
                            style: {
                                padding: '10px 20px',
                                backgroundColor: selectedFiles.size === 0 || Object.keys(validationResults).length === 0 ? '#c0c4cc' : '#67c23a',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: selectedFiles.size === 0 || Object.keys(validationResults).length === 0 ? 'not-allowed' : 'pointer'
                            }
                        }, '下一步')
                    ] : [
                        React.createElement('button', {
                            key: 'back',
                            onClick: () => setShowConfirmation(false),
                            disabled: isRenaming,
                            style: {
                                padding: '10px 20px',
                                backgroundColor: '#fff',
                                color: '#606266',
                                border: '1px solid #dcdfe6',
                                borderRadius: '4px',
                                cursor: isRenaming ? 'not-allowed' : 'pointer',
                                opacity: isRenaming ? 0.6 : 1
                            }
                        }, '上一步'),
                        React.createElement('button', {
                            key: 'confirm',
                            onClick: performBatchRename,
                            disabled: isRenaming,
                            style: {
                                padding: '10px 20px',
                                backgroundColor: isRenaming ? '#c0c4cc' : '#e6a23c',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: isRenaming ? 'not-allowed' : 'pointer'
                            }
                        }, isRenaming ? '重命名中...' : '确认重命名')
                    ]
                ])
            ]),

            // 配置对话框
            React.createElement(ConfigDialog, {
                key: 'config-dialog',
                isOpen: showConfigDialog,
                onClose: () => setShowConfigDialog(false),
                config: config,
                onConfigChange: setConfig
            })
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