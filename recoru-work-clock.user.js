// ==UserScript==
// @name         RecoRu Work Clock
// @name:en      RecoRu Work Clock
// @name:ja      RecoRu 稼働時計
// @name:zh-CN   RecoRu 工时时钟
// @namespace    https://github.com/CheerChen
// @version      1.0.0
// @description  Show scheduled end time, working/labor time, and an analog clock on RecoRu. Auto-select workplace when accessed from office IPs.
// @description:en Show scheduled end time, working/labor time, and an analog clock on RecoRu. Auto-select workplace when accessed from office IPs.
// @description:ja RecoRu に所定退勤時刻・稼働時間・労働時間とアナログ時計を表示。オフィス IP からアクセス時は勤務地を自動選択します。
// @description:zh-CN 在 RecoRu 页面显示所定退勤时间、稼働时间、劳动时间与模拟时钟；从办公室 IP 访问时自动选择办公地点。
// @author       cheerchen37
// @match        https://app.recoru.in/ap/home/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      checkip.amazonaws.com
// @icon         https://www.google.com/s2/favicons?domain=app.recoru.in
// @run-at       document-idle
// @license      MIT
// @homepage     https://github.com/CheerChen/userscripts
// @supportURL   https://github.com/CheerChen/userscripts/issues
// @updateURL    https://raw.githubusercontent.com/CheerChen/userscripts/master/recoru-work-clock.user.js
// ==/UserScript==

(function () {
    'use strict';

    // --------------------------------------------------------------------------------
    // ClockModule: canvas drawing with HiDPI support (ported from src/clock.js)
    // --------------------------------------------------------------------------------
    const ClockModule = (function () {
        // Prepares the canvas with the correct DPI settings for HiDPI displays.
        // Returns the clock radius.
        function prepareCanvasDpi(canvas, context) {
            const dpr = window.devicePixelRatio;
            const rect = canvas.getBoundingClientRect();

            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            context.scale(dpr, dpr);

            canvas.style.width = `${rect.width}px`;
            canvas.style.height = `${rect.height}px`;

            const minSide = Math.min(rect.width, rect.height);
            const padding = 30;
            const radius = minSide / 2 - padding;
            const midX = rect.width / 2;
            const midY = rect.height / 2;
            context.translate(midX, midY);
            return radius;
        }

        // Draws the clock. excludeBreak toggles the 1-hour break visualization after 6 hours.
        function drawClock(context, radius, start_time, end_time, now = new Date(), excludeBreak = true) {
            drawFace(context, radius);

            const diff = now.getTime() - end_time.getTime();

            // Gray pie for total scheduled office time (9 hours including break).
            const sixHourMarkGray = new Date(start_time.getTime() + 6 * 60 * 60 * 1000);
            const sevenHourMarkGray = new Date(start_time.getTime() + 7 * 60 * 60 * 1000);
            drawWorkingTimePie(context, radius, 4, start_time, sixHourMarkGray, '#aaa');
            drawWorkingTimePie(context, radius, 4, sixHourMarkGray, sevenHourMarkGray, '#ccc');
            drawWorkingTimePie(context, radius, 4, sevenHourMarkGray, end_time, '#aaa');

            if (!excludeBreak) {
                if (diff < 0) {
                    drawWorkingTimePie(context, radius, 8, start_time, now, '#2a2');
                } else {
                    drawWorkingTimePie(context, radius, 8, start_time, end_time, '#2a2');
                    drawWorkingTimePie(context, radius, 8, end_time, now, 'orange');
                }
            } else {
                const elapsed = now.getTime() - start_time.getTime();
                const sixHours = 6 * 60 * 60 * 1000;
                const sevenHours = 7 * 60 * 60 * 1000;
                const nineHours = 9 * 60 * 60 * 1000;

                if (elapsed <= sixHours) {
                    drawWorkingTimePie(context, radius, 8, start_time, now, '#2a2');
                } else if (elapsed <= sevenHours) {
                    const sixHourMark = new Date(start_time.getTime() + sixHours);
                    drawWorkingTimePie(context, radius, 8, start_time, sixHourMark, '#2a2');
                    drawWorkingTimePie(context, radius, 8, sixHourMark, now, '#87CEEB');
                } else if (elapsed <= nineHours) {
                    const sixHourMark = new Date(start_time.getTime() + sixHours);
                    drawWorkingTimePie(context, radius, 8, start_time, sixHourMark, '#2a2');
                    const sevenHourMark = new Date(start_time.getTime() + sevenHours);
                    drawWorkingTimePie(context, radius, 8, sixHourMark, sevenHourMark, '#87CEEB');
                    drawWorkingTimePie(context, radius, 8, sevenHourMark, now, '#2a2');
                } else {
                    const sixHourMark = new Date(start_time.getTime() + sixHours);
                    drawWorkingTimePie(context, radius, 8, start_time, sixHourMark, '#2a2');
                    const sevenHourMark = new Date(start_time.getTime() + sevenHours);
                    drawWorkingTimePie(context, radius, 8, sixHourMark, sevenHourMark, '#87CEEB');
                    const nineHourMark = new Date(start_time.getTime() + nineHours);
                    drawWorkingTimePie(context, radius, 8, sevenHourMark, nineHourMark, '#2a2');

                    // Late-night overtime (after 22:00) shown in a distinct color.
                    const lateNightStart = new Date(now);
                    lateNightStart.setHours(22, 0, 0, 0);

                    if (now.getTime() <= lateNightStart.getTime()) {
                        drawWorkingTimePie(context, radius, 8, nineHourMark, now, 'orange');
                    } else if (nineHourMark.getTime() >= lateNightStart.getTime()) {
                        drawWorkingTimePie(context, radius, 8, nineHourMark, now, '#CC3366');
                    } else {
                        drawWorkingTimePie(context, radius, 8, nineHourMark, lateNightStart, 'orange');
                        drawWorkingTimePie(context, radius, 8, lateNightStart, now, '#CC3366');
                    }
                }
            }

            drawNumbers(context, radius);
            drawTime(context, radius, now);
        }

        function drawFace(ctx, radius) {
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, 2 * Math.PI);
            ctx.fillStyle = 'white';
            ctx.fill();
            ctx.lineWidth = 8;
            ctx.strokeStyle = '#333';
            ctx.stroke();
        }

        function drawNumbers(ctx, radius) {
            ctx.font = `${radius * 0.15}px Arial`;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#333';
            for (let num = 1; num <= 12; num++) {
                const angle = (num * Math.PI) / 6 - Math.PI / 2;
                const x = radius * 0.85 * Math.cos(angle);
                const y = radius * 0.85 * Math.sin(angle);
                ctx.fillText(num.toString(), x, y);
            }
        }

        function drawWorkingTimePie(ctx, radius, distance, startTime, endTime, fillStyle) {
            const rad = radius - distance;
            const zeroPoint = -Math.PI / 2;
            const lengthPerHour = Math.PI / 6;

            const startPoint = (startTime.getHours() + startTime.getMinutes() / 60) * lengthPerHour + zeroPoint;
            const endPoint = (endTime.getHours() + endTime.getMinutes() / 60) * lengthPerHour + zeroPoint;

            ctx.lineWidth = 1;
            ctx.fillStyle = fillStyle;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(rad * Math.cos(startPoint), rad * Math.sin(startPoint));
            ctx.arc(0, 0, rad, startPoint, endPoint);
            ctx.lineTo(0, 0);
            ctx.fill();
        }

        function drawTime(ctx, radius, now = new Date()) {
            drawCenterDot(ctx, radius);

            const hour = now.getHours() % 12;
            const minute = now.getMinutes();
            const second = now.getSeconds();

            const hourAngle = ((hour + minute / 60) * Math.PI) / 6;
            drawHand(ctx, hourAngle, radius * 0.5, 8);

            const minuteAngle = ((minute + second / 60) * Math.PI) / 30;
            drawHand(ctx, minuteAngle, radius * 0.8, 6);

            const secondAngle = (second * Math.PI) / 30;
            drawHand(ctx, secondAngle, radius * 0.9, 2, 'red');
        }

        function drawCenterDot(ctx, radius, color = '#333') {
            ctx.beginPath();
            ctx.arc(0, 0, radius * 0.1, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
        }

        function drawHand(ctx, pos, length, width, color = '#333') {
            ctx.beginPath();
            ctx.lineWidth = width;
            ctx.lineCap = 'round';
            ctx.strokeStyle = color;
            ctx.moveTo(0, 0);
            ctx.rotate(pos);
            ctx.lineTo(0, -length);
            ctx.stroke();
            ctx.rotate(-pos);
        }

        return {
            drawClock: drawClock,
            prepareCanvasDpi: prepareCanvasDpi,
        };
    })();

    // --------------------------------------------------------------------------------
    // Content logic (ported from src/content.js)
    // --------------------------------------------------------------------------------

    // Storage key for user-configured office IP list (kept out of source so the
    // published script carries no company-internal information).
    const OFFICE_IPS_KEY = 'recoruWorkClock.officeIps';

    // Returns the user's configured office IP list, or [] if unset.
    function getOfficeIps() {
        const ips = GM_getValue(OFFICE_IPS_KEY, []);
        return Array.isArray(ips) ? ips : [];
    }

    // Check current IP address via GM_xmlhttpRequest (cross-origin) and set
    // workplace to オフィス if the IP is in the user-configured office list.
    function checkIPAndSetWorkplace() {
        const officeIps = getOfficeIps();
        if (officeIps.length === 0) {
            // No office IPs configured — skip the lookup entirely.
            return;
        }

        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://checkip.amazonaws.com',
            onload: function (response) {
                const currentIP = (response.responseText || '').trim();
                if (currentIP && officeIps.includes(currentIP)) {
                    setWorkplaceToOffice();
                }
            },
            onerror: function (error) {
                console.error('RecoRu Work Clock: failed to check IP address:', error);
            },
        });
    }

    function setWorkplaceToOffice() {
        const workPlaceSelect = document.getElementById('workPlaceId');
        if (workPlaceSelect) {
            // Find the option with value "1" (オフィス) and select it
            const officeOption = workPlaceSelect.querySelector('option[value="1"]');
            if (officeOption) {
                workPlaceSelect.value = '1';
                console.log('RecoRu Work Clock: workplace automatically set to オフィス based on office IP');
            }
        }
    }

    function refreshTime(div, start_time, context, radius) {
        const end_time = new Date(start_time.getTime() + 9 * 60 * 60 * 1000);

        const now = new Date();
        const elapsed = now.getTime() - start_time.getTime();

        const elapsed_hour = Math.floor(elapsed / (60 * 60 * 1000));
        const elapsed_min = Math.floor((elapsed % (60 * 60 * 1000)) / (60 * 1000));
        const elapsed_time = formatTime(elapsed_hour, elapsed_min);
        // 労働時間: assumes a 1-hour break after 6 hours of work (legal minimum).
        const labor_time = formatLaborTime(elapsed_hour, elapsed_min);
        const diff_time = calculateDiffTime(now, end_time);
        const end_time_str = formatTime(end_time.getHours(), end_time.getMinutes());

        updateDivContent(div, end_time_str, elapsed_time, labor_time, diff_time, now, end_time);
        ClockModule.drawClock(context, radius, start_time, end_time, now, true);
    }

    function formatTime(hours, minutes) {
        return ("0" + hours).slice(-2) + ":" + ("0" + minutes).slice(-2);
    }

    // 労働時間の表示
    // 「毎日1時間の休憩」と仮定する, UI表示上、始業から6時間経過したら1時間休憩
    function formatLaborTime(elapsed_hour, elapsed_min) {
        let labor_hour = elapsed_hour < 6 ? elapsed_hour : (elapsed_hour - 1);
        return formatTime(labor_hour, elapsed_min);
    }

    function calculateDiffTime(now, end_time) {
        const diff = now.getTime() - end_time.getTime();
        const diff_hour = Math.floor(Math.abs(diff) / (60 * 60 * 1000));
        const diff_min = Math.floor((Math.abs(diff) % (60 * 60 * 1000)) / (60 * 1000));
        const sign = diff < 0 ? "-" : "+";
        return sign + formatTime(diff_hour, diff_min);
    }

    function updateDivContent(div, end_time_str, elapsed_time, labor_time, diff_time, now, end_time) {
        const childIdx = 1;
        div.childNodes[childIdx + 0].textContent = "所定退勤：" + end_time_str;
        div.childNodes[childIdx + 1].textContent = "稼働時間：+" + elapsed_time;
        div.childNodes[childIdx + 2].textContent = "労働時間：+" + labor_time;
        div.childNodes[childIdx + 3].textContent = "過不足：" + diff_time;

        const isOvertime = now.getTime() > end_time.getTime();
        div.childNodes[childIdx + 2].style.color = isOvertime ? "#97D077" : "red";
        div.childNodes[childIdx + 3].style.color = isOvertime ? "#FFB570" : "red";
    }

    function createDivElement() {
        const div = document.createElement('div');
        div.style.display = 'block';
        div.classList.add('h-gadget', 'h-punchGadget');
        div.appendChild(createHeader());

        for (let i = 0; i < 4; i++) {
            const p = document.createElement('div');
            p.style.fontSize = '14px';
            div.appendChild(p);
        }

        const canvas = document.createElement('canvas');
        canvas.width = 250;
        canvas.height = 250;
        div.appendChild(canvas);

        return div;
    }

    function modifyPage() {
        const div = createDivElement();
        const pgNode = document.getElementById('PG');
        pgNode.parentNode.insertBefore(div, pgNode.nextSibling);

        const canvas = div.querySelector('canvas');
        const context = canvas.getContext('2d');
        const radius = ClockModule.prepareCanvasDpi(canvas, context);
        let start_time = tryRetrieveStartTime();

        // Check IP and set workplace if user hasn't clocked in yet
        if (!start_time) {
            checkIPAndSetWorkplace();
        }

        if (start_time) {
            refreshTime(div, start_time, context, radius);
        }

        setInterval(() => {
            if (!start_time) {
                start_time = tryRetrieveStartTime();
            }
            if (start_time) {
                refreshTime(div, start_time, context, radius);
            }
        }, 1000);
    }

    // 始業時間を取得する
    function tryRetrieveStartTime() {
        const startTimeLabel = document.querySelector('#PunchGadgetForm > table > tbody > tr:nth-child(1) > td:nth-child(1) > label');
        if (startTimeLabel) {
            const str_start_time = startTimeLabel.textContent.trim();
            if (str_start_time) {
                const start_time = new Date();
                const [hours, minutes] = str_start_time.split(':').map(Number);
                start_time.setHours(hours);
                start_time.setMinutes(minutes);
                return start_time;
            }
        }

        return null;
    }

    function createHeader() {
        const header = document.createElement('div');
        header.classList.add('h-gadget-header', 'h-punchGadget-header');
        const headerTitle = document.createElement('label');
        headerTitle.textContent = '稼働情報';
        header.appendChild(headerTitle);
        // Right-aligned action button: office-IP config only.
        const actions = document.createElement('label');
        actions.style = "float:right; margin-right: 5px; margin-top: -2px;";
        actions.appendChild(createConfigButton());
        header.appendChild(actions);
        return header;
    }

    function createConfigButton() {
        const iconButton = document.createElement('a');
        iconButton.href = "#";
        iconButton.title = "オフィス IP を設定";
        iconButton.classList.add('link', 'icon-f16', 'icon-settings-white');
        iconButton.onclick = (e) => {
            e.preventDefault();
            openOfficeIpConfigDialog();
        };
        return iconButton;
    }

    // --------------------------------------------------------------------------------
    // Office-IP configuration dialog (pure DOM, no dependencies).
    // --------------------------------------------------------------------------------
    function openOfficeIpConfigDialog() {
        // Guard against duplicate overlays.
        const existing = document.getElementById('recoruWorkClockConfigOverlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'recoruWorkClockConfigOverlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:sans-serif;';

        const dialog = document.createElement('div');
        dialog.style.cssText = 'background:#fff;padding:20px;border-radius:8px;width:420px;max-width:90vw;box-shadow:0 4px 20px rgba(0,0,0,0.2);';

        const title = document.createElement('h3');
        title.textContent = 'オフィス IP 一覧';
        title.style.cssText = 'margin:0 0 8px 0;font-size:16px;';

        const hint = document.createElement('p');
        hint.textContent = '1 行に 1 件ずつ入力してください。これらの IP からアクセスした場合、勤務地が自動で「オフィス」に設定されます。空欄の場合はこの機能は無効になります。';
        hint.style.cssText = 'margin:0 0 12px 0;font-size:12px;color:#666;line-height:1.4;';

        const textarea = document.createElement('textarea');
        textarea.value = getOfficeIps().join('\n');
        textarea.placeholder = '203.0.113.10\n203.0.113.11\n...';
        textarea.style.cssText = 'width:100%;height:180px;box-sizing:border-box;font-family:monospace;font-size:13px;padding:8px;border:1px solid #ccc;border-radius:4px;margin-bottom:12px;';

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'キャンセル';
        cancelBtn.style.cssText = 'padding:6px 14px;border:1px solid #ccc;background:#f5f5f5;border-radius:4px;cursor:pointer;';

        const saveBtn = document.createElement('button');
        saveBtn.textContent = '保存';
        saveBtn.style.cssText = 'padding:6px 14px;border:none;background:#2a2;color:#fff;border-radius:4px;cursor:pointer;';

        cancelBtn.onclick = () => overlay.remove();
        saveBtn.onclick = () => {
            const ips = textarea.value
                .split('\n')
                .map(s => s.trim())
                .filter(Boolean);
            GM_setValue(OFFICE_IPS_KEY, ips);
            overlay.remove();
        };

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(saveBtn);
        dialog.appendChild(title);
        dialog.appendChild(hint);
        dialog.appendChild(textarea);
        dialog.appendChild(btnRow);
        overlay.appendChild(dialog);

        // Click on backdrop closes the dialog.
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

        document.body.appendChild(overlay);
        textarea.focus();
    }

    // --------------------------------------------------------------------------------
    // Init: wait for RecoRu's #PG node to be populated, then inject.
    // Replaces the original window.onload hook with a ready-state-aware observer
    // so it also works under userscript @run-at document-idle.
    // --------------------------------------------------------------------------------
    function startObserver() {
        const observer = new MutationObserver((mutations, obs) => {
            const pgNode = document.getElementById('PG');
            if (pgNode && pgNode.childElementCount > 0) {
                obs.disconnect();
                modifyPage();
            }
        });

        // Fast path: #PG already populated when the script runs.
        const pgNode = document.getElementById('PG');
        if (pgNode && pgNode.childElementCount > 0) {
            modifyPage();
            return;
        }

        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.body) {
        startObserver();
    } else {
        document.addEventListener('DOMContentLoaded', startObserver, { once: true });
    }
})();
