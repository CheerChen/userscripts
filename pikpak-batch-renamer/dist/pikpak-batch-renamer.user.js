// ==UserScript==
// @name         PikPak 批量番号重命名助手
// @name:en      PikPak Batch JAV Renamer Assistant
// @name:ja      PikPak バッチJAV リネームアシスタント
// @name:zh-CN   PikPak 批量番号重命名助手
// @namespace    https://github.com/CheerChen
// @version      0.0.20
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

    // 三种提取格式的番号识别
    function extractKeyword(fileName, isFile = false) {
        // 对于文件和文件夹，都去掉扩展名，因为扩展名通常不包含番号信息
        // 而且可能造成误判（如 .mp4 被识别为 mp-4）
        const cleanName = fileName.replace(/\.[^.]+$/, '');
        
        // 处理前导0的函数：保留最少3位数字
        function cleanLeadingZeros(numberStr) {
            // 先去掉所有前导0，看看实际的数字位数
            const withoutLeadingZeros = numberStr.replace(/^0+/, '') || '0';
            const actualDigits = withoutLeadingZeros.length;
            
            // 如果去掉前导0后的数字位数 >= 3位，则去除前导0
            if (actualDigits >= 3) {
                return withoutLeadingZeros;
            }
            // 如果去掉前导0后的数字位数 < 3位，则补足到3位
            return withoutLeadingZeros.padStart(3, '0');
        }
        
        // 使用全局匹配找到所有可能的番号，然后取最后一个
        let allMatches = [];
        
        // 格式1: 标准格式 ABC-123 (优先级最高)
        let matches = [...cleanName.matchAll(/([a-zA-Z]+)-(\d+)/g)];
        matches.forEach(match => {
            // 检查原始数字部分长度（包括前导0），少于3位不认为是番号
            if (match[2].length < 3) {
                return; // 跳过数字部分少于3位的匹配
            }
            
            const cleanedNumber = cleanLeadingZeros(match[2]);
            allMatches.push({
                format: 'standard',
                keyword: `${match[1].toLowerCase()}-${cleanedNumber}`,
                originalMatch: match[0], // 保存原始匹配
                series: match[1].toLowerCase(),
                number: cleanedNumber,
                index: match.index,
                priority: 1
            });
        });
        
        // 格式2: 无连字符 ABC123  
        matches = [...cleanName.matchAll(/([a-zA-Z]+)(\d+)/g)];
        matches.forEach(match => {
            // 检查原始数字部分长度（包括前导0），少于3位不认为是番号
            if (match[2].length < 3) {
                return; // 跳过数字部分少于3位的匹配
            }
            
            const cleanedNumber = cleanLeadingZeros(match[2]);
            allMatches.push({
                format: 'no-dash',
                keyword: `${match[1].toLowerCase()}-${cleanedNumber}`,
                originalMatch: match[0], // 保存原始匹配
                series: match[1].toLowerCase(), 
                number: cleanedNumber,
                index: match.index,
                priority: 2
            });
        });
        
        // 格式3: 通用匹配
        matches = [...cleanName.matchAll(/([a-zA-Z]{3,})(\d+)/g)];
        matches.forEach(match => {
            // 检查原始数字部分长度（包括前导0），少于3位不认为是番号
            if (match[2].length < 3) {
                return; // 跳过数字部分少于3位的匹配
            }
            
            const cleanedNumber = cleanLeadingZeros(match[2]);
            allMatches.push({
                format: 'generic',
                keyword: `${match[1].toLowerCase()}-${cleanedNumber}`,
                originalMatch: match[0], // 保存原始匹配
                series: match[1].toLowerCase(),
                number: cleanedNumber,
                index: match.index,
                priority: 3
            });
        });
        
        if (allMatches.length === 0) {
            return null;
        }
        
        // 按位置排序（最后出现的优先），如果位置相同则按优先级排序
        allMatches.sort((a, b) => {
            if (a.index !== b.index) {
                return b.index - a.index; // 位置越靠后越优先
            }
            return a.priority - b.priority; // 优先级越小越优先
        });
        
        const result = allMatches[0];
        return {
            format: result.format,
            keyword: result.keyword,
            originalMatch: result.originalMatch,
            series: result.series,
            number: result.number
        };
    }

    // 构建直接访问URL
    function buildDirectAccessUrl(keyword) {
        return `https://av-wiki.net/${keyword.toLowerCase()}/`;
    }

    // 构建搜索URL
    function buildSearchUrl(searchTerm) {
        return `https://av-wiki.net/?s=${encodeURIComponent(searchTerm)}&post_type=product`;
    }

    // 为了测试目的而保留的函数，实际逻辑已整合到主要函数中
    function predictDirectAccess(keyword) {
        if (!keyword) {
            return {
                url: '',
                likely: false
            };
        }
        
        return {
            url: buildDirectAccessUrl(keyword),
            likely: keyword.match(/^[a-zA-Z]+-\d+$/) !== null
        };
    }

    // 为了测试目的而保留的函数，实际逻辑已整合到主要函数中
    function getSearchFallback(originalMatch) {
        if (!originalMatch) {
            return {
                searchUrl: '',
            };
        }
        
        return {
            searchUrl: buildSearchUrl(originalMatch),
        };
    }

    // 获取回退搜索的详情页链接
    function getFallbackDetailUrl(searchTerm) {
        return new Promise((resolve, reject) => {
            if (!searchTerm) {
                resolve(null);
                return;
            }

            const searchUrl = buildSearchUrl(searchTerm);
            
            httpRequest({
                method: "GET",
                url: searchUrl
            }).then(function(response) {
                const parser = new DOMParser();
                const doc = parser.parseFromString(response.responseText, "text/html");
                const listItems = doc.querySelectorAll('.read-more a');

                const seriesMatch = searchTerm.match(/[a-zA-Z]+/);
                if (!seriesMatch) {
                    resolve(null);
                    return;
                }
                const seriesName = seriesMatch[0].toLowerCase();
                const keywordRegex = new RegExp(seriesName, 'i');
                
                for (let item of listItems) {
                    const href = item.href;
                    if (href && keywordRegex.test(href.toLowerCase())) {
                        resolve(href);
                        return;
                    }
                }
                
                resolve(null);
            }).catch(function(error) {
                console.error(`[getFallbackDetailUrl] HTTP request failed:`, error);
                resolve(null);
            });
        });
    }

    // HTTP 请求适配器 - 在测试环境使用代理，在 userscript 环境使用 GM_xmlhttpRequest
    function httpRequest(options) {
        return new Promise((resolve, reject) => {
            // 检查是否在 userscript 环境中
            if (typeof GM_xmlhttpRequest !== 'undefined') {
                GM_xmlhttpRequest({
                    method: options.method || 'GET',
                    url: options.url,
                    onload: resolve,
                    onerror: reject
                });
            } else {
                // 测试环境中使用代理服务器
                const proxyUrl = `http://localhost:3001?url=${encodeURIComponent(options.url)}`;
                fetch(proxyUrl, {
                    method: options.method || 'GET'
                })
                .then(response => response.text())
                .then(responseText => {
                    resolve({
                        status: 200,
                        responseText: responseText
                    });
                })
                .catch(reject);
            }
        });
    }

    // 解析详情页内容，提取标题和日期
    function parseDetailPage(responseText) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(responseText, "text/html");
        const ogTitle = doc.querySelector('.blockquote-like p');
        const dateElement = doc.querySelector('time.date.published');

        let name = ogTitle ? ogTitle.textContent : null;
        let date = dateElement ? dateElement.getAttribute('datetime') : null;

        if (name) {
            name = name.replace(/[\/:*?"<>|\x00-\x1F]/g, '_');
        }
        return { title: name, date: date };
    }

    // 查询AV-wiki获取标题和日期
    function queryAVwiki(extractionResult) {
        return new Promise((resolve, reject) => {
            if (!extractionResult || !extractionResult.keyword) {
                return reject('Invalid extraction result provided.');
            }

            const directUrl = buildDirectAccessUrl(extractionResult.keyword);

            httpRequest({ method: "GET", url: directUrl })
                .then(response => {
                    // 检查是否成功获取到详情页
                    if (response.status === 200 && response.responseText.includes('blockquote-like')) {
                        const { title, date } = parseDetailPage(response.responseText);
                        if (title) {
                            console.log(`[queryAVwiki] DirectAccess 成功: ${extractionResult.keyword}`);
                            resolve({ title, date });
                            return; // 成功，终止Promise链
                        }
                    }
                    // 若无有效标题或页面结构不对，抛出错误进入fallback
                    console.log(`[queryAVwiki] DirectAccess 失败，准备进入 Fallback: ${extractionResult.keyword}`);
                    throw new Error('Direct access failed or page content invalid.');
                })
                .catch(async () => {
                    // 直接访问失败，回退到搜索方式
                    console.log(`[queryAVwiki] 开始 Fallback 搜索: ${extractionResult.originalMatch}`);
                    try {
                        const detailUrl = await getFallbackDetailUrl(extractionResult.originalMatch);
                        if (detailUrl) {
                            const detailResponse = await httpRequest({ method: "GET", url: detailUrl });
                            const { title, date } = parseDetailPage(detailResponse.responseText);
                            if (title) {
                                console.log(`[queryAVwiki] Fallback 成功: ${extractionResult.originalMatch} -> ${detailUrl}`);
                                resolve({ title, date });
                            } else {
                                console.log(`[queryAVwiki] Fallback 失败 - 未找到标题: ${extractionResult.originalMatch}`);
                                reject('未找到标题 (Fallback)');
                            }
                        } else {
                            console.log(`[queryAVwiki] Fallback 失败 - 未找到匹配的番号: ${extractionResult.originalMatch}`);
                            reject('未找到匹配的番号 (Fallback)');
                        }
                    } catch (fallbackError) {
                        console.error(`[queryAVwiki] Fallback 网络请求失败: ${extractionResult.originalMatch}`, fallbackError);
                        reject('网络请求失败 (Fallback)');
                    }
                });
        });
    }


    

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

        const configOptions = [
            {
                key: 'addDatePrefix',
                label: '在文件名开头增加发行日期',
                desc: '启用后文件名格式为: {日期} {标题}，例如: 2025-09-12 标题名称.mp4'
            },
            {
                key: 'fixFileExtension', 
                label: '修复文件扩展名',
                desc: '当文件缺少扩展名时，根据文件MIME类型自动添加合适的扩展名'
            }
        ];

        return React.createElement('div', { style: { ...STYLES.overlay, zIndex: 10001 } },
            React.createElement('div', { style: { ...STYLES.modal, width: '400px' } }, [
                React.createElement('div', { key: 'header', style: STYLES.header }, [
                    React.createElement('h3', { key: 'title', style: { margin: 0, color: STYLES.text.primary, fontSize: '16px' } }, '重命名配置'),
                    React.createElement('button', { key: 'close', onClick: onClose, style: { background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: STYLES.text.secondary, padding: '4px' } }, '×')
                ]),
                React.createElement('div', { key: 'content', style: { marginBottom: '20px' } }, 
                    configOptions.map((option, i) => [
                        React.createElement('label', { key: `option${i}`, style: { display: 'flex', alignItems: 'center', cursor: 'pointer', padding: '8px 0' } }, [
                            React.createElement('input', { key: 'checkbox', type: 'checkbox', checked: config[option.key], onChange: (e) => onConfigChange({ ...config, [option.key]: e.target.checked }), style: { marginRight: '8px' } }),
                            React.createElement('span', { key: 'label', style: { fontSize: '14px', color: STYLES.text.primary } }, option.label)
                        ]),
                        React.createElement('div', { key: `desc${i}`, style: { fontSize: '12px', color: STYLES.text.secondary, marginLeft: '24px', lineHeight: '1.4', marginBottom: '12px' } }, option.desc)
                    ]).flat()
                ),
                React.createElement('div', { key: 'footer', style: { display: 'flex', justifyContent: 'flex-end', gap: '12px', paddingTop: '16px', borderTop: '1px solid #ebeef5' } }, [
                    React.createElement('button', { key: 'cancel', onClick: onClose, style: { ...STYLES.button, ...STYLES.secondaryBtn } }, '取消'),
                    React.createElement('button', { key: 'save', onClick: () => { setConfig(config); onClose(); }, style: { ...STYLES.button, ...STYLES.primaryBtn } }, '保存')
                ])
            ])
        );
    };

    // 文件项组件
    const FileItem = ({ file, selected, onSelect, validationStatus, newName }) => {
        const statusMap = {
            valid: { icon: '✅', color: STYLES.text.success },
            invalid: { icon: '❌', color: STYLES.text.danger },
            loading: { icon: '⏳', color: STYLES.text.warning }
        };
        const status = statusMap[validationStatus] || { icon: '', color: STYLES.text.secondary };

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
                key: 'status', style: { marginLeft: '8px', color: status.color, fontSize: '16px' }
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
                            createButton('validate', 
                                isValidating ? '扫描中...' : (selectedFiles.size === 0 ? '请选择文件' : '扫描番号'),
                                validateFiles, 'primary', isValidating || selectedFiles.size === 0),
                            React.createElement('button', {
                                key: 'config', onClick: () => setShowConfigDialog(true), title: '配置选项',
                                style: { padding: '8px', backgroundColor: 'transparent', color: STYLES.text.secondary, border: '1px solid #dcdfe6', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }
                            }, React.createElement('svg', { width: '16', height: '16', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2' }, [
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
                        createButton('cancel', '取消', () => { resetModal(); onClose(); }, 'secondary'),
                        createButton('next', '下一步', () => setShowConfirmation(true), 'primary', 
                            selectedFiles.size === 0 || Object.keys(validationResults).length === 0)
                    ] : [
                        createButton('back', '上一步', () => setShowConfirmation(false), 'secondary', isRenaming),
                        createButton('confirm', isRenaming ? '重命名中...' : '确认重命名', 
                            performBatchRename, 'primary', isRenaming)
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