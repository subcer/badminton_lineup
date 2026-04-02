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
const myClientId = 'user_' + Math.random().toString(36).substr(2, 9);
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
    $('#helpBtn').click(function () {
        $('#helpModal').removeClass('hidden');
    });
    $('#closeHelpBtn').click(function () {
        $('#helpModal').addClass('hidden');
    });

    // Smart Pick Events
    $('.form-toggle-btn').click(function () {
        $(this).toggleClass('active');
    });

    $('#smartPickBtn').click(function () {
        trySmartPick();
    });

    // Search Filter
    $('#searchPlayer').on('input', function () {
        renderPlayerPool();
    });

    // --- Theme Toggle LocalStorage ---
    const currentTheme = localStorage.getItem('theme') || 'dark';
    if (currentTheme === 'light') {
        $('body').addClass('light-mode');
        $('#themeToggleBtn i').removeClass('fa-sun').addClass('fa-moon');
    }

    $('#themeToggleBtn, #themeToggleBtnMobile').click(function () {
        $('body').toggleClass('light-mode');
        const isLight = $('body').hasClass('light-mode');
        localStorage.setItem('theme', isLight ? 'light' : 'dark');

        const $icons = $('#themeToggleBtn i, #themeToggleBtnMobile i');
        const $text = $('#themeToggleBtnMobile span');

        if (isLight) {
            $icons.removeClass('fa-sun').addClass('fa-moon');
            $text.text('切換深色');
        } else {
            $icons.removeClass('fa-moon').addClass('fa-sun');
            $text.text('切換淺色');
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
        players = snapshot.val() || {};
        const count = Object.keys(players).length;
        $('#totalPlayerCount').text(`(${count})`);
        renderPlayerPool();
    });

    // 2. Courts
    db.ref('lineup/courts').on('value', snapshot => {
        courts = snapshot.val() || {};
        renderCourts();
    });

    // 3. Queue
    db.ref('lineup/queue').on('value', snapshot => {
        queue = snapshot.val() || [];
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
    const filterText = $('#searchPlayer').val().toLowerCase();

    const containerWidth = $playerPool[0].offsetWidth || $playerPool.width() || 300;

    let occupiedPositions = []; // Track occupancy to prevent overlap
    Object.keys(players).forEach(pid => {
        const p = players[pid];
        if (p.name.toLowerCase().includes(filterText)) {
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
            const selectedMark = (isSelected && isMobile) ? `<div class="selected-mark"><i class="fas fa-check"></i></div>` : '';

            const html = `
                <div class="player-chip ${p.gender} ${isSelected ? 'selected' : ''}" 
                     id="player-${pid}" data-id="${pid}" draggable="${!isMobile}"
                     style="left: ${left}px; top: ${top}px; position: absolute;">
                    <div class="play-count-badge" title="上場次數">${playCount}</div>
                    <div class="player-level" title="程度">${p.level}</div>
                    <div class="player-avatar">
                        ${avatarHtml}
                        ${selectedMark}
                    </div>
                    <div class="player-name ${(p.name && p.name.length > 4) ? 'long-name' : ''}">${escapeHtml(p.name)}</div>
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
                        <div class="court-side top"></div>
                        <div class="scoreboard" style="${$('#scoreModeToggle').is(':checked') ? '' : 'display:none'}">
                            <div class="score" onclick="updateScore('${cid}', 'A', 1, event)">${c.scoreA || 0}</div>
                            <span>:</span>
                            <div class="score" onclick="updateScore('${cid}', 'B', 1, event)">${c.scoreB || 0}</div>
                        </div>
                        <div class="court-net"></div>
                        <div class="court-side bottom"></div>
                    </div>
                </div>
                <div class="court-actions">
                    <button class="btn btn-silver btn-sm" onclick="endGame('${cid}')">結束</button>
                    ${!c.startTime ?
                `<button class="btn btn-silver btn-sm" onclick="startTimer('${cid}')"><i class="fas fa-play"></i></button>` :
                `<button class="btn btn-silver btn-sm" onclick="resetTimer('${cid}')"><i class="fas fa-stop"></i></button>`
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
                        <div class="player-name ${(p.name && p.name.length > 4) ? 'long-name' : ''}">${escapeHtml(p.name)}</div>
                    </div>
                `;
                // Position logic (Manual visual placement needed)
                // For now just append to sides
                const targetSide = idx < 2 ? '.top' : '.bottom';
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
}

// Global Timer Interval
setInterval(updateTimers, 1000);

function renderQueue() {
    // Update count
    $('#queueCount').text(queue ? queue.length : 0);

    $queueContainer.empty();
    if (!queue || queue.length === 0) {
        $queueContainer.html('<div class="empty-state">暫無等待組別</div>');
        return;
    }

    queue.forEach((group, idx) => {
        const isMobile = window.innerWidth <= 768;
        const groupSig = [...group.members].sort().join(',');
        const groupHtml = `
            <div class="group-card" data-gid="${idx}" draggable="${!isMobile}">
                <div style="width:100%; display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <div class="group-title" style="font-size:0.8rem;color:#888;">Group ${idx + 1}</div>
                    <div class="group-remove" style="position:static;" onclick="event.stopPropagation(); removeFromQueue(${idx}, '${groupSig}')">×</div>
                </div>
                <div class="group-members">
        ${group.members.map(pid => {
            const p = players[pid];
            const avatarHtml = p.avatarUrl
                ? `<img src="${p.avatarUrl}" class="avatar-img">`
                : `<i class="fas fa-user"></i>`;
            return `<div class="player-chip active-chip ${p.gender}" style="position:relative;">
                        <div class="player-avatar">${avatarHtml}</div>
                        <div class="player-name" style="white-space:nowrap; max-width:60px; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(p.name)}</div>
                    </div>`;
        }).join('')}
                </div>
            </div>
        `;
        $queueContainer.append(groupHtml);
    });
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

    if (name) {
        let assignedAvatar = window.tempNewAvatar;

        // If NO manual upload, pick a random cat
        if (!assignedAvatar) {
            const usedAvatars = Object.values(players).map(p => p.avatarUrl).filter(url => url && url.startsWith('avatars/'));
            const availableAvatars = AVATAR_POOL.filter(url => !usedAvatars.includes(url));
            if (availableAvatars.length > 0) {
                assignedAvatar = availableAvatars[Math.floor(Math.random() * availableAvatars.length)];
            } else {
                assignedAvatar = AVATAR_POOL[Math.floor(Math.random() * AVATAR_POOL.length)];
            }
        }

        db.ref('lineup/players').push({
            name,
            gender,
            level: parseInt(level),
            avatarUrl: assignedAvatar,
            status: 'idle',
            playCount: 0,
            wins: 0,
            losses: 0,
            created_at: firebase.database.ServerValue.TIMESTAMP
        });
        $('#modalOverlay').addClass('hidden');
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
$playerPool.on('touchend', '.player-chip', function (e) {
    if (isSelecting) return;
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTap;

    // Check for double tap (within 500ms)
    if (tapLength < 500 && tapLength > 0) {
        e.preventDefault(); // Prevent zoom
        e.stopPropagation();
        openEditModal($(this).data('id'));
    }
    lastTap = currentTime;
});

function openEditModal(pid) {
    const p = players[pid];
    if (!p) return;

    $('#editPlayerId').val(pid);
    $('#editPlayerName').val(p.name);
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
}

$('#cancelEditModalBtn').click(() => {
    $('#editModalOverlay').addClass('hidden');
});

$('#confirmEditPlayerBtn').click(() => {
    const pid = $('#editPlayerId').val();
    const name = $('#editPlayerName').val();
    const gender = $('#editPlayerGender').val();
    const level = $('#editPlayerLevel').val();

    if (pid && name) {
        let updateData = {
            name: name,
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
        $('#editModalOverlay').addClass('hidden');
    }
});

// Custom Confirm Helper (確認/取消)
window.showConfirm = function (title, message, onConfirm) {
    $('#alertIcon').addClass('hidden'); // Confirm normally doesn't need huge icon
    $('#confirmTitle').text(title);
    $('#confirmMessage').text(message);
    $('#confirmModalOverlay').removeClass('hidden');
    $('#cancelConfirmBtn').removeClass('hidden');
    $('#doConfirmBtn').text('確定').removeClass('btn-silver').addClass('btn-gold');

    $('#doConfirmBtn').off('click').on('click', function () {
        onConfirm();
        $('#confirmModalOverlay').addClass('hidden');
    });

    $('#cancelConfirmBtn').off('click').on('click', function () {
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
    if (c && c.players) {
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
            updates[pid + '/playCount'] = firebase.database.ServerValue.increment(1);

            if (!isPractice) {
                if ((idx === 0 || idx === 1) && teamAWins) updates[pid + '/wins'] = firebase.database.ServerValue.increment(1);
                if ((idx === 0 || idx === 1) && teamBWins) updates[pid + '/losses'] = firebase.database.ServerValue.increment(1);
                if ((idx === 2 || idx === 3) && teamBWins) updates[pid + '/wins'] = firebase.database.ServerValue.increment(1);
                if ((idx === 2 || idx === 3) && teamAWins) updates[pid + '/losses'] = firebase.database.ServerValue.increment(1);
            }
        });

        // 紀錄搭檔歷史：前兩個 pids (0,1) 一隊，後兩個 pids (2,3) 一隊
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
                courtName: c.name || courtId, // 如果沒有名字就用 ID
                teamA: [pids[0] || null, pids[1] || null].filter(Boolean),
                teamB: [pids[2] || null, pids[3] || null].filter(Boolean),
                scoreA: scoreA,
                scoreB: scoreB
            });
        }
    }

    // Remove game status or reset timer
    db.ref('lineup/courts/' + courtId + '/startTime').remove();
    db.ref('lineup/courts/' + courtId + '/scoreA').set(0);
    db.ref('lineup/courts/' + courtId + '/scoreB').set(0);

    // Clean court players
    db.ref('lineup/courts/' + courtId + '/players').set([]);
    db.ref('lineup/courts/' + courtId + '/status').set('active');

    // Auto Rotation Trigger
    setTimeout(tryAutoRotate, 500);
};

// Refresh Layout Button
$('#refreshLayoutBtn').off('click').click(function () {
    // Reset ALL player positions to null, forcing re-layout
    let updates = {};
    Object.keys(players).forEach(pid => {
        updates[pid + '/x'] = null;
        updates[pid + '/y'] = null;
    });
    if (Object.keys(updates).length > 0) {
        db.ref('lineup/players').update(updates);
    }
});

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

window.startTimer = function (cid) {
    db.ref('lineup/courts/' + cid + '/startTime').set(firebase.database.ServerValue.TIMESTAMP);
};

window.resetTimer = function (cid) {
    db.ref('lineup/courts/' + cid + '/startTime').remove();
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

    // 將閒置球員依上場次數由小到大排序（若次數相同，稍微打亂增加新鮮感）
    idleIds.sort((a, b) => {
        const pA = players[a].playCount || 0;
        const pB = players[b].playCount || 0;
        if (pA !== pB) return pA - pB;
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
            const g = p.gender.toLowerCase();
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

                // 性別權重設為極大值 (10000)，確保它優於任何搭檔紀錄 (10)
                let currentPairScore = totalOverlap * 10 + balancePenalty * 10000;

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

    $('#closeLeaderboardBtn').click(function () {
        $('#leaderboardModalOverlay').addClass('hidden');
    });

    // Clear Leaderboard Data Logic
    $('#clearLeaderboardBtn').click(() => {
        showConfirm('清除全球紀錄', '警告：此操作將會「永久清除」所有球員的勝場、敗場、與歷史對戰比分，確定要執行嗎？', () => {
            const entriesUpdates = {};
            Object.keys(players).forEach(pid => {
                entriesUpdates[pid + '/wins'] = null;     // 使用 null 徹底在 DB 刪除該欄位
                entriesUpdates[pid + '/losses'] = null;
                entriesUpdates[pid + '/partners'] = null; // 清除戰績時通常也代表重開一季，順便清搭檔
            });

            // 執行批次更新與刪除歷史紀錄
            db.ref('lineup/players').update(entriesUpdates);
            db.ref('lineup/history').remove();

            // 強制關閉視窗讓使用者看到數據已清空
            $('#leaderboardModalOverlay').addClass('hidden');
            showAlert('清理完成', '所有數據已成功清除！');

            // 提示成功 (選擇性)
            console.log("Leaderboard and history cleared.");

            // 立即重新渲染 (因為 Firebase 是非同步，監聽器會觸發，但這裡可以關閉視窗或切回首頁)
        });
    });

    $('.lb-tab').click(function () {
        $('.lb-tab').removeClass('active');
        $('.lb-content').removeClass('active').addClass('hidden');

        $(this).addClass('active');
        const target = $(this).data('tab');
        $('#' + target).removeClass('hidden').addClass('active');
    });

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
                        <div class="history-score-center">${entry.scoreA} : ${entry.scoreB}</div>
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
