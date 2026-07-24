// ==UserScript==
// @name         Manebi Learning Helper
// @name:en      Manebi Learning Helper
// @name:ja      Manebi ラーニング補助ツール
// @name:zh-CN   Manebi 学习助手
// @namespace    https://github.com/CheerChen
// @version      1.1.7
// @description  Removes video playback restrictions and automatically browses unfinished PDF lessons on manebi-learning.com.
// @description:en  Removes video playback restrictions and automatically browses unfinished PDF lessons on manebi-learning.com.
// @description:ja  manebi-learning.comの動画再生制限を解除し、未完了のPDFレッスンを自動閲覧します。
// @description:zh-CN  解除 manebi-learning.com 的视频播放限制，并自动浏览课程中尚未完成的 PDF 课件。
// @author       anonymous
// @match        *://*.manebi-learning.com/*
// @match        *://manebi-learning.com/*
// @icon         https://www.google.com/s2/favicons?domain=manebi.co.jp
// @grant        none
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    const language = (navigator.language || 'en').toLowerCase();
    const locale = language.startsWith('zh') ? 'zh' : language.startsWith('ja') ? 'ja' : 'en';
    const text = {
        en: {
            pdfAuto: 'PDF Auto',
            ready: 'Ready',
            runRemaining: 'Run remaining',
            resume: 'Resume',
            pause: 'Pause',
            paused: (page, pages) =>
                pages ? `Paused — ${page}/${pages} pages viewed` : 'Paused',
            readingList: 'Reading course PDF list…',
            listNotFound: 'PDF lesson list not found',
            allCompleted: (total) => `All ${total} PDF lessons completed`,
            opening: (title) => `Opening ${title}…`,
            couldNotOpen: (title) => `Could not open ${title}`,
            pagesNotFound: (title) => `PDF pages not found: ${title}`,
            pageControlsChanged: 'PDF page controls changed',
            progress: (index, total, page, pages) =>
                `[${index}/${total}] Page ${page}/${pages}`,
            waitingCompletion: (title) => `Waiting for completion: ${title}`,
            completionNotFound: (title) => `Completion mark not found: ${title}`,
            speedControl: 'Speed Control',
            skipToEnd: 'Skip to End',
        },
        ja: {
            pdfAuto: 'PDF自動閲覧',
            ready: '準備完了',
            runRemaining: '未完了分を閲覧',
            resume: '再開',
            pause: '一時停止',
            paused: (page, pages) =>
                pages ? `一時停止：${page}/${pages}ページ閲覧済み` : '一時停止しました',
            readingList: 'PDFレッスン一覧を読み込み中…',
            listNotFound: 'PDFレッスン一覧が見つかりません',
            allCompleted: (total) => `PDFレッスン${total}件はすべて完了しています`,
            opening: (title) => `${title}を開いています…`,
            couldNotOpen: (title) => `${title}を開けませんでした`,
            pagesNotFound: (title) => `${title}のページが見つかりません`,
            pageControlsChanged: 'PDFのページ操作ボタンが変更されました',
            progress: (index, total, page, pages) =>
                `[${index}/${total}] ページ ${page}/${pages}`,
            waitingCompletion: (title) => `${title}の完了を確認中…`,
            completionNotFound: (title) => `${title}の完了表示を確認できませんでした`,
            speedControl: '再生速度',
            skipToEnd: '末尾へ移動',
        },
        zh: {
            pdfAuto: 'PDF 自动浏览',
            ready: '就绪',
            runRemaining: '浏览未完成项',
            resume: '继续',
            pause: '暂停',
            paused: (page, pages) => (pages ? `已暂停，已浏览 ${page}/${pages} 页` : '已暂停'),
            readingList: '正在读取 PDF 课程列表…',
            listNotFound: '未找到 PDF 课程列表',
            allCompleted: (total) => `全部 ${total} 个 PDF 课程已完成`,
            opening: (title) => `正在打开「${title}」…`,
            couldNotOpen: (title) => `无法打开「${title}」`,
            pagesNotFound: (title) => `未找到「${title}」的 PDF 页面`,
            pageControlsChanged: 'PDF 页码控件已发生变化',
            progress: (index, total, page, pages) =>
                `[${index}/${total}] 第 ${page}/${pages} 页`,
            waitingCompletion: (title) => `正在等待「${title}」完成…`,
            completionNotFound: (title) => `未检测到「${title}」的完成标记`,
            speedControl: '播放速度',
            skipToEnd: '跳至结尾',
        },
    }[locale];

    // =========================================================================
    // 1. Override Page Visibility API — prevent background tab detection
    // =========================================================================
    Object.defineProperty(document, 'hidden', {
        get: () => false,
        configurable: true,
    });

    Object.defineProperty(document, 'visibilityState', {
        get: () => 'visible',
        configurable: true,
    });

    // Block all visibilitychange events before they reach the site's listeners
    document.addEventListener(
        'visibilitychange',
        (e) => {
            e.stopImmediatePropagation();
            e.preventDefault();
        },
        true
    );

    // Also block on window level (some sites listen here)
    window.addEventListener(
        'visibilitychange',
        (e) => {
            e.stopImmediatePropagation();
            e.preventDefault();
        },
        true
    );

    // Block blur/focus events that some sites use as a fallback
    window.addEventListener('blur', (e) => e.stopImmediatePropagation(), true);
    window.addEventListener('focus', (e) => e.stopImmediatePropagation(), true);

    // =========================================================================
    // 2. Override hasFocus() — always return true
    // =========================================================================
    Document.prototype.hasFocus = function () {
        return true;
    };

    // =========================================================================
    // 3. Auto-browse unfinished PDF lessons
    // =========================================================================
    const PDF_AUTO_KEY = 'manebi-pdf-auto-running';
    const PDF_PROGRESS_KEY = 'manebi-pdf-auto-progress';
    const PDF_PAGE_INTERVAL = 1250;
    let pdfRunning = false;
    let pdfPauseRequested = false;
    let pdfResumeScheduled = false;
    let pdfController = null;

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const lessonId = () => Number(new URL(location.href).searchParams.get('lessonId'));

    function readPdfProgress() {
        try {
            const progress = JSON.parse(sessionStorage.getItem(PDF_PROGRESS_KEY));
            const savedLessonId = Number(progress?.lessonId);
            const nextPage = Number(progress?.nextPage);
            const totalPages = Number(progress?.totalPages);
            if (
                !savedLessonId ||
                !Number.isInteger(nextPage) ||
                nextPage < 0 ||
                !Number.isInteger(totalPages) ||
                totalPages < 1
            ) {
                return null;
            }
            return { lessonId: savedLessonId, nextPage, totalPages };
        } catch {
            return null;
        }
    }

    function savePdfProgress(lesson, nextPage, totalPages) {
        sessionStorage.setItem(
            PDF_PROGRESS_KEY,
            JSON.stringify({ lessonId: lesson.id, nextPage, totalPages })
        );
    }

    function clearPdfProgress() {
        sessionStorage.removeItem(PDF_PROGRESS_KEY);
    }

    function isElementVisible(element) {
        if (!element?.isConnected) return false;
        for (let node = element; node; node = node.parentElement) {
            const style = node.ownerDocument.defaultView?.getComputedStyle(node);
            if (
                node.hidden ||
                node.getAttribute('aria-hidden') === 'true' ||
                style?.display === 'none' ||
                style?.visibility === 'hidden'
            ) {
                return false;
            }
        }
        const frame = element.ownerDocument.defaultView?.frameElement;
        return frame ? isElementVisible(frame) : true;
    }

    function pdfPageButtons() {
        const groups = new Map();
        document.querySelectorAll('button[aria-label]').forEach((button) => {
            const label = button.getAttribute('aria-label') || '';
            if (
                !isElementVisible(button) ||
                !button.closest('ul') ||
                (!/\/png\/\d+\.png(?:$|[?#])/i.test(label) &&
                    !(/^https?:/i.test(label) && !button.textContent.trim()))
            ) {
                return;
            }
            const list = button.closest('ul');
            groups.set(list, [...(groups.get(list) || []), button]);
        });
        return [...groups.values()].sort((a, b) => b.length - a.length)[0] || [];
    }

    function pdfLessons() {
        const lessons = new Map();
        document
            .querySelectorAll('a[href*="/student/courses/"][href*="lessonId="]')
            .forEach((link) => {
                if (!link.querySelector('svg[aria-label="PDF"]')) return;
                const id = Number(new URL(link.href, location.href).searchParams.get('lessonId'));
                if (!id || lessons.has(id)) return;
                const item = link.closest('li');
                lessons.set(id, {
                    id,
                    link,
                    title: link.querySelector('b')?.textContent.trim() || `PDF ${id}`,
                    done: Boolean(
                        item?.querySelector(
                            'svg[aria-label="完了"], svg[data-testid="CheckCircleIcon"]'
                        )
                    ),
                });
            });
        return [...lessons.values()];
    }

    async function waitFor(getValue, timeout = 20000) {
        const started = Date.now();
        while (!pdfPauseRequested && Date.now() - started < timeout) {
            const value = getValue();
            if (value) return value;
            await sleep(250);
        }
        return null;
    }

    function setPdfStatus(message, busy = pdfRunning) {
        if (!pdfController) return;
        pdfController.status.textContent = message;
        pdfController.run.disabled = busy;
        pdfController.pause.disabled = !busy;
    }

    function updatePdfRunLabel() {
        if (!pdfController) return;
        pdfController.run.textContent = readPdfProgress() ? text.resume : text.runRemaining;
    }

    function nextIncomplete(lessons, currentId, completed) {
        const index = lessons.findIndex((lesson) => lesson.id === currentId);
        const ordered =
            index < 0
                ? lessons
                : [...lessons.slice(index + 1), ...lessons.slice(0, index + 1)];
        return ordered.find((lesson) => !lesson.done && !completed.has(lesson.id));
    }

    async function autoBrowsePdfs() {
        if (pdfRunning) return;
        pdfRunning = true;
        pdfPauseRequested = false;
        sessionStorage.setItem(PDF_AUTO_KEY, '1');
        setPdfStatus(text.readingList);
        const completed = new Set();
        let paused = false;

        try {
            const initialLessons = await waitFor(() => pdfLessons().length && pdfLessons());
            if (pdfPauseRequested) {
                paused = true;
                return;
            }
            if (!initialLessons) throw new Error(text.listNotFound);
            const total = initialLessons.length;

            while (!pdfPauseRequested) {
                const lessons = pdfLessons();
                const currentId = lessonId();
                const current = lessons.find((lesson) => lesson.id === currentId);
                let savedProgress = readPdfProgress();
                const savedTarget = lessons.find(
                    (lesson) => lesson.id === savedProgress?.lessonId
                );
                if (savedProgress && (!savedTarget || savedTarget.done)) {
                    clearPdfProgress();
                    savedProgress = null;
                }
                const target =
                    savedProgress && savedTarget && !completed.has(savedTarget.id)
                        ? savedTarget
                        : current && !current.done && !completed.has(current.id)
                        ? current
                        : nextIncomplete(lessons, currentId, completed);

                if (!target) {
                    clearPdfProgress();
                    setPdfStatus(text.allCompleted(total), false);
                    return;
                }
                const targetIndex =
                    lessons.findIndex((lesson) => lesson.id === target.id) + 1;

                if (currentId !== target.id) {
                    setPdfStatus(text.opening(target.title));
                    target.link.click();
                    if (!(await waitFor(() => lessonId() === target.id))) {
                        if (pdfPauseRequested) {
                            paused = true;
                            return;
                        }
                        throw new Error(text.couldNotOpen(target.title));
                    }
                    await sleep(1500);
                }

                const pages = await waitFor(() => {
                    const buttons = pdfPageButtons();
                    return buttons.length && buttons;
                });
                if (pdfPauseRequested) {
                    paused = true;
                    return;
                }
                if (!pages) throw new Error(text.pagesNotFound(target.title));

                const progress = readPdfProgress();
                const startPage =
                    progress?.lessonId === target.id
                        ? Math.min(progress.nextPage, pages.length)
                        : 0;
                if (progress?.lessonId !== target.id) {
                    savePdfProgress(target, 0, pages.length);
                }

                for (let i = startPage; i < pages.length; i += 1) {
                    if (pdfPauseRequested) {
                        paused = true;
                        return;
                    }
                    const buttons = pdfPageButtons();
                    if (!buttons[i]) throw new Error(text.pageControlsChanged);
                    buttons[i].click();
                    savePdfProgress(target, i + 1, pages.length);
                    setPdfStatus(text.progress(targetIndex, total, i + 1, pages.length));
                    await sleep(PDF_PAGE_INTERVAL);
                }

                if (pdfPauseRequested) {
                    paused = true;
                    return;
                }
                setPdfStatus(text.waitingCompletion(target.title));
                const done = await waitFor(
                    () => pdfLessons().find((lesson) => lesson.id === target.id)?.done,
                    15000
                );
                if (pdfPauseRequested) {
                    paused = true;
                    return;
                }
                if (!done) throw new Error(text.completionNotFound(target.title));
                completed.add(target.id);
                clearPdfProgress();
                await sleep(750);
            }
        } catch (error) {
            if (pdfPauseRequested) {
                paused = true;
            } else {
                setPdfStatus(error.message || String(error), false);
            }
        } finally {
            pdfRunning = false;
            sessionStorage.removeItem(PDF_AUTO_KEY);
            if (paused) {
                const progress = readPdfProgress();
                setPdfStatus(text.paused(progress?.nextPage, progress?.totalPages), false);
            }
            pdfPauseRequested = false;
            if (pdfController) {
                pdfController.run.disabled = false;
                pdfController.pause.disabled = true;
                updatePdfRunLabel();
            }
            scheduleControllerSync();
        }
    }

    function pausePdfAutomation() {
        if (!pdfRunning) return;
        pdfPauseRequested = true;
        sessionStorage.removeItem(PDF_AUTO_KEY);
        const progress = readPdfProgress();
        setPdfStatus(text.paused(progress?.nextPage, progress?.totalPages));
    }

    function removePdfController() {
        if (!pdfController) return;
        pdfController.cleanup();
        pdfController.box.remove();
        pdfController.style.remove();
        pdfController = null;
    }

    function createPdfController() {
        if (pdfController?.box.isConnected || !document.body) return;
        removePdfController();

        const box = document.createElement('div');
        box.id = 'manebi-pdf-auto';
        const progress = readPdfProgress();
        box.innerHTML = `
            <strong>📄 ${text.pdfAuto}</strong>
            <span class="status">${progress ? text.paused(progress.nextPage, progress.totalPages) : text.ready}</span>
            <div><button class="run">${progress ? text.resume : text.runRemaining}</button><button class="pause" disabled>${text.pause}</button></div>
        `;
        const style = document.createElement('style');
        style.textContent = `
            #manebi-pdf-auto{position:fixed;right:20px;bottom:20px;z-index:999999;width:min(280px,calc(100vw - 40px));box-sizing:border-box;padding:10px 14px;border-radius:8px;background:rgba(0,0,0,.8);color:#fff;font:13px/1.4 system-ui,sans-serif;display:flex;flex-direction:column;gap:8px;box-shadow:0 4px 12px rgba(0,0,0,.3);user-select:none;cursor:move}
            #manebi-pdf-auto strong{font-size:12px;opacity:.7;text-align:center}
            #manebi-pdf-auto .status{min-height:17px;color:#cfd8e3}
            #manebi-pdf-auto>div{display:flex;gap:6px}
            #manebi-pdf-auto button{padding:6px 10px;border:0;border-radius:4px;cursor:pointer;font-size:12px}
            #manebi-pdf-auto .run{background:#4caf50;color:#fff}
            #manebi-pdf-auto .pause{background:#666;color:#fff}
            #manebi-pdf-auto button:disabled{cursor:not-allowed;opacity:.45}
        `;
        document.head.appendChild(style);
        document.body.appendChild(box);

        pdfController = {
            box,
            style,
            cleanup: makeDraggable(box),
            status: box.querySelector('.status'),
            run: box.querySelector('.run'),
            pause: box.querySelector('.pause'),
        };
        pdfController.run.addEventListener('click', autoBrowsePdfs);
        pdfController.pause.addEventListener('click', pausePdfAutomation);

        if (sessionStorage.getItem(PDF_AUTO_KEY) && !pdfResumeScheduled) {
            pdfResumeScheduled = true;
            setTimeout(autoBrowsePdfs, 500);
        }
    }

    // =========================================================================
    // 4. Speed control & seek unlock — inject after DOM is ready
    // =========================================================================
    const SPEED_OPTIONS = [1, 1.5, 2, 3, 4, 8, 16];
    let speedController = null;
    let controlledVideo = null;
    let controllerSyncTimer = null;
    let controllerPollTimer = null;

    function makeDraggable(container) {
        let isDragging = false;
        let offsetX;
        let offsetY;
        const onMouseDown = (event) => {
            if (event.target.tagName === 'BUTTON') return;
            isDragging = true;
            const rect = container.getBoundingClientRect();
            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;
        };
        const onMouseMove = (event) => {
            if (!isDragging) return;
            container.style.left = event.clientX - offsetX + 'px';
            container.style.top = event.clientY - offsetY + 'px';
            container.style.right = 'auto';
            container.style.bottom = 'auto';
        };
        const onMouseUp = () => (isDragging = false);

        container.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        return () => {
            container.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
    }

    function removeSpeedController() {
        if (!speedController) return;
        speedController.cleanup();
        speedController.container.remove();
        speedController = null;
        controlledVideo = null;
    }

    function createSpeedController(video) {
        if (controlledVideo === video && speedController?.container.isConnected) return;
        removeSpeedController();

        const container = document.createElement('div');
        container.id = 'manebi-speed-ctrl';
        Object.assign(container.style, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            width: 'min(280px, calc(100vw - 40px))',
            boxSizing: 'border-box',
            zIndex: '999999',
            background: 'rgba(0, 0, 0, 0.8)',
            color: '#fff',
            borderRadius: '8px',
            padding: '10px 14px',
            fontFamily: 'system-ui, sans-serif',
            fontSize: '13px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            userSelect: 'none',
            cursor: 'move',
        });

        // Title bar
        const title = document.createElement('div');
        title.textContent = `⚡ ${text.speedControl}`;
        Object.assign(title.style, {
            fontWeight: 'bold',
            fontSize: '12px',
            opacity: '0.7',
            textAlign: 'center',
        });
        container.appendChild(title);

        // Speed buttons
        const btnRow = document.createElement('div');
        Object.assign(btnRow.style, {
            display: 'flex',
            gap: '4px',
            flexWrap: 'wrap',
            justifyContent: 'center',
        });

        let activeBtn = null;

        SPEED_OPTIONS.forEach((speed) => {
            const btn = document.createElement('button');
            btn.textContent = speed + 'x';
            Object.assign(btn.style, {
                background: speed === 1 ? '#4CAF50' : '#555',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                padding: '4px 8px',
                cursor: 'pointer',
                fontSize: '12px',
                minWidth: '36px',
                transition: 'background 0.2s',
            });

            if (speed === 1) activeBtn = btn;

            btn.addEventListener('click', () => {
                video.playbackRate = speed;
                if (activeBtn) activeBtn.style.background = '#555';
                btn.style.background = '#4CAF50';
                activeBtn = btn;
            });

            btn.addEventListener('mouseenter', () => {
                if (btn !== activeBtn) btn.style.background = '#777';
            });
            btn.addEventListener('mouseleave', () => {
                if (btn !== activeBtn) btn.style.background = '#555';
            });

            btnRow.appendChild(btn);
        });

        container.appendChild(btnRow);

        // Skip-to-end button
        const skipBtn = document.createElement('button');
        skipBtn.textContent = `⏭ ${text.skipToEnd}`;
        Object.assign(skipBtn.style, {
            background: '#FF5722',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            padding: '6px 10px',
            cursor: 'pointer',
            fontSize: '12px',
            transition: 'background 0.2s',
        });
        skipBtn.addEventListener('click', () => {
            if (Number.isFinite(video.duration) && video.duration > 0) {
                video.currentTime = Math.max(0, video.duration - 5);
            }
            if (video.paused) {
                video.play()?.catch((error) => {
                    console.warn('[Manebi Helper] Could not start video playback', error);
                });
            }
        });
        skipBtn.addEventListener('mouseenter', () => (skipBtn.style.background = '#E64A19'));
        skipBtn.addEventListener('mouseleave', () => (skipBtn.style.background = '#FF5722'));
        container.appendChild(skipBtn);

        document.body.appendChild(container);
        controlledVideo = video;
        speedController = {
            container,
            cleanup: makeDraggable(container),
        };
    }

    // =========================================================================
    // 5. Unlock video controls — remove restrictions on the <video> element
    // =========================================================================
    function unlockVideo(video) {
        if (controlledVideo === video && speedController?.container.isConnected) return;

        // Ensure controls are visible
        video.controls = true;

        createSpeedController(video);

        console.log('[Manebi Helper] Video unlocked ✅');
    }

    function currentLessonLink() {
        const currentId = lessonId();
        if (!currentId) return null;
        return [...document.querySelectorAll('a[href*="/student/courses/"][href*="lessonId="]')]
            .find(
                (link) =>
                    Number(new URL(link.href, location.href).searchParams.get('lessonId')) ===
                    currentId
            );
    }

    function accessibleDocuments() {
        const documents = [document];
        for (let index = 0; index < documents.length; index += 1) {
            documents[index].querySelectorAll('iframe').forEach((frame) => {
                try {
                    const frameDocument = frame.contentDocument;
                    if (frameDocument?.documentElement && !documents.includes(frameDocument)) {
                        documents.push(frameDocument);
                    }
                } catch {
                    // Cross-origin frames cannot be inspected.
                }
            });
        }
        return documents;
    }

    function contentNodes(selector) {
        return accessibleDocuments().flatMap((root) => [...root.querySelectorAll(selector)]);
    }

    function activeVideo() {
        const player = contentNodes('[data-vjs-player], video-js.video-js').find(
            isElementVisible
        );
        const playerVideo = player?.querySelector('video.vjs-tech, video');
        if (playerVideo) return playerVideo;

        const videos = contentNodes('video').filter(isElementVisible);
        return videos.find((video) => !video.paused || video.readyState > 0) || videos[0] || null;
    }

    function currentLessonContent() {
        if (!location.pathname.startsWith('/student/courses/')) {
            return { type: 'none' };
        }

        const link = currentLessonLink();
        if (link?.querySelector('svg[aria-label="PDF"]')) {
            return { type: 'pdf' };
        }

        const video = activeVideo();
        if (link) return video ? { type: 'video', video } : { type: 'none' };
        if (pdfPageButtons().length) return { type: 'pdf' };
        return video ? { type: 'video', video } : { type: 'none' };
    }

    function syncControllers() {
        controllerSyncTimer = null;
        if (typeof document === 'undefined' || !document.documentElement?.isConnected) return;
        try {
            const content = currentLessonContent();

            if (content.type === 'pdf') {
                removeSpeedController();
                createPdfController();
                return;
            }

        if (content.type === 'video') {
            if (pdfRunning) pausePdfAutomation();
                removePdfController();
                unlockVideo(content.video);
                return;
            }

            removeSpeedController();
            if (!pdfRunning) removePdfController();
        } catch (error) {
            console.error('[Manebi Helper] Controller sync failed', error);
        }
    }

    function scheduleControllerSync() {
        if (typeof document === 'undefined' || !document.documentElement?.isConnected) return;
        clearTimeout(controllerSyncTimer);
        controllerSyncTimer = setTimeout(syncControllers, 100);
    }

    // =========================================================================
    // 6. Initialize controls and watch dynamic content
    // =========================================================================
    function init() {
        syncControllers();

        for (const method of ['pushState', 'replaceState']) {
            const original = history[method];
            history[method] = function (...args) {
                const result = original.apply(this, args);
                scheduleControllerSync();
                return result;
            };
        }
        window.addEventListener('popstate', scheduleControllerSync);

        // Re-evaluate the active lesson after SPA content changes.
        const observer = new MutationObserver(scheduleControllerSync);

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });

        clearInterval(controllerPollTimer);
        controllerPollTimer = setInterval(syncControllers, 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    console.log('[Manebi Helper] Script loaded — Visibility API spoofed ✅');
})();
