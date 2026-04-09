// Initialize Firebase (Using the same config as existing project if possible, or placeholder)
// NOTE: I will attempt to read the config from script.js or use the one I found in view_file previously.
// Based on previous file: databaseURL: "https://fir-60db1.firebaseio.com/"

var config = {
    databaseURL: "https://fir-60db1.firebaseio.com/"
};

if (!firebase.apps.length) {
    firebase.initializeApp(config);
}
const db = firebase.database();

// State
let players = {};
let courts = {};
let queue = [];
let selectedPlayers = new Set(); // IDs of selected players
let isSelecting = false;
let selectionStart = { x: 0, y: 0 };
let timers = {}; // Stores interval IDs for courts

const AVATAR_POOL = [
    'avatars/cat_1.png', 'avatars/cat_2.png', 'avatars/cat_3.png', 'avatars/cat_4.png',
    'avatars/cat_5.png', 'avatars/cat_6.png', 'avatars/cat_7.png', 'avatars/cat_8.png',
    'avatars/cat_9.png', 'avatars/cat_10.png', 'avatars/cat_11.png', 'avatars/cat_12.png',
    'avatars/cat_13.png', 'avatars/cat_14.png', 'avatars/cat_15.png', 'avatars/cat_16.png',
    'avatars/cat_17.png'
];

// --- Image Processing & Validation ---
async function processImage(file) {
    return new Promise((resolve, reject) => {
        if (file.size > 2 * 1024 * 1024) {
            reject("檔案太大囉！請選擇小於 2MB 的圖片。");
            return;
        }

        const reader = new FileReader();
        reader.onload = function (e) {
            const dataUrl = e.target.result;

            // If GIF, don't resize to keep animation
            if (file.type === "image/gif") {
                resolve(dataUrl);
                return;
            }

            // For JPG/PNG, resize to 200x200
            const img = new Image();
            img.onload = function () {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const size = 200;
                canvas.width = size;
                canvas.height = size;

                // Square Crop & Resize
                const minDim = Math.min(img.width, img.height);
                const sx = (img.width - minDim) / 2;
                const sy = (img.height - minDim) / 2;

                ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
                resolve(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.src = dataUrl;
        };
        reader.onerror = () => reject("讀取圖片失敗");
        reader.readAsDataURL(file);
    });
}

// DOM Elements
const $courtsContainer = $('#courtsContainer');
const $playerPool = $('#playerPool');
const $queueContainer = $('#queueContainer');
const $selectionBox = $('#selectionBox');

// --- Global Lock System ---
const myClientId = (function () {
    let id = localStorage.getItem('chat_client_id');
    if (!id) {
        id = 'c_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('chat_client_id', id);
    }
    return id;
})();
let lockTimeout = null;

function initLockSystem() {
    // Prevent any click or touch from dismissing or bypassing the lock screen
    $('#systemLockOverlay').on('click mousedown mouseup touchstart', (e) => {
        e.stopImmediatePropagation();
        e.preventDefault();
        return false;
    });

    // Monitor Lock
    db.ref('lineup/lock').on('value', snap => {
        const val = snap.val();
        // Check if locked by someone else
        // Also check timeout logic if client side wants to ignore stale locks? 
        // Firebase timestamp is server side. We can verify age if we wanted strictness.
        // For now simple ID check.
        if (val && val.clientId !== myClientId) {
            $('#systemLockOverlay').removeClass('hidden');
        } else {
            $('#systemLockOverlay').addClass('hidden');
        }
    });
}

function acquireLock() {
    const ref = db.ref('lineup/lock');
    // Ensure lock is cleared if I disconnect
    ref.onDisconnect().remove();

    ref.set({
        clientId: myClientId,
        timestamp: firebase.database.ServerValue.TIMESTAMP
    });

    // Auto release after 10s to prevent stuck
    if (lockTimeout) clearTimeout(lockTimeout);
    lockTimeout = setTimeout(() => {
        releaseLock();
    }, 10000);
}

function releaseLock() {
    // Only release if we (might) hold it?
    // We just try to clear it. Conflict resolution low priority for small groups.
    const ref = db.ref('lineup/lock');
    ref.remove();
    ref.onDisconnect().cancel();
    if (lockTimeout) clearTimeout(lockTimeout);
}

function initPresenceSystem() {
    // 1. Monitor connection state
    const connectedRef = db.ref('.info/connected');
    const presenceRef = db.ref('lineup/presence/' + myClientId);

    connectedRef.on('value', (snap) => {
        if (snap.val() === true) {
            // We're connected (or reconnected)!

            // Remove on disconnect (ensure clean state)
            presenceRef.onDisconnect().remove();

            // Set presence
            presenceRef.set({
                lastSeen: firebase.database.ServerValue.TIMESTAMP,
                clientId: myClientId
            });
        }
    });

    // 2. Count online users
    db.ref('lineup/presence').on('value', snap => {
        // Filter out stale entries if needed, but for now just count
        const val = snap.val() || {};
        const count = Object.keys(val).length;
        $('#onlineCount').text(`🟢 ${count} 人在線`);
        $('#drawerOnlineCount .count').text(count);
    });
}

// --- Name Helper: Get weighted length class ---
function getNameLenClass(name) {
    if (!name) return '';
    let weight = 0;
    let hasFullWidth = false;
    for (let char of name) {
        const isFullWidth = !!char.match(/[^\x00-\xff]/);
        if (isFullWidth) hasFullWidth = true;
        weight += isFullWidth ? 2 : 1;
    }

    // 中文較大，上限 6 字 (12分)，但視覺寬度不需縮到極限
    if (hasFullWidth) {
        if (weight > 8) return 'long-name'; // 5-6 個中文字
        return '';
    }

    // 純英文/數字，上限 12 字 (12分)，需採取階梯縮放防止切邊
    if (weight > 10) return 'extra-long-name'; // 11-12 字
    if (weight > 8) return 'long-name';       // 9-10 字
    return '';
}

$(function () {
    initListeners();
    initSelectionLogic();
    initDragAndDrop();
    initLockSystem();
    initPresenceSystem();
    initNameLengthValidators();

    requestNotificationPermission();

    // Fix Scoreboard Toggle Immediate Update
    $('#scoreModeToggle').change(function () {
        const isChecked = $(this).is(':checked');
        $('.scoreboard').toggle(isChecked);
    });

    // Help Modal
    $(document).on('click', '#helpBtn', function () {
        $('#helpModal').removeClass('hidden');
    });
    $(document).on('click', '#closeHelpBtn', function () {
        $('#helpModal').addClass('hidden');
    });

    // Smart Pick Events
    $('.form-toggle-btn').click(function () {
        $(this).toggleClass('active');
    });

    $('#smartPickBtn').click(function () {
        acquireLock();
        trySmartPick();
        // The trySmartPick itself might be async or have its own flow, 
        // but generally we release after the action or if it fails.
        // For simplicity, we release after a short delay or within the function if it has a callback.
        setTimeout(releaseLock, 2000);
    });

    // Search Filter
    $('#searchPlayer').on('input', function () {
        renderPlayerPool();
    });

    // --- Theme Toggle LocalStorage (Default: Pinkish/Light) ---
    const currentTheme = localStorage.getItem('theme') || 'light';
    if (currentTheme === 'dark') {
        $('body').addClass('light-mode'); // We keep the class name but use Dark colors in CSS
        $('#themeToggleBtn i, #themeToggleBtnMobile i').removeClass('fa-moon').addClass('fa-sun');
        $('#themeToggleBtnMobile span').text('切換淺色');
    } else {
        // Default (Pinkish)
        $('#themeToggleBtn i, #themeToggleBtnMobile i').removeClass('fa-sun').addClass('fa-moon');
        $('#themeToggleBtnMobile span').text('切換深色');
    }

    $('#themeToggleBtn, #themeToggleBtnMobile').click(function () {
        $('body').toggleClass('light-mode');
        const isDark = $('body').hasClass('light-mode');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');

        const $icons = $('#themeToggleBtn i, #themeToggleBtnMobile i');
        const $text = $('#themeToggleBtnMobile span');

        if (isDark) {
            $icons.removeClass('fa-moon').addClass('fa-sun');
            $text.text('切換淺色');
        } else {
            $icons.removeClass('fa-sun').addClass('fa-moon');
            $text.text('切換深色');
        }
    });

    // --- Mobile Drawer Logic ---
    $('#mobileMenuBtn').click(function () {
        $('#mobileDrawer').addClass('open');
        $('#drawerOverlay').removeClass('hidden');
    });

    $('#closeDrawerBtn, #drawerOverlay').click(function () {
        $('#mobileDrawer').removeClass('open');
        $('#drawerOverlay').addClass('hidden');
    });

    // Sync Toggles between Drawer and Main Header
    $('#autoModeToggleMobile').change(function () {
        $('#autoModeToggle').prop('checked', $(this).is(':checked')).trigger('change');
    });
    $('#autoModeToggle').change(function () {
        $('#autoModeToggleMobile').prop('checked', $(this).is(':checked'));
    });

    $('#scoreModeToggleMobile').change(function () {
        $('#scoreModeToggle').prop('checked', $(this).is(':checked')).trigger('change');
    });
    $('#scoreModeToggle').on('change', function () {
        $('#scoreModeToggleMobile').prop('checked', $(this).is(':checked'));
    });

    // Drawer Buttons mapping to original buttons
    $('#qrBtnMobile').click(() => { $('#qrBtn').click(); $('#closeDrawerBtn').click(); });
    $('#leaderboardBtnMobile').click(() => { $('#leaderboardBtn').click(); $('#closeDrawerBtn').click(); });
    $('#helpBtnMobile').click(() => { $('#helpBtn').click(); $('#closeDrawerBtn').click(); });
    $('#resetBtnMobile').click(() => { $('#resetBtn').click(); $('#closeDrawerBtn').click(); });

    // --- Mobile Click-to-Start match logic for Queue ---
    $queueContainer.on('click', '.group-card', function (e) {
        if (window.innerWidth > 1200) return; // Desktop still uses drag-and-drop
        if (e.target.closest('.group-remove')) return; // Ignore if user clicked the delete button

        const idx = $(this).data('gid');
        const group = queue[idx];
        if (!group) return;

        // Find first empty court
        const emptyCourtId = Object.keys(courts).find(cid => {
            const c = courts[cid];
            return !c.players || c.players.length === 0;
        });

        if (emptyCourtId) {
            const courtName = courts[emptyCourtId].name || emptyCourtId;
            acquireLock(); // Lock immediately when starting the flow
            window.showConfirm("準備開賽", `確定要在「場地 ${courtName}」進行下場比賽嗎？`, () => {
                // Assign group to court
                db.ref('lineup/courts/' + emptyCourtId + '/players').set(group.members);

                // Update player status to fighting
                let updates = {};
                group.members.forEach(pid => updates[pid + '/status'] = 'fighting');
                db.ref('lineup/players').update(updates);

                // Remove from queue (keep status)
                const groupSig = [...group.members].sort().join(',');
                window.removeFromQueue(idx, groupSig, true);

                // Start timer
                window.startTimer(emptyCourtId);
                releaseLock(); // Release after success
            }, () => {
                releaseLock(); // Release if canceled
            });
        } else {
            window.showAlert("場地全滿", "目前所有場地皆在比賽中，請稍候。");
        }
    });

    // --- Avatar Preview Listeners ---
    $('#newPlayerPhoto').change(async function (e) {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const processedData = await processImage(file);
            $('#newPlayerPreview').attr('src', processedData).removeClass('hidden');
            $('#newPlayerPlaceholder').addClass('hidden');
            window.tempNewAvatar = processedData;
        } catch (err) {
            window.showAlert("上傳失敗", err);
            $(this).val('');
        }
    });

    $('#editPlayerPhoto').change(async function (e) {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const processedData = await processImage(file);
            $('#editPlayerPreview').attr('src', processedData).removeClass('hidden');
            $('#editPlayerPlaceholder').addClass('hidden');
            window.tempEditAvatar = processedData;
        } catch (err) {
            window.showAlert("上傳失敗", err);
            $(this).val('');
        }
    });

    $('#removePhotoBtn').click(function () {
        window.tempEditAvatar = null;
        $('#editPlayerPreview').attr('src', '').addClass('hidden');
        $('#editPlayerPlaceholder').removeClass('hidden');
        $('#editPlayerPhoto').val('');
    });
});

// --- Firebase Listeners ---

function initListeners() {
    // 1. Players
    db.ref('lineup/players').on('value', snapshot => {
        const rawVal = snapshot.val() || {};

        // 1. 強力修復：偵測是否被 Firebase 誤判為陣列或包含 null 值
        let needsRepair = false;
        let cleanPlayers = {};

        // 如果是陣列，代表 Firebase 把 0, 1, 2... 當成 Index 了，且中間可能有 null
        if (Array.isArray(rawVal)) {
            needsRepair = true;
            rawVal.forEach((val, idx) => {
                if (val && typeof val === 'object') {
                    cleanPlayers[idx] = val;
                }
            });
        } else {
            // 如果是物件，檢查內容是否有損毀 (null) 或缺失關鍵欄位 (name)
            Object.keys(rawVal).forEach(key => {
                const p = rawVal[key];
                if (p === null || p === undefined || !p.name) {
                    needsRepair = true;
                } else {
                    cleanPlayers[key] = p;
                }
            });
        }

        // 2. 靜默修復：若發現壞資料，強制覆寫資料庫為乾淨的物件結構
        if (needsRepair) {
            console.warn("[System] 偵測到 Firebase 數據結構異常，正在自動修復...");
            // 使用 set 而非 update，確保徹底蓋掉原本的「陣列結構」
            db.ref('lineup/players').set(cleanPlayers).then(() => {
                const msg = `偵測到資料庫結構不穩定，系統已自動修復，並優化了讀取效能。✨`;
                if (window.showAlert) window.showAlert("數據庫自動維護", msg);
            });
        }

        // 3. 更新全域變數
        players = cleanPlayers;
        const count = Object.keys(players).length;
        $('#totalPlayerCount').text(count);
        renderPlayerPool();
    });

    // 2. Courts
    db.ref('lineup/courts').on('value', snapshot => {
        courts = snapshot.val() || {};
        renderCourts();
    });

    // 3. Queue
    db.ref('lineup/queue').on('value', snapshot => {
        const rawQueue = snapshot.val() || {};
        const cleanQueue = [];
        let hasInvalidGroups = false;

        // 遍歷所有組別進行健康檢查
        Object.keys(rawQueue).forEach(key => {
            const group = rawQueue[key];
            if (!group || !group.members) {
                db.ref(`lineup/queue/${key}`).remove();
                hasInvalidGroups = true;
                return;
            }

            // 檢查組員是否都正確存在於目前的 players 名單中且具備姓名
            const allMembersValid = group.members.every(pid => players[pid] && players[pid].name);

            if (!allMembersValid) {
                console.warn(`[System] 偵測到列隊組別 ${key} 包含無效球員，正在自動將其餘成員狀態重設並解散...`);

                // 補救措施：確保組內其餘正常的球員恢復為 'idle'
                group.members.forEach(mId => {
                    if (players[mId]) {
                        db.ref(`lineup/players/${mId}/status`).set('idle');
                    }
                });

                db.ref(`lineup/queue/${key}`).remove();
                hasInvalidGroups = true;
            } else {
                cleanQueue.push(group);
            }
        });

        // 只有在資料完全正確的情況下才更新前端狀態
        queue = cleanQueue;
        renderQueue();
    });
}

// --- Render Functions ---

function renderPlayerPool() {
    // Save scroll positions to prevent jumping
    const poolScrollTop = $playerPool.scrollTop();

    // Prevent layout collapse by fixing height temporarily
    // This is critical if the player pool dictates page height on mobile
    const currentHeight = $playerPool.height();
    if (currentHeight > 100) {
        $playerPool.css('min-height', currentHeight + 'px');
    }

    $playerPool.empty();
    const filterText = ($('#searchPlayer').val() || '').toLowerCase();

    const containerWidth = $playerPool[0].offsetWidth || $playerPool.width() || 300;

    let occupiedPositions = []; // Track occupancy to prevent overlap
    Object.keys(players).forEach(pid => {
        const p = players[pid];
        if (p && p.name && p.name.toLowerCase().includes(filterText)) {
            const isSelected = selectedPlayers.has(pid);

            if (p.status !== 'idle' && p.status !== undefined) {
                return; // Skip non-idle players
            }

            // Assign position if not set (Grid Layout)
            // Responsive spacing to match Chip Size
            // Mobile Chip: ~64px -> Spacing 80x90
            // Desktop Chip: ~80-100px -> Spacing 95x105 (Very tight for 5 columns)
            const isDesktop = window.innerWidth > 768;
            const itemWidth = isDesktop ? 95 : 80;
            const itemHeight = isDesktop ? 105 : 90;

            const availableCols = Math.floor(Math.max(containerWidth, isDesktop ? 320 : 300) / itemWidth);
            const cols = Math.max(isDesktop ? 2 : 3, availableCols);

            let left = p.x;
            let top = p.y;
            let needsUpdate = false;

            // 1. Initial Bounds Check
            if (left === undefined || top === undefined) {
                left = null;
                top = null;
                needsUpdate = true;
            } else if (left > containerWidth) { // 只處理極端越界，不強制回歸格線，而是貼標
                left = containerWidth - itemWidth;
                needsUpdate = true;
            }

            // 2. Collision Resolution
            if (left === null || top === null) {
                let foundSlot = false;
                let slotIdx = 0;

                while (!foundSlot) {
                    const c = slotIdx % cols;
                    const r = Math.floor(slotIdx / cols);
                    const testX = 10 + (c * itemWidth);
                    const testY = 10 + (r * itemHeight);

                    let candidateCollides = false;
                    for (let pos of occupiedPositions) {
                        const dx = Math.abs(pos.x - testX);
                        const dy = Math.abs(pos.y - testY);
                        // Strict check responsive to size
                        if (dx < (itemWidth - 5) && dy < (itemHeight - 5)) {
                            candidateCollides = true;
                            break;
                        }
                    }

                    if (!candidateCollides) {
                        left = testX;
                        top = testY;
                        foundSlot = true;
                        needsUpdate = true;
                    }
                    slotIdx++;
                    // Increased search limit as requested (10x10 -> 100+ slots)
                    if (slotIdx > 1000) break;
                }
            }

            // Track this position
            if (left !== null && top !== null) {
                occupiedPositions.push({ x: left, y: top });
            }

            // Update DB if moved
            if (needsUpdate) {
                // Avoid tiny jitter updates
                if (Math.abs(p.x - left) > 1 || Math.abs(p.y - top) > 1) {
                    db.ref('lineup/players/' + pid).update({ x: left, y: top });
                }
            }

            const avatarHtml = p.avatarUrl
                ? `<img src="${p.avatarUrl}" class="avatar-img">`
                : `<i class="fas fa-user"></i>`;

            const playCount = p.playCount || 0;

            const isMobile = window.innerWidth <= 768;

            const html = `
                <div class="player-chip ${p.gender} ${isSelected ? 'selected' : ''}" 
                     id="player-${pid}" data-id="${pid}" draggable="${!isMobile}"
                     style="left: ${left}px; top: ${top}px; position: absolute;">
                    <div class="play-count-badge" title="上場次數">${playCount}</div>
                    <div class="player-level" title="程度">${p.level}</div>
                    <div class="player-avatar">
                        ${avatarHtml}
                    </div>
                    <div class="player-name ${getNameLenClass(p.name)}">${escapeHtml(p.name)}</div>
                </div>
    `;
            $playerPool.append(html);
        }
    });

    // 4. Force Container Height for Absolute Layout (Mobile Only)
    // On Desktop, CSS height:100% + overflow:auto handles it.
    // On Mobile, we generally want full expansion (unless restricted).

    let maxBottom = 0;

    occupiedPositions.forEach(pos => {
        const bottom = pos.y + 100;
        if (bottom > maxBottom) maxBottom = bottom;
    });

    if (window.innerWidth <= 768) {
        $playerPool.css('height', 'auto');
        $playerPool.css('min-height', Math.max(maxBottom + 120, 300) + 'px');
    } else {
        // Desktop: Reset inline height to allow CSS (100% or flex) to take over
        $playerPool.css('height', '');
        $playerPool.css('min-height', '');
    }

    // Restore positions
    if (poolScrollTop > 0) $playerPool.scrollTop(poolScrollTop);

    // --- 同步貓砂盆化身選擇器 ---
    updateChatIdentitySelect();
}

function updateChatIdentitySelect() {
    const currentPid = localStorage.getItem('chat_pid') || 'anonymous';
    const $trigger = $('#chatIdentityTrigger');
    const $popup = $('#identityPopup');

    if (!$trigger.length || !$popup.length) return;

    // 1. 更新觸發器 UI
    let triggerName = "匿名貓";
    let triggerAvatar = "👻";

    if (currentPid !== 'anonymous' && players[currentPid]) {
        const p = players[currentPid];
        triggerName = p.name;
        triggerAvatar = p.avatarUrl
            ? `<div class="trigger-avatar" style="background-image: url('${p.avatarUrl}')"></div>`
            : `<div class="trigger-avatar">🐱</div>`;
    } else {
        triggerAvatar = `<div class="trigger-avatar">👻</div>`;
    }

    $('#triggerAvatar').html(triggerAvatar);
    $('#triggerName').text(triggerName);

    // 2. 生成彈窗清單
    // 如果彈窗目前是空的，或者它目前處於關閉狀態且需要定期更新，我們就重新渲染
    const isPopupEmpty = $popup.is(':empty');
    if (isPopupEmpty || !$trigger.hasClass('open')) {
        let html = `
            <div class="id-card ${currentPid === 'anonymous' ? 'active' : ''}" data-pid="anonymous">
                <div class="id-card-avatar">👻</div>
                <div class="id-card-name">匿名貓 (預設)</div>
            </div>
        `;

        Object.keys(players).forEach(pid => {
            const p = players[pid];
            if (p && p.name) {
                const isActive = (pid === currentPid);
                const genderIcon = p.gender === 'male' ? '♂️' : (p.gender === 'female' ? '♀️' : '🐱');
                const avatar = p.avatarUrl
                    ? `<div class="id-card-avatar" style="background-image: url('${p.avatarUrl}')"></div>`
                    : `<div class="id-card-avatar">🐱</div>`;

                html += `
                    <div class="id-card ${isActive ? 'active' : ''}" data-pid="${pid}">
                        ${avatar}
                        <div class="id-card-name">${p.name}</div>
                        <div class="id-card-gender">${genderIcon}</div>
                    </div>
                `;
            }
        });
        $popup.html(html);
    }
}

function renderCourts() {
    $courtsContainer.empty();
    Object.keys(courts).forEach(cid => {
        const c = courts[cid];
        // Players on court
        // This part needs complex logic to render players in specific slots
        // For scaffold, just buttons

        // Calculate Time
        let timeDisplay = "00:00";
        // Logic for timer... (Implementation later)

        const html = `
            <div class="court-card ${(c.players && c.players.length > 0) ? 'active' : ''}" id="court-${cid}" data-id="${cid}">
                <div class="court-header" style="justify-content: space-between;">
                    <span class="court-title">場地 ${c.name}</span>
                    <span class="court-timer" id="timer-${cid}" style="flex:1; text-align:center;">${timeDisplay}</span>
                    <button class="group-remove" style="position:static; margin-left:10px;" onclick="removeCourt('${cid}')">×</button>
                </div>
                <div class="court-body drop-zone" data-type="court" data-court-id="${cid}">
                    <div class="court-visual">
                        <div class="court-side team-a-side"></div>
                        <div class="scoreboard" style="${$('#scoreModeToggle').is(':checked') ? '' : 'display:none'}">
                            <div class="score-team left">
                                <div class="score-minus" onclick="event.stopPropagation(); updateScore('${cid}', 'A', -1, event)" title="扣 1 分"><i class="fas fa-minus"></i></div>
                                <div class="score" onclick="updateScore('${cid}', 'A', 1, event)">${c.scoreA || 0}</div>
                            </div>
                            <span class="score-divider">:</span>
                            <div class="score-team right">
                                <div class="score" onclick="updateScore('${cid}', 'B', 1, event)">${c.scoreB || 0}</div>
                                <div class="score-minus" onclick="event.stopPropagation(); updateScore('${cid}', 'B', -1, event)" title="扣 1 分"><i class="fas fa-minus"></i></div>
                            </div>
                        </div>
                        <div class="court-net"></div>
                        <div class="court-side team-b-side"></div>
                    </div>
                </div>
                <div class="court-actions">
                    <button class="btn btn-silver btn-sm" onclick="endGame('${cid}')" style="flex: 1;">結束</button>
                    <button class="speech-btn" onclick="event.stopPropagation(); speakMatch('${cid}')" title="語音叫號">
                        <i class="fas fa-bullhorn"></i>
                    </button>
                    ${!c.startTime ?
                `<button class="btn btn-silver btn-sm" onclick="startTimer('${cid}')" style="flex: 1;">開始</button>` :
                `<button class="btn btn-silver btn-sm" onclick="resetTimer('${cid}')" style="flex: 1;">停止</button>`
            }
                </div>
            </div>
        `;
        const $el = $(html);
        $courtsContainer.append($el);

        // Render Players on Court
        if (c.players) {
            c.players.forEach((pid, idx) => {
                if (!pid) return;
                const p = players[pid];
                if (!p) return;

                const avatarHtml = p.avatarUrl
                    ? `<img src="${p.avatarUrl}" class="avatar-img">`
                    : `<i class="fas fa-user"></i>`;
                const chip = `
                    <div class="player-chip active-chip ${p.gender}" style="margin: 0 5px; display:flex; flex-direction:column; align-items:center;">
                        <div class="player-avatar">${avatarHtml}</div>
                        <div class="player-name ${getNameLenClass(p.name)}">${escapeHtml(p.name)}</div>
                    </div>
                `;
                // Position logic (Manual visual placement needed)
                // For now just append to sides
                const targetSide = idx < 2 ? '.team-a-side' : '.team-b-side';
                $el.find(targetSide).append(chip);
            });
        }
    });

    // Update Status Legend Dynamic Display
    const totalCourts = Object.keys(courts).length;
    const activeMatchCount = Object.values(courts).filter(c => c.players && c.players.length > 0).length;
    const $legend = $('#matchStatusLegend');

    if (totalCourts > 0 && activeMatchCount === totalCourts) {
        $legend.css('color', '#f38989ff'); // Red for Full
        $legend.find('i').css('color', '#f38989ff').addClass('pulse-ripple');
        $legend.find('span').text('場地全滿');
    } else if (activeMatchCount > 0) {
        $legend.css('color', '#55AE71');
        $legend.find('i').css('color', '#55AE71').addClass('pulse-ripple');
        $legend.find('span').text(`${activeMatchCount} 場比賽中`);
    } else {
        $legend.css('color', 'var(--text-muted)');
        $legend.find('i').css('color', '#ccc').removeClass('pulse-ripple');
        $legend.find('span').text('目前暫無比賽');
    }

    // Add "New Court" button at the end if needed, or just let header button do it
    updateTimers();
}

function updateTimers() {
    Object.keys(courts).forEach(cid => {
        const c = courts[cid];
        if (c.startTime) {
            const now = Date.now();
            let elapsed = Math.floor((now - c.startTime) / 1000);
            if (elapsed < 0) elapsed = 0; // Prevent negative time
            const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
            const s = (elapsed % 60).toString().padStart(2, '0');
            $(`#timer-${cid}`).text(`${m}:${s}`).css('color', '#FFD700');
        } else {
            $(`#timer-${cid}`).text('00:00').css('color', '#aaa');
        }
    });

    // --- Anti-Bench-Warming Routine ---
    const now = Date.now();
    $('.player-chip').each(function () {
        const pid = $(this).data('id');
        const p = players[pid];
        if (p && p.lastPlayTime && p.status === 'idle') {
            const waitMins = Math.floor((now - p.lastPlayTime) / 60000);

            if (waitMins >= 30) {
                if (!$(this).hasClass('freezing-bench')) {
                    $(this).removeClass('cold-bench').addClass('freezing-bench');
                    $(this).find('.bench-badge').remove();
                    $(this).find('.player-avatar').append(`<div class="bench-badge freezing" title="已重度結冰等待 ${waitMins} 分鐘"><i class="fas fa-snowflake" style="color: #4169E1; font-size: 14px;"></i></div>`);
                } else {
                    $(this).find('.bench-badge').attr('title', `已重度結冰等待 ${waitMins} 分鐘`);
                }
            } else if (waitMins >= 15) {
                if (!$(this).hasClass('cold-bench')) {
                    $(this).removeClass('freezing-bench').addClass('cold-bench');
                    $(this).find('.bench-badge').remove();
                    $(this).find('.player-avatar').append(`<div class="bench-badge cold" title="已結露等待 ${waitMins} 分鐘"><i class="fas fa-snowflake" style="color: #87ceeb; font-size: 12px;"></i></div>`);
                } else {
                    $(this).find('.bench-badge').attr('title', `已結露等待 ${waitMins} 分鐘`);
                }
            } else {
                $(this).removeClass('cold-bench freezing-bench');
                $(this).find('.bench-badge').remove();
            }
        }
    });
}

// Global Timer Interval
setInterval(updateTimers, 1000);

function renderQueue() {
    // Update count
    $('#queueCount').text(queue ? queue.length : 0);

    $queueContainer.empty();
    if (!queue || queue.length === 0) {
        $queueContainer.html(`
            <div class="empty-state-visual">
                <div class="geometric-cat-wrapper">
                    <div class="geometric-cat">
                        <div class="cat-ears"></div>
                        <div class="cat-body">
                            <div class="cat-eyes">
                                <span class="eye-l"></span>
                                <span class="eye-r"></span>
                            </div>
                        </div>
                        <div class="cat-tail-spiral">
                            <div class="cat-tail-inner"></div>
                        </div>
                    </div>
                </div>
                <p>目前暫無等待組別<br><span style="font-size:0.8rem; font-weight:normal; opacity:0.6;">大家都在場上奮戰中，快去熱身吧！🏸</span></p>
            </div>
        `);
        return;
    }

    queue.forEach((group, idx) => {
        const isMobile = window.innerWidth <= 768;
        const groupSig = [...group.members].sort().join(',');
        const teamA = group.members.slice(0, 2);
        const teamB = group.members.slice(2, 4);

        const groupHtml = `
            <div class="group-card" data-gid="${idx}" draggable="${!isMobile}">
                <div style="width:100%; display:flex; justify-content:space-between; align-items:center;">
                    <div class="group-title" style="font-size:0.75rem; font-weight:800; color:#aaa; text-transform:uppercase; letter-spacing:1px;">Group ${idx + 1}</div>
                    <div class="group-remove" style="position:static;" onclick="event.stopPropagation(); removeFromQueue(${idx}, '${groupSig}')">×</div>
                </div>
                <div class="group-members">
                    <div class="team-side team-a">
                        ${teamA.map(pid => renderPlayerChipHtml(pid)).join('')}
                    </div>
                    
                    <div class="group-vs-divider">
                        <span>VS</span>
                    </div>

                    <div class="team-side team-b">
                        ${teamB.map(pid => renderPlayerChipHtml(pid)).join('')}
                    </div>
                </div>
            </div>
        `;
        $queueContainer.append(groupHtml);
    });
}

/**
 * Helper to render a player chip simplified for the queue/court
 */
function renderPlayerChipHtml(pid) {
    const p = players[pid];
    if (!p) return '';

    // 防禦性渲染：確保姓名不會是 undefined
    const name = p.name || "未知球員";
    const avatarHtml = p.avatarUrl
        ? `<img src="${p.avatarUrl}" class="avatar-img">`
        : `<i class="fas fa-paw" style="opacity: 0.5;"></i>`; // 使用爪印作為預設頭像更契合主題

    return `
        <div class="player-chip active-chip ${p.gender || 'unknown'}" style="position:relative;">
            <div class="player-avatar">${avatarHtml}</div>
            <div class="player-name ${getNameLenClass(name)}">${escapeHtml(name)}</div>
        </div>
    `;
}

// --- Interaction Logic ---

// Selection Box
function initSelectionLogic() {
    $playerPool.on('mousedown', function (e) {
        acquireLock();
        if (e.target.closest('.player-chip')) return; // Allow clicking chips directly

        isSelecting = true;
        selectionStart = { x: e.pageX, y: e.pageY };
        $selectionBox.css({
            left: e.pageX,
            top: e.pageY,
            width: 0,
            height: 0
        }).removeClass('hidden');

        // Clear previous if no shift key (Standard behavior)
        if (!e.shiftKey) {
            selectedPlayers.clear();
            $('.player-chip').removeClass('selected');
        }
    });

    $(document).on('mousemove', function (e) {
        if (!isSelecting) return;

        const currentX = e.pageX;
        const currentY = e.pageY;

        const width = Math.abs(currentX - selectionStart.x);
        const height = Math.abs(currentY - selectionStart.y);
        const left = Math.min(currentX, selectionStart.x);
        const top = Math.min(currentY, selectionStart.y);

        $selectionBox.css({ left, top, width, height });

        // Highlight logic
        $('.player-chip').each(function () {
            const $el = $(this);
            const offset = $el.offset();
            const elW = $el.outerWidth();
            const elH = $el.outerHeight();

            // Intersection Check
            if (left < offset.left + elW && left + width > offset.left &&
                top < offset.top + elH && top + height > offset.top) {

                $el.addClass('selected');
                selectedPlayers.add($el.data('id'));
            } else {
                // If logic to deselect when moving out box? (Standard marquee usually just adds)
                // We'll keep it simple: Add to selection
            }
        });
    });

    $(document).on('mouseup', function () {
        releaseLock(); // Ensure lock is released 
        if (isSelecting) {
            isSelecting = false;
            $selectionBox.addClass('hidden');

            // Auto queue creation if dragging to queue? 
            // Or just leave them selected for dragging?
            // User requirement: "可手動用框取名子且最多四個人 ，形成待排隊名單"
            // So after selecting, they are highlighted. Then user DRAGS them?
            // "形成待排隊名單" implies maybe a button or drag action.
            // Let's assume Drag.

            if (selectedPlayers.size > 4) {
                window.showAlert("人數過多", "最多只能選 4 人一組！", "warning");
                // Trim selection
                const arr = Array.from(selectedPlayers).slice(0, 4);
                selectedPlayers = new Set(arr);
                renderPlayerPool(); // Re-render to fix classes
            }
            updateQuickAddButton();
        }
    });

    // Toggle selection on click
    $playerPool.on('click', '.player-chip', function (e) {
        e.stopPropagation();
        const pid = $(this).data('id'); // Ensure type match
        if (selectedPlayers.has(pid)) {
            selectedPlayers.delete(pid);
            $(this).removeClass('selected');
        } else {
            if (selectedPlayers.size >= 4) {
                window.showAlert("組隊上限", "一組最多只能選 4 人喔！", "warning");
                return;
            }
            selectedPlayers.add(pid);
            $(this).addClass('selected');
        }
        updateQuickAddButton();
    });

    // Quick Add Button Logic
    $('#quickAddBtn').click(function () {
        if (selectedPlayers.size === 0) return;

        const pids = Array.from(selectedPlayers);

        // Create Group in Queue
        const newGroup = { members: pids };
        const newQ = [...queue, newGroup];
        db.ref('lineup/queue').set(newQ);

        // Update Status
        let updates = {};
        pids.forEach(pid => updates[pid + '/status'] = 'queued');
        db.ref('lineup/players').update(updates);

        // Reset Selection
        selectedPlayers.clear();
        renderPlayerPool();
        updateQuickAddButton();

        // Scroll to top to show user
        // $('html, body').animate({ scrollTop: 0 }, 500); 
    });
}

function updateQuickAddButton() {
    if (selectedPlayers.size > 0) {
        $('#quickAddBtn').removeClass('hidden');
        $('#quickAddBtn').html(`<i class="fas fa-plus"></i> 加入列隊 (${selectedPlayers.size})`);
    } else {
        $('#quickAddBtn').addClass('hidden');
    }
}

function initDragAndDrop() {
    // This is complex with multiple items. 
    // We can simulate it by: When dragging ANY selected item, we drag ALL selected items.

    // Simplified jQuery UI Draggable would be easier, but let's try HTML5
    // HTML5 DnD is tricky for "Multiselect".
    // Strategy: On dragstart, set dataTransfer to a JSON of all selected IDs.

    // NOTE: Since chips are dynamic, delegation needed?
    // HTML5 drag events bubble.

    document.addEventListener('dragstart', function (e) {
        if (window.innerWidth <= 768) return; // Block dragging on mobile
        const target = e.target.closest('.player-chip');
        const groupTarget = e.target.closest('.group-card');

        if (target || groupTarget) acquireLock(); // Lock if dragging game elements

        if (target) {
            // Player Chip Drag
            const pid = target.dataset.id;

            // If dragging an unselected item, add it to selection (Don't clear others, easier for mobile)
            if (!selectedPlayers.has(pid)) {
                if (selectedPlayers.size >= 4) {
                    selectedPlayers.clear();
                    $('.player-chip').removeClass('selected');
                }

                selectedPlayers.add(pid);
                $(target).addClass('selected');
                updateQuickAddButton(); // Ensure button updates
            }

            // Calculate offsets for drag visual
            const rect = target.getBoundingClientRect();
            const offsetX = e.clientX - rect.left;
            const offsetY = e.clientY - rect.top;

            const payload = {
                type: 'players',
                ids: Array.from(selectedPlayers),
                offsetX: offsetX,
                offsetY: offsetY
            };
            e.dataTransfer.setData('text/plain', JSON.stringify(payload));
        } else if (groupTarget) {
            // Group Drag
            const gid = groupTarget.dataset.gid;
            const payload = {
                type: 'group',
                gid: gid
            };
            e.dataTransfer.setData('text/plain', JSON.stringify(payload));
        }
    });

    document.addEventListener('dragend', function () {
        releaseLock();
    });

    // Event Delegation for Drag & Drop (Global)
    // Since courts are dynamic, we can't bind to them once at startup.
    // We bind to document and check the valid drop zone.

    const dragEvents = ['dragover', 'dragleave', 'drop'];

    dragEvents.forEach(evtName => {
        document.addEventListener(evtName, function (e) {
            let zone = e.target.closest('.drop-zone');

            // 如果掉在 FAB 按鈕上，視為掉在 pool 區塊
            if (!zone && e.target.closest('.fab-btn')) {
                zone = document.querySelector('.players-panel.drop-zone') || document.getElementById('playerPool');
            }

            if (!zone) return;

            if (evtName === 'dragover') {
                e.preventDefault();
                zone.classList.add('drag-over');
            } else if (evtName === 'dragleave') {
                zone.classList.remove('drag-over');
            } else if (evtName === 'drop') {
                e.preventDefault();
                zone.classList.remove('drag-over');

                const dataRaw = e.dataTransfer.getData('text/plain');
                if (!dataRaw) return;

                const data = JSON.parse(dataRaw);
                handleDrop(data, zone, e.target, { clientX: e.clientX, clientY: e.clientY });
            }
        });
    });


    // Initialize Touch Drag for Mobile (Only if not already blocked)
    if (window.innerWidth > 768) {
        initTouchDrag();
    }
}
/*
    // Drop Zones (Legacy - Removed for Delegation)
    const zones = document.querySelectorAll('.drop-zone');
    zones.forEach(zone => {
         // ...
    });
*/

function handleDrop(data, zone, targetElement, clientPos) {
    if (!zone) return;
    const zoneType = zone.dataset.type; // 'queue', 'pool', 'court'

    if (data.type === 'players') {
        const pids = data.ids;

        if (zoneType === 'pool') {
            // Repositioning in pool
            // Calculate new position based on mouse drop
            // Note: 'drop' event clientX is global. Need relative to pool container.
            // Only works well for SINGLE drag or group drag moving together

            // Since we might have multiple, we can move the "primary" one to the mouse, 
            // and shift others by same delta? Or just scatter them around mouse?
            // "Scatter at mouse" is easiest and usually fine.

            const rect = $playerPool[0].getBoundingClientRect();
            // Use provided clientPos or fallback to global event if missing (for safety)
            const cx = clientPos ? clientPos.clientX : (event.clientX || event.originalEvent.clientX);
            const cy = clientPos ? clientPos.clientY : (event.clientY || event.originalEvent.clientY);

            let baseX = cx - rect.left - (data.offsetX || 30);
            let baseY = cy - rect.top - (data.offsetY || 30);

            // Boundary checks using offsetWidth to include padding and avoid aggressive left-clamping
            const w = $playerPool[0].offsetWidth;
            const h = $playerPool[0].offsetHeight;

            let updates = {};
            pids.forEach((pid, idx) => {
                // If multiple, stack them slightly
                let x = baseX + (idx * 5);
                let y = baseY + (idx * 5);

                // Clamp less aggressively (allow touching right padding)
                x = Math.max(0, Math.min(x, w - 70));
                y = Math.max(0, Math.min(y, h - 70));

                updates[pid + '/x'] = x;
                updates[pid + '/y'] = y;
                updates[pid + '/status'] = 'idle'; // Ensure idle if dropped in pool
            });
            db.ref('lineup/players').update(updates);


            // render handled by listener

        } else if (zoneType === 'queue') {
            // Check if dropped onto a specific group card to merge
            const targetGroupCard = targetElement ? targetElement.closest('.group-card') : null;

            if (targetGroupCard) {
                // Add to existing group
                const index = parseInt(targetGroupCard.dataset.gid);
                const targetGroup = queue[index];

                if (targetGroup) {
                    // Check limit
                    if (targetGroup.members.length + pids.length > 4) {
                        window.showAlert("人數限制", "該組人數已滿，最多只能 4 人一組。", "warning");
                        return;
                    }

                    // Merge
                    // Avoid duplicates (though drag logic shouldn't allow dragging already queued)
                    const newMembers = [...new Set([...targetGroup.members, ...pids])];

                    db.ref('lineup/queue/' + index + '/members').set(newMembers);

                    // Update statuses
                    let updates = {};
                    pids.forEach(pid => updates[pid + '/status'] = 'queued');
                    db.ref('lineup/players').update(updates);

                    selectedPlayers.clear();
                    renderPlayerPool();
                    return;
                }
            }

            // Create a NEW group in queue (Default behavior)
            const newGroup = { members: pids };
            // Push to valid firebase path
            const newQ = [...queue, newGroup];
            db.ref('lineup/queue').set(newQ);

            // Update player status
            let updates = {};
            pids.forEach(pid => updates[pid + '/status'] = 'queued');
            db.ref('lineup/players').update(updates);

            // Clear selection
            selectedPlayers.clear();
            renderPlayerPool();

        } else if (zoneType === 'court') {
            const courtId = zone.dataset.courtId;
            // Add to court logic
            // Check occupancy
            const court = courts[courtId];
            if (court.players && court.players.length + pids.length > 4) {
                window.showAlert("場地限制", "場地人數過多，請先結束目前比賽或減少組員。", "error");
                return;
            }

            // Add players
            const existing = court.players || [];
            const newArr = existing.concat(pids);

            db.ref('lineup/courts/' + courtId + '/players').set(newArr);
            // Update status
            let updates = {};
            pids.forEach(pid => updates[pid + '/status'] = 'fighting');
            db.ref('lineup/players').update(updates);
            startTimer(courtId);

            selectedPlayers.clear();
        }
    } else if (data.type === 'group') {
        // Dragging a WHOLE group from queue
        if (zoneType === 'court') {
            const courtId = zone.dataset.courtId;
            const group = queue[data.gid];

            // Move group to court
            // 1. Check if court has existing players -> Reset them to idle
            const currentCourt = courts[courtId];
            if (currentCourt && currentCourt.players && currentCourt.players.length > 0) {
                let oldUpdates = {};
                currentCourt.players.forEach(pid => oldUpdates[pid + '/status'] = 'idle');
                db.ref('lineup/players').update(oldUpdates);
            }

            // 2. Set new players
            db.ref('lineup/courts/' + courtId + '/players').set(group.members);
            // Update status
            let updates = {};
            group.members.forEach(pid => updates[pid + '/status'] = 'fighting');
            db.ref('lineup/players').update(updates);

            // Remove from queue (keepStatus = true)
            // Fix: Pass null for signature (2nd arg) so strict check doesn't fail
            removeFromQueue(parseInt(data.gid), null, true);

            // Auto-start Timer
            startTimer(courtId);
        }
    }
}

// --- Management ---

$('#addCourtBtn').click(() => {
    const newRef = db.ref('lineup/courts').push();
    newRef.set({
        name: Object.keys(courts).length + 1,
        status: 'active',
        players: [],
        scoreA: 0,
        scoreB: 0
    });
});


$('#addPlayerBtn').click(() => {
    // Reset Modal
    $('#newPlayerName').val('');
    $('#newPlayerBirthday').val('');
    $('#newPlayerPhoto').val('');
    $('#newPlayerPreview').addClass('hidden');
    $('#newPlayerPlaceholder').removeClass('hidden');
    window.tempNewAvatar = null;
    $('#modalOverlay').removeClass('hidden');
});

$('#cancelModalBtn').click(() => {
    $('#modalOverlay').addClass('hidden');
});
$('#confirmAddPlayerBtn').click(() => {
    const name = $('#newPlayerName').val();
    const gender = $('#newPlayerGender').val();
    const level = $('#newPlayerLevel').val();
    const birthday = $('#newPlayerBirthday').val();

    if (!name || !birthday) {
        window.showAlert("資料不全", "姓名與生日均為必填項目喔！", "warning");
        return;
    }

    if (birthday.length !== 4 || isNaN(birthday)) {
        window.showAlert("格式錯誤", "生日請輸入 4 位碼，例如 0520", "warning");
        return;
    }

    if (name) {
        const rid = getRegistryId(name, birthday);

        // 1. 先去 Registry 抓抓看有沒有老朋友資料
        db.ref('lineup/registry/' + rid).once('value', snap => {
            const regData = snap.val();
            let assignedAvatar = window.tempNewAvatar;

            // 如果沒上傳新照片，但 Registry 有舊照片，就用舊的
            if (!assignedAvatar && regData && regData.avatarUrl) {
                assignedAvatar = regData.avatarUrl;
            }

            // 如果兩者都沒有，才去抓貓咪池
            if (!assignedAvatar) {
                const usedAvatars = Object.values(players).map(p => p.avatarUrl).filter(url => url && url.startsWith('avatars/'));
                const availableAvatars = AVATAR_POOL.filter(url => !usedAvatars.includes(url));
                if (availableAvatars.length > 0) {
                    assignedAvatar = availableAvatars[Math.floor(Math.random() * availableAvatars.length)];
                } else {
                    assignedAvatar = AVATAR_POOL[Math.floor(Math.random() * AVATAR_POOL.length)];
                }
            }

            const playerData = {
                name,
                birthday,
                gender,
                level: parseInt(level),
                avatarUrl: assignedAvatar,
                status: 'idle',
                playCount: 0,
                wins: 0,
                losses: 0,
                lastPlayTime: firebase.database.ServerValue.TIMESTAMP,
                created_at: firebase.database.ServerValue.TIMESTAMP
            };

            // 寫入今日名單
            db.ref('lineup/players').push(playerData);

            // 同步回 Registry (確保 registry 中也有這一筆，或更新最新資料)
            syncToRegistry(playerData);

            $('#modalOverlay').addClass('hidden');
        });
    }
});

// Edit Player Logic
// Edit Player Logic
// Double Click for Desktop
$playerPool.on('dblclick', '.player-chip', function (e) {
    if (isSelecting) return;
    e.stopPropagation();
    openEditModal($(this).data('id'));
});

// Custom Double Tap for Mobile (Better than standard dblclick on touch devices)
let lastTap = 0;
let lastTapId = null;
$playerPool.on('touchend', '.player-chip', function (e) {
    // 如果正在「選取中」，絕對禁用法！
    if (isSelecting || selectedPlayers.size > 0) return;

    const currentTime = new Date().getTime();
    const currentPid = $(this).data('id');
    const tapLength = currentTime - lastTap;

    // 定義適合各端的閾值 (手機 350ms / 電腦或模擬器 500ms)
    const threshold = (e.type === 'touchend' || 'ontouchstart' in window) ? 350 : 500;

    if (tapLength < threshold && tapLength > 0 && lastTapId === currentPid) {
        e.preventDefault();
        e.stopPropagation();
        openEditModal(currentPid);

        // 觸發後重設，避免「三連點」誤觸
        lastTap = 0;
        lastTapId = null;
    } else {
        lastTap = currentTime;
        lastTapId = currentPid;
    }
});

function openEditModal(pid) {
    // 加強防呆：選人中絕對不准跳窗
    if (isSelecting || (typeof selectedPlayers !== 'undefined' && selectedPlayers.size > 0)) {
        console.log("Blocking Modal: We are in selection mode.");
        return;
    }

    const p = players[pid];
    if (!p) return;

    $('#editPlayerId').val(pid);
    $('#editPlayerName').val(p.name);
    $('#editPlayerBirthday').val(p.birthday || '');

    // Calculate and Show Zodiac Icon
    if (p.birthday) {
        const zInfo = getZodiacInfo(p.birthday);
        if (zInfo) {
            $('#editPlayerZodiacIcon').text(zInfo.emoji).css({
                'background': zInfo.color + '22',
                'color': zInfo.color
            });
            $('#editPlayerZodiacName').text(zInfo.name).css('color', zInfo.color);
        } else {
            $('#editPlayerZodiacIcon').text('❓').css({ 'background': '#eee', 'color': '#999' });
            $('#editPlayerZodiacName').text('無星座資料').css('color', '#999');
        }
    } else {
        $('#editPlayerZodiacIcon').text('❓').css({ 'background': '#eee', 'color': '#999' });
        $('#editPlayerZodiacName').text('未提供生日').css('color', '#999');
    }
    $('#editPlayerGender').val(p.gender);
    $('#editPlayerLevel').val(p.level);

    // Load existing avatar preview
    window.tempEditAvatar = p.avatarUrl;
    if (p.avatarUrl) {
        $('#editPlayerPreview').attr('src', p.avatarUrl).removeClass('hidden');
        $('#editPlayerPlaceholder').addClass('hidden');
    } else {
        $('#editPlayerPreview').addClass('hidden');
        $('#editPlayerPlaceholder').removeClass('hidden');
    }
    $('#editPlayerPhoto').val('');

    $('#editModalOverlay').removeClass('hidden');

    // --- 抓取生涯數據庫 (NEW) ---
    const rid = getRegistryId(p.name, p.birthday);
    if (rid) {
        db.ref('lineup/registry/' + rid).once('value', snap => {
            const reg = snap.val();
            if (reg) {
                $('#careerStatsSection').removeClass('hidden');
                $('#careerWinsText').text(reg.totalWins || 0);
                $('#careerLossesText').text(reg.totalLosses || 0);

                const total = (reg.totalWins || 0) + (reg.totalLosses || 0);
                const rate = total > 0 ? Math.round((reg.totalWins || 0) / total * 100) : 0;
                $('#careerRateText').text(rate + '%');

                if (reg.lastSeen) {
                    const d = new Date(reg.lastSeen);
                    $('#careerJoinDate').text(`${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`);
                } else {
                    $('#careerJoinDate').text('較早前註冊');
                }
            } else {
                $('#careerStatsSection').addClass('hidden');
            }
        });
    } else {
        $('#careerStatsSection').addClass('hidden');
    }
}

$('#cancelEditModalBtn').click(() => {
    $('#editModalOverlay').addClass('hidden');
});

$('#confirmEditPlayerBtn').click(() => {
    const pid = $('#editPlayerId').val();
    const name = $('#editPlayerName').val();
    const birthday = $('#editPlayerBirthday').val();
    const gender = $('#editPlayerGender').val();
    const level = $('#editPlayerLevel').val();

    if (pid && name && birthday) {
        if (birthday.length !== 4 || isNaN(birthday)) {
            window.showAlert("格式錯誤", "生日請輸入 4 位碼，例如 0520", "warning");
            return;
        }

        let updateData = {
            name: name,
            birthday: birthday,
            gender: gender,
            level: parseInt(level)
        };

        // If photo was removed (or never existed), and no new upload, ensure a random cat exists
        if (!window.tempEditAvatar) {
            const usedAvatars = Object.values(players).map(p => p.avatarUrl).filter(url => url && url.startsWith('avatars/'));
            const availableAvatars = AVATAR_POOL.filter(url => !usedAvatars.includes(url));
            let assignedAvatar;
            if (availableAvatars.length > 0) {
                assignedAvatar = availableAvatars[Math.floor(Math.random() * availableAvatars.length)];
            } else {
                assignedAvatar = AVATAR_POOL[Math.floor(Math.random() * AVATAR_POOL.length)];
            }
            updateData.avatarUrl = assignedAvatar;
        } else {
            updateData.avatarUrl = window.tempEditAvatar;
        }

        db.ref('lineup/players/' + pid).update(updateData);

        // 同步回 Registry
        syncToRegistry(updateData);

        $('#editModalOverlay').addClass('hidden');
    }
});

// Custom Confirm Helper (確認/取消)
window.showConfirm = function (title, message, onConfirm, onCancel) {
    $('#alertIcon').addClass('hidden'); // Confirm normally doesn't need huge icon
    $('#confirmTitle').text(title);
    $('#confirmMessage').text(message);
    $('#confirmModalOverlay').removeClass('hidden');
    $('#cancelConfirmBtn').removeClass('hidden');
    $('#doConfirmBtn').text('確定').removeClass('btn-silver').addClass('btn-gold');

    $('#doConfirmBtn').off('click').on('click', function () {
        if (onConfirm) onConfirm();
        $('#confirmModalOverlay').addClass('hidden');
    });

    $('#cancelConfirmBtn').off('click').on('click', function () {
        if (onCancel) onCancel();
        $('#confirmModalOverlay').addClass('hidden');
    });
};

// Custom Alert Helper (只有確定)
window.showAlert = function (title, message, type = 'success') {
    const $icon = $('#alertIcon');

    // Set icon based on type
    $icon.removeClass('hidden alert-warning alert-error alert-success');
    if (type === 'warning') {
        $icon.addClass('alert-warning').html('<i class="fas fa-exclamation-triangle"></i>');
    } else if (type === 'error') {
        $icon.addClass('alert-error').html('<i class="fas fa-times-circle"></i>');
    } else if (type === 'success') {
        $icon.addClass('alert-success').html('<i class="fas fa-check-circle"></i>');
    } else {
        $icon.addClass('hidden');
    }

    $('#confirmTitle').text(title);
    $('#confirmMessage').text(message);
    $('#confirmModalOverlay').removeClass('hidden');
    $('#cancelConfirmBtn').addClass('hidden');
    $('#doConfirmBtn').text('我知道了').removeClass('btn-gold').addClass('btn-silver');

    $('#doConfirmBtn').off('click').on('click', function () {
        $('#confirmModalOverlay').addClass('hidden');
    });
};

$('#deletePlayerBtn').click(() => {
    const pid = $('#editPlayerId').val();
    if (pid) {
        showConfirm('刪除球員', '確定要刪除此球員嗎？操作無法復原。', () => {
            db.ref('lineup/players/' + pid).remove();
            selectedPlayers.delete(pid);
            $('#editModalOverlay').addClass('hidden');
            showAlert('已刪除', '球員已從名單中移除');
        });
    }
});

// Reset Button Logic
$('#resetBtn').click(() => {
    showConfirm('系統重置', '確定要重置所有資料嗎？這將會清空場地、等待列，並重置所有球員的上場次數與狀態！', () => {
        // 1. Reset Courts (Keep courts but clear players/score)
        Object.keys(courts).forEach(cid => {
            db.ref('lineup/courts/' + cid + '/players').set([]);
            db.ref('lineup/courts/' + cid + '/status').set('active');
            db.ref('lineup/courts/' + cid + '/scoreA').set(0);
            db.ref('lineup/courts/' + cid + '/scoreB').set(0);
            db.ref('lineup/courts/' + cid + '/startTime').remove();
        });

        // 2. Clear Queue
        db.ref('lineup/queue').set([]);

        // 3. Reset All Players to Idle and playCount to 0 AND clear partners
        let updates = {};
        Object.keys(players).forEach(pid => {
            updates[pid + '/status'] = 'idle';
            updates[pid + '/playCount'] = 0;
            // 這裡直接將 partners 設為 null 以在 Firebase 中刪除
            updates[pid + '/partners'] = null;
        });
        if (Object.keys(updates).length > 0) {
            db.ref('lineup/players').update(updates);
        }

        // 4. Clear Selection
        selectedPlayers.clear();
        $('.player-chip').removeClass('selected');
    });
});

// --- Registry (Permanent Records) Logic ---
// 根據「姓名 + 生日」生成唯一的 Registry ID
function getRegistryId(name, birthday) {
    if (!name || !birthday) return null;
    return (name + "_" + birthday).replace(/[.#$[\]]/g, ""); // 清理 Firebase 不合規字元
}

// 將今日球員資料同步到永久檔案室
function syncToRegistry(player) {
    const rid = getRegistryId(player.name, player.birthday);
    if (!rid) return;

    const registryRef = db.ref('lineup/registry/' + rid);
    registryRef.update({
        name: player.name,
        birthday: player.birthday,
        gender: player.gender || 'male',
        level: parseInt(player.level) || 5,
        avatarUrl: player.avatarUrl || null,
        lastSeen: firebase.database.ServerValue.TIMESTAMP
    });
}

// 當比賽結束時，額外更新永久檔案室的勝負紀錄
function syncMatchResultToRegistry(pid, isWin) {
    const p = players[pid];
    if (!p) return;
    const rid = getRegistryId(p.name, p.birthday);
    if (!rid) return;

    const ref = db.ref('lineup/registry/' + rid);
    if (isWin) {
        ref.child('totalWins').set(firebase.database.ServerValue.increment(1));
    } else {
        ref.child('totalLosses').set(firebase.database.ServerValue.increment(1));
    }
}

// Global helpers
let isDeletingQueue = false; // Cooldown flag
window.removeFromQueue = function (idx, signature = null, keepStatus = false) {
    if (isDeletingQueue) return; // Block validation if in cooldown
    if (!queue[idx]) return;

    // Safety check: Prevent double-deletion of shifting indices
    // If signature is provided, verify it matches
    if (signature) {
        const currentSig = [...queue[idx].members].sort().join(',');
        if (currentSig !== signature) {
            console.warn("Delete blocked: Group signature mismatch. Likely double-click race condition.");
            return;
        }
    }

    // Set cooldown to prevent "Ghost Click" or "UI Shift" accidental second delete
    isDeletingQueue = true;
    setTimeout(() => { isDeletingQueue = false; }, 500); // 500ms strict cooldown

    // Logic to remove group and set players back to idle
    const group = queue[idx];
    if (group && !keepStatus) {
        let updates = {};
        group.members.forEach(pid => {
            updates[pid + '/status'] = 'idle';
            // Reset position so they flow back to the default grid instead of getting stuck on edges
            updates[pid + '/x'] = null;
            updates[pid + '/y'] = null;
        });
        db.ref('lineup/players').update(updates);
    }

    const newQ = queue.filter((_, i) => i !== idx);
    db.ref('lineup/queue').set(newQ);
};

window.removeCourt = function (id) {
    showConfirm('移除場地', '確定要移除此場地嗎？', () => {
        db.ref('lineup/courts/' + id).remove();
    });
};

window.endGame = function (courtId) {
    const c = courts[courtId];
    if (!c || !c.players || c.players.length === 0) return;

    showConfirm('結束比賽', '確定要結算目前比分並結束這場比賽嗎？', () => {
        let updates = {};
        const pids = c.players;
        const scoreA = c.scoreA || 0;
        const scoreB = c.scoreB || 0;

        let isPractice = (scoreA === scoreB);
        let teamAWins = scoreA > scoreB;
        let teamBWins = scoreB > scoreA;

        pids.forEach((pid, idx) => {
            if (!pid) return;
            updates[pid + '/status'] = 'idle';
            updates[pid + '/lastPlayTime'] = firebase.database.ServerValue.TIMESTAMP;
            updates[pid + '/playCount'] = firebase.database.ServerValue.increment(1);

            if (!isPractice) {
                if ((idx === 0 || idx === 1) && teamAWins) updates[pid + '/wins'] = firebase.database.ServerValue.increment(1);
                if ((idx === 0 || idx === 1) && teamBWins) updates[pid + '/losses'] = firebase.database.ServerValue.increment(1);
                if ((idx === 2 || idx === 3) && teamBWins) updates[pid + '/wins'] = firebase.database.ServerValue.increment(1);
                if ((idx === 2 || idx === 3) && teamAWins) updates[pid + '/losses'] = firebase.database.ServerValue.increment(1);
            }
        });

        // 紀錄搭檔歷史
        if (pids[0] && pids[1]) {
            updates[pids[0] + '/partners/' + pids[1]] = firebase.database.ServerValue.increment(1);
            updates[pids[1] + '/partners/' + pids[0]] = firebase.database.ServerValue.increment(1);
        }
        if (pids[2] && pids[3]) {
            updates[pids[2] + '/partners/' + pids[3]] = firebase.database.ServerValue.increment(1);
            updates[pids[3] + '/partners/' + pids[2]] = firebase.database.ServerValue.increment(1);
        }

        if (Object.keys(updates).length > 0) {
            db.ref('lineup/players').update(updates);
        }

        // 儲存總表對戰歷史紀錄
        if (!isPractice && pids.length >= 2) {
            const historyRef = db.ref('lineup/history').push();
            historyRef.set({
                timestamp: firebase.database.ServerValue.TIMESTAMP,
                courtName: c.name || courtId,
                teamA: [pids[0] || null, pids[1] || null].filter(Boolean),
                teamB: [pids[2] || null, pids[3] || null].filter(Boolean),
                scoreA: scoreA,
                scoreB: scoreB
            });
        }

        // Remove game status or reset timer
        db.ref('lineup/courts/' + courtId + '/startTime').remove();
        db.ref('lineup/courts/' + courtId + '/scoreA').set(0);
        db.ref('lineup/courts/' + courtId + '/scoreB').set(0);

        // Clean court players
        db.ref('lineup/courts/' + courtId + '/players').set([]);
        db.ref('lineup/courts/' + courtId + '/status').set('active');

        // --- 同步至永久檔案室 (Registry) ---
        pids.forEach((pid, idx) => {
            if (!pid) return;
            const p = players[pid];
            if (!p) return;

            // 更新生涯總勝敗數
            if (!isPractice) {
                const isWin = ((idx === 0 || idx === 1) && teamAWins) || ((idx === 2 || idx === 3) && teamBWins);
                syncMatchResultToRegistry(pid, isWin);
            }
            // 每次比賽結束也同步一次基本屬性 (保險起見)
            syncToRegistry(p);
        });

        // Auto Rotation Trigger
        setTimeout(tryAutoRotate, 500);
    });
};

// --- Reset Session (主力重整：清場、解散、場次歸零) ---
function resetSession() {
    showConfirm('重整版面', '您確定要清空目前的所有場地、列隊，並將全體今日場次與勝率歸零嗎？(已報到人員會保留)', () => {
        // 1. 暫停自動化邏輯，避免重整中途被自動補人介入
        const $autoToggle = $('#autoModeToggle');
        const wasAuto = $autoToggle.is(':checked');
        if (wasAuto) $autoToggle.prop('checked', false).trigger('change');

        // 2. 重設所有球員資料庫中的狀態與今日數據
        let playerUpdates = {};
        Object.keys(players).forEach(pid => {
            playerUpdates[pid + '/status'] = 'idle';
            playerUpdates[pid + '/playCount'] = 0;
            playerUpdates[pid + '/wins'] = 0;
            playerUpdates[pid + '/losses'] = 0;
            playerUpdates[pid + '/x'] = null;
            playerUpdates[pid + '/y'] = null;
            playerUpdates[pid + '/partners'] = null; // [新加入] 清空搭檔紀錄，實現徹底重置
        });

        if (Object.keys(playerUpdates).length > 0) {
            db.ref('lineup/players').update(playerUpdates);
        }

        // 3. 清空等待列隊
        db.ref('lineup/queue').remove();

        // 4. 清空所有場地、重設比分與狀態
        db.ref('lineup/courts').once('value', snap => {
            const allCourts = snap.val() || {};
            let courtUpdates = {};
            Object.keys(allCourts).forEach(cid => {
                courtUpdates[cid + '/players'] = [];
                courtUpdates[cid + '/scoreA'] = 0;
                courtUpdates[cid + '/scoreB'] = 0;
                courtUpdates[cid + '/status'] = 'active';
                courtUpdates[cid + '/startTime'] = null;
            });
            db.ref('lineup/courts').update(courtUpdates, (err) => {
                if (!err && wasAuto) {
                    // 重整完成後，若原本有開自動則恢復
                    setTimeout(() => $autoToggle.prop('checked', true).trigger('change'), 500);
                }
            });
        });

        // 4. 清理前端本地狀態
        if (typeof selectedPlayers !== 'undefined') selectedPlayers.clear();
        $('.player-chip').removeClass('active-chip');

        // 5. [新加入] 清空歷史紀錄與貓砂盆留言
        db.ref('lineup/history').remove();
        db.ref('lineup/chat').remove();

        showAlert('重整成功', '全場數據已重設，所有人已回歸待命，聊天室也已清空。', 'success');
    });
}

// --- Refresh Layout (輔助整理：僅重設球員圖標位置) ---
function refreshLayout() {
    let updates = {};
    Object.keys(players).forEach(pid => {
        updates[pid + '/x'] = null;
        updates[pid + '/y'] = null;
    });

    if (Object.keys(updates).length > 0) {
        db.ref('lineup/players').update(updates);
    }

    // 強制重繪前端，讓球員跳回格位
    if (typeof renderPlayerPool === 'function') {
        renderPlayerPool();
    }

    // 側邊小按鈕不跳大視窗，改用 Console 紀錄或輕提示
    console.log("Layout refreshed (coordinates reset)");
}

// 綁定大按鈕 (resetBtn, resetBtnMobile) 執行「主力重整」
$('#resetBtn').off('click').click(resetSession);
$('#resetBtnMobile').off('click').click(resetSession);

// 綁定名單旁小按鈕 (refreshLayoutBtn) 僅執行「輔助整理」
$('#refreshLayoutBtn').off('click').click(refreshLayout);

// Sidebar Collapse Toggle
$('#toggleSidebarBtn').off('click').click(function () {
    $('.players-panel').toggleClass('collapsed');
    // Save preference? (Optional, skipping for simplicity unless requested)
});

// Fix Mobile Long Press being hijacked by Context Menu
window.addEventListener('contextmenu', function (e) {
    if (e.target.closest('.player-chip') || e.target.closest('.group-card')) {
        e.preventDefault();
        return false;
    }
}, { passive: false });

window.updateScore = function (cid, side, delta, event) {
    const c = courts[cid];
    let s = (side === 'A' ? c.scoreA : c.scoreB) || 0;
    if (delta === -999) s = 0;
    else s += delta;
    if (s < 0) s = 0;

    db.ref('lineup/courts/' + cid + '/score' + side).set(s);

    // --- Cat Paw Hit Animation ---
    if (event) {
        const $target = $(event.currentTarget);

        // 1. Score Bounce
        $target.addClass('score-pop');
        setTimeout(() => $target.removeClass('score-pop'), 400);

        // 2. Spawn Paw at Click Position
        const x = event.clientX;
        const y = event.clientY;
        const $paw = $('<div class="paw-hit-effect"><i class="fas fa-paw"></i></div>');
        $paw.css({ left: x + 'px', top: y + 'px' });
        $('body').append($paw);

        // 3. Cleanup Element
        setTimeout(() => $paw.remove(), 600);
    }
};

window.startTimer = function (courtId) {
    db.ref('lineup/courts/' + courtId + '/startTime').set(firebase.database.ServerValue.TIMESTAMP);
    // 觸發自動語音廣播
    setTimeout(() => speakMatch(courtId), 500);
};

window.resetTimer = function (cid) {
    showConfirm('停止計時', '確定要重置並停止此場地的計時器嗎？', () => {
        db.ref('lineup/courts/' + cid + '/startTime').remove();
    });
};

function tryAutoRotate() {
    const isAuto = $('#autoModeToggle').is(':checked');
    if (!isAuto) return;

    // Find empty courts
    const emptyCourts = Object.keys(courts).filter(cid => {
        const c = courts[cid];
        return !c.players || c.players.length === 0;
    });

    if (emptyCourts.length > 0 && queue.length > 0) {
        const targetCourtId = emptyCourts[0];
        const group = queue[0]; // First in queue

        // Move to court
        db.ref('lineup/courts/' + targetCourtId + '/players').set(group.members);

        let updates = {};
        group.members.forEach(pid => updates[pid + '/status'] = 'fighting');
        db.ref('lineup/players').update(updates);

        // Remove from queue (keepStatus = true, players are now fighting)
        // Fix: Pass null for signature so it doesn't fail
        window.removeFromQueue(0, null, true);

        // Auto start timer
        startTimer(targetCourtId);
    }
}

function trySmartPick() {
    // 取得目前啟用的陣型開關
    const allowMD = $('#toggleMD').hasClass('active');
    const allowWD = $('#toggleWD').hasClass('active');
    const allowXD = $('#toggleXD').hasClass('active');

    // 若全都沒開，預設視為全部允許
    const allowAll = (!allowMD && !allowWD && !allowXD);

    // 取出所有閒置球員
    const idleIds = Object.keys(players).filter(pid => (players[pid].status === 'idle' || !players[pid].status));

    if (idleIds.length < 4) {
        showAlert("人數不足", "閒置球員不足 4 名，無法進行自動補人！");
        return;
    }

    // 將閒置球員依等待時間與結霜階級優先排序，再來才是上場次數
    const now = Date.now();
    idleIds.sort((a, b) => {
        const pA = players[a];
        const pB = players[b];

        const waitA = (pA.lastPlayTime) ? Math.floor((now - pA.lastPlayTime) / 60000) : 999;
        const waitB = (pB.lastPlayTime) ? Math.floor((now - pB.lastPlayTime) / 60000) : 999;

        const tierA = waitA >= 30 ? 2 : (waitA >= 15 ? 1 : 0);
        const tierB = waitB >= 30 ? 2 : (waitB >= 15 ? 1 : 0);

        if (tierA !== tierB) return tierB - tierA; // 結霜嚴重的優先

        const cA = pA.playCount || 0;
        const cB = pB.playCount || 0;
        if (cA !== cB) return cA - cB; // 次數少的優先

        if (waitA !== waitB) return waitB - waitA; // 等比較久的優先

        return Math.random() - 0.5;
    });

    // 為了效能與確保抓到最欠缺上場的人，只取前 12 名作為候選人 (12取4組合約495種)
    const candidates = idleIds.slice(0, 12);

    // Helper: 產生組合
    function getCombinations(arr, size) {
        let result = [];
        let temp = [];
        function recurse(start) {
            if (temp.length === size) {
                result.push([...temp]);
                return;
            }
            for (let i = start; i < arr.length; i++) {
                temp.push(arr[i]);
                recurse(i + 1);
                temp.pop();
            }
        }
        recurse(0);
        return result;
    }

    const allCombos = getCombinations(candidates, 4);
    let validCombinations = [];

    allCombos.forEach(combo => {
        // --- 核心輔助：性別偵測與分組 ---
        const isMale = (pid) => {
            const p = players[pid];
            if (!p || !p.gender) return false;
            const g = (p.gender || '').toLowerCase();
            return (g === 'male' || g === '男' || g.startsWith('m'));
        };

        let males = [];
        let females = [];
        combo.forEach(pid => {
            if (isMale(pid)) males.push(pid);
            else females.push(pid);
        });

        const mCount = males.length;
        const fCount = females.length;
        const isMD = mCount === 4;
        const isWD = fCount === 4;
        const isXD = mCount === 2 && fCount === 2;

        if (allowAll || (allowMD && isMD) || (allowWD && isWD) || (allowXD && isXD)) {
            // 合法組合！開始評分 (越低越好)
            let score = 0;

            // 1. 上場次數懲罰：確保盡量排到絕對次數最低的人
            let totalPlays = combo.reduce((sum, pid) => sum + (players[pid].playCount || 0), 0);
            score += totalPlays * 100;

            // 2. 避免重複搭檔懲罰與性別失衡懲罰
            let minPairScore = 999999;
            let bestPairing = null;
            let bestOverlap = 0;

            const pairings = [
                [[combo[0], combo[1]], [combo[2], combo[3]]],
                [[combo[0], combo[2]], [combo[1], combo[3]]],
                [[combo[0], combo[3]], [combo[1], combo[2]]]
            ];

            pairings.forEach(pair => {
                const s1m = (isMale(pair[0][0]) ? 1 : 0) + (isMale(pair[0][1]) ? 1 : 0);
                const s2m = (isMale(pair[1][0]) ? 1 : 0) + (isMale(pair[1][1]) ? 1 : 0);

                // 計算性別失衡程度 (兩邊男生人數差距)
                let balancePenalty = Math.abs(s1m - s2m);

                // 核心邏輯：不論總人數分佈，配對時優先追求性別平衡
                // 除非是 4男 或 4女，否則不平衡的配對將被給予巨大的懲罰
                let overlap1 = (players[pair[0][0]].partners && players[pair[0][0]].partners[pair[0][1]]) || 0;
                let overlap2 = (players[pair[1][0]].partners && players[pair[1][0]].partners[pair[1][1]]) || 0;
                let totalOverlap = overlap1 + overlap2;

                // 性別權重設為極大值 (10000)，確保它優於任何搭檔紀錄 (120)
                let currentPairScore = totalOverlap * 120 + balancePenalty * 10000;

                if (currentPairScore < minPairScore) {
                    minPairScore = currentPairScore;
                    bestPairing = pair;
                    bestOverlap = totalOverlap;
                }
            });

            if (bestPairing) {
                // --- 混雙與性別排序邏輯 ---
                // 核心目的：確保 Team 1 是 (0,1)，Team 2 是 (2,3)
                // 如果偵測到 2男2女 (混雙)，強制排成 [男1, 女1, 男2, 女2]
                let finalMembers;
                if (males.length === 2 && females.length === 2) {
                    // 強制混合排列！
                    finalMembers = [males[0], females[0], males[1], females[1]];
                } else if (males.length > 0 && females.length > 0) {
                    // 若不是完美 2男2女，但有混和，則盡量讓第一對是混雙
                    const team1 = [males[0], females[0]];
                    const remaining = combo.filter(id => id !== males[0] && id !== females[0]);
                    finalMembers = [team1[0], team1[1], remaining[0], remaining[1]];
                } else {
                    // 全男或全女，維持原始最佳配對順序 [A, B, C, D]
                    finalMembers = [bestPairing[0][0], bestPairing[0][1], bestPairing[1][0], bestPairing[1][1]];
                }

                score += bestOverlap * 10;
                validCombinations.push({
                    members: finalMembers,
                    score: score
                });
            }
        }
    });

    if (validCombinations.length === 0) {
        showAlert("配對失敗", "目前的閒置名單無法湊出您指定的陣型！請放寬條件或手動拖曳。");
        return;
    }

    // 取分數最低（上場最少且較沒搭檔過）的組合
    validCombinations.sort((a, b) => a.score - b.score);
    const best = validCombinations[0];

    // 加入等待列
    const newGroup = { members: best.members };
    const newQ = [...queue, newGroup];
    db.ref('lineup/queue').set(newQ);

    let updates = {};
    best.members.forEach(pid => updates[pid + '/status'] = 'queued');
    db.ref('lineup/players').update(updates);
}

window.escapeHtml = function (text) {
    if (!text) return text;
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
};

function requestNotificationPermission() {
    // Reuse specific permission logic if needed
}

// Custom Touch Drag Implementation for Mobile
// Custom Touch Drag Implementation for Mobile
function initTouchDrag() {
    if (window.isTouchDragInitialized) return;
    window.isTouchDragInitialized = true;

    let activeDrag = null;
    let longPressTimer = null;
    let autoScrollInterval = null;

    document.addEventListener('touchstart', function (e) {
        // If already dragging, ignore new touches
        if (activeDrag) return;

        const target = e.target.closest('.player-chip, .group-card');
        if (!target) return;

        const touch = e.touches[0];

        // Prepare potential drag
        activeDrag = {
            source: target,
            startX: touch.clientX,
            startY: touch.clientY,
            currentX: touch.clientX,
            currentY: touch.clientY,
            isDragging: false,
            clone: null,
            identifier: touch.identifier
        };

        // Shorter Timer (300ms)
        longPressTimer = setTimeout(() => {
            if (!activeDrag) return;

            // Activate Drag Mode
            activeDrag.isDragging = true;
            acquireLock();

            // Visual Feedback for "Picked Up"
            if (window.navigator.vibrate) window.navigator.vibrate(50);

            // Create Clone
            createDragClone(activeDrag);

        }, 300);

    }, { passive: false });

    // Helper to create clone called by timer
    function createDragClone(dragObj) {
        if (dragObj.clone) return;

        const clone = dragObj.source.cloneNode(true);
        clone.style.position = 'fixed';
        clone.style.zIndex = '9999';
        clone.style.pointerEvents = 'none';
        clone.style.opacity = '0.8';
        clone.style.width = dragObj.source.offsetWidth + 'px';
        clone.style.height = dragObj.source.offsetHeight + 'px';

        // Position at current finger location (might have micro-moved)
        clone.style.left = (dragObj.currentX - 30) + 'px';
        clone.style.top = (dragObj.currentY - 30) + 'px';

        document.body.appendChild(clone);
        dragObj.clone = clone;

        // Prepare Payload
        const pid = dragObj.source.dataset.id;
        const gid = dragObj.source.dataset.gid;

        if (pid) {
            if (!selectedPlayers.has(pid)) {
                selectedPlayers.clear();
                selectedPlayers.add(pid);
                $(dragObj.source).addClass('selected');
            }
            dragObj.payload = {
                type: 'players',
                ids: Array.from(selectedPlayers),
                offsetX: 30,
                offsetY: 30
            };
        } else if (gid) {
            dragObj.payload = {
                type: 'group',
                gid: gid
            };
        }
    }

    // Auto Scroll Logic
    function checkAutoScroll(y) {
        const edgeSize = 60;
        const scrollSpeed = 15;
        const windowHeight = window.innerHeight;

        if (autoScrollInterval) {
            clearInterval(autoScrollInterval);
            autoScrollInterval = null;
        }

        if (y < edgeSize) {
            autoScrollInterval = setInterval(() => window.scrollBy(0, -scrollSpeed), 20);
        } else if (y > windowHeight - edgeSize) {
            autoScrollInterval = setInterval(() => window.scrollBy(0, scrollSpeed), 20);
        }
    }

    document.addEventListener('touchmove', function (e) {
        if (!activeDrag) return;

        let touch = null;
        for (let i = 0; i < e.touches.length; i++) {
            if (e.touches[i].identifier === activeDrag.identifier) {
                touch = e.touches[i];
                break;
            }
        }
        if (!touch) return;

        // Update current position for potential clone creation
        activeDrag.currentX = touch.clientX;
        activeDrag.currentY = touch.clientY;

        const dx = touch.clientX - activeDrag.startX;
        const dy = touch.clientY - activeDrag.startY;

        // Logic:
        // 1. If isDragging is TRUE: We are dragging. Move clone, prevent default (scroll).
        // 2. If isDragging is FALSE: Check if moved too much. If so, CANCEL timer. It's a scroll.

        if (activeDrag.isDragging) {
            e.preventDefault(); // Stop scrolling
            if (activeDrag.clone) {
                activeDrag.clone.style.left = (touch.clientX - 30) + 'px';
                activeDrag.clone.style.top = (touch.clientY - 30) + 'px';
            }
            checkAutoScroll(touch.clientY);
        } else {
            // Check for movement threshold to CANCEL drag (allow scroll)
            if (Math.abs(dx) > 15 || Math.abs(dy) > 15) {
                // User moved finger before timer fired -> It's a scroll!
                clearTimeout(longPressTimer);
                activeDrag = null; // Abort drag intent
            }
        }
    }, { passive: false });

    const endDrag = function (e) {
        if (longPressTimer) clearTimeout(longPressTimer);
        if (autoScrollInterval) { clearInterval(autoScrollInterval); autoScrollInterval = null; }

        if (!activeDrag) return;

        // Check if our touch ended
        let touchEnded = false;
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === activeDrag.identifier) {
                touchEnded = true;
                break;
            }
        }
        if (!touchEnded) return;

        if (activeDrag.isDragging) {
            // Drop Logic
            if (e.type === 'touchend') {
                let touch = null;
                for (let i = 0; i < e.changedTouches.length; i++) {
                    if (e.changedTouches[i].identifier === activeDrag.identifier) {
                        touch = e.changedTouches[i];
                        break;
                    }
                }

                if (touch) {
                    let dropTarget = document.elementFromPoint(touch.clientX, touch.clientY);
                    let zone = dropTarget ? dropTarget.closest('.drop-zone') : null;

                    if (!zone && dropTarget && dropTarget.closest('.fab-btn')) {
                        zone = document.querySelector('.players-panel.drop-zone') || document.getElementById('playerPool');
                    }

                    if (zone) {
                        handleDrop(activeDrag.payload, zone, dropTarget, { clientX: touch.clientX, clientY: touch.clientY });
                    }
                }
            }
            // Cleanup clone
            if (activeDrag.clone) activeDrag.clone.remove();
            releaseLock();
        }

        activeDrag = null;
    };

    document.addEventListener('touchend', endDrag);
    document.addEventListener('touchcancel', endDrag);
}

// Global Resize Listener to fix layout on orientation change/resize
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        // Re-render player pool to fix height/grid
        if (typeof renderPlayerPool === 'function') {
            renderPlayerPool();
        }
    }, 200);
});

// --- Leaderboard & History Logic ---
$(document).ready(function () {
    $('#leaderboardBtn').click(function () {
        $('#leaderboardModalOverlay').removeClass('hidden');
        renderLeaderboard();
        // Trigger history load if it hasn't loaded yet
        if (!window.historyLoaded) {
            db.ref('lineup/history').limitToLast(50).on('value', snap => {
                const data = snap.val() || {};
                renderHistory(data);
                window.historyLoaded = true;
            });
        }
    });

    $('#exportLeaderboardBtn').click(function () {
        exportLeaderboardImage();
    });

    $('#closeLeaderboardBtn').click(function () {
        $('#leaderboardModalOverlay').addClass('hidden');
    });

    // End Today Session Logic
    $('#clearLeaderboardBtn').click(() => {
        showConfirm('結算今日場次', '確定要結束今天的活動嗎？這將會清空「今日排行榜」與「待排隊名單」，但所有球員的「生涯總戰績」與「貓頭像」將會安全保留。', () => {
            const entriesUpdates = {};
            Object.keys(players).forEach(pid => {
                // We keep the player in the list but reset their "session" stats?
                // Actually, Plan A says "Clear today's players" (Wipe them from the screen)
                // Let's remove today's players node entirely.
            });

            // 執行清空今日數據與歷史紀錄
            db.ref('lineup/players').remove();
            db.ref('lineup/queue').remove();
            db.ref('lineup/history').remove();

            // 強制關閉視窗讓使用者看到數據已清空
            $('#leaderboardModalOverlay').addClass('hidden');
            showAlert('結算完成', '今日場次已結束，期待下次開球！');
        });
    });

    // Tab Switching Logic
    $('.lb-tab').off('click').on('click', function () {
        $('.lb-tab').removeClass('active');
        $('.lb-content').hide(); // 直接使用 hide() 比較統一

        $(this).addClass('active');
        const target = $(this).data('tab');
        $('#' + target).show().addClass('active');

        // 執行對應分頁的渲染
        if (target === 'tab-registry') {
            renderHallOfFame();
        } else if (target === 'tab-leaderboard') {
            renderLeaderboard();
        } else if (target === 'tab-history') {
            // 確保歷史紀錄區塊的可見度與數據載入
            if (!window.historyLoaded) {
                db.ref('lineup/history').limitToLast(50).once('value', snap => {
                    const data = snap.val() || {};
                    renderHistory(data);
                    window.historyLoaded = true;
                });
            }
        } else if (target === 'tab-zodiac') {
            // 觸發星座統計渲染
            renderZodiacStats();
        }
    });

    function renderHallOfFame() {
        const hfTbody = $('#hallOfFameTbody');
        hfTbody.empty().append('<tr><td colspan="4" style="text-align:center; padding:30px; color:#aaa;"><i class="fas fa-spinner fa-spin"></i> 正在翻閱英雄榜...</td></tr>');

        db.ref('lineup/registry').once('value', snap => {
            const data = snap.val() || {};
            let hfData = [];

            Object.keys(data).forEach(rid => {
                const reg = data[rid];
                const wins = reg.totalWins || 0;
                const losses = reg.totalLosses || 0;
                const total = wins + losses;
                const winRate = total > 0 ? (wins / total * 100).toFixed(1) : 0;

                if (total > 0) { // 只顯示有打過球的人
                    hfData.push({
                        name: reg.name,
                        avatar: reg.avatarUrl,
                        total,
                        wins,
                        losses,
                        winRate: parseFloat(winRate)
                    });
                }
            });

            // 排序：勝場數優先 (展現累積榮譽)，勝率次之
            hfData.sort((a, b) => {
                if (b.wins !== a.wins) return b.wins - a.wins;
                return b.winRate - a.winRate;
            });

            hfTbody.empty();
            if (hfData.length === 0) {
                hfTbody.append('<tr><td colspan="4" style="text-align:center; padding:20px; color:#aaa;">尚未有人進入名人堂</td></tr>');
                return;
            }

            hfData.forEach((d, index) => {
                const rank = index + 1;
                let rankHtml = `<span class="rank-badge">${rank}</span>`;
                if (rank === 1) rankHtml = `<span class="rank-badge rank-1"><i class="fas fa-crown"></i></span>`;
                else if (rank === 2) rankHtml = `<span class="rank-badge rank-2">2</span>`;
                else if (rank === 3) rankHtml = `<span class="rank-badge rank-3">3</span>`;

                const avatarHtml = d.avatar
                    ? `<img src="${d.avatar}" style="width:36px; height:36px; border-radius:50%; object-fit:cover;">`
                    : `<div class="avatar-icon" style="width:36px; height:36px; border-radius:50%; background:#eee; display:flex; justify-content:center; align-items:center; color:#ccc;"><i class="fas fa-user"></i></div>`;

                const html = `
                    <tr>
                        <td>${rankHtml}</td>
                        <td><div class="lb-player" style="display:flex; align-items:center; gap:10px;">${avatarHtml} <span>${d.name}</span></div></td>
                        <td><b style="color:var(--gold-start)">${d.wins}</b> <span style="font-size:0.8rem; color:#aaa;">W</span> / <b>${d.losses}</b> <span style="font-size:0.8rem; color:#aaa;">L</span></td>
                        <td style="font-weight:700;">${d.winRate}%</td>
                    </tr>
                `;
                hfTbody.append(html);
            });
        });
    }

    function renderLeaderboard() {
        const lbTbody = $('#leaderboardTbody');
        lbTbody.empty();

        let lbData = [];
        Object.keys(players).forEach(pid => {
            const p = players[pid];
            const wins = p.wins || 0;
            const losses = p.losses || 0;
            const total = wins + losses;
            const winRate = total > 0 ? (wins / total * 100).toFixed(1) : 0;

            lbData.push({
                pid,
                name: p.name,
                avatar: p.avatarUrl,
                total,
                wins,
                losses,
                winRate: parseFloat(winRate)
            });
        });

        // Sort by winRate desc, then total desc, then wins desc
        lbData.sort((a, b) => {
            if (b.winRate !== a.winRate) return b.winRate - a.winRate;
            if (b.total !== a.total) return b.total - a.total;
            return b.wins - a.wins;
        });

        lbData.forEach((d, index) => {
            const rank = index + 1;
            let rankHtml = `<span class="rank-badge">${rank}</span>`;
            if (rank === 1) rankHtml = `<span class="rank-badge rank-1"><i class="fas fa-crown"></i></span>`;
            else if (rank === 2) rankHtml = `<span class="rank-badge rank-2">2</span>`;
            else if (rank === 3) rankHtml = `<span class="rank-badge rank-3">3</span>`;

            const avatarHtml = d.avatar
                ? `<img src="${d.avatar}" alt="${d.name}">`
                : `<div class="avatar-icon" style="width:36px; height:36px; border-radius:50%; background:#ddd; display:flex; justify-content:center; align-items:center;"><i class="fas fa-user"></i></div>`;

            const html = `
                <tr>
                    <td>${rankHtml}</td>
                    <td><div class="lb-player">${avatarHtml} ${d.name}</div></td>
                    <td>${d.total}</td>
                    <td><span style="color:var(--gold-start)">${d.wins}</span> / <span style="color:var(--text-muted)">${d.losses}</span></td>
                    <td style="font-weight:bold;">${d.winRate}%</td>
                </tr>
            `;
            lbTbody.append(html);
        });
    }

    function renderHistory(historyData) {
        const container = $('#historyListContainer');
        container.empty();

        const entries = Object.keys(historyData).map(k => historyData[k]);
        entries.sort((a, b) => b.timestamp - a.timestamp); // newest first

        if (entries.length === 0) {
            container.append('<div style="text-align:center; padding:20px; color:#888;">尚未有比賽紀錄</div>');
            return;
        }

        entries.forEach(entry => {
            const date = new Date(entry.timestamp);
            const timeStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;

            const renderPlayerRow = (pid) => {
                const p = players[pid];
                if (!p) return '';
                const avatar = p.avatarUrl
                    ? `<img src="${p.avatarUrl}">`
                    : `<div class="avatar-icon"><i class="fas fa-user"></i></div>`;
                return `<div class="history-player">${avatar} <span>${p.name}</span></div>`;
            };

            const teamAHtml = (entry.teamA || []).map(pid => renderPlayerRow(pid)).join('');
            const teamBHtml = (entry.teamB || []).map(pid => renderPlayerRow(pid)).join('');

            const html = `
                <div class="history-item">
                    <div class="history-meta">${timeStr} · 📍 <span>${entry.courtName}</span></div>
                    <div class="history-teams-layout">
                        <div class="history-team-side">${teamAHtml}</div>
                        <div class="history-score-center"><span class="score-hist-a">${entry.scoreA}</span> : <span class="score-hist-b">${entry.scoreB}</span></div>
                        <div class="history-team-side side-right">${teamBHtml}</div>
                    </div>
                </div>
            `;
            container.append(html);
        });
    }

    // --- QR Code Logic ---
    let qrcode = null;

    $('#qrBtn').click(function () {
        const currentUrl = window.location.href;
        // 取得目錄路徑並串接 checkin.html
        let baseUrl = currentUrl.substring(0, currentUrl.lastIndexOf('/') + 1);
        if (baseUrl.startsWith('file:///')) {
            // 如果是本機檔案，提示使用者
            console.warn("偵測到本機檔案路徑，QR Code 僅供測試。");
        }
        const checkinUrl = baseUrl + "checkin.html";

        $('#qrUrlDisplay').text(checkinUrl);
        $('#qrModalOverlay').removeClass('hidden');

        // 清除舊的 QR Code
        $('#qrcode').empty();

        // 產生新的 QR Code
        qrcode = new QRCode(document.getElementById("qrcode"), {
            text: checkinUrl,
            width: 256,
            height: 256,
            colorDark: "#853b51",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
        });
    });

    $('#closeQrBtn').click(function () {
        $('#qrModalOverlay').addClass('hidden');
    });
});

// --- Name Length Validators (Weighted: Chinese=2, English=1) ---
function initNameLengthValidators() {
    const applyLimit = ($input, max = 12) => {
        $input.on('input', function () {
            let val = $(this).val();
            let currentWeight = 0;
            let result = '';
            for (let char of val) {
                // Determine if char is Full-width/Chinese (Non-ASCII)
                const weight = char.match(/[^\x00-\xff]/) ? 2 : 1;
                if (currentWeight + weight <= max) {
                    currentWeight += weight;
                    result += char;
                } else {
                    break;
                }
            }
            if (val !== result) $(this).val(result);
        });
    };

    applyLimit($('#newPlayerName'));
    applyLimit($('#editPlayerName'));
}

// --- Voice Announcement (Web Speech API) ---
window.speakMatch = function (courtId) {
    if (!('speechSynthesis' in window)) return;

    const c = courts[courtId];
    if (!c || !c.players || c.players.length === 0) return;

    const courtName = c.name || (parseInt(courtId) + 1);
    const pNames = c.players.map(pid => players[pid] ? players[pid].name : '').filter(n => n);

    // 播報文字模板
    let text = `第 ${courtName} 場地開賽。`;
    if (pNames.length >= 2) {
        const teamA = pNames.slice(0, 2).join('、');
        const teamB = pNames.slice(2, 4).join('、');
        text += `由 ${teamA} ${teamB ? '對戰 ' + teamB : ''}，請颯氣a進場比賽。`;
    } else {
        text += `請 ${pNames.join('、')} 準備進場。`;
    }

    const utterance = new SpeechSynthesisUtterance(text);

    // 語音引擎選擇 (優先找台灣口音)
    const voices = window.speechSynthesis.getVoices();
    const twVoice = voices.find(v =>
        (v.lang.includes('zh-TW') || v.name.includes('Taiwan') || v.name.includes('Yating') || v.name.includes('Hanhan')) &&
        !v.name.includes('Natural') // 避免部分 Natural 語音在某些環境下需權限才能非同步載入
    );

    if (twVoice) {
        utterance.voice = twVoice;
    } else {
        // 退而求其次尋找中文語系
        const zhVoice = voices.find(v => v.lang.includes('zh-'));
        if (zhVoice) utterance.voice = zhVoice;
    }

    utterance.rate = 0.85; // 稍微放慢一點，聽起來比較像廣播
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    window.speechSynthesis.cancel(); // 停止目前正在播放的語音
    window.speechSynthesis.speak(utterance);
};

// --- Leaderboard Image Export Logic (html2canvas) ---
async function exportLeaderboardImage() {
    if (typeof html2canvas === 'undefined') {
        showAlert('錯誤', '尚未載入圖片轉換工具，請稍後再試。', 'error');
        return;
    }

    const $template = $('#exportTemplate');
    const $grid = $('#exportStatsGrid');

    // 1. Data Preparation
    let lbData = [];
    Object.keys(players).forEach(pid => {
        const p = players[pid];
        const wins = p.wins || 0;
        const losses = p.losses || 0;
        const total = wins + losses;
        const winRate = total > 0 ? (wins / total * 100).toFixed(1) : 0;
        lbData.push({ pid, name: p.name, avatar: p.avatarUrl, wins, losses, total, winRate: parseFloat(winRate) });
    });

    // Sort: WinRate(D) -> Total(D) -> Wins(D)
    lbData.sort((a, b) => {
        if (b.winRate !== a.winRate) return b.winRate - a.winRate;
        if (b.total !== a.total) return b.total - a.total;
        return b.wins - a.wins;
    });

    // 2. Set Metadata
    const now = new Date();
    $('#exportDate').text(`${now.getFullYear()}.${(now.getMonth() + 1).toString().padStart(2, '0')}.${now.getDate().toString().padStart(2, '0')}`);

    // 3. Populate Podium
    const renderPodium = (index, elementIdPrefix) => {
        const p = lbData[index];
        const $avatar = $(`#${elementIdPrefix}-avatar`);
        const $name = $(`#${elementIdPrefix}-name`);
        const $stat = $(`#${elementIdPrefix}-stat`);

        if (p) {
            $name.text(p.name);
            $stat.text(`${p.wins} 勝 / ${p.losses} 敗`);
            if (p.avatar) {
                // 移除 crossorigin 以免在本機 file:// 模式下出錯
                $avatar.html(`<img src="${p.avatar}">`);
            } else {
                $avatar.html('<i class="fas fa-user"></i>');
            }
        } else {
            $name.text('---');
            $stat.text('無資料');
            $avatar.html('<i class="fas fa-user"></i>');
        }
    };

    renderPodium(0, 'podium1');
    renderPodium(1, 'podium2');
    renderPodium(2, 'podium3');

    // 4. Calculate Honorary Titles
    const $honors = $('#exportHonors');
    $honors.empty();

    const titles = [];
    // A. 今日戰神 (勝場最多)
    const mostWins = [...lbData].sort((a, b) => b.wins - a.wins)[0];
    if (mostWins && mostWins.wins > 0) titles.push({ icon: '🏆', title: '今日戰神', name: mostWins.name });

    // B. 勞動楷模 (總場數最多)
    const mostTotal = [...lbData].sort((a, b) => b.total - a.total)[0];
    if (mostTotal && mostTotal.total > 0 && mostTotal.pid !== (mostWins ? mostWins.pid : null)) {
        titles.push({ icon: '💪', title: '勞動楷模', name: mostTotal.name });
    }

    // C. 全勝神話 (100% 勝率且 > 1 場)
    const perfect = lbData.find(p => p.winRate === 100 && p.total >= 2);
    if (perfect) titles.push({ icon: '🔥', title: '全勝神話', name: perfect.name });

    titles.forEach(t => {
        $honors.append(`<div class="honor-tag">${t.icon} ${t.title}: <b>${t.name}</b></div>`);
    });

    // 5. Populate Stats Grid (Show ALL remaining players)
    $grid.empty();
    const otherPlayers = lbData.slice(3); // 取出第 4 名之後的所有球員
    if (otherPlayers.length === 0) {
        $grid.append('<div style="grid-column: span 2; text-align: center; color: #aaa; font-size: 0.8rem; padding: 10px;">目前尚無更多戰績紀錄</div>');
    } else {
        otherPlayers.forEach((p, idx) => {
            const html = `
                <div class="stat-row">
                    <span>${idx + 4}. ${p.name}</span>
                    <span>${p.wins} W / ${p.losses} L</span>
                </div>
            `;
            $grid.append(html);
        });
    }

    showAlert('產生中', '正在為您製作精美戰績表，請稍候...', 'success');

    // 延遲一段時間確保圖片在隱藏區域中載入完成
    setTimeout(async () => {
        try {
            const canvas = await html2canvas(document.getElementById('exportTemplate'), {
                scale: 2, // High resolution
                useCORS: true,
                allowTaint: true,
                backgroundColor: '#ffffff',
                logging: false,
                width: 500,
                height: document.getElementById('exportTemplate').offsetHeight
            });

            const dataUrl = canvas.toDataURL('image/png');

            // Trigger Download
            const link = document.createElement('a');
            link.download = `badminton_results_${now.getTime()}.png`;
            link.href = dataUrl;
            link.click();

            showAlert('匯出成功', '戰績圖已下載完成！您可以將它分享到社群群組囉。');
        } catch (err) {
            console.error("Export failed:", err);
            showAlert('匯出失敗', '抱歉，製作圖片時發生錯誤。請確認網路連線或稍後再試。', 'error');
        }
    }, 800); // 延長到 800ms 確保渲染完成
}

// --- Zodiac (Stars) Logic ---
const ZODIAC_DATA = [
    { name: '摩羯座', range: [1222, 119], emoji: '♑\uFE0E', color: '#607d8b' },
    { name: '水瓶座', range: [120, 218], emoji: '♒\uFE0E', color: '#03a9f4' },
    { name: '雙魚座', range: [219, 320], emoji: '♓\uFE0E', color: '#26c6da' },
    { name: '白羊座', range: [321, 419], emoji: '♈\uFE0E', color: '#ff5252' },
    { name: '金牛座', range: [420, 520], emoji: '♉\uFE0E', color: '#8bc34a' },
    { name: '雙子座', range: [521, 621], emoji: '♊\uFE0E', color: '#fdd835' },
    { name: '巨蟹座', range: [622, 722], emoji: '♋\uFE0E', color: '#64b5f6' },
    { name: '獅子座', range: [723, 822], emoji: '♌\uFE0E', color: '#ffa726' },
    { name: '處女座', range: [823, 922], emoji: '♍\uFE0E', color: '#4caf50' },
    { name: '天秤座', range: [923, 1023], emoji: '♎\uFE0E', color: '#f06292' },
    { name: '天蠍座', range: [1024, 1122], emoji: '♏\uFE0E', color: '#9c27b0' },
    { name: '射手座', range: [1123, 1221], emoji: '♐\uFE0E', color: '#ff9800' }
];

function getZodiacInfo(mmdd) {
    if (!mmdd || mmdd.length !== 4) return null;
    const num = parseInt(mmdd);
    if (num >= 1222 || num <= 119) return ZODIAC_DATA[0];
    return ZODIAC_DATA.find(z => num >= z.range[0] && num <= z.range[1]) || null;
}

function renderZodiacStats() {
    const grid = $('#zodiacChartGrid');
    const banner = $('#zodiacStatsSummary');

    grid.empty().append('<div class="loading-stars"><i class="fas fa-spinner fa-spin"></i> 正在夜觀星象...</div>');

    db.ref('lineup/registry').once('value', snap => {
        const allRecords = snap.val() || {};
        let statsMap = {};
        ZODIAC_DATA.forEach(z => {
            statsMap[z.name] = { count: 0, totalWins: 0, totalLosses: 0, info: z };
        });

        Object.values(allRecords).forEach(p => {
            const zInfo = getZodiacInfo(p.birthday);
            if (zInfo) {
                statsMap[zInfo.name].count++;
                statsMap[zInfo.name].totalWins += (p.totalWins || 0);
                statsMap[zInfo.name].totalLosses += (p.totalLosses || 0);
            }
        });

        const sorted = Object.values(statsMap).sort((a, b) => b.count - a.count);
        const top = sorted[0];

        if (top && top.count > 0) {
            banner.html(`
                <div class="zodiac-top-banner" style="background: linear-gradient(135deg, ${top.info.color}15, #ffffff); border: 2px solid ${top.info.color}22; padding: 10px 20px;">
                    <div class="z-top-icon" style="background: ${top.info.color}15; color: ${top.info.color}; width: 54px; height: 54px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 2rem;">
                        ${top.info.emoji}
                    </div>
                    <div class="banner-text" style="gap: 2px; margin-left: 10px;">
                        <strong style="font-size: 1.15rem; color: ${top.info.color};">本隊霸主：${top.info.name}</strong>
                        <span style="font-size: 0.85rem; color: #666;">目前共有 ${top.count} 位${top.info.name}成員活躍中！</span>
                    </div>
                </div>
            `);
        } else {
            banner.html('<div class="empty-state">尚無腳本或生日資料...</div>');
        }

        grid.empty();
        sorted.forEach(s => {
            const total = s.totalWins + s.totalLosses;
            const winRate = total > 0 ? Math.round((s.totalWins / total) * 100) : 0;

            const card = $(`
                <div class="zodiac-card" style="background: white; border: 1px solid #f2f2f2; padding: 14px 18px !important;">
                    <div class="zodiac-card-main">
                        <div class="zodiac-icon-wrapper" style="background: ${s.info.color}15; color: ${s.info.color}; font-size: 1.5rem; width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                            ${s.info.emoji}
                        </div>
                        <div class="z-meta">
                            <span class="zodiac-name" style="font-size: 1.1rem !important; color: ${s.info.color}; font-weight: 800;">${s.info.name}</span>
                            <span class="zodiac-tag" style="opacity: 0.6; font-size: 0.8rem;">${s.count} 人活躍</span>
                        </div>
                    </div>
                    <div class="zodiac-card-footer">
                        <div class="z-rate-bar" style="height: 6px; background: #eee;">
                            <div class="z-rate-fill" style="width: ${winRate}%; background: ${s.info.color};"></div>
                        </div>
                        <div class="z-rate-text">
                            <span style="font-size: 0.75rem; color: #999;">勝率</span>
                            <strong style="font-size: 0.9rem; color: ${s.info.color};">${winRate}%</strong>
                        </div>
                    </div>
                </div>
            `);
            grid.append(card);
        });
    });
}

// --- 貓砂盆 (即時留言板) 系統邏輯 ---
let chatUnreadCount = 0;
let isChatOpen = false;

function initChatSystem() {
    // 1. 點擊標題列或摺疊按鈕切換展開/收合
    $('#chatHeader').click(function (e) {
        const $chat = $('#chatIntegrated');
        const isCurrentlyExpanded = $chat.hasClass('expanded');

        if (isCurrentlyExpanded) {
            $chat.removeClass('expanded').addClass('collapsed');
            isChatOpen = false;
        } else {
            $chat.removeClass('collapsed').addClass('expanded');
            isChatOpen = true;
            chatUnreadCount = 0;
            $('#chatUnreadCount').text('0').addClass('hidden');
            scrollToBottom();
        }
    });

    // 2. 監聽 Firebase 留言 (限制最近 50 則)
    db.ref('lineup/chat').limitToLast(50).on('child_added', (snap) => {
        const msg = snap.val();
        renderChatMessage(msg);

        // 更新 Ticker 預覽
        updateChatTicker(msg);

        if (!isChatOpen) {
            chatUnreadCount++;
            $('#chatUnreadCount').text(chatUnreadCount).removeClass('hidden');
        }

        scrollToBottom();
    });

    // 3. 發送留言
    $('#chatSendBtn').click(sendChatMessage);
    $('#chatInput').keypress((e) => {
        if (e.which === 13) sendChatMessage();
    });

    // 4. 自訂身分選擇器互動
    $('#chatIdentityTrigger').on('click', function (e) {
        e.stopPropagation();

        // 點擊時先強制更新一次內容，確保清單是最新的
        updateChatIdentitySelect();

        const $chat = $('#chatIntegrated');
        // 如果聊天室還沒展開，先展開它
        if ($chat.hasClass('collapsed')) {
            $chat.removeClass('collapsed').addClass('expanded');
            isChatOpen = true;
            scrollToBottom();
        }
        $(this).toggleClass('open');
        $('#identityPopup').toggleClass('hidden');
    });

    // 點擊外部關閉彈窗
    $(document).click(function () {
        $('#chatIdentityTrigger').removeClass('open');
        const $popup = $('#identityPopup');
        if (!$popup.hasClass('hidden')) {
            $popup.addClass('hidden');
        }
    });

    // 防止彈窗內部的點擊觸發「點擊外部關閉」
    // 但允許 .id-card 的點擊事件繼續冒泡，以便被處理
    $('#identityPopup').click(function (e) {
        if (!$(e.target).closest('.id-card').length) {
            e.stopPropagation();
        }
    });

    // 點擊身分卡片
    $('#identityPopup').on('click', '.id-card', function (e) {
        e.stopPropagation(); // 處理完換人後，停止冒泡

        const pid = $(this).data('pid');
        localStorage.setItem('chat_pid', pid);

        // 視覺更新
        $('.id-card').removeClass('active');
        $(this).addClass('active');
        $('#chatIdentityTrigger').removeClass('open');
        $('#identityPopup').addClass('hidden');

        updateChatIdentitySelect();

        // 重新渲染歷史訊息 (為了正確顯示左右側)
        $('#chatMessageList').empty();
        db.ref('lineup/chat').limitToLast(50).once('value', snap => {
            snap.forEach(child => {
                renderChatMessage(child.val());
            });
            scrollToBottom();
        });
    });

    // 5. 定期更新化身選擇器 UI
    setInterval(updateChatIdentitySelect, 10000);
    updateChatIdentitySelect(); // 立即初始化一次
}

function sendChatMessage() {
    const text = $('#chatInput').val().trim();
    if (!text) return;

    const pid = localStorage.getItem('chat_pid') || 'anonymous';
    const timestamp = firebase.database.ServerValue.TIMESTAMP;

    const newMessage = {
        pid: pid,
        text: text,
        timestamp: timestamp,
        clientId: myClientId // 用於區分發言者是否為本人
    };

    db.ref('lineup/chat').push(newMessage);
    $('#chatInput').val('');
}

function renderChatMessage(msg) {
    if (!msg) return;
    const $list = $('#chatMessageList');
    $('.chat-empty-state').remove();

    // 判定是否為本人：
    // 1. 如果 ClientId 相同，絕對是本人（跨設備/重整後依然有效）
    // 2. 如果 PID 跟目前選的一樣，也視為本人
    const savedPid = localStorage.getItem('chat_pid') || 'anonymous';
    const isMe = (msg.clientId === myClientId) || (msg.pid === savedPid && msg.pid !== 'anonymous');

    let name = "匿名貓";
    let avatarHtml = "👻";

    if (msg.pid !== 'anonymous' && players[msg.pid]) {
        const p = players[msg.pid];
        name = p.name;
        avatarHtml = p.avatarUrl
            ? `<div class="chat-msg-avatar" style="background-image: url('${p.avatarUrl}')"></div>`
            : `<div class="chat-msg-avatar">🐱</div>`;
    } else {
        avatarHtml = `<div class="chat-msg-avatar">👻</div>`;
    }

    const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";

    // 緊湊排版：姓名+時間在頂部，氣泡在下方
    const html = `
        <div class="chat-msg ${isMe ? 'me' : ''}">
            <div class="chat-msg-avatar-wrapper">${avatarHtml}</div>
            <div class="chat-msg-content">
                <div class="chat-msg-header">
                    <span class="chat-msg-name">${name}</span>
                    <span class="chat-msg-time">${time}</span>
                </div>
                <div class="chat-msg-bubble">${escapeHtml(msg.text)}</div>
            </div>
        </div>
    `;

    $list.append(html);
}

function scrollToBottom() {
    const container = document.getElementById('chatMessageList');
    if (container) container.scrollTop = container.scrollHeight;
}

// 更新收合時的最新訊息預覽
function updateChatTicker(msg) {
    if (!msg) return;
    const name = (msg.pid !== 'anonymous' && players[msg.pid]) ? players[msg.pid].name : "匿名貓";
    const $ticker = $('#tickerContent');

    // 透過切換 animate class 觸發 CSS 動畫
    $ticker.removeClass('animate');
    void $ticker[0].offsetWidth; // 強制瀏覽器重繪 (Reflow)
    $ticker.text(`${name}: ${msg.text}`).addClass('animate');
}

// 在頁面載入完成後啟動聊天室
$(function () {
    initChatSystem();
});
