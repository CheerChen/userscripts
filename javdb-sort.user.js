// ==UserScript==
// @name         javdb 重排序
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  根据评分人数降序排列，且会自动加载十页的内容
// @author       You
// @match        https://javdb.com/*
// @match        https://185.246.85.103/*

// @icon         https://www.google.com/s2/favicons?sz=64&domain=javdb.com
// @grant        none
// @license MIT
// @downloadURL https://update.sleazyfork.org/scripts/453085/javdb%20%E9%87%8D%E6%8E%92%E5%BA%8F.user.js
// @updateURL https://update.sleazyfork.org/scripts/453085/javdb%20%E9%87%8D%E6%8E%92%E5%BA%8F.meta.js
// ==/UserScript==

(function () {
    'use strict';

    const peoplePattern = /由(\d+)人/;
    const pagePattern = /page=(\d+)/;
    const movieList = $('.movie-list')[0];
    const state = {
        items: [],
        selectedMonth: 'ALL',
        sortEnabled: true,
    };
    const controls = {
        monthSelect: null,
        panel: null,
        toggleButton: null,
    };
    let maxPageOffset = 0;
    let paginationNext = $('.pagination-next');
    const curPage = getCurPage();
    if (paginationNext && paginationNext.length) {
        paginationNext = paginationNext[0];
        maxPageOffset = 4;
        paginationNext.href = getPageUrl(curPage + maxPageOffset + 1);
        paginationNext.textContent = `下${maxPageOffset + 1}页`;
    }
    main();

    function main() {
        if (!movieList) {
            return;
        }
        collectItems($('.item', movieList));
        setupFloatingControls();
        renderList();
        for (let pageOffset = 0; pageOffset < maxPageOffset; pageOffset++) {
            const newPage = curPage + pageOffset + 1;
            loadPage(newPage, newList => {
                collectItems(newList);
                console.log(`load page:${newPage}`);
            });
        }
    }

    function collectItems(list) {
        if (!list || !list.length) {
            return;
        }
        for (let item of list) {
            state.items.push(enrichItem(item, state.items.length));
        }
        updateMonthOptions();
        renderList();
    }

    function enrichItem(item, index) {
        const score = $('.score', item)[0];
        let peopleCnt = 0;
        if (score) {
            const searchRes = peoplePattern.exec(score.textContent);
            if (searchRes && searchRes[1]) {
                peopleCnt = Number.parseInt(searchRes[1]);
            }
            if (!score.dataset.enhanced) {
                score.innerHTML = score.innerHTML.replace(/由(\d+)人/, '由<span style="color:red">$1</span>人');
                score.dataset.enhanced = 'true';
            }
        }
        return {
            element: item,
            peopleCnt,
            month: extractMonth(item),
            originalIndex: index,
        };
    }

    function extractMonth(item) {
        const meta = $('.meta', item)[0];
        if (!meta) {
            return '未知';
        }
        const text = meta.textContent.trim();
        const match = text.match(/(\d{4})[-/](\d{2})/);
        if (!match) {
            return '未知';
        }
        return `${match[1]}-${match[2]}`;
    }

    function renderList() {
        if (!movieList) {
            return;
        }
        let list = state.items.slice();
        if (state.selectedMonth !== 'ALL') {
            list = list.filter(item => item.month === state.selectedMonth);
        }
        if (state.sortEnabled) {
            list.sort((a, b) => b.peopleCnt - a.peopleCnt);
        } else {
            list.sort((a, b) => a.originalIndex - b.originalIndex);
        }
        movieList.innerHTML = '';
        for (let item of list) {
            movieList.append(item.element);
        }
    }

    function setupFloatingControls() {
        injectStyles();
        const container = document.createElement('div');
        container.className = 'javdb-sort-controls';

        controls.toggleButton = document.createElement('button');
        controls.toggleButton.className = 'javdb-sort-toggle';
        controls.toggleButton.textContent = '排序/筛选';
        controls.toggleButton.addEventListener('click', () => {
            controls.panel.classList.toggle('open');
        });

        controls.panel = document.createElement('div');
        controls.panel.className = 'javdb-sort-panel';

        const sortLabel = document.createElement('label');
        sortLabel.className = 'javdb-sort-option';
        const sortCheckbox = document.createElement('input');
        sortCheckbox.type = 'checkbox';
        sortCheckbox.checked = state.sortEnabled;
        sortCheckbox.addEventListener('change', () => {
            state.sortEnabled = sortCheckbox.checked;
            renderList();
        });
        const sortText = document.createElement('span');
        sortText.textContent = '按评分人数排序';
        sortLabel.append(sortCheckbox, sortText);

        const monthGroup = document.createElement('div');
        monthGroup.className = 'javdb-month-group';

        const monthLabel = document.createElement('div');
        monthLabel.textContent = '月份筛选';

        controls.monthSelect = document.createElement('select');
        controls.monthSelect.addEventListener('change', () => {
            state.selectedMonth = controls.monthSelect.value;
            renderList();
        });

        monthGroup.append(monthLabel, controls.monthSelect);
        controls.panel.append(sortLabel, monthGroup);
        container.append(controls.toggleButton, controls.panel);
        document.body.appendChild(container);
        updateMonthOptions();
    }

    function updateMonthOptions() {
        if (!controls.monthSelect) {
            return;
        }
        const previousValue = controls.monthSelect.value || state.selectedMonth;
        const monthSet = new Set();
        state.items.forEach(item => {
            if (item.month && item.month !== '未知') {
                monthSet.add(item.month);
            }
        });
        const months = Array.from(monthSet).sort((a, b) => b.localeCompare(a));
        controls.monthSelect.innerHTML = '';

        const defaultOption = document.createElement('option');
        defaultOption.value = 'ALL';
        defaultOption.textContent = '全部月份';
        controls.monthSelect.appendChild(defaultOption);

        months.forEach(month => {
            const option = document.createElement('option');
            option.value = month;
            option.textContent = month;
            controls.monthSelect.appendChild(option);
        });

        if (months.includes(previousValue)) {
            controls.monthSelect.value = previousValue;
            state.selectedMonth = previousValue;
        } else {
            controls.monthSelect.value = 'ALL';
            state.selectedMonth = 'ALL';
        }
    }

    function injectStyles() {
        const styles = `
        .javdb-sort-controls {
            position: fixed;
            right: 24px;
            bottom: 24px;
            z-index: 9999;
            font-size: 14px;
            font-family: sans-serif;
        }
        .javdb-sort-toggle {
            background: #ff5c5c;
            color: #fff;
            border: none;
            border-radius: 24px;
            padding: 8px 16px;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        }
        .javdb-sort-panel {
            margin-top: 8px;
            padding: 12px;
            border-radius: 12px;
            background: rgba(0,0,0,0.85);
            color: #fff;
            min-width: 200px;
            display: none;
        }
        .javdb-sort-panel.open {
            display: block;
        }
        .javdb-sort-option {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 8px;
        }
        .javdb-month-group select {
            width: 100%;
            padding: 4px;
            border-radius: 6px;
            border: 1px solid rgba(255,255,255,0.2);
            background: rgba(255,255,255,0.1);
            color: #fff;
        }
        .javdb-month-group select option {
            color: #000;
        }`;
        const styleEl = document.createElement('style');
        styleEl.textContent = styles;
        document.head.appendChild(styleEl);
    }

    function getCurPage() {
        const curPath = window.location.href;
        const searchRes = pagePattern.exec(curPath);
        if (searchRes && searchRes.length > 1) {
            return Number.parseInt(searchRes[1]);
        }
        return 1;
    }

    function getPageUrl(page) {
        const curPath = window.location.href;
        const pageIdx = curPath.indexOf('page');
        if (pageIdx > 0) {
            return curPath.replace(pagePattern, `page=${page}`);
        }
        if (curPath.indexOf('?') > 0) {
            return `${curPath}&page=${page}`;
        }
        return `${curPath}?page=${page}`;
    }

    function loadPage(page, cb) {
        const pageUrl = getPageUrl(page);
        getdata(pageUrl, data => {
            const container = document.createElement('div');
            container.style.display = 'none';
            container.innerHTML = data;
            const newList = $('.movie-list .item', container);
            cb(newList);
        });
    }

    function getdata(pageUrl, cb) {
        $.get(pageUrl, function (data) {
            cb(data);
        });
    }
})();
