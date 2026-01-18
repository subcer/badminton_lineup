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

// DOM Elements
const $courtsContainer = $('#courtsContainer');
const $playerPool = $('#playerPool');
const $queueContainer = $('#queueContainer');
const $selectionBox = $('#selectionBox');

// --- Global Lock System ---
const myClientId = 'user_' + Math.random().toString(36).substr(2, 9);
let lockTimeout = null;

function initLockSystem() {
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
    });
}

$(function () {
    initListeners();
    initSelectionLogic();
    initDragAndDrop();
    initLockSystem();
    initPresenceSystem();

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

    // Search Filter
    $('#searchPlayer').on('input', function () {
        renderPlayerPool();
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

    const containerWidth = $playerPool.width() || 300;

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
            // Desktop Chip: ~110px -> Spacing 120x130
            const isDesktop = window.innerWidth > 768;
            const itemWidth = isDesktop ? 120 : 80;
            const itemHeight = isDesktop ? 130 : 90;

            const availableCols = Math.floor(Math.max(containerWidth, isDesktop ? 320 : 300) / itemWidth);
            const cols = Math.max(isDesktop ? 2 : 3, availableCols);

            let left = p.x;
            let top = p.y;
            let needsUpdate = false;

            // 1. Initial Bounds Check
            if (left === undefined || top === undefined || left > containerWidth - 50) {
                left = null;
                top = null;
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

            const html = `
                <div class="player-chip ${p.gender} ${isSelected ? 'selected' : ''}" 
                     id="player-${pid}" data-id="${pid}" draggable="true"
                     style="left: ${left}px; top: ${top}px; position: absolute;">
                    <div class="player-level">${p.level}</div>
                    <div class="player-avatar"><i class="fas fa-user"></i></div>
                    <div class="player-name">${escapeHtml(p.name)}</div>
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
                            <div class="score" onclick="updateScore('${cid}', 'A', 1)">${c.scoreA || 0}</div>
                            <span>:</span>
                            <div class="score" onclick="updateScore('${cid}', 'B', 1)">${c.scoreB || 0}</div>
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

                const chip = `
                    <div class="player-chip active-chip ${p.gender}" style="margin: 0 5px; display:flex; flex-direction:column; align-items:center;">
                        <div class="player-avatar"><i class="fas fa-user"></i></div>
                        <div class="player-name">${escapeHtml(p.name)}</div>
                    </div>
                `;
                // Position logic (Manual visual placement needed)
                // For now just append to sides
                const targetSide = idx < 2 ? '.top' : '.bottom';
                $el.find(targetSide).append(chip);
            });
        }
    });

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
        const groupSig = group.members.sort().join(',');
        const groupHtml = `
            <div class="group-card" data-gid="${idx}" draggable="true">
                <div style="width:100%; display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <div class="group-title" style="font-size:0.8rem;color:#888;">Group ${idx + 1}</div>
                    <div class="group-remove" style="position:static;" onclick="event.stopPropagation(); removeFromQueue(${idx}, '${groupSig}')">×</div>
                </div>
                <div class="group-members">
                ${group.members.map(pid => {
            const p = players[pid];
            return `<div class="player-chip active-chip ${p.gender}" style="position:relative;">
                        <div class="player-avatar"><i class="fas fa-user"></i></div>
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
                alert("最多只能選 4 人一組！");
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
                alert("一組最多 4 人");
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
            const zone = e.target.closest('.drop-zone');
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


    // Initialize Touch Drag for Mobile
    initTouchDrag();
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

            // Boundary checks
            const w = $playerPool.width();
            const h = $playerPool.height();

            let updates = {};
            pids.forEach((pid, idx) => {
                // If multiple, stack them slightly
                let x = baseX + (idx * 5);
                let y = baseY + (idx * 5);

                // Clamp
                x = Math.max(0, Math.min(x, w - 60));
                y = Math.max(0, Math.min(y, h - 60));

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
                        alert("該組人數已滿 (最多4人)");
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
                alert("場地已滿或人數過多！");
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
        const newRef = db.ref('lineup/players').push();
        newRef.set({
            name: name,
            gender: gender,
            level: parseInt(level),
            status: 'idle'
        });
        $('#newPlayerName').val('');
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
        db.ref('lineup/players/' + pid).update({
            name: name,
            gender: gender,
            level: parseInt(level)
        });
        $('#editModalOverlay').addClass('hidden');
    }
});

// Custom Confirm Helper
window.showConfirm = function (title, message, onConfirm) {
    $('#confirmTitle').text(title);
    $('#confirmMessage').text(message);
    $('#confirmModalOverlay').removeClass('hidden');

    // Unbind previous clicks to avoid stacking logic
    $('#doConfirmBtn').off('click').on('click', function () {
        onConfirm();
        $('#confirmModalOverlay').addClass('hidden');
    });

    $('#cancelConfirmBtn').off('click').on('click', function () {
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
        });
    }
});

// Reset Button Logic
$('#resetBtn').click(() => {
    showConfirm('系統重置', '確定要重置所有資料嗎？這將會清空場地、等待列，並重置所有球員為閒置狀態！', () => {
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

        // 3. Reset All Players to Idle
        let updates = {};
        Object.keys(players).forEach(pid => {
            updates[pid + '/status'] = 'idle';
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
        const currentSig = queue[idx].members.sort().join(',');
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
    // Move players back to idle or bottom of queue?
    // User requirement: "場上的人下來排到隊伍末端" (If auto rotation?)
    // Usually just back to idle, or separate flow.
    // For now: Set to Idle

    // NOTE: 'updates' variable is missing in this scope in the original broken code.
    // Assuming we need to fetch players first?
    // Actually, 'endGame' doesn't have 'updates' defined unless I define it.
    // BUT the broken code referred to 'updates'. 
    // Wait, let's look at previous context. 'endGame' needs to find players on court.
    const c = courts[courtId];
    if (c && c.players) {
        let updates = {};
        c.players.forEach(pid => updates[pid + '/status'] = 'idle');
        if (Object.keys(updates).length > 0) {
            db.ref('lineup/players').update(updates);
        }
    }

    // Remove game status or reset timer?
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

// Fix Mobile Long Press being hijacked by Context Menu
window.addEventListener('contextmenu', function (e) {
    if (e.target.closest('.player-chip') || e.target.closest('.group-card')) {
        e.preventDefault();
        return false;
    }
}, { passive: false });

window.updateScore = function (cid, side, delta) {
    const c = courts[cid];
    let s = (side === 'A' ? c.scoreA : c.scoreB) || 0;
    if (delta === -999) s = 0;
    else s += delta;
    if (s < 0) s = 0;

    db.ref('lineup/courts/' + cid + '/score' + side).set(s);
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
        window.removeFromQueue(0, true);

        // Auto start timer
        startTimer(targetCourtId);
    }
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
