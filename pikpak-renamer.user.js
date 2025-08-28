// ==UserScript==
// @name         PikPak 番号重命名助手
// @name:en      PikPak JAV Renamer Assistant
// @name:ja      PikPak JAV リネームアシスタント
// @name:zh-CN   PikPak 番号重命名助手
// @namespace    https://github.com/CheerChen
// @version      0.7.1
// @description  Automatically fetches information from AV-wiki website and fills it into the rename dialog on mypikpak.com to help users quickly rename files. The script executes automatically when mypikpak.com dialog is triggered, improving efficiency and accuracy when managing JAV-coded files. Now supports file extension preservation.
// @description:en Automatically fetches information from AV-wiki website and fills it into the rename dialog on mypikpak.com to help users quickly rename files. The script executes automatically when mypikpak.com dialog is triggered, improving efficiency and accuracy when managing JAV-coded files. Now supports file extension preservation.
// @description:ja AV-wikiウェブサイトから情報を自動取得し、mypikpak.comのリネームダイアログに入力してファイルの迅速なリネームを支援します。mypikpak.comのダイアログがトリガーされると自動実行され、JAVコード付きファイル管理の効率性と正確性を向上させます。ファイル拡張子の保護機能を追加。
// @description:zh-CN 自动从AV-wiki网站获取信息并填充到mypikpak.com网站上的重命名对话框中，以帮助用户快速重命名文件。脚本在mypikpak.com的对话框触发时自动执行，从而提高用户在管理带番号的文件时的效率和准确性。现在支持文件扩展名保护。
// @author       cheerchen37
// @match        *://*mypikpak.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @icon         https://www.google.com/s2/favicons?domain=mypikpak.com
// @license      MIT
// @homepage     https://github.com/CheerChen/userscripts
// @supportURL   https://github.com/CheerChen/userscripts/issues
// @updateURL    https://raw.githubusercontent.com/CheerChen/userscripts/master/pikpak-renamer.user.js
// ==/UserScript==

(function() {
    'use strict';

    console.log("脚本已加载");

    // 1. 定位到元素的部分
    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach(node => {
                    if (node.className === "el-dialog") {
                        handleDialog(node);
                    }
                });
            }
        });
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    function handleDialog(node) {
        const input = node.querySelector('input.el-input__inner[type="text"]');
        if (!input) return;

        const originalValue = input.value;
        const keyword = extractKeyword(originalValue);
        if (!keyword) {
            console.log("未能提取有效关键字");
            return;
        }

        queryAVwiki(keyword, input, originalValue);
    }

    // 2. 提取查询元素的部分
    function extractKeyword(text) {
        // 尝试匹配包含字母和数字的模式，忽略后面的字符
        let match = text.match(/([a-zA-Z]+)-(\d+)/);
        if (match) {
            return match[0];
        }
        // 如果上面的特殊格式未匹配，尝试更通用的匹配
        match = text.match(/([a-zA-Z]+)0(\d+)/);
        if (match) {
            return match[0];
        }
        match = text.match(/([a-zA-Z]{3,})(\d+)/);

        return match ? `${match[1]}-${match[2]}` : null;
    }

    // 3. 使用关键字查询AV-wiki的部分
    function queryAVwiki(keyword, input, originalValue) {
        console.log("keyword " + keyword);
        const encodedKeyword = encodeURIComponent(keyword);

        const url = `https://av-wiki.net/?s=${encodedKeyword}&post_type=product`;
        console.log("url " + url);
        GM_xmlhttpRequest({
            method: "GET",
            url: url,
            onload: function(response) {
                const parser = new DOMParser();
                const doc = parser.parseFromString(response.responseText, "text/html");
                const listItems = doc.querySelectorAll('.post .archive-list .read-more a');
                const keywordRegex = new RegExp(keyword.match(/[a-zA-Z]+/)[0], 'i');
                // 查找第一个有效链接
                for (let item of listItems) {
                    if (item.href) {
                        if (!keywordRegex.test(item.href)){
                            continue;
                        }
                        const detailUrl = item.href;
                        console.log("detailUrl "+ detailUrl)
                        GM_xmlhttpRequest({
                            method: "GET",
                            url: detailUrl,
                            onload: function(response) {
                                parseResponseWiki(response.responseText, input, originalValue);
                            }
                        });
                        return; // 找到有效链接后结束循环
                    }
                }
                // 如果没有找到有效链接，设置输入框显示未找到
                input.value = '未找到有效链接';
            },
            onerror: function(error) {
                console.log("请求出错: ", error);
                input.value = "请求错误，请检查网络";
            }
        });
    }

    // 4. 解析响应并更新输入框
    function parseResponseWiki(html, input, originalValue) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        // 尝试从meta标签中提取备选信息
        const ogTitle = doc.querySelector('.blockquote-like p');

        let name = ogTitle ? ogTitle.textContent : '未找到名称';

        // 清理名称中的特殊字符
        name = name.replace(/[\/:*?"<>|\x00-\x1F]/g, '_');
        
        // 检查原始值是否包含文件扩展名
        const extensionMatch = originalValue.match(/(\.[^.]+)$/);
        const extension = extensionMatch ? extensionMatch[1] : '';
        
        // 如果有扩展名，保留它；否则直接使用新名称
        input.value = extension ? `${name}${extension}` : `${name}`;
        triggerInputChange(input);
    }

    // 5. 触发输入变化事件
    function triggerInputChange(element) {
        // 创建一个新的键盘事件
        var event = new Event('input', {
            bubbles: true,
            cancelable: true,
        });

        element.value = element.value.trim(); // 移除空格
        element.dispatchEvent(event); // 再次触发input事件
    }
})();