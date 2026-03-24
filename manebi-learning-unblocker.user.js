// ==UserScript==
// @name         Manebi Learning Unblocker
// @name:en      Manebi Learning Unblocker
// @name:ja      Manebi ラーニング制限解除
// @name:zh-CN   Manebi 学习平台限制解除
// @namespace    https://github.com/CheerChen
// @version      1.0.0
// @description  Removes video playback restrictions on manebi-learning.com: disables background tab detection, enables fast-forward/seeking, and allows playback speed control.
// @description:en  Removes video playback restrictions on manebi-learning.com: disables background tab detection, enables fast-forward/seeking, and allows playback speed control.
// @description:ja  manebi-learning.comの動画再生制限を解除：バックグラウンドタブ検出の無効化、早送り・シークの有効化、再生速度の変更が可能になります。
// @description:zh-CN  解除 manebi-learning.com 的视频播放限制：禁用后台标签页检测、启用快进/拖动进度条、允许调整播放速度。
// @author       anonymous
// @match        *://*.manebi-learning.com/*
// @match        *://manebi-learning.com/*
// @icon         https://www.google.com/s2/favicons?domain=manebi-learning.com
// @grant        none
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

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
    // 3. Speed control & seek unlock — inject after DOM is ready
    // =========================================================================
    const SPEED_OPTIONS = [1, 1.5, 2, 3, 4, 8, 16];

    function createSpeedController(video) {
        // Avoid duplicates
        if (document.getElementById('manebi-speed-ctrl')) return;

        const container = document.createElement('div');
        container.id = 'manebi-speed-ctrl';
        Object.assign(container.style, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
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
        title.textContent = '⚡ Speed Control';
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
        skipBtn.textContent = '⏭ Skip to End';
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
            if (video.duration) {
                video.currentTime = video.duration - 5;
            }
        });
        skipBtn.addEventListener('mouseenter', () => (skipBtn.style.background = '#E64A19'));
        skipBtn.addEventListener('mouseleave', () => (skipBtn.style.background = '#FF5722'));
        container.appendChild(skipBtn);

        // Make draggable
        let isDragging = false;
        let offsetX, offsetY;
        container.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            isDragging = true;
            offsetX = e.clientX - container.getBoundingClientRect().left;
            offsetY = e.clientY - container.getBoundingClientRect().top;
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            container.style.left = e.clientX - offsetX + 'px';
            container.style.top = e.clientY - offsetY + 'px';
            container.style.right = 'auto';
            container.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', () => (isDragging = false));

        document.body.appendChild(container);
    }

    // =========================================================================
    // 4. Unlock video controls — remove restrictions on the <video> element
    // =========================================================================
    function unlockVideo(video) {
        // -----------------------------------------------------------------
        // [DISABLED] Anti-reset protection — uncomment if the site resets
        // your playback speed or seek position back to original values.
        // -----------------------------------------------------------------

        // // Prevent the site from resetting playbackRate
        // const nativeDescriptor = Object.getOwnPropertyDescriptor(
        //     HTMLMediaElement.prototype,
        //     'playbackRate'
        // );
        //
        // if (nativeDescriptor) {
        //     let _rate = video.playbackRate || 1;
        //     Object.defineProperty(video, 'playbackRate', {
        //         get() {
        //             return _rate;
        //         },
        //         set(val) {
        //             _rate = val;
        //             nativeDescriptor.set.call(this, val);
        //         },
        //         configurable: true,
        //     });
        // }

        // // Prevent the site from resetting currentTime
        // const timeDescriptor = Object.getOwnPropertyDescriptor(
        //     HTMLMediaElement.prototype,
        //     'currentTime'
        // );
        //
        // if (timeDescriptor) {
        //     const originalSet = timeDescriptor.set;
        //     let lastUserSet = 0;
        //
        //     Object.defineProperty(video, 'currentTime', {
        //         get() {
        //             return timeDescriptor.get.call(this);
        //         },
        //         set(val) {
        //             const now = Date.now();
        //             const current = timeDescriptor.get.call(this);
        //
        //             if (now - lastUserSet < 500 && val < current - 2) {
        //                 return;
        //             }
        //             lastUserSet = now;
        //             originalSet.call(this, val);
        //         },
        //         configurable: true,
        //     });
        // }

        // Ensure controls are visible
        video.controls = true;

        createSpeedController(video);

        console.log('[Manebi Unblocker] Video unlocked ✅');
    }

    // =========================================================================
    // 5. Watch for dynamically loaded videos
    // =========================================================================
    function init() {
        // Handle existing videos
        document.querySelectorAll('video').forEach(unlockVideo);

        // Watch for new videos added dynamically
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeName === 'VIDEO') {
                        unlockVideo(node);
                    }
                    if (node.querySelectorAll) {
                        node.querySelectorAll('video').forEach(unlockVideo);
                    }
                }
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    console.log('[Manebi Unblocker] Script loaded — Visibility API spoofed ✅');
})();