// ==UserScript==
// @name         Emby Stats
// @name:en      Emby Stats
// @name:zh-CN   Emby 统计
// @namespace    https://github.com/CheerChen
// @version      1.2.0
// @description  Generates statistics for Emby libraries and displays them in charts.
// @description:en Generates statistics for Emby libraries and displays them in charts.
// @description:zh-CN 为Emby媒体库生成统计信息并用图表展示。
// @author       cheerchen37
// @match        *://*/web/index.html*
// @require      https://unpkg.com/react@18/umd/react.production.min.js
// @require      https://unpkg.com/react-dom@18/umd/react-dom.production.min.js
// @require      https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js
// @grant        none
// @icon         https://www.google.com/s2/favicons?domain=emby.media
// @license      MIT
// @homepage     https://github.com/CheerChen/userscripts
// @supportURL   https://github.com/CheerChen/userscripts/issues
// ==/UserScript==

(function() {
    'use strict';

    const { React, ReactDOM, echarts } = window;
    const { useState, useEffect, useRef, useCallback } = React;
    const { createRoot } = ReactDOM;

    console.log("Emby Stats script loaded.");

    // --- Utility Functions ---
    let wordCloudLoaded = false;
    function loadWordCloudScript(callback) {
        if (wordCloudLoaded) {
            callback();
            return;
        }
        const scriptUrl = 'https://cdnjs.cloudflare.com/ajax/libs/wordcloud2.js/1.1.0/wordcloud2.min.js';
        const existingScript = document.querySelector(`script[src="${scriptUrl}"]`);
        if (existingScript) {
            // It might be loading, wait for it
            const checkInterval = setInterval(() => {
                if (typeof window.WordCloud === 'function') {
                    wordCloudLoaded = true;
                    clearInterval(checkInterval);
                    callback();
                }
            }, 100);
            return;
        }
        const script = document.createElement('script');
        script.src = scriptUrl;
        script.onload = () => {
            console.log('[Emby Stats] wordcloud2.js loaded successfully.');
            wordCloudLoaded = true;
            callback();
        };
        script.onerror = () => console.error('[Emby Stats] Failed to load wordcloud2.js script.');
        document.head.appendChild(script);
    }

    // --- API Functions ---
    async function fetchLibraryItems(userId, parentId, progressCallback) {
        const allItems = [];
        let startIndex = 0;
        const limit = 200;
        const headers = { 'X-Emby-Token': window.ApiClient.accessToken(), 'Content-Type': 'application/json' };
        const baseUrl = window.ApiClient.serverAddress();
        const initialUrl = `${baseUrl}/emby/Users/${userId}/Items?IncludeItemTypes=Movie&Recursive=true&ParentId=${parentId}&Limit=0`;
        const initialResponse = await fetch(initialUrl, { headers });
        const initialData = await initialResponse.json();
        const totalRecordCount = initialData.TotalRecordCount;
        if (!totalRecordCount) return [];
        progressCallback({ current: 0, total: totalRecordCount });
        while (startIndex < totalRecordCount) {
            const loopUrl = `${baseUrl}/emby/Users/${userId}/Items?IncludeItemTypes=Movie&Recursive=true&ParentId=${parentId}&Limit=${limit}&StartIndex=${startIndex}&Fields=PremiereDate,People,Studios`;
            const response = await fetch(loopUrl, { headers });
            const data = await response.json();
            if (data.Items) {
                allItems.push(...data.Items);
                startIndex += data.Items.length;
                progressCallback({ current: startIndex, total: totalRecordCount });
            } else {
                throw new Error(data.error_message || 'Failed to fetch a page of items.');
            }
        }
        return allItems;
    }

    // --- Core Logic ---
    function processApiItem(item) {
        if (!item || !item.PremiereDate || !item.Name) return null;
        const cleanName = item.Name.replace(/\.[^/.]+$/, "");
        const date = item.PremiereDate;
        const actors = (item.People || []).filter(p => p.Type === 'Actor').map(p => p.Name);
        const seriesMatch = cleanName.match(/([a-zA-Z]{2,6})-\d{2,5}/);
        const series = seriesMatch ? seriesMatch[1].toUpperCase() : null;
        return { date, actors, series };
    }

    function getParentIdFromUrl() {
        const match = window.location.hash.match(/parentId=([a-zA-Z0-9]+)/);
        return match ? match[1] : null;
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
        useEffect(() => {
            if (!chartRef.current) return;
            const chartInstance = echarts.init(chartRef.current);
            const resizeObserver = new ResizeObserver(() => chartInstance?.resize());
            resizeObserver.observe(chartRef.current);
            if (isLoading) chartInstance.showLoading();
            else {
                chartInstance.hideLoading();
                if(option) chartInstance.setOption(option, { notMerge: true });
            }
            return () => {
                resizeObserver.disconnect();
                chartInstance.dispose();
            };
        }, [option, isLoading]);
        return React.createElement('div', { ref: chartRef, style: { width: '100%', height: '100%' } });
    };

    const WordCloudComponent = ({ data, onHover }) => {
        const cloudRef = useRef(null);
        useEffect(() => {
            if (!cloudRef.current || data.length === 0) return;
            cloudRef.current.innerHTML = '';
            const MIN_FONT_SIZE = 14, MAX_FONT_SIZE = 60;
            const counts = data.map(([, count]) => count);
            const minCount = Math.min(...counts), maxCount = Math.max(...counts);
            const getWeight = count => {
                if (minCount === maxCount) return MIN_FONT_SIZE;
                const scale = Math.sqrt((count - minCount) / (maxCount - minCount));
                return MIN_FONT_SIZE + Math.round(scale * (MAX_FONT_SIZE - MIN_FONT_SIZE));
            };
            const wordList = data.map(([name, count]) => [name, getWeight(count)]);
            window.WordCloud(cloudRef.current, {
                list: wordList,
                gridSize: 8,
                weightFactor: size => size,
                fontFamily: 'Arial, sans-serif',
                color: () => ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#85C1E9'][Math.floor(Math.random() * 6)],
                backgroundColor: 'transparent',
                rotateRatio: 0.3,
                hover: (item, dimension, event) => {
                    if (item) {
                        const originalItem = data.find(([name]) => name === item[0]);
                        onHover(item, originalItem ? originalItem[1] : 0, event);
                    } else {
                        onHover(null);
                    }
                },
            });
            return () => { if(cloudRef.current) cloudRef.current.innerHTML = ''; };
        }, [data, onHover]);
        return React.createElement('div', { ref: cloudRef, style: { width: '100%', height: '100%' } });
    };

    const StatsModal = ({ isOpen, onClose }) => {
        const [isAnalyzing, setIsAnalyzing] = useState(false);
        const [progress, setProgress] = useState('');
        const [analysisData, setAnalysisData] = useState(null);
        const [activeTab, setActiveTab] = useState('monthly');
        const [chartOption, setChartOption] = useState(null);
        const [tooltip, setTooltip] = useState({ visible: false, content: '', x: 0, y: 0 });
        const [isWordCloudReady, setIsWordCloudReady] = useState(wordCloudLoaded);

        useEffect(() => {
            if (activeTab === 'actors' || activeTab === 'series') {
                if (!isWordCloudReady) {
                    loadWordCloudScript(() => setIsWordCloudReady(true));
                }
            }
        }, [activeTab]);

        const handleWordCloudHover = useCallback((item, count, event) => {
            if (item && event) {
                setTooltip({ visible: true, content: `${item[0]}: ${count} items`, x: event.pageX + 15, y: event.pageY + 15 });
            } else {
                setTooltip(t => ({ ...t, visible: false }));
            }
        }, []);

        const handleStartAnalysis = useCallback(async () => {
            setIsAnalyzing(true);
            setAnalysisData(null);
            setProgress('Checking library info...');
            const parentId = getParentIdFromUrl();
            const userId = window.ApiClient.getCurrentUserId();
            if (!parentId || !userId) {
                setProgress('Error: Not in a library view. Please navigate to a movie library.');
                setIsAnalyzing(false);
                return;
            }
            const allItems = await fetchLibraryItems(userId, parentId, prog => setProgress(`Fetching items... ${prog.current} / ${prog.total}`)).catch(e => {
                setProgress(`Error: ${e.message}`);
                setIsAnalyzing(false);
                return null;
            });
            if (!allItems) return;
            setProgress(`Processing ${allItems.length} items...`);
            await new Promise(resolve => setTimeout(resolve, 50));
            const parsedData = allItems.map(processApiItem).filter(Boolean);
            const monthlyCounts = {}, actorCounts = {}, seriesCounts = {};
            parsedData.forEach(({ date, actors, series }) => {
                const yearMonth = date.substring(0, 7);
                monthlyCounts[yearMonth] = (monthlyCounts[yearMonth] || 0) + 1;
                if (actors) actors.forEach(actor => { actorCounts[actor] = (actorCounts[actor] || 0) + 1; });
                if (series) seriesCounts[series] = (seriesCounts[series] || 0) + 1;
            });
            setAnalysisData({ monthly: monthlyCounts, actors: Object.entries(actorCounts).sort(([, a], [, b]) => b - a), series: Object.entries(seriesCounts).sort(([, a], [, b]) => b - a) });
            setIsAnalyzing(false);
            setProgress('');
        }, []);
        
        useEffect(() => {
            if (!analysisData) { setChartOption(null); return; }
            if (activeTab === 'monthly') {
                const monthKeys = Object.keys(analysisData.monthly).sort();
                if (monthKeys.length === 0) { setChartOption(null); return; }
                const startDate = new Date(monthKeys[0] + '-01T00:00:00Z');
                const endDate = new Date(monthKeys[monthKeys.length - 1] + '-01T00:00:00Z');
                const fullMonthRange = [];
                let currentDate = startDate;
                while (currentDate <= endDate) {
                    fullMonthRange.push(`${currentDate.getUTCFullYear()}-${(currentDate.getUTCMonth() + 1).toString().padStart(2, '0')}`);
                    currentDate.setUTCMonth(currentDate.getUTCMonth() + 1);
                }
                const chartData = fullMonthRange.map(month => analysisData.monthly[month] || 0);
                setChartOption({ title: { text: 'Items per Month' }, tooltip: { trigger: 'axis' }, xAxis: { type: 'category', data: fullMonthRange }, yAxis: { type: 'value' }, series: [{ data: chartData, type: 'line', smooth: true, areaStyle: {} }], dataZoom: [{ type: 'slider' }] });
            } else {
                setChartOption(null);
            }
        }, [analysisData, activeTab]);

        if (!isOpen) return null;

        const renderContent = () => {
            if (analysisData) {
                let tabContent;
                if (activeTab === 'monthly') {
                    tabContent = React.createElement(EChart, { option: chartOption, isLoading: isAnalyzing });
                } else if (isWordCloudReady) {
                    if (activeTab === 'actors') {
                        tabContent = React.createElement(WordCloudComponent, { data: analysisData.actors, onHover: handleWordCloudHover });
                    } else if (activeTab === 'series') {
                        tabContent = React.createElement(WordCloudComponent, { data: analysisData.series, onHover: handleWordCloudHover });
                    }
                } else {
                    tabContent = React.createElement('p', null, 'Loading WordCloud library...');
                }

                return React.createElement('div', { key: 'results-view', style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } }, [
                    React.createElement('div', { key: 'tabs', style: { borderBottom: '1px solid #eee', marginBottom: '16px' } }, [
                        React.createElement('button', { onClick: () => setActiveTab('monthly'), style: { ...STYLES.tabButton, ...(activeTab === 'monthly' ? STYLES.activeTab : {}) } }, 'By Month'),
                        React.createElement('button', { onClick: () => setActiveTab('actors'), style: { ...STYLES.tabButton, ...(activeTab === 'actors' ? STYLES.activeTab : {}) } }, 'By Actor'),
                        React.createElement('button', { onClick: () => setActiveTab('series'), style: { ...STYLES.tabButton, ...(activeTab === 'series' ? STYLES.activeTab : {}) } }, 'By Series')
                    ]),
                    React.createElement('div', { key: 'chart', style: STYLES.chartContainer }, tabContent)
                ]);
            }
            return React.createElement('div', { key: 'start-view', style: { textAlign: 'center', padding: '40px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' } }, [
                React.createElement('h3', null, 'Generate Library Statistics'),
                isAnalyzing ? React.createElement('p', { style: { color: '#666', margin: '20px 0' } }, progress) :
                React.createElement('p', { style: { color: '#666', margin: '10px 0 20px' } }, 'Click to start analyzing the current movie library.'),
                !isAnalyzing && React.createElement('button', { onClick: handleStartAnalysis, style: STYLES.button }, 'Start Analysis')
            ]);
        };

        return React.createElement('div', { style: STYLES.overlay, onMouseMove: e => {
            if(tooltip.visible) setTooltip(t => ({...t, x: e.pageX + 15, y: e.pageY + 15}))
        }}, [
            tooltip.visible && React.createElement('div', { style: { position: 'absolute', top: tooltip.y, left: tooltip.x, backgroundColor: 'rgba(0,0,0,0.8)', color: 'white', padding: '5px 10px', borderRadius: '3px', fontSize: '12px', pointerEvents: 'none', zIndex: 10001 }}, tooltip.content),
            React.createElement('div', { style: STYLES.modal }, [
                React.createElement('div', { key: 'header', style: STYLES.header }, [
                    React.createElement('h2', { key: 'title', style: { margin: 0, fontSize: '18px' } }, 'Library Statistics'),
                    React.createElement('button', { key: 'close', onClick: onClose, style: { background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer' } }, '×')
                ]),
                renderContent()
            ])
        ]);
    };

    // --- App Initialization ---
    function initApp() {
        if (document.getElementById('emby-stats-button')) return;
        const statsButton = document.createElement('div');
        statsButton.id = 'emby-stats-button';
        statsButton.innerHTML = '📊';
        statsButton.title = 'Library Stats';
        statsButton.style.cssText = `position: fixed; top: 15px; right: 60px; width: 40px; height: 40px; background-color: rgba(0,122,204,0.8); color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 20px; z-index: 10001; border: 2px solid white; box-shadow: 0 2px 10px rgba(0,0,0,0.3);`;
        statsButton.onclick = () => {
            let modalContainer = document.getElementById('emby-stats-modal-container');
            if (!modalContainer) {
                modalContainer = document.createElement('div');
                modalContainer.id = 'emby-stats-modal-container';
                document.body.appendChild(modalContainer);
            }
            const root = createRoot(modalContainer);
            const handleClose = () => { root.unmount(); if (document.body.contains(modalContainer)) document.body.removeChild(modalContainer); };
            root.render(React.createElement(StatsModal, { isOpen: true, onClose: handleClose }));
        };
        document.body.appendChild(statsButton);
    }

    function waitForApiClient() {
        if (window.ApiClient && typeof window.ApiClient.getCurrentUserId === 'function') {
            initApp();
        } else {
            setTimeout(waitForApiClient, 500);
        }
    }

    waitForApiClient();

})();