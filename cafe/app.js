// ── Firebase ──
const firebaseConfig = { databaseURL: "https://fir-60db1.firebaseio.com/" };
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

const dbOrders = firebase.database().ref('cafe_orders');
const dbMenu   = firebase.database().ref('cafe_menu');

// ── State ──
let tables    = {};  // { tableId: { name, status, order, items: { itemId: {name,qty,note,done,price} } } }
let menuItems = {};  // { menuItemId: { name, price, category, order } }
let activeTableId = null;

const STATUS       = { empty: '空桌', ordering: '點餐中', served: '已出餐', paid: '已結帳' };
const STATUS_ORDER = ['empty', 'ordering', 'served', 'paid'];

// ── Firebase Listeners ──
dbOrders.on('value', snap => {
  tables = snap.val() || {};
  renderTables();
  updateHeaderCount();
  if (activeTableId && tables[activeTableId]) updateModalContent(activeTableId);
});

dbMenu.on('value', snap => {
  menuItems = snap.val() || {};
  renderMenuPicker();
  renderMenuItemsList();
});

// ── Helpers ──
function calcTotal(table) {
  return Object.values(table.items || {}).reduce((sum, item) => {
    return sum + (Number(item.price) || 0) * (Number(item.qty) || 1);
  }, 0);
}

function fmtPrice(n) {
  return n > 0 ? `$${n}` : '—';
}

function updateHeaderCount() {
  const count = Object.keys(tables).length;
  document.getElementById('tableCount').textContent = `${count} 桌`;
}

// ── Render Tables ──
function renderTables() {
  const grid = document.getElementById('tablesGrid');
  const sorted = Object.entries(tables).sort((a, b) => a[1].order - b[1].order);
  grid.innerHTML = '';

  if (sorted.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <i class="fa-solid fa-mug-hot"></i>
      <p>還沒有餐桌，點右上角「+桌」新增</p>
    </div>`;
  } else {
    sorted.forEach(([id, table]) => grid.appendChild(buildTableCard(id, table)));
  }

  const addCard = document.createElement('div');
  addCard.className = 'add-table-card';
  addCard.innerHTML = '<i class="fa-solid fa-plus"></i><span>新增餐桌</span>';
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
  const summaryText = items.slice(0, 3).map(i => `${i.name}${i.qty > 1 ? ' ×' + i.qty : ''}`).join('、');

  card.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
      <span class="table-name">${table.name}</span>
      <span class="table-status-badge">${STATUS[table.status]}</span>
    </div>
    <div class="table-summary">${summaryText || '無訂單'}</div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:4px;">
      ${items.length > 0 ? `<span class="table-item-count">✓ ${doneCount}/${items.length}</span>` : '<span></span>'}
      <span class="table-total">${total > 0 ? '$' + total : '—'}</span>
    </div>
  `;
  return card;
}

// ── Table Modal ──
function openTableModal(tableId) {
  activeTableId = tableId;
  document.getElementById('tableModal').classList.add('open');
  updateModalContent(tableId);
}

function updateModalContent(tableId) {
  const table = tables[tableId];
  if (!table) return;

  document.getElementById('modalTitle').textContent = table.name;

  // Status dots
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
    list.innerHTML = `<div class="order-empty">尚未點餐，請從菜單快選或輸入品項</div>`;
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

// ── Add Item ──
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

// ── Menu Picker (inside table modal) ──
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
    chip.innerHTML = `<span class="mpc-name">${item.name}</span><span class="mpc-price">${item.price > 0 ? '$' + item.price : '—'}</span>`;
    chip.addEventListener('click', () => {
      document.getElementById('inputItemName').value  = item.name;
      document.getElementById('inputItemPrice').value = item.price || '';
      document.getElementById('inputItemName').focus();
    });
    picker.appendChild(chip);
  });
}

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
  table.status = 'paid';
  dbOrders.child(activeTableId).set(table);
  const total = calcTotal(table);
  showToast(`已結帳！${total > 0 ? ' 共 $' + total : ''}`);
});

document.getElementById('btnDeleteTable').addEventListener('click', () => {
  if (!confirm(`確定要刪除「${tables[activeTableId]?.name}」並清空所有訂單？`)) return;
  dbOrders.child(activeTableId).remove();
  closeTableModal();
  showToast('餐桌已刪除');
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

function addMenuItem() {
  const name     = document.getElementById('inputMenuName').value.trim();
  const price    = parseFloat(document.getElementById('inputMenuPrice').value) || 0;
  const category = document.getElementById('inputMenuCategory').value;

  if (!name) return;

  const id = 'menu_' + Date.now();
  dbMenu.child(id).set({ name, price, category, order: Date.now() });

  document.getElementById('inputMenuName').value  = '';
  document.getElementById('inputMenuPrice').value = '';
  document.getElementById('inputMenuName').focus();
  showToast(`已新增菜單品項「${name}」`);
}

function deleteMenuItem(id) {
  if (!confirm(`確定刪除「${menuItems[id]?.name}」？`)) return;
  dbMenu.child(id).remove();
  showToast('已刪除品項');
}

function renderMenuItemsList() {
  const list = document.getElementById('menuItemsList');
  const sorted = Object.entries(menuItems).sort((a, b) => a[1].order - b[1].order);

  if (sorted.length === 0) {
    list.innerHTML = `<div class="order-empty" style="padding:24px 0;">尚無品項，請在上方新增</div>`;
    return;
  }

  // Group by category
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
      row.innerHTML = `
        <span class="menu-manage-name">${item.name}</span>
        <span class="menu-manage-price">${item.price > 0 ? '$' + item.price : '未定價'}</span>
        <button class="btn-del-item" onclick="deleteMenuItem('${id}')">
          <i class="fa-solid fa-trash"></i>
        </button>
      `;
      section.appendChild(row);
    });
    list.appendChild(section);
  });
}

// ── Toast ──
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2200);
}
