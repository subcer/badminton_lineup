// ── Firebase ──
const firebaseConfig = { databaseURL: "https://fir-60db1.firebaseio.com/" };
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

const dbOrders          = firebase.database().ref('cafe_orders');
const dbMenu            = firebase.database().ref('cafe_menu');
const dbDaily           = firebase.database().ref('cafe_daily');
const dbCustomModifiers = firebase.database().ref('cafe_custom_modifiers');

// ── State ──
let tables          = {};
let menuItems       = {};
let customModifiers = [];   // string[]
let activeTableId   = null;
let showPaidTables  = false;

const STATUS       = { empty: '空桌', ordering: '點餐中', served: '已出餐', paid: '已結帳' };
const STATUS_LABEL = { empty: '空桌', ordering: '點餐中', served: '已出餐', paid: '已結帳' };
const STATUS_ORDER = ['empty', 'ordering', 'served', 'paid'];

// ── Firebase Listeners ──
dbOrders.on('value', snap => {
  tables = snap.val() || {};
  renderTables();
  renderStats();
  renderTodaySection();
  if (activeTableId && tables[activeTableId]) updateModalContent(activeTableId);
});

dbMenu.on('value', snap => {
  menuItems = snap.val() || {};
  renderMenuPicker();
  renderMenuItemsList();
});

dbCustomModifiers.on('value', snap => {
  customModifiers = snap.val() || [];
  renderVoiceKeywordTags();
});

// ── Helpers ──
function isToday(ts) {
  if (!ts) return false;
  const d = new Date(ts), now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function calcTotal(table) {
  return Object.values(table.items || {}).reduce((sum, item) => {
    return sum + (Number(item.price) || 0) * (Number(item.qty) || 1);
  }, 0);
}

function renderStats() {
  const all = Object.values(tables);
  document.getElementById('statTotal').textContent    = all.length;
  document.getElementById('statEmpty').textContent    = all.filter(t => t.status === 'empty').length;
  document.getElementById('statOrdering').textContent = all.filter(t => t.status === 'ordering').length;
  document.getElementById('statServed').textContent   = all.filter(t => t.status === 'served').length;
  document.getElementById('statPaid').textContent     = all.filter(t => t.status === 'paid').length;
}

function renderTodaySection() {
  const paid = Object.entries(tables).filter(([, t]) => t.status === 'paid');
  const count = paid.length;
  const revenue = paid.reduce((sum, [, t]) => sum + (t.paidTotal || calcTotal(t)), 0);
  const names = paid.map(([, t]) => t.name).join('、');

  document.getElementById('todayPaidCount').textContent = count;
  document.getElementById('todayPaidTables').textContent = names;
  document.getElementById('todayRevenue').textContent = count > 0 ? '$' + revenue : '—';

  renderPaidTablesGrid(paid);
}

function renderPaidTablesGrid(paid) {
  const grid = document.getElementById('paidTablesGrid');
  grid.innerHTML = '';
  if (!paid || paid.length === 0) {
    grid.style.display = 'none';
    showPaidTables = false;
    updateToggleBtn();
    return;
  }
  if (!showPaidTables) return;
  grid.style.display = 'grid';
  paid.forEach(([id, table]) => grid.appendChild(buildTableCard(id, table)));
}

function updateToggleBtn() {
  const btn = document.getElementById('btnTogglePaid');
  const icon = document.getElementById('togglePaidIcon');
  const label = document.getElementById('togglePaidLabel');
  if (showPaidTables) {
    btn.classList.add('active');
    icon.textContent = 'visibility_off';
    label.textContent = '隱藏已結帳';
  } else {
    btn.classList.remove('active');
    icon.textContent = 'visibility';
    label.textContent = '查看已結帳';
  }
}

document.getElementById('btnTogglePaid').addEventListener('click', () => {
  showPaidTables = !showPaidTables;
  updateToggleBtn();
  const paid = Object.entries(tables).filter(([, t]) => t.status === 'paid');
  renderPaidTablesGrid(paid);
});

// ── Render Tables ──
function renderTables() {
  const grid = document.getElementById('tablesGrid');
  const sorted = Object.entries(tables).sort((a, b) => a[1].order - b[1].order);
  const visible = sorted.filter(([, t]) => t.status !== 'paid');
  grid.innerHTML = '';

  if (visible.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <span class="material-symbols-outlined">table_restaurant</span>
      <p>還沒有餐桌，點右上角「新增餐桌」</p>
    </div>`;
  } else {
    visible.forEach(([id, table]) => grid.appendChild(buildTableCard(id, table)));
  }

  const addCard = document.createElement('div');
  addCard.className = 'add-table-card';
  addCard.innerHTML = `<span class="material-symbols-outlined">add_circle</span><span class="label">新增餐桌</span>`;
  addCard.onclick = openAddTableModal;
  grid.appendChild(addCard);
}

function buildTableCard(id, table) {
  const card = document.createElement('div');
  card.className = `table-card status-${table.status}`;
  card.onclick = () => openTableModal(id);

  const items = Object.values(table.items || {});
  const doneCount = items.filter(i => i.done).length;
  const total = calcTotal(table);

  const itemsHtml = items.length === 0
    ? `<p class="tc-empty-body">尚無訂單</p>`
    : items.slice(0, 3).map(i => {
        const lineTotal = (Number(i.price) || 0) * (Number(i.qty) || 1);
        return `<div class="tc-order-item">
          <span>${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}</span>
          <span>${lineTotal > 0 ? '$' + lineTotal : i.done ? '✓' : '—'}</span>
        </div>`;
      }).join('');

  card.innerHTML = `
    <div class="tc-header">
      <div>
        <span class="tc-label">餐桌</span>
        <h3 class="tc-name">${table.name}</h3>
      </div>
      <span class="tc-badge">${STATUS_LABEL[table.status]}</span>
    </div>
    <div class="tc-body">${itemsHtml}</div>
    <div class="tc-footer">
      <div class="tc-total-wrap">
        <span class="tc-total-label">小計</span>
        <span class="tc-total-amount">${total > 0 ? '$' + total : '—'}</span>
      </div>
      ${items.length > 0 ? `<span class="tc-progress">✓ ${doneCount}/${items.length}</span>` : ''}
    </div>
  `;
  return card;
}

// ── Table Modal ──
function openTableModal(tableId) {
  activeTableId = tableId;
  clearVoiceResult();
  document.getElementById('voiceSection').classList.remove('recording');
  document.getElementById('tableModal').classList.add('open');
  updateModalContent(tableId);
}

function updateModalContent(tableId) {
  const table = tables[tableId];
  if (!table) return;

  document.getElementById('modalTitle').textContent = table.name;

  const dots = document.querySelectorAll('.status-dot');
  const idx = STATUS_ORDER.indexOf(table.status);
  dots.forEach((dot, i) => {
    dot.classList.remove('active', 'done-dot');
    if (i < idx) dot.classList.add('done-dot');
    if (i === idx) dot.classList.add('active');
  });

  renderOrderItems(table);
  updateTotalBar(table);

  document.getElementById('btnMarkServed').style.display = table.status === 'ordering' ? '' : 'none';
  document.getElementById('btnMarkPaid').style.display   = table.status === 'served'   ? '' : 'none';
}

function renderOrderItems(table) {
  const list = document.getElementById('orderList');
  const items = Object.entries(table.items || {});

  if (items.length === 0) {
    list.innerHTML = `<div class="order-empty">尚未點餐，請用語音或手動輸入品項</div>`;
    return;
  }

  list.innerHTML = '';
  items.forEach(([itemId, item]) => {
    const el = document.createElement('div');
    el.className = `order-item${item.done ? ' done' : ''}`;
    const lineTotal = (Number(item.price) || 0) * (Number(item.qty) || 1);
    el.innerHTML = `
      <button class="btn-done-item" onclick="toggleItemDone('${itemId}')">
        <i class="fa-solid fa-check"></i>
      </button>
      <div class="order-item-info">
        <span class="order-item-name">${item.name}</span>
        ${item.note ? `<span class="order-item-note">${item.note}</span>` : ''}
      </div>
      <div class="order-item-right">
        <span class="order-item-qty">×${item.qty}</span>
        <span class="order-item-line-price">${lineTotal > 0 ? '$' + lineTotal : '—'}</span>
      </div>
      <button class="btn-del-item" onclick="deleteItem('${itemId}')">
        <i class="fa-solid fa-xmark"></i>
      </button>
    `;
    list.appendChild(el);
  });
}

function updateTotalBar(table) {
  const total = calcTotal(table);
  const bar = document.getElementById('orderTotal');
  const items = Object.values(table.items || {});
  if (items.length > 0) {
    bar.style.display = 'flex';
    document.getElementById('orderTotalAmount').textContent = total > 0 ? '$' + total : '—';
  } else {
    bar.style.display = 'none';
  }
}

function toggleItemDone(itemId) {
  const table = tables[activeTableId];
  if (!table?.items?.[itemId]) return;
  table.items[itemId].done = !table.items[itemId].done;
  dbOrders.child(activeTableId).set(table);
}

function deleteItem(itemId) {
  const table = tables[activeTableId];
  if (!table?.items) return;
  delete table.items[itemId];
  dbOrders.child(activeTableId).set(table);
}

// ── Add Item (manual) ──
document.getElementById('btnAddItem').addEventListener('click', addItem);
document.getElementById('inputItemName').addEventListener('keydown', e => { if (e.key === 'Enter') addItem(); });

function addItem() {
  const name  = document.getElementById('inputItemName').value.trim();
  const price = parseFloat(document.getElementById('inputItemPrice').value) || 0;
  const qty   = parseInt(document.getElementById('inputItemQty').value) || 1;
  const note  = document.getElementById('inputItemNote').value.trim();

  if (!name || !activeTableId) return;

  const table = tables[activeTableId];
  if (!table.items) table.items = {};

  const itemId = 'item_' + Date.now();
  table.items[itemId] = { name, qty, note, done: false, price };
  if (table.status === 'empty') table.status = 'ordering';

  dbOrders.child(activeTableId).set(table);

  document.getElementById('inputItemName').value  = '';
  document.getElementById('inputItemPrice').value = '';
  document.getElementById('inputItemQty').value   = '1';
  document.getElementById('inputItemNote').value  = '';
  document.getElementById('inputItemName').focus();

  showToast(`已加入「${name}」${price > 0 ? ' $' + price : ''}`);
}

// ── Menu Picker ──
function renderMenuPicker() {
  const picker = document.getElementById('menuPicker');
  const sorted = Object.entries(menuItems).sort((a, b) => a[1].order - b[1].order);

  if (sorted.length === 0) {
    picker.innerHTML = '<span class="menu-picker-empty">尚無菜單，請先到「菜單管理」新增品項</span>';
    return;
  }

  picker.innerHTML = '';
  sorted.forEach(([, item]) => {
    const chip = document.createElement('button');
    chip.className = 'menu-pick-chip';
    const hasOpts = (item.options || []).some(g => g.choices?.length > 0);
    chip.innerHTML = `
      <span class="mpc-name">${item.name}</span>
      ${hasOpts ? '<span class="mpc-options-dot" title="有必選選項"></span>' : ''}
      <span class="mpc-price">${item.price > 0 ? '$' + item.price : '—'}</span>
    `;
    chip.addEventListener('click', () => {
      const opts = (item.options || []).filter(g => g.choices?.length > 0);
      if (opts.length > 0) {
        openOptionPicker(item, opts);
      } else {
        document.getElementById('inputItemName').value  = item.name;
        document.getElementById('inputItemPrice').value = item.price || '';
        document.getElementById('inputItemName').focus();
      }
    });
    picker.appendChild(chip);
  });
}

// ── Option Picker Modal ──
let _pendingOptionItem = null;

function openOptionPicker(item, opts) {
  _pendingOptionItem = item;
  document.getElementById('optionPickerTitle').textContent = item.name;

  const content = document.getElementById('optionPickerContent');
  content.innerHTML = opts.map((grp, gi) => `
    <div class="option-picker-group">
      <p class="option-picker-group-label">${grp.label || '選項'}</p>
      <div class="option-picker-choices">
        ${(grp.choices || []).map((c, ci) => `
          <label class="option-picker-choice">
            <input type="radio" name="optgrp-${gi}" value="${c}" ${ci === 0 ? 'checked' : ''}>
            <span class="option-picker-choice-label">${c}</span>
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');

  document.getElementById('optionPickerModal').classList.add('open');
}

function closeOptionPicker() {
  document.getElementById('optionPickerModal').classList.remove('open');
  _pendingOptionItem = null;
}

document.getElementById('btnCloseOptionPicker').addEventListener('click', closeOptionPicker);
document.getElementById('btnOptionCancel').addEventListener('click', closeOptionPicker);
document.getElementById('optionPickerModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeOptionPicker();
});

document.getElementById('btnOptionConfirm').addEventListener('click', () => {
  if (!_pendingOptionItem || !activeTableId) return;

  const item  = _pendingOptionItem;
  const opts  = (item.options || []).filter(g => g.choices?.length > 0);
  const chosen = opts.map((grp, gi) => {
    const radio = document.querySelector(`#optionPickerContent input[name="optgrp-${gi}"]:checked`);
    return radio ? radio.value : null;
  }).filter(Boolean);

  const table = tables[activeTableId];
  if (!table.items) table.items = {};
  const itemId = 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
  table.items[itemId] = {
    name: item.name, qty: 1, price: item.price || 0,
    note: chosen.join('、'), done: false
  };
  if (table.status === 'empty') table.status = 'ordering';
  dbOrders.child(activeTableId).set(table);
  showToast(`已加入「${item.name}」${chosen.length ? '（' + chosen.join('、') + '）' : ''}`);
  closeOptionPicker();
});

// ══════════════════════════════════════════════════
//  語音點餐
// ══════════════════════════════════════════════════

const CN_NUM_MAP = { '零':0,'一':1,'兩':2,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10 };

// 只保留這些已知修飾詞當備註，其他雜字丟棄（長的先比對）
const MODIFIERS = [
  // 溫度
  '去冰', '少冰', '微冰', '半冰', '加冰', '正常冰', '常溫', '室溫',
  '熱的', '冰的', '溫的', '熱', '冰', '溫',
  // 甜度
  '無糖', '微糖', '少糖', '半糖', '七分糖', '三分糖', '全糖', '不加糖', '少甜', '不甜',
  // 大小
  '大杯', '中杯', '小杯', '大的', '小的',
  // 其他常見
  '加奶', '不加奶', '少奶', '外帶', '內用', '打包'
];

function buildDynamicModifiers() {
  const all = new Set(MODIFIERS);
  Object.values(menuItems).forEach(item => {
    (item.options || []).forEach(grp => {
      (grp.choices || []).forEach(c => { if (c.trim()) all.add(c.trim()); });
    });
  });
  customModifiers.forEach(k => { if (k && k.trim()) all.add(k.trim()); });
  return [...all];
}

function extractModifiers(text) {
  const found = [];
  const sorted = buildDynamicModifiers().sort((a, b) => b.length - a.length);
  let remaining = text;
  for (const mod of sorted) {
    if (remaining.includes(mod)) {
      found.push(mod);
      remaining = remaining.split(mod).join('');
    }
  }
  return found.join('、');
}

let recognition      = null;
let voiceParsedItems = [];

function initSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    // 不支援時隱藏語音按鈕
    document.getElementById('btnVoice').style.display = 'none';
    return;
  }
  recognition = new SR();
  recognition.lang            = 'zh-TW';
  recognition.continuous      = false;
  recognition.interimResults  = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    document.getElementById('btnVoice').classList.add('recording');
    document.getElementById('voiceStatus').textContent = '';
    document.getElementById('voiceSection').classList.add('recording');
  };

  recognition.onresult = e => {
    const text = e.results[0][0].transcript;
    handleVoiceResult(text);
  };

  recognition.onerror = e => {
    stopRecording();
    if (e.error !== 'no-speech') showToast('語音辨識失敗：' + e.error);
  };

  recognition.onend = stopRecording;
}

function stopRecording() {
  document.getElementById('btnVoice').classList.remove('recording');
  document.getElementById('voiceStatus').textContent = '';
  document.getElementById('voiceSection').classList.remove('recording');
}

document.getElementById('btnVoice').addEventListener('click', () => {
  if (!recognition) { showToast('此瀏覽器不支援語音，請用 Chrome'); return; }
  try { recognition.start(); } catch(e) { /* already started */ }
});

// ── 解析語音文字 ──
function extractNum(str) {
  const arabic = str.match(/\d+/);
  if (arabic) return parseInt(arabic[0]);
  for (const [ch, val] of Object.entries(CN_NUM_MAP)) {
    if (str.includes(ch)) return val;
  }
  return null;
}

function parseVoiceText(rawText) {
  const results = [];
  if (Object.keys(menuItems).length === 0) return results;

  // 名字長的先比對，避免「抹茶拿鐵」先被「拿鐵」截走
  const sortedMenu = Object.values(menuItems).sort((a, b) => b.name.length - a.name.length);

  // Step 1：掃描全句找出所有品項位置，不重疊
  const taken = new Array(rawText.length).fill(false);
  const found = []; // { name, price, start, end }

  for (const menuItem of sortedMenu) {
    let from = 0;
    while (from < rawText.length) {
      const idx = rawText.indexOf(menuItem.name, from);
      if (idx === -1) break;
      const end = idx + menuItem.name.length;
      if (!taken.slice(idx, end).some(Boolean)) {
        found.push({ name: menuItem.name, price: menuItem.price || 0, start: idx, end });
        for (let k = idx; k < end; k++) taken[k] = true;
      }
      from = end;
    }
  }

  if (found.length === 0) return results;

  // Step 2：依出現位置排序
  found.sort((a, b) => a.start - b.start);

  // Step 3：每個品項各自從「前後區段」抓數量與修飾詞
  // lookBefore = 上一個品項結尾 ～ 本品項開頭
  // lookAfter  = 本品項結尾 ～ 下一個品項開頭
  for (let i = 0; i < found.length; i++) {
    const item      = found[i];
    const prevEnd   = i > 0               ? found[i - 1].end   : 0;
    const nextStart = i < found.length - 1 ? found[i + 1].start : rawText.length;

    const lookBefore = rawText.slice(prevEnd, item.start);
    const lookAfter  = rawText.slice(item.end, nextStart);

    // 數量：優先品名前的數字，沒有再找後面
    let qty = 1;
    const numBefore = extractNum(lookBefore);
    const numAfter  = extractNum(lookAfter);
    if (numBefore !== null && numBefore > 0) qty = numBefore;
    else if (numAfter !== null && numAfter > 0) qty = numAfter;

    // 備註：只保留已知修飾詞
    const note = extractModifiers(lookBefore + lookAfter);

    results.push({ name: item.name, qty, note, price: item.price });
  }

  return results;
}

// ── 顯示語音解析結果 ──
function handleVoiceResult(text) {
  document.getElementById('voiceResultText').textContent = `「${text}」`;
  voiceParsedItems = parseVoiceText(text);
  renderVoiceParsedList();
  document.getElementById('voiceResult').style.display = '';
}

function renderVoiceParsedList() {
  const list    = document.getElementById('voiceParsedList');
  const noMatch = document.getElementById('voiceNoMatch');
  const confirm = document.getElementById('btnVoiceConfirm');

  list.innerHTML = '';

  if (voiceParsedItems.length === 0) {
    noMatch.style.display  = '';
    confirm.style.display  = 'none';
    return;
  }

  noMatch.style.display = 'none';
  confirm.style.display = '';

  voiceParsedItems.forEach((item, idx) => {
    const lineTotal = (item.price || 0) * item.qty;
    const el = document.createElement('div');
    el.className = 'voice-parsed-item';
    el.innerHTML = `
      <div class="vpi-info">
        <span class="vpi-name">${item.name}</span>
        ${item.note ? `<span class="vpi-note">${item.note}</span>` : ''}
      </div>
      <span class="vpi-qty">×${item.qty}</span>
      <span class="vpi-price">${lineTotal > 0 ? '$' + lineTotal : '—'}</span>
      <button class="btn-del-item" onclick="removeVoiceParsedItem(${idx})">
        <i class="fa-solid fa-xmark"></i>
      </button>
    `;
    list.appendChild(el);
  });
}

function removeVoiceParsedItem(idx) {
  voiceParsedItems.splice(idx, 1);
  renderVoiceParsedList();
  if (voiceParsedItems.length === 0) {
    document.getElementById('voiceNoMatch').style.display = '';
    document.getElementById('btnVoiceConfirm').style.display = 'none';
  }
}

function clearVoiceResult() {
  voiceParsedItems = [];
  document.getElementById('voiceResult').style.display = 'none';
}

document.getElementById('btnClearVoice').addEventListener('click', clearVoiceResult);

document.getElementById('btnVoiceConfirm').addEventListener('click', () => {
  if (!activeTableId || voiceParsedItems.length === 0) return;

  const table = tables[activeTableId];
  if (!table.items) table.items = {};

  voiceParsedItems.forEach(item => {
    const itemId = 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    table.items[itemId] = { name: item.name, qty: item.qty, note: item.note, done: false, price: item.price };
  });

  if (table.status === 'empty') table.status = 'ordering';

  dbOrders.child(activeTableId).set(table);
  showToast(`已加入 ${voiceParsedItems.length} 項品項`);
  clearVoiceResult();
});

// 初始化語音辨識
initSpeechRecognition();

// ── Status Actions ──
document.getElementById('btnMarkServed').addEventListener('click', () => {
  const table = tables[activeTableId];
  if (!table) return;
  table.status = 'served';
  dbOrders.child(activeTableId).set(table);
  showToast('已標記為「已出餐」');
});

document.getElementById('btnMarkPaid').addEventListener('click', () => {
  const table = tables[activeTableId];
  if (!table) return;
  const total = calcTotal(table);
  table.status   = 'paid';
  table.paidAt   = Date.now();
  table.paidTotal = total;
  dbOrders.child(activeTableId).set(table);
  showToast(`已結帳！${total > 0 ? ' 共 $' + total : ''}`);
  closeTableModal();
});

document.getElementById('btnDeleteTable').addEventListener('click', () => {
  const name = tables[activeTableId]?.name;
  showConfirm({
    title: '刪除餐桌',
    message: `確定要刪除「${name}」並清空所有訂單？此操作無法復原。`,
    danger: true,
    okLabel: '刪除',
    icon: 'delete'
  }, () => {
    dbOrders.child(activeTableId).remove();
    closeTableModal();
    showToast('餐桌已刪除');
  });
});

// ── Close Table Modal ──
function closeTableModal() {
  document.getElementById('tableModal').classList.remove('open');
  activeTableId = null;
}
document.getElementById('tableModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeTableModal(); });
document.getElementById('btnCloseModal').addEventListener('click', closeTableModal);

// ── Add Table Modal ──
function openAddTableModal() {
  document.getElementById('addTableModal').classList.add('open');
  document.getElementById('inputTableName').focus();
}
function closeAddTableModal() {
  document.getElementById('addTableModal').classList.remove('open');
  document.getElementById('inputTableName').value = '';
}
document.getElementById('addTableModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeAddTableModal(); });
document.getElementById('btnCloseAddModal').addEventListener('click', closeAddTableModal);
document.getElementById('btnHeaderAdd').addEventListener('click', openAddTableModal);
document.getElementById('btnAddTable').addEventListener('click', addTable);
document.getElementById('inputTableName').addEventListener('keydown', e => { if (e.key === 'Enter') addTable(); });
document.querySelectorAll('.table-preset').forEach(chip => {
  chip.addEventListener('click', () => { document.getElementById('inputTableName').value = chip.dataset.name; });
});

function addTable() {
  const name = document.getElementById('inputTableName').value.trim();
  if (!name) return;
  const tableId = 'table_' + Date.now();
  dbOrders.child(tableId).set({ name, status: 'empty', order: Date.now(), items: {} });
  closeAddTableModal();
  showToast(`已新增「${name}」`);
}

// ── Menu Management Modal ──
document.getElementById('btnOpenMenu').addEventListener('click', () => {
  document.getElementById('menuModal').classList.add('open');
});
document.getElementById('btnCloseMenuModal').addEventListener('click', () => {
  document.getElementById('menuModal').classList.remove('open');
});
document.getElementById('menuModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) document.getElementById('menuModal').classList.remove('open');
});

document.getElementById('btnAddMenuItem').addEventListener('click', addMenuItem);
document.getElementById('inputMenuName').addEventListener('keydown', e => { if (e.key === 'Enter') addMenuItem(); });

// ── Voice Keywords (Custom Modifiers) ──
function renderVoiceKeywordTags() {
  const container = document.getElementById('voiceKeywordTags');
  if (!container) return;
  if (!customModifiers.length) {
    container.innerHTML = '<span style="font-size:0.75rem;color:var(--text-muted);padding:4px 2px;">尚無自訂關鍵字</span>';
    return;
  }
  container.innerHTML = customModifiers.map((kw, i) => `
    <span class="voice-keyword-tag">
      ${kw}
      <button onclick="deleteVoiceKeyword(${i})" title="刪除">×</button>
    </span>
  `).join('');
}

function addVoiceKeyword() {
  const input = document.getElementById('inputVoiceKeyword');
  const kw = input.value.trim();
  if (!kw) return;
  if (customModifiers.includes(kw)) { showToast(`「${kw}」已在清單中`); input.value = ''; return; }
  const updated = [...customModifiers, kw];
  dbCustomModifiers.set(updated);
  input.value = '';
  input.focus();
}

function deleteVoiceKeyword(index) {
  const updated = customModifiers.filter((_, i) => i !== index);
  dbCustomModifiers.set(updated);
}

document.getElementById('btnAddVoiceKeyword').addEventListener('click', addVoiceKeyword);
document.getElementById('inputVoiceKeyword').addEventListener('keydown', e => { if (e.key === 'Enter') addVoiceKeyword(); });

function addMenuItem() {
  const name     = document.getElementById('inputMenuName').value.trim();
  const price    = parseFloat(document.getElementById('inputMenuPrice').value) || 0;
  const category = document.getElementById('inputMenuCategory').value.trim() || '其他';
  if (!name) return;
  const id = 'menu_' + Date.now();
  dbMenu.child(id).set({ name, price, category, order: Date.now() });
  document.getElementById('inputMenuName').value  = '';
  document.getElementById('inputMenuPrice').value = '';
  document.getElementById('inputMenuName').focus();
  showToast(`已新增「${name}」`);
}

function deleteMenuItem(id) {
  const name = menuItems[id]?.name;
  showConfirm({
    title: '刪除品項',
    message: `確定要刪除菜單品項「${name}」？`,
    danger: true,
    okLabel: '刪除',
    icon: 'delete'
  }, () => {
    dbMenu.child(id).remove();
    showToast('已刪除品項');
  });
}

function syncCategoryDatalist() {
  const dl = document.getElementById('categoryList');
  if (!dl) return;
  const existing = new Set(['咖啡','茶飲','甜點','輕食','其他']);
  Object.values(menuItems).forEach(i => { if (i.category) existing.add(i.category); });
  dl.innerHTML = [...existing].map(c => `<option value="${c}">`).join('');
}

function renderMenuItemsList() {
  syncCategoryDatalist();
  const list = document.getElementById('menuItemsList');
  const sorted = Object.entries(menuItems).sort((a, b) => a[1].order - b[1].order);

  if (sorted.length === 0) {
    list.innerHTML = `<div class="order-empty" style="padding:24px 0;">尚無品項，請在上方新增</div>`;
    return;
  }

  const groups = {};
  sorted.forEach(([id, item]) => {
    if (!groups[item.category]) groups[item.category] = [];
    groups[item.category].push([id, item]);
  });

  list.innerHTML = '';
  Object.entries(groups).forEach(([cat, items]) => {
    const section = document.createElement('div');
    section.innerHTML = `<div class="menu-category-label">${cat}</div>`;
    items.forEach(([id, item]) => {
      const row = document.createElement('div');
      row.className = 'menu-manage-row';
      row.id = `menu-row-${id}`;
      const activeOpts = (item.options || []).filter(g => g.choices?.length > 0);
      const optTagsHtml = activeOpts.length > 0
        ? `<div class="menu-has-options">${activeOpts.map(g =>
            `<span class="menu-option-tag">${g.label || '選項'}：${g.choices.join(' / ')}</span>`
          ).join('')}</div>` : '';
      row.innerHTML = `
        <div style="flex:1;min-width:0">
          <span class="menu-manage-name">${item.name}</span>
          ${optTagsHtml}
        </div>
        <span class="menu-manage-price">${item.price > 0 ? '$' + item.price : '未定價'}</span>
        <button class="btn-edit-item" onclick="startEditMenuItem('${id}')" title="編輯">
          <span class="material-symbols-outlined">edit</span>
        </button>
        <button class="btn-del-item" onclick="deleteMenuItem('${id}')">
          <i class="fa-solid fa-trash"></i>
        </button>
      `;
      section.appendChild(row);
    });
    list.appendChild(section);
  });
}

let _editingOptions = [];

function startEditMenuItem(id) {
  const item = menuItems[id];
  if (!item) return;
  _editingOptions = JSON.parse(JSON.stringify(item.options || []));

  const existing = new Set(['咖啡','茶飲','甜點','輕食','其他']);
  Object.values(menuItems).forEach(i => { if (i.category) existing.add(i.category); });
  const editListId = `editCatList-${id}`;
  const datalistHtml = `<datalist id="${editListId}">${[...existing].map(c=>`<option value="${c}">`).join('')}</datalist>`;

  const row = document.getElementById(`menu-row-${id}`);
  row.classList.add('editing');
  row.innerHTML = `
    <div class="menu-edit-fields">
      <input class="menu-edit-input" id="editName-${id}" value="${item.name}" placeholder="品項名稱">
      <input class="menu-edit-price" id="editPrice-${id}" type="number" value="${item.price || ''}" placeholder="定價">
      <input class="menu-edit-cat-input" id="editCat-${id}" value="${item.category || ''}" placeholder="分類" list="${editListId}" autocomplete="off">
      ${datalistHtml}
    </div>
    <div class="edit-options-section" id="editOptions-${id}"></div>
    <div class="menu-edit-btns">
      <button class="btn-edit-save" onclick="saveEditMenuItem('${id}')" title="儲存">
        <span class="material-symbols-outlined">check</span>儲存
      </button>
      <button class="btn-edit-cancel" onclick="renderMenuItemsList()" title="取消">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
  `;
  document.getElementById(`editName-${id}`).focus();
  renderEditOptionsUI(id);
}

function renderEditOptionsUI(id) {
  const container = document.getElementById(`editOptions-${id}`);
  if (!container) return;
  const groupsHtml = _editingOptions.map((grp, gi) => `
    <div class="edit-option-group">
      <div class="edit-option-top">
        <input class="menu-edit-input edit-option-label-input"
               placeholder="選項名稱（如：內容選擇）"
               value="${grp.label || ''}"
               id="editOptLabel-${id}-${gi}">
        <button class="btn-edit-cancel" onclick="removeEditOptionGroup(${gi},'${id}')">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <input class="menu-edit-input edit-option-choices-input"
             placeholder="選項值（逗號分隔，如：果醬+起司片、有鹽奶油）"
             value="${(grp.choices || []).join('、')}"
             id="editOptChoices-${id}-${gi}">
    </div>
  `).join('');

  container.innerHTML = `
    <div class="edit-options-header">
      <span class="edit-options-title">必選選項組</span>
      <button class="edit-add-group-btn" onclick="addEditOptionGroup('${id}')">
        <span class="material-symbols-outlined">add</span>新增選項組
      </button>
    </div>
    ${groupsHtml}
  `;
}

function syncEditOptionsFromInputs(id) {
  _editingOptions.forEach((grp, gi) => {
    const labelEl   = document.getElementById(`editOptLabel-${id}-${gi}`);
    const choicesEl = document.getElementById(`editOptChoices-${id}-${gi}`);
    if (labelEl)   grp.label   = labelEl.value.trim();
    if (choicesEl) grp.choices = choicesEl.value.split(/[,、，]+/).map(s => s.trim()).filter(Boolean);
  });
}

function addEditOptionGroup(id) {
  syncEditOptionsFromInputs(id);
  _editingOptions.push({ label: '', choices: [] });
  renderEditOptionsUI(id);
  document.getElementById(`editOptLabel-${id}-${_editingOptions.length - 1}`)?.focus();
}

function removeEditOptionGroup(gi, id) {
  syncEditOptionsFromInputs(id);
  _editingOptions.splice(gi, 1);
  renderEditOptionsUI(id);
}

function saveEditMenuItem(id) {
  syncEditOptionsFromInputs(id);
  const name  = document.getElementById(`editName-${id}`)?.value.trim();
  const price = parseFloat(document.getElementById(`editPrice-${id}`)?.value) || 0;
  const cat   = document.getElementById(`editCat-${id}`)?.value.trim() || '其他';
  if (!name) return;
  const options = _editingOptions.filter(g => g.label || g.choices.length > 0);
  dbMenu.child(id).update({ name, price, category: cat, options });
  showToast(`已更新「${name}」`);
}

// ── Daily Settlement ──
function openSettlementModal() {
  const paidToday = Object.entries(tables).filter(([, t]) => t.status === 'paid');
  if (paidToday.length === 0) { showToast('今日尚無已結帳桌次'); return; }

  const revenue = paidToday.reduce((sum, [, t]) => sum + (t.paidTotal || calcTotal(t)), 0);
  const rowsHtml = paidToday.map(([, t]) =>
    `<div class="settlement-row"><span class="name">${t.name}</span><span class="amount">$${t.paidTotal || calcTotal(t)}</span></div>`
  ).join('');

  document.getElementById('settlementSummary').innerHTML = `
    ${rowsHtml}
    <div class="settlement-divider"></div>
    <div class="settlement-row settlement-total">
      <span class="name">共 ${paidToday.length} 桌</span>
      <span class="amount">$${revenue}</span>
    </div>
  `;
  document.getElementById('settlementModal').classList.add('open');
}

function doSettlement() {
  const paidToday = Object.entries(tables).filter(([, t]) => t.status === 'paid');
  if (paidToday.length === 0) return;

  const now = new Date();
  const dateKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const revenue = paidToday.reduce((sum, [, t]) => sum + (t.paidTotal || calcTotal(t)), 0);

  const record = {
    date: dateKey,
    settledAt: Date.now(),
    tableCount: paidToday.length,
    revenue,
    tables: paidToday.map(([, t]) => ({ name: t.name, total: t.paidTotal || calcTotal(t) }))
  };

  dbDaily.child(dateKey).set(record)
    .then(() => Promise.all(paidToday.map(([id]) => dbOrders.child(id).remove())))
    .then(() => {
      document.getElementById('settlementModal').classList.remove('open');
      showToast(`日結完成！今日營業額 $${revenue}`);
    })
    .catch(() => showToast('日結失敗，請重試'));
}

function renderHistoryList() {
  const list = document.getElementById('historyList');
  list.innerHTML = '<div class="history-empty">載入中…</div>';

  dbDaily.orderByKey().limitToLast(30).once('value', snap => {
    const data = snap.val();
    if (!data) {
      list.innerHTML = '<div class="history-empty">尚無歷史紀錄</div>';
      return;
    }
    const entries = Object.values(data).sort((a, b) => b.settledAt - a.settledAt);
    list.innerHTML = '';
    entries.forEach(rec => {
      const card = document.createElement('div');
      card.className = 'history-card';
      const tableDetail = rec.tables ? rec.tables.map(t => `${t.name} $${t.total}`).join('・') : '';
      card.innerHTML = `
        <div class="history-card-header">
          <span class="history-date">${rec.date}</span>
          <span class="history-total">$${rec.revenue}</span>
        </div>
        <div class="history-meta">${rec.tableCount} 桌${tableDetail ? '・' + tableDetail : ''}</div>
      `;
      list.appendChild(card);
    });
  });
}

document.getElementById('btnSettlement').addEventListener('click', openSettlementModal);
document.getElementById('btnConfirmSettlement').addEventListener('click', doSettlement);
document.getElementById('btnCancelSettlement').addEventListener('click', () => {
  document.getElementById('settlementModal').classList.remove('open');
});
document.getElementById('btnCloseSettlement').addEventListener('click', () => {
  document.getElementById('settlementModal').classList.remove('open');
});
document.getElementById('settlementModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) document.getElementById('settlementModal').classList.remove('open');
});

document.getElementById('btnHistory').addEventListener('click', () => {
  document.getElementById('historyModal').classList.add('open');
  renderHistoryList();
});
document.getElementById('btnCloseHistory').addEventListener('click', () => {
  document.getElementById('historyModal').classList.remove('open');
});
document.getElementById('historyModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) document.getElementById('historyModal').classList.remove('open');
});

// ── Custom Confirm Dialog ──
let _confirmCallback = null;

function showConfirm({ title = '確認操作', message, danger = true, okLabel = '確定', icon = 'warning' }, onConfirm) {
  document.getElementById('confirmTitle').textContent   = title;
  document.getElementById('confirmMessage').textContent = message;
  document.getElementById('confirmIcon').textContent    = icon;
  const iconWrap = document.getElementById('confirmIconWrap');
  iconWrap.className = 'confirm-icon-wrap' + (danger ? ' danger' : '');
  const okBtn = document.getElementById('btnConfirmOk');
  okBtn.textContent = okLabel;
  okBtn.className   = 'btn-confirm-ok' + (danger ? '' : ' safe');
  _confirmCallback = onConfirm;
  document.getElementById('confirmModal').classList.add('open');
}

document.getElementById('btnConfirmOk').addEventListener('click', () => {
  document.getElementById('confirmModal').classList.remove('open');
  if (_confirmCallback) { _confirmCallback(); _confirmCallback = null; }
});
document.getElementById('btnConfirmCancel').addEventListener('click', () => {
  document.getElementById('confirmModal').classList.remove('open');
  _confirmCallback = null;
});
document.getElementById('confirmModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) {
    document.getElementById('confirmModal').classList.remove('open');
    _confirmCallback = null;
  }
});

// ── Toast ──
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2200);
}
