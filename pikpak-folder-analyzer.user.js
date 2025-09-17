// ==UserScript==
// @name         PikPak Folder Analyzer
// @name:en      PikPak Folder Analyzer
// @name:zh-CN   PikPak 文件夹统计分析
// @namespace    https://github.com/CheerChen
// @version      0.1.0
// @description  Analyzes PikPak folders, extracts data based on a specific pattern, and visualizes it using charts.
// @description:en Analyzes PikPak folders, extracts data based on a specific pattern, and visualizes it using charts.
// @description:zh-CN 分析PikPak文件夹，根据特定模式提取数据，并使用图表进行可视化。
// @author       cheerchen37
// @match        *://*mypikpak.com/*
// @require      https://unpkg.com/react@18/umd/react.production.min.js
// @require      https://unpkg.com/react-dom@18/umd/react-dom.production.min.js
// @require      https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js
// @require      https://cdn.jsdelivr.net/npm/wordcloud@1.2.2/src/wordcloud2.min.js
// @grant        GM_xmlhttpRequest
// @connect      api-drive.mypikpak.com
// @icon         https://www.google.com/s2/favicons?domain=mypikpak.com
// @license      MIT
// @homepage     https://github.com/CheerChen/userscripts
// @supportURL   https://github.com/CheerChen/userscripts/issues
// ==/UserScript==

(function() {
    'use strict';

    const { React, ReactDOM, echarts } = window;
    const { useState, useEffect, useRef, useCallback } = React;
    const { createRoot } = ReactDOM;

    console.log("PikPak Folder Analyzer script loaded.");

    // --- API Functions ---
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
            "x-device-id": window.localStorage.getItem("deviceid") || "",
            "x-captcha-token": captcha
        };
    }

    function getList(parentId, pageToken = '') {
        const limit = 100;
        let url = `https://api-drive.mypikpak.com/drive/v1/files?parent_id=${parentId}&limit=${limit}&with_audit=true&filters=%7B%22phase%22%3A%7B%22eq%22%3A%22PHASE_TYPE_COMPLETE%22%7D%2C%22trashed%22%3A%7B%22eq%22%3Afalse%7D%7D`;
        if (pageToken) {
            url += `&page_token=${pageToken}`;
        }
        return fetch(url, { headers: getHeader() }).then(res => res.json());
    }

    // --- Core Logic ---
    function parseItemName(name) {
        // First, remove file extension
        const cleanName = name.replace(/\.[^/.]+$/, "");

        const dateMatch = cleanName.match(/^(\d{4}-\d{2}-\d{2})\s+/);
        if (!dateMatch) {
            return null;
        }
        const date = dateMatch[1];
        const rest = cleanName.substring(dateMatch[0].length);

        // Extract Series
        const seriesMatch = rest.match(/([a-zA-Z]{2,6})-\d{2,5}/);
        const series = seriesMatch ? seriesMatch[1].toUpperCase() : null;

        // Extract Actor
        let actor = null;
        let title = rest;
        const lastSpaceIndex = rest.lastIndexOf(' ');

        if (lastSpaceIndex > -1) {
            const potentialActor = rest.substring(lastSpaceIndex + 1);
            if (potentialActor) {
                const cjkChars = (potentialActor.match(/[\u4e00-\u9faf]/g) || []).length;
                // Heuristic: if it has CJK chars and is short, it's likely an actor.
                if (cjkChars > 0 && potentialActor.length < 10) {
                    title = rest.substring(0, lastSpaceIndex);
                    actor = potentialActor;
                }
            }
        }
        
        return { date, title, actor, series };
    }

    function getCurrentFolderId() {
        const path = window.location.pathname;
        const match = path.match(/\/drive\/all(?:\/(.*))?$/);
        if (match) {
            return match[1] || '';
        }
        return '';
    }

    function getFileInfo(fileId) {
        const url = `https://api-drive.mypikpak.com/drive/v1/files/${fileId}`;
        return fetch(url, { headers: getHeader() }).then(res => res.json());
    }


    // --- React Components ---
    const STYLES = {
        overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 },
        modal: { backgroundColor: '#fff', borderRadius: '8px', padding: '24px', boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)', width: '90%', maxWidth: '1000px', height: '80vh', display: 'flex', flexDirection: 'column' },
        header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid #ebeef5', paddingBottom: '16px' },
        button: { padding: '8px 16px', border: 'none', borderRadius: '4px', cursor: 'pointer', backgroundColor: '#409eff', color: '#fff' },
        tabButton: { padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '16px', borderBottom: '2px solid transparent' },
        activeTab: { borderBottom: '2px solid #409eff', color: '#409eff' },
        chartContainer: { flex: 1, minHeight: 0, position: 'relative' }
    };

    const EChart = ({ option, isLoading }) => {
        const chartRef = useRef(null);
        const chartInstance = useRef(null);

        useEffect(() => {
            if (!chartRef.current) return;

            chartInstance.current = echarts.init(chartRef.current);
            
            const resizeObserver = new ResizeObserver(() => {
                chartInstance.current?.resize();
            });
            resizeObserver.observe(chartRef.current);

            const handleWindowResize = () => chartInstance.current?.resize();
            window.addEventListener('resize', handleWindowResize);

            return () => {
                resizeObserver.disconnect();
                window.removeEventListener('resize', handleWindowResize);
                chartInstance.current?.dispose();
            };
        }, []);

        useEffect(() => {
            if (!chartInstance.current) return;

            if (isLoading) {
                chartInstance.current.showLoading();
            } else {
                chartInstance.current.hideLoading();
                if (option) {
                    chartInstance.current.setOption(option, { notMerge: true });
                }
            }
        }, [option, isLoading]);

        return React.createElement('div', { ref: chartRef, style: { width: '100%', height: '100%' } });
    };

    const WordCloudComponent = ({ data, onHover }) => {
        const cloudRef = useRef(null);

        useEffect(() => {
            if (!cloudRef.current || !window.WordCloud || data.length === 0) return;

            const MIN_FONT_SIZE = 14;
            const MAX_FONT_SIZE = 60;

            const counts = data.map(([, count]) => count);
            const minCount = Math.min(...counts);
            const maxCount = Math.max(...counts);

            const getWeight = (count) => {
                if (minCount === maxCount) {
                    return MIN_FONT_SIZE;
                }
                const scale = Math.sqrt((count - minCount) / (maxCount - minCount));
                return MIN_FONT_SIZE + Math.round(scale * (MAX_FONT_SIZE - MIN_FONT_SIZE));
            };

            const wordList = data.map(([name, count]) => [name, getWeight(count)]);

            const options = {
                list: wordList,
                gridSize: 8,
                weightFactor: (size) => size,
                fontFamily: 'Arial, sans-serif',
                color: () => {
                    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#85C1E9'];
                    return colors[Math.floor(Math.random() * colors.length)];
                },
                backgroundColor: 'transparent',
                rotateRatio: 0.3,
                rotationSteps: 2,
                hover: (item, dimension, event) => {
                    if (item) {
                        const originalItem = data.find(([name]) => name === item[0]);
                        const originalCount = originalItem ? originalItem[1] : 0;
                        onHover(item, originalCount, event);
                    } else {
                        onHover(null);
                    }
                },
            };

            window.WordCloud(cloudRef.current, options);

            return () => {
                if(cloudRef.current) {
                    cloudRef.current.innerHTML = '';
                }
            };
        }, [data, onHover]);

        return React.createElement('div', { ref: cloudRef, style: { width: '100%', height: '100%' } });
    };

    const AnalysisModal = ({ isOpen, onClose }) => {
        const [isAnalyzing, setIsAnalyzing] = useState(false);
        const [progress, setProgress] = useState({ scanned: 0, total: 0, currentFolder: '' });
        const [analysisData, setAnalysisData] = useState(null);
        const [activeTab, setActiveTab] = useState('monthly');
        const [chartOption, setChartOption] = useState(null);
        const [tooltip, setTooltip] = useState({ visible: false, content: '', x: 0, y: 0 });

        const handleWordCloudHover = useCallback((item, count, event) => {
            if (item) {
                setTooltip({
                    visible: true,
                    content: `${item[0]}: ${count} items`,
                    x: event.pageX + 15,
                    y: event.pageY + 15,
                });
            } else {
                setTooltip(t => ({ ...t, visible: false }));
            }
        }, []);

        const handleStartAnalysis = useCallback(async () => {
            setIsAnalyzing(true);
            setAnalysisData(null);
            setProgress({ scanned: 0, total: 0, currentFolder: 'Initializing...' });

            const allItemsToAnalyze = [];
            const startFolderId = getCurrentFolderId();

            if (startFolderId) {
                try {
                    const currentFolderInfo = await getFileInfo(startFolderId);
                    if (currentFolderInfo && currentFolderInfo.kind === 'drive#folder') {
                        allItemsToAnalyze.push(currentFolderInfo);
                    }
                } catch (e) {
                    console.error("Failed to fetch current folder info", e);
                }
            }

            setProgress(p => ({ ...p, currentFolder: 'Fetching direct children...' }));
            const depth1Folders = [];
            try {
                let nextPageToken = '';
                do {
                    const res = await getList(startFolderId, nextPageToken);
                    if (res && Array.isArray(res.files)) {
                        allItemsToAnalyze.push(...res.files);
                        const folders = res.files.filter(f => f.kind === 'drive#folder');
                        depth1Folders.push(...folders);
                        nextPageToken = res.next_page_token;
                    } else {
                        nextPageToken = '';
                    }
                } while (nextPageToken);
            } catch (e) {
                console.error("Failed to fetch direct children", e);
            }
            setProgress({ scanned: 0, total: depth1Folders.length, currentFolder: 'Fetching grandchildren...' });

            for (let i = 0; i < depth1Folders.length; i++) {
                const d1folder = depth1Folders[i];
                setProgress(p => ({ ...p, scanned: i + 1, currentFolder: d1folder.name }));
                try {
                    let nextPageToken = '';
                    do {
                        const res = await getList(d1folder.id, nextPageToken);
                        if (res && Array.isArray(res.files)) {
                            allItemsToAnalyze.push(...res.files);
                            nextPageToken = res.next_page_token;
                        } else {
                            nextPageToken = '';
                        }
                    } while (nextPageToken);
                } catch (e) {
                    console.error(`Failed to fetch children of ${d1folder.name}`, e);
                }
            }

            setProgress(p => ({ ...p, currentFolder: 'Processing results...' }));
            const parsedData = allItemsToAnalyze
                .map(f => parseItemName(f.name))
                .filter(Boolean);

            const monthlyCounts = {};
            const actorCounts = {};
            const seriesCounts = {};

            parsedData.forEach(({ date, actor, series }) => {
                const yearMonth = date.substring(0, 7);
                monthlyCounts[yearMonth] = (monthlyCounts[yearMonth] || 0) + 1;
                if (actor) actorCounts[actor] = (actorCounts[actor] || 0) + 1;
                if (series) seriesCounts[series] = (seriesCounts[series] || 0) + 1;
            });
            
            const sortedActors = Object.entries(actorCounts).sort(([, a], [, b]) => b - a);
            const sortedSeries = Object.entries(seriesCounts).sort(([, a], [, b]) => b - a);

            setAnalysisData({ monthly: monthlyCounts, actors: sortedActors, series: sortedSeries });
            setIsAnalyzing(false);
        }, []);
        
        useEffect(() => {
            if (!analysisData) {
                setChartOption(null);
                return;
            }

            if (activeTab === 'monthly') {
                const monthKeys = Object.keys(analysisData.monthly).sort();
                if (monthKeys.length === 0) {
                    setChartOption(null); // No data to display
                    return;
                }

                const fullMonthRange = [];
                const startDate = new Date(monthKeys[0] + '-01T00:00:00Z');
                const endDate = new Date(monthKeys[monthKeys.length - 1] + '-01T00:00:00Z');

                let currentDate = startDate;
                while (currentDate <= endDate) {
                    const year = currentDate.getUTCFullYear();
                    const month = (currentDate.getUTCMonth() + 1).toString().padStart(2, '0');
                    fullMonthRange.push(`${year}-${month}`);
                    currentDate.setUTCMonth(currentDate.getUTCMonth() + 1);
                }

                const chartData = fullMonthRange.map(month => analysisData.monthly[month] || 0);

                setChartOption({
                    title: { text: 'Items per Month' },
                    tooltip: { trigger: 'axis' },
                    xAxis: { type: 'category', data: fullMonthRange },
                    yAxis: { type: 'value' },
                    series: [{
                        data: chartData,
                        type: 'line',
                        smooth: true,
                        areaStyle: {}
                    }],
                    dataZoom: [{ type: 'slider' }],
                });
            } else {
                setChartOption(null);
            }
        }, [analysisData, activeTab]);

        if (!isOpen) return null;

        return React.createElement('div', { style: STYLES.overlay, onMouseMove: (e) => {
            if(tooltip.visible) setTooltip(t => ({...t, x: e.pageX + 15, y: e.pageY + 15}))
        } }, [
            tooltip.visible && React.createElement('div', { style: {
                position: 'absolute',
                top: tooltip.y,
                left: tooltip.x,
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                color: 'white',
                padding: '5px 10px',
                borderRadius: '3px',
                fontSize: '12px',
                pointerEvents: 'none',
                zIndex: 10001,
            }}, tooltip.content),

            React.createElement('div', { style: STYLES.modal }, [
                React.createElement('div', { key: 'header', style: STYLES.header }, [
                    React.createElement('h2', { key: 'title', style: { margin: 0, fontSize: '18px' } }, 'Folder & File Analysis'),
                    React.createElement('button', { key: 'close', onClick: onClose, style: { background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer' } }, '×')
                ]),
                
                !analysisData && !isAnalyzing && React.createElement('div', { key: 'start-view', style: { textAlign: 'center', padding: '40px 0' } }, [
                    React.createElement('h3', null, 'Analyze all items to generate statistics.'),
                    React.createElement('p', { style: { color: '#666', margin: '10px 0 20px' } }, 'This will scan the current directory and one level of subdirectories.'),
                    React.createElement('button', { onClick: handleStartAnalysis, style: STYLES.button }, 'Start Analysis')
                ]),

                isAnalyzing && React.createElement('div', { key: 'loading-view', style: { textAlign: 'center', padding: '40px 0' } }, [
                    React.createElement('h3', null, 'Analyzing... Please wait.'),
                    React.createElement('p', null, `Scanning folder: ${progress.currentFolder}`),
                    React.createElement('p', null, `${progress.scanned} / ${progress.total} folders checked.`)
                ]),

                analysisData && React.createElement('div', { key: 'results-view', style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } }, [
                    React.createElement('div', { key: 'tabs', style: { borderBottom: '1px solid #eee', marginBottom: '16px' } }, [
                        React.createElement('button', { onClick: () => setActiveTab('monthly'), style: { ...STYLES.tabButton, ...(activeTab === 'monthly' ? STYLES.activeTab : {}) } }, 'By Month'),
                        React.createElement('button', { onClick: () => setActiveTab('actors'), style: { ...STYLES.tabButton, ...(activeTab === 'actors' ? STYLES.activeTab : {}) } }, 'By Actor'),
                        React.createElement('button', { onClick: () => setActiveTab('series'), style: { ...STYLES.tabButton, ...(activeTab === 'series' ? STYLES.activeTab : {}) } }, 'By Series')
                    ]),
                    React.createElement('div', { key: 'chart', style: STYLES.chartContainer }, 
                        activeTab === 'monthly' && React.createElement(EChart, { option: chartOption, isLoading: isAnalyzing }),
                        activeTab === 'actors' && React.createElement(WordCloudComponent, { data: analysisData.actors, onHover: handleWordCloudHover }),
                        activeTab === 'series' && React.createElement(WordCloudComponent, { data: analysisData.series, onHover: handleWordCloudHover })
                    )
                ])
            ])
        ]);
    };

    // --- App Initialization ---
    function initApp() {
        if (location.pathname === '/') return;

        const fileOps = document.querySelector('.file-operations');
        if (fileOps && !fileOps.querySelector('.folder-analyzer-button')) {
            const analyzerItem = document.createElement('li');
            analyzerItem.className = 'icon-with-label folder-analyzer-button';
            analyzerItem.innerHTML = `
                <a aria-label="Folder Analysis" class="pp-link-button hover-able" href="javascript:void(0)">
                    <span class="icon-hover-able pp-icon" style="--icon-color: var(--color-secondary-text); --icon-color-hover: var(--color-primary); display: flex; align-items: center; justify-content: center; width: 24px; height: 24px;">
                        <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style="width: 20px; height: 20px;"><path d="M4 4h16v2H4V4zm0 14h16v2H4v-2zm0-7h16v2H4v-2z"/></svg>
                    </span>
                    <span class="label">文件夹统计</span>
                </a>`;
            
            analyzerItem.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                let modalContainer = document.getElementById('pikpak-folder-analyzer-modal');
                if (!modalContainer) {
                    modalContainer = document.createElement('div');
                    modalContainer.id = 'pikpak-folder-analyzer-modal';
                    document.body.appendChild(modalContainer);
                }
                
                const root = createRoot(modalContainer);
                const handleClose = () => {
                    root.unmount();
                    if (document.body.contains(modalContainer)) {
                        document.body.removeChild(modalContainer);
                    }
                };
                root.render(React.createElement(AnalysisModal, { isOpen: true, onClose: handleClose }));
            });
            
            const divider = fileOps.querySelector('.divider-in-operations');
            fileOps.insertBefore(analyzerItem, divider || null);
        } else {
            setTimeout(initApp, 1000);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
    } else {
        setTimeout(initApp, 1000);
    }
})();
