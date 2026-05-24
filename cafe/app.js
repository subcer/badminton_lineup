// Firebase config (same project as badminton app)
const firebaseConfig = {
  databaseURL: "https://fir-60db1.firebaseio.com/"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.database().ref('cafe_orders');

// ── State ──
let tables = {}; // { tableId: { name, status, items: { itemId: {name,qty,note,done} } } }
let activeTableId = null;

const STATUS = { empty: '空桌', ordering: '點餐中', served: '已出餐', paid: '已結帳' };
const STATUS_ORDER = ['empty', 'ordering', 'served', 'paid'];

// ── Firebase Sync ──
db.on('value', snap => {
  tables = snap.val() || {};
  renderTables();
  if (activeTableId && tables[activeTableId]) {
    updateModalContent(activeTableId);
  }
});

function saveTable(tableId, data) {
  db.child(tableId).set(data);
}

function deleteTableFromDB(tableId) {
  db.child(tableId).remove();
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
    sorted.forEach(([id, table]) => {
      grid.appendChild(buildTableCard(id, table));
    });
  }

  // Always add the "add table" card at the end
  const addCard = document.createElement('div');
  addCard.className = 'add-table-card';
  addCard.innerHTML = '<i class="fa-solid fa-plus"></i><span>新增餐桌</span>';
  addCard.onclick = () => openAddTableModal();
  grid.appendChild(addCard);
}

function buildTableCard(id, table) {
  const card = document.createElement('div');
  card.className = `table-card status-${table.status}`;
  card.onclick = () => openTableModal(id);

  const items = Object.values(table.items || {});
  const doneCount = items.filter(i => i.done).length;
  const totalCount = items.length;

  const summaryText = items.slice(0, 3).map(i => `${i.name}${i.qty > 1 ? ' x' + i.qty : ''}`).join('、');

  card.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <span class="table-name">${table.name}</span>
      <span class="table-status-badge">${STATUS[table.status]}</span>
    </div>
    <div class="table-summary">${summaryText || '無訂單'}</div>
    ${totalCount > 0 ? `<div class="table-item-count">✓ ${doneCount}/${totalCount} 項完成</div>` : ''}
  `;
  return card;
}

// ── Table Modal ──
function openTableModal(tableId) {
  activeTableId = tableId;
  const overlay = document.getElementById('tableModal');
  overlay.classList.add('open');
  updateModalContent(tableId);
}

function updateModalContent(tableId) {
  const table = tables[tableId];
  if (!table) return;

  document.getElementById('modalTitle').textContent = table.name;

  // Status flow dots
  const dots = document.querySelectorAll('.status-dot');
  const idx = STATUS_ORDER.indexOf(table.status);
  dots.forEach((dot, i) => {
    dot.classList.remove('active', 'done-dot');
    if (i < idx) dot.classList.add('done-dot');
    if (i === idx) dot.classList.add('active');
  });

  // Order items
  renderOrderItems(table);

  // Action buttons
  document.getElementById('btnMarkServed').style.display = table.status === 'ordering' ? '' : 'none';
  document.getElementById('btnMarkPaid').style.display = table.status === 'served' ? '' : 'none';
}

function renderOrderItems(table) {
  const list = document.getElementById('orderList');
  const items = Object.entries(table.items || {});

  if (items.length === 0) {
    list.innerHTML = `<div style="text-align:center;color:var(--muted);padding:20px;font-size:0.88rem;">尚未點餐，請在下方新增品項</div>`;
    return;
  }

  list.innerHTML = '';
  items.forEach(([itemId, item]) => {
    const el = document.createElement('div');
    el.className = `order-item${item.done ? ' done' : ''}`;
    el.innerHTML = `
      <button class="btn-done-item" onclick="toggleItemDone('${itemId}')">
        <i class="fa-solid fa-check"></i>
      </button>
      <div style="flex:1">
        <span class="order-item-name">${item.name}</span>
        ${item.note ? `<span class="order-item-note">${item.note}</span>` : ''}
      </div>
      <span class="order-item-qty">x${item.qty}</span>
      <button class="btn-del-item" onclick="deleteItem('${itemId}')">
        <i class="fa-solid fa-xmark"></i>
      </button>
    `;
    list.appendChild(el);
  });
}

function toggleItemDone(itemId) {
  const table = tables[activeTableId];
  if (!table || !table.items[itemId]) return;
  table.items[itemId].done = !table.items[itemId].done;
  saveTable(activeTableId, table);
}

function deleteItem(itemId) {
  const table = tables[activeTableId];
  if (!table || !table.items) return;
  delete table.items[itemId];
  saveTable(activeTableId, table);
}

// ── Add Item ──
document.getElementById('btnAddItem').addEventListener('click', addItem);
document.getElementById('inputItemName').addEventListener('keydown', e => {
  if (e.key === 'Enter') addItem();
});

function addItem() {
  const name = document.getElementById('inputItemName').value.trim();
  const qty = parseInt(document.getElementById('inputItemQty').value) || 1;
  const note = document.getElementById('inputItemNote').value.trim();

  if (!name || !activeTableId) return;

  const table = tables[activeTableId];
  if (!table.items) table.items = {};

  const itemId = 'item_' + Date.now();
  table.items[itemId] = { name, qty, note, done: false };

  // Auto-set status to ordering when first item added
  if (table.status === 'empty') table.status = 'ordering';

  saveTable(activeTableId, table);

  document.getElementById('inputItemName').value = '';
  document.getElementById('inputItemQty').value = '1';
  document.getElementById('inputItemNote').value = '';
  document.getElementById('inputItemName').focus();

  showToast(`已加入「${name}」`);
}

// Preset menu chips
document.querySelectorAll('.menu-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.getElementById('inputItemName').value = chip.dataset.name;
    document.getElementById('inputItemName').focus();
  });
});

// ── Status Actions ──
document.getElementById('btnMarkServed').addEventListener('click', () => {
  const table = tables[activeTableId];
  if (!table) return;
  table.status = 'served';
  saveTable(activeTableId, table);
  showToast('已標記為「已出餐」');
});

document.getElementById('btnMarkPaid').addEventListener('click', () => {
  const table = tables[activeTableId];
  if (!table) return;
  table.status = 'paid';
  saveTable(activeTableId, table);
  showToast('已結帳！');
});

document.getElementById('btnDeleteTable').addEventListener('click', () => {
  if (!confirm(`確定要刪除「${tables[activeTableId]?.name}」並清空所有訂單？`)) return;
  deleteTableFromDB(activeTableId);
  closeTableModal();
  showToast('餐桌已刪除');
});

// ── Close Modal ──
function closeTableModal() {
  document.getElementById('tableModal').classList.remove('open');
  activeTableId = null;
}

document.getElementById('tableModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeTableModal();
});
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

document.getElementById('addTableModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeAddTableModal();
});
document.getElementById('btnCloseAddModal').addEventListener('click', closeAddTableModal);

document.getElementById('btnAddTable').addEventListener('click', addTable);
document.getElementById('inputTableName').addEventListener('keydown', e => {
  if (e.key === 'Enter') addTable();
});

document.querySelectorAll('.table-preset').forEach(chip => {
  chip.addEventListener('click', () => {
    document.getElementById('inputTableName').value = chip.dataset.name;
  });
});

function addTable() {
  const name = document.getElementById('inputTableName').value.trim();
  if (!name) return;

  const tableId = 'table_' + Date.now();
  const newTable = {
    name,
    status: 'empty',
    order: Date.now(),
    items: {}
  };

  db.child(tableId).set(newTable);
  closeAddTableModal();
  showToast(`已新增「${name}」`);
}

// Header add button
document.getElementById('btnHeaderAdd').addEventListener('click', openAddTableModal);

// ── Toast ──
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2200);
}
