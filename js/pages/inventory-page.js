import { requireLogin } from "../core/auth.js";
import { 
  collection, getDocs, doc, setDoc, updateDoc, getDoc, addDoc, deleteDoc,
  serverTimestamp, query, orderBy, where, writeBatch, limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const currentUser = await requireLogin();
const db = window.firebaseDB;
const isAdmin = currentUser.role === 'admin';

// DOM
const storeFilter = document.getElementById('storeFilter');
const categoryFilter = document.getElementById('categoryFilter');
const searchInput = document.getElementById('searchInput');
const invList = document.getElementById('invList');
const emptyMsg = document.getElementById('emptyMsg');
const alertBar = document.getElementById('alertBar');
const alertText = document.getElementById('alertText');
const filterLowStock = document.getElementById('filterLowStock');

const tabList = document.getElementById('tabList');
const tabMovement = document.getElementById('tabMovement');
const moveList = document.getElementById('moveList');
const moveEmptyMsg = document.getElementById('moveEmptyMsg');
const moveTypeFilter = document.getElementById('moveTypeFilter');
const moveDateFilter = document.getElementById('moveDateFilter');

let allProducts = [];
let allStores = [];
let allCategories = [];
let allInventory = [];
let allMovements = [];
let onlyLowStock = false;
let currentTab = 'list';

// ===== 標籤切換 =====
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTab = btn.dataset.tab;
    tabList.style.display = (currentTab === 'list') ? 'block' : 'none';
    tabMovement.style.display = (currentTab === 'movement') ? 'block' : 'none';
    if (currentTab === 'movement') loadMovements();
  });
});

// ===== 載入基礎資料 =====
async function loadBaseData() {
  const [pSnap, sSnap, cSnap] = await Promise.all([
    getDocs(query(collection(db, 'products'), orderBy('sku'))),
    getDocs(query(collection(db, 'stores'), orderBy('storeCode'))),
    getDocs(collection(db, 'categories')),
  ]);
  allProducts = [];
  pSnap.forEach(d => allProducts.push({ id: d.id, ...d.data() }));
  allStores = [];
  sSnap.forEach(d => allStores.push({ id: d.id, ...d.data() }));
  allCategories = [];
  cSnap.forEach(d => allCategories.push({ id: d.id, ...d.data() }));

  // 分店下拉
  const activeStores = allStores.filter(s => s.active !== false);
  if (isAdmin) {
    storeFilter.innerHTML = activeStores.map(s => 
      `<option value="${s.id}">${escapeHtml(s.storeCode)} - ${escapeHtml(s.storeName)}</option>`
    ).join('');
  } else {
    const myStore = allStores.find(s => s.id === currentUser.storeId);
    if (myStore) {
      storeFilter.innerHTML = `<option value="${myStore.id}">${escapeHtml(myStore.storeName)}</option>`;
      storeFilter.disabled = true;
    }
  }
  
  // 分類下拉
  categoryFilter.innerHTML = '<option value="">全部分類</option>' +
    allCategories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  
  storeFilter.addEventListener('change', loadInventory);
  categoryFilter.addEventListener('change', renderInventory);
  searchInput.addEventListener('input', renderInventory);
  filterLowStock.addEventListener('click', () => {
    onlyLowStock = !onlyLowStock;
    filterLowStock.textContent = onlyLowStock ? '顯示全部' : '只看不足';
    renderInventory();
  });
}

// ===== 載入庫存（指定分店） =====
async function loadInventory() {
  const storeId = storeFilter.value;
  if (!storeId) return;
  invList.innerHTML = '<p class="loading">載入中...</p>';
  try {
    const snap = await getDocs(query(collection(db, 'inventory'), where('storeId', '==', storeId)));
    allInventory = [];
    snap.forEach(d => allInventory.push({ id: d.id, ...d.data() }));
    
    // 自動補建：商品中有，但 inventory 沒有的，建一筆 qty=0
    await autoFillInventory(storeId);
    
    renderInventory();
  } catch (err) {
    invList.innerHTML = `<p class="error-msg">載入失敗：${err.message}</p>`;
  }
}

async function autoFillInventory(storeId) {
  if (!isAdmin) return; // 分店帳號不自動補建（避免權限問題），由 admin 統一重建
  const existIds = new Set(allInventory.map(i => i.productId));
  const missing = allProducts.filter(p => p.active !== false && !existIds.has(p.id));
  if (missing.length === 0) return;

  
  const batch = writeBatch(db);
  missing.forEach(p => {
    const id = storeId + '_' + p.id;
    const data = {
      storeId,
      productId: p.id,
      sku: p.sku,
      name: p.name,
      unit: p.unit || '個',
      qty: 0,
      safetyStock: 0,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.displayName,
    };
    batch.set(doc(db, 'inventory', id), data);
    allInventory.push({ id, ...data });
  });
  try {
    await batch.commit();
  } catch (e) {
    console.warn('自動建立庫存失敗', e);
  }
}

// ===== 渲染庫存清單 =====
function renderInventory() {
  const keyword = searchInput.value.trim().toLowerCase();
  const catId = categoryFilter.value;
  
  // 判斷目前分店是總店還是分店
  const currentStoreId = storeFilter.value;
  const currentStore = allStores.find(s => s.id === currentStoreId);
  const isHQ = currentStore?.storeType === 'hq';
  
  // 合併：用 allProducts 為主，左連到 inventory（沒資料的當作 0）
  let items = allProducts
    .filter(p => p.active !== false)
    .filter(p => {
      // 依分店類型過濾商品
      const av = p.availableFor || 'all';
      if (av === 'all') return true;
      if (av === 'hq_only') return isHQ;       // 僅總店 → 只有總店看得到
      if (av === 'stores_only') return !isHQ;  // 僅分店 → 只有分店看得到
      return true;
    })
    .map(p => {

      const inv = allInventory.find(i => i.productId === p.id);
      return {
        productId: p.id,
        sku: p.sku,
        name: p.name,
        categoryId: p.categoryId,
        unit: p.unit || '個',
        price: p.price || 0,
        qty: inv?.qty ?? 0,
        safetyStock: inv?.safetyStock ?? 0,
        invId: inv?.id || (storeFilter.value + '_' + p.id),
      };
    });
  
  if (catId) items = items.filter(i => i.categoryId === catId);
  if (keyword) {
    items = items.filter(i => 
      (i.name || '').toLowerCase().includes(keyword) ||
      (i.sku || '').toLowerCase().includes(keyword)
    );
  }
  
  // 庫存不足統計
  const lowItems = items.filter(i => i.safetyStock > 0 && i.qty < i.safetyStock);
  if (lowItems.length > 0) {
    alertBar.style.display = 'flex';
    alertText.textContent = `⚠️ ${lowItems.length} 項商品低於安全庫存`;
  } else {
    alertBar.style.display = 'none';
  }
  
  if (onlyLowStock) items = lowItems;
  
  if (items.length === 0) {
    invList.innerHTML = '';
    emptyMsg.style.display = 'block';
    return;
  }
  emptyMsg.style.display = 'none';
  
  invList.innerHTML = items.map(i => {
    const isLow = i.safetyStock > 0 && i.qty < i.safetyStock;
    return `
      <div class="data-card inv-card ${isLow ? 'low' : ''}">
        <div class="inv-info">
          <div class="inv-name">
            <span class="code-tag">${escapeHtml(i.sku)}</span>
            ${escapeHtml(i.name)}
          </div>
          <div class="inv-meta">
            ${i.safetyStock > 0 ? `安全庫存：${i.safetyStock}` : '未設安全庫存'}
            ・ $${Number(i.price).toLocaleString()}
          </div>
        </div>
        <div class="inv-qty ${isLow ? 'low' : ''}">
          ${i.qty}
          <span class="inv-unit">${escapeHtml(i.unit)}</span>
        </div>
        <div class="inv-actions">
  <button class="btn-edit" data-act="adjust" data-pid="${i.productId}">調整</button>
</div>

      </div>
    `;
  }).join('');
  
  invList.querySelectorAll('[data-act="adjust"]').forEach(btn => {
    btn.addEventListener('click', () => openAdjustModal(btn.dataset.pid));
  });
}

// ===== 動作選單 =====
const actionMenu = document.getElementById('actionMenu');
document.getElementById('actionMenuBtn').addEventListener('click', () => {
  // 分店帳號隱藏破壞性功能
  if (!isAdmin) {
    document.querySelector('[data-act="import"]').style.display = 'none';
    document.querySelector('[data-act="rebuild"]').style.display = 'none';
  }
  actionMenu.style.display = 'block';
});

actionMenu.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', () => {
    actionMenu.style.display = 'none';
    const act = btn.dataset.act;
    if (act === 'close') return;
    if (act === 'adjust') openAdjustModal();
    else if (act === 'stocktake') openStocktakeModal();
    else if (act === 'setSafety') openSafetyModal();
    else if (act === 'import') openImportModal();
    else if (act === 'export') exportExcel();
    else if (act === 'rebuild') rebuildInventory();
  });
});

// ===== 手動調整單一商品 =====
const adjustModal = document.getElementById('adjustModal');
const adjustProductInfo = document.getElementById('adjustProductInfo');
const adjustCurrentQty = document.getElementById('adjustCurrentQty');
const adjustMode = document.getElementById('adjustMode');
const adjustQty = document.getElementById('adjustQty');
const adjustAfterQty = document.getElementById('adjustAfterQty');
const adjustReason = document.getElementById('adjustReason');
const adjustNote = document.getElementById('adjustNote');
let adjustingProductId = null;

document.getElementById('adjustCancelBtn').addEventListener('click', () => adjustModal.style.display = 'none');
document.getElementById('adjustSaveBtn').addEventListener('click', saveAdjust);
adjustMode.addEventListener('change', updateAdjustPreview);
adjustQty.addEventListener('input', updateAdjustPreview);

function openAdjustModal(productId) {
  if (!productId) {
    // 從動作選單進來，沒指定商品，要先讓使用者選
    const sku = prompt('請輸入要調整的商品 SKU：');
    if (!sku) return;
    const p = allProducts.find(x => x.sku === sku);
    if (!p) {
      alert('找不到 SKU：' + sku);
      return;
    }
    productId = p.id;
  }
  adjustingProductId = productId;
  const p = allProducts.find(x => x.id === productId);
  const inv = allInventory.find(i => i.productId === productId);
  const curQty = inv?.qty ?? 0;
  
  adjustProductInfo.textContent = `${p.sku}  ${p.name}`;
  adjustCurrentQty.textContent = `${curQty} ${p.unit || '個'}`;
  adjustMode.value = 'add';
  adjustQty.value = '';
  adjustAfterQty.textContent = '--';
  adjustReason.value = '進貨';
  adjustNote.value = '';
  
  adjustModal.style.display = 'flex';
}

function updateAdjustPreview() {
  const inv = allInventory.find(i => i.productId === adjustingProductId);
  const curQty = inv?.qty ?? 0;
  const mode = adjustMode.value;
  const n = parseInt(adjustQty.value) || 0;
  let after = curQty;
  if (mode === 'add') after = curQty + n;
  else if (mode === 'sub') after = curQty - n;
  else if (mode === 'set') after = n;
  adjustAfterQty.textContent = after;
  adjustAfterQty.style.color = after < 0 ? '#dc2626' : '#1e40af';
}

async function saveAdjust() {
  const n = parseInt(adjustQty.value) || 0;
  if (n <= 0 && adjustMode.value !== 'set') {
    alert('請輸入大於 0 的數量');
    return;
  }
  const p = allProducts.find(x => x.id === adjustingProductId);
  const storeId = storeFilter.value;
  const store = allStores.find(s => s.id === storeId);
  const inv = allInventory.find(i => i.productId === adjustingProductId);
  const curQty = inv?.qty ?? 0;
  const mode = adjustMode.value;
  let after = curQty;
  let change = 0;
  if (mode === 'add') { after = curQty + n; change = n; }
  else if (mode === 'sub') { after = curQty - n; change = -n; }
  else if (mode === 'set') { after = n; change = n - curQty; }
  
  if (after < 0) {
    if (!confirm('調整後庫存將為負數，確定？')) return;
  }
  
  const reason = adjustReason.value;
  const note = adjustNote.value.trim();
  
  try {
    await applyStockChange({
      storeId,
      storeName: store.storeName,
      productId: adjustingProductId,
      sku: p.sku,
      name: p.name,
      unit: p.unit || '個',
      qtyBefore: curQty,
      qtyChange: change,
      qtyAfter: after,
      type: 'adjust',
      reason,
      note,
    });
    adjustModal.style.display = 'none';
    await loadInventory();
    alert('調整完成');
  } catch (err) {
    alert('儲存失敗：' + err.message);
  }
}

// ===== 套用庫存變動（核心函式） =====
async function applyStockChange({ storeId, storeName, productId, sku, name, unit, qtyBefore, qtyChange, qtyAfter, type, reason, note, refOrderNo }) {
  const invId = storeId + '_' + productId;
  const invRef = doc(db, 'inventory', invId);
  
  // 1. 更新 inventory
  await setDoc(invRef, {
    storeId,
    productId,
    sku,
    name,
    unit,
    qty: qtyAfter,
    safetyStock: allInventory.find(i => i.id === invId)?.safetyStock ?? 0,
    updatedAt: serverTimestamp(),
    updatedBy: currentUser.displayName,
  }, { merge: true });
  
  // 2. 寫入異動紀錄
  await addDoc(collection(db, 'stockMovements'), {
    storeId,
    storeName: storeName || '',
    productId,
    sku,
    name,
    unit,
    type,                // 'in' | 'out' | 'adjust' | 'stocktake' | 'order_received' | 'order_shipped'
    qtyBefore,
    qtyChange,
    qtyAfter,
    reason: reason || '',
    note: note || '',
    refOrderNo: refOrderNo || '',
    createdAt: serverTimestamp(),
    createdBy: currentUser.uid,
    createdByName: currentUser.displayName,
  });
}

// ===== 盤點 =====
const stocktakeModal = document.getElementById('stocktakeModal');
const stocktakeList = document.getElementById('stocktakeList');
const stocktakeSearch = document.getElementById('stocktakeSearch');
const stocktakeCategory = document.getElementById('stocktakeCategory');
let stocktakeInputs = {};

document.getElementById('stocktakeCancelBtn').addEventListener('click', () => stocktakeModal.style.display = 'none');
document.getElementById('stocktakeSaveBtn').addEventListener('click', saveStocktake);
stocktakeSearch.addEventListener('input', renderStocktake);
stocktakeCategory.addEventListener('change', renderStocktake);

function openStocktakeModal() {
  stocktakeInputs = {};
  stocktakeSearch.value = '';
  stocktakeCategory.innerHTML = '<option value="">全部分類</option>' +
    allCategories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  stocktakeCategory.value = '';
  renderStocktake();
  stocktakeModal.style.display = 'flex';
}

function renderStocktake() {
  const keyword = stocktakeSearch.value.trim().toLowerCase();
  const catId = stocktakeCategory.value;
  let items = allProducts.filter(p => p.active !== false);
  if (catId) items = items.filter(p => p.categoryId === catId);
  if (keyword) {
    items = items.filter(p => 
      (p.name || '').toLowerCase().includes(keyword) ||
      (p.sku || '').toLowerCase().includes(keyword)
    );
  }
  
  stocktakeList.innerHTML = items.map(p => {
    const inv = allInventory.find(i => i.productId === p.id);
    const curQty = inv?.qty ?? 0;
    const inputVal = stocktakeInputs[p.id] ?? '';
    return `
      <div class="st-item">
        <div class="st-name">
          <span class="code-tag">${escapeHtml(p.sku)}</span>
          ${escapeHtml(p.name)}
        </div>
        <span class="st-current">系統：${curQty}</span>
        <input type="number" class="st-input" data-pid="${p.id}" value="${inputVal}" min="0" placeholder="${curQty}">
      </div>
    `;
  }).join('');
  stocktakeList.querySelectorAll('.st-input').forEach(inp => {
    inp.addEventListener('input', () => {
      const pid = inp.dataset.pid;
      const v = inp.value.trim();
      if (v === '') {
        delete stocktakeInputs[pid];
        inp.classList.remove('changed');
      } else {
        stocktakeInputs[pid] = parseInt(v) || 0;
        const inv = allInventory.find(i => i.productId === pid);
        const curQty = inv?.qty ?? 0;
        if (stocktakeInputs[pid] !== curQty) inp.classList.add('changed');
        else inp.classList.remove('changed');
      }
    });
  });
}

async function saveStocktake() {
  const changes = [];
  const storeId = storeFilter.value;
  const store = allStores.find(s => s.id === storeId);
  for (const [productId, newQty] of Object.entries(stocktakeInputs)) {
    const inv = allInventory.find(i => i.productId === productId);
    const curQty = inv?.qty ?? 0;
    if (newQty === curQty) continue;
    const p = allProducts.find(x => x.id === productId);
    changes.push({
      productId, p, curQty, newQty, change: newQty - curQty,
    });
  }
  if (changes.length === 0) {
    alert('沒有任何數量變動');
    return;
  }
  if (!confirm(`共 ${changes.length} 項商品需要調整，確定儲存？`)) return;
  
  document.getElementById('stocktakeSaveBtn').disabled = true;
  try {
    for (const c of changes) {
      await applyStockChange({
        storeId,
        storeName: store.storeName,
        productId: c.productId,
        sku: c.p.sku,
        name: c.p.name,
        unit: c.p.unit || '個',
        qtyBefore: c.curQty,
        qtyChange: c.change,
        qtyAfter: c.newQty,
        type: 'stocktake',
        reason: '盤點調整',
      });
    }
    stocktakeModal.style.display = 'none';
    await loadInventory();
    alert(`已調整 ${changes.length} 項商品`);
  } catch (err) {
    alert('儲存失敗：' + err.message);
  } finally {
    document.getElementById('stocktakeSaveBtn').disabled = false;
  }
}

// ===== 設定安全庫存 =====
const safetyModal = document.getElementById('safetyModal');
const safetyList = document.getElementById('safetyList');
const safetySearch = document.getElementById('safetySearch');
let safetyInputs = {};

document.getElementById('safetyCancelBtn').addEventListener('click', () => safetyModal.style.display = 'none');
document.getElementById('safetySaveBtn').addEventListener('click', saveSafety);
safetySearch.addEventListener('input', renderSafety);

function openSafetyModal() {
  safetyInputs = {};
  safetySearch.value = '';
  renderSafety();
  safetyModal.style.display = 'flex';
}

function renderSafety() {
  const keyword = safetySearch.value.trim().toLowerCase();
  
  // 依分店類型過濾商品
  const currentStoreId = storeFilter.value;
  const currentStore = allStores.find(s => s.id === currentStoreId);
  const isHQ = currentStore?.storeType === 'hq';
  
  let items = allProducts.filter(p => p.active !== false).filter(p => {
    const av = p.availableFor || 'all';
    if (av === 'all') return true;
    if (av === 'hq_only') return isHQ;
    if (av === 'stores_only') return !isHQ;
    return true;
  });
  
  if (keyword) {

    items = items.filter(p => 
      (p.name || '').toLowerCase().includes(keyword) ||
      (p.sku || '').toLowerCase().includes(keyword)
    );
  }
  safetyList.innerHTML = items.map(p => {
    const inv = allInventory.find(i => i.productId === p.id);
    const curSafety = safetyInputs[p.id] ?? (inv?.safetyStock ?? 0);
    return `
      <div class="st-item">
        <div class="st-name">
          <span class="code-tag">${escapeHtml(p.sku)}</span>
          ${escapeHtml(p.name)}
        </div>
        <span class="st-current">目前：${inv?.qty ?? 0}</span>
        <input type="number" class="st-input safety-input" data-pid="${p.id}" value="${curSafety}" min="0">
      </div>
    `;
  }).join('');
  safetyList.querySelectorAll('.safety-input').forEach(inp => {
    inp.addEventListener('input', () => {
      safetyInputs[inp.dataset.pid] = parseInt(inp.value) || 0;
    });
  });
}

async function saveSafety() {
  const storeId = storeFilter.value;
  const entries = Object.entries(safetyInputs);
  if (entries.length === 0) {
    alert('未變動任何項目');
    return;
  }
  if (!confirm(`將更新 ${entries.length} 項商品的安全庫存？`)) return;
  
  document.getElementById('safetySaveBtn').disabled = true;
  try {
    const batch = writeBatch(db);
    for (const [productId, safetyStock] of entries) {
      const invId = storeId + '_' + productId;
      const p = allProducts.find(x => x.id === productId);
      batch.set(doc(db, 'inventory', invId), {
        storeId,
        productId,
        sku: p.sku,
        name: p.name,
        unit: p.unit || '個',
        qty: allInventory.find(i => i.id === invId)?.qty ?? 0,
        safetyStock: parseInt(safetyStock) || 0,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.displayName,
      }, { merge: true });
    }
    await batch.commit();
    safetyModal.style.display = 'none';
    await loadInventory();
    alert('安全庫存設定完成');
  } catch (err) {
    alert('儲存失敗：' + err.message);
  } finally {
    document.getElementById('safetySaveBtn').disabled = false;
  }
}

// ===== Excel 匯出 =====
function exportExcel() {
  const storeId = storeFilter.value;
  const store = allStores.find(s => s.id === storeId);
  const data = allProducts
    .filter(p => p.active !== false)
    .map(p => {
      const inv = allInventory.find(i => i.productId === p.id);
      return {
        SKU: p.sku,
        商品名稱: p.name,
        單位: p.unit || '個',
        數量: inv?.qty ?? 0,
        安全庫存: inv?.safetyStock ?? 0,
      };
    });
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '庫存');
  const dt = new Date().toISOString().slice(0,10);
  XLSX.writeFile(wb, `庫存_${store.storeName}_${dt}.xlsx`);
}

// ===== Excel 匯入 =====
const importModal = document.getElementById('importModal');
const importFile = document.getElementById('importFile');
const importPreview = document.getElementById('importPreview');
const importConfirmBtn = document.getElementById('importConfirmBtn');
let parsedRows = [];

document.getElementById('importCancelBtn').addEventListener('click', () => importModal.style.display = 'none');
importConfirmBtn.addEventListener('click', confirmImport);
importFile.addEventListener('change', handleImportFile);

function openImportModal() {
  importFile.value = '';
  importPreview.innerHTML = '';
  parsedRows = [];
  importConfirmBtn.disabled = true;
  importModal.style.display = 'flex';
}

async function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws);
  
  parsedRows = rows.map(r => {
    const sku = String(r.SKU || r.sku || '').trim();
    const qty = parseInt(r.數量 || r.qty || 0) || 0;
    const safety = parseInt(r.安全庫存 || r.safetyStock || 0) || 0;
    const p = allProducts.find(x => x.sku === sku);
    return { sku, qty, safety, found: !!p, productId: p?.id, name: p?.name || '（未找到）' };
  });
  
  const ok = parsedRows.filter(r => r.found).length;
  const fail = parsedRows.filter(r => !r.found).length;
  importPreview.innerHTML = `
    <div>共 ${parsedRows.length} 筆：<span class="ok">${ok} 筆可匯入</span>　<span class="fail">${fail} 筆 SKU 找不到</span></div>
    ${fail > 0 ? `<div class="fail">未找到的 SKU：${parsedRows.filter(r=>!r.found).map(r=>r.sku).join(', ')}</div>` : ''}
  `;
  importConfirmBtn.disabled = ok === 0;
}

async function confirmImport() {
  if (!confirm(`確定匯入 ${parsedRows.filter(r=>r.found).length} 筆庫存資料（將直接覆蓋現有數量）？`)) return;
  const storeId = storeFilter.value;
  const store = allStores.find(s => s.id === storeId);
  importConfirmBtn.disabled = true;
  let success = 0;
  try {
    for (const r of parsedRows) {
      if (!r.found) continue;
      const p = allProducts.find(x => x.id === r.productId);
      const inv = allInventory.find(i => i.productId === r.productId);
      const curQty = inv?.qty ?? 0;
      await applyStockChange({
        storeId,
        storeName: store.storeName,
        productId: r.productId,
        sku: p.sku,
        name: p.name,
        unit: p.unit || '個',
        qtyBefore: curQty,
        qtyChange: r.qty - curQty,
        qtyAfter: r.qty,
        type: 'adjust',
        reason: 'Excel 匯入',
      });
      // 更新安全庫存
      if (r.safety > 0) {
        const invId = storeId + '_' + r.productId;
        await updateDoc(doc(db, 'inventory', invId), { safetyStock: r.safety });
      }
      success++;
    }
    importModal.style.display = 'none';
    await loadInventory();
    alert(`匯入完成，共處理 ${success} 筆`);
  } catch (err) {
    alert('匯入失敗：' + err.message);
  } finally {
    importConfirmBtn.disabled = false;
  }
}

// ===== 重建庫存（補建所有商品在所有分店的庫存記錄） =====
async function rebuildInventory() {
  if (!confirm('將補建所有分店與商品的庫存記錄（已有資料不會覆蓋），確定？')) return;
  const stores = allStores.filter(s => s.active !== false);
  let total = 0, created = 0;
  
  try {
    for (const s of stores) {
      const snap = await getDocs(query(collection(db, 'inventory'), where('storeId', '==', s.id)));
      const existIds = new Set();
      snap.forEach(d => existIds.add(d.data().productId));
      
      const batch = writeBatch(db);
      let batchCount = 0;
      for (const p of allProducts) {
        if (p.active === false) continue;
        total++;
        if (existIds.has(p.id)) continue;
        const id = s.id + '_' + p.id;
        batch.set(doc(db, 'inventory', id), {
          storeId: s.id,
          productId: p.id,
          sku: p.sku,
          name: p.name,
          unit: p.unit || '個',
          qty: 0,
          safetyStock: 0,
          updatedAt: serverTimestamp(),
          updatedBy: currentUser.displayName,
        });
        created++;
        batchCount++;
        if (batchCount >= 400) {
          await batch.commit();
          batchCount = 0;
        }
      }
      if (batchCount > 0) await batch.commit();
    }
    alert(`完成：總共 ${total} 個組合，新建 ${created} 筆`);
    await loadInventory();
  } catch (err) {
    alert('重建失敗：' + err.message);
  }
}

// ===== 異動紀錄 =====
moveTypeFilter.addEventListener('change', renderMovements);
moveDateFilter.addEventListener('change', renderMovements);

async function loadMovements() {
  moveList.innerHTML = '<p class="loading">載入中...</p>';
  try {
    const storeId = storeFilter.value;
    let q;
    if (storeId) {
      q = query(
        collection(db, 'stockMovements'),
        where('storeId', '==', storeId),
        orderBy('createdAt', 'desc'),
        limit(200)
      );
    } else {
      q = query(collection(db, 'stockMovements'), orderBy('createdAt', 'desc'), limit(200));
    }
    const snap = await getDocs(q);
    allMovements = [];
    snap.forEach(d => allMovements.push({ id: d.id, ...d.data() }));
    renderMovements();
  } catch (err) {
    moveList.innerHTML = `<p class="error-msg">載入失敗：${err.message}<br>${err.message.includes('index') ? '請點錯誤訊息中的連結建立索引' : ''}</p>`;
  }
}

function renderMovements() {
  let items = allMovements;
  const tf = moveTypeFilter.value;
  const df = moveDateFilter.value;
  if (tf) items = items.filter(m => m.type === tf);
  if (df) {
    items = items.filter(m => {
      const d = m.createdAt?.toDate ? m.createdAt.toDate() : new Date(m.createdAt);
      const ds = d.toISOString().slice(0, 10);
      return ds === df;
    });
  }
  
  if (items.length === 0) {
    moveList.innerHTML = '';
    moveEmptyMsg.style.display = 'block';
    return;
  }
  moveEmptyMsg.style.display = 'none';
  
  moveList.innerHTML = items.map(m => {
    const d = m.createdAt?.toDate ? m.createdAt.toDate() : new Date(m.createdAt);
    const dateStr = isNaN(d) ? '' : d.toLocaleString('zh-TW', { hour12: false });
    const change = m.qtyChange > 0 ? `+${m.qtyChange}` : m.qtyChange;
    const changeClass = m.qtyChange > 0 ? 'plus' : (m.qtyChange < 0 ? 'minus' : '');
    return `
      <div class="data-card" data-id="${m.id}">
        <div class="card-main">
          <div class="card-title">
            <span class="move-type move-type-${m.type}">${moveTypeLabel(m.type)}</span>
            ${escapeHtml(m.sku)} ${escapeHtml(m.name)}
          </div>
          <div class="card-info">
            ${m.storeName ? `<b>${escapeHtml(m.storeName)}</b> ・ ` : ''}
            ${m.qtyBefore} → ${m.qtyAfter} 
            <span class="move-change ${changeClass}">(${change})</span>
            ${m.unit ? escapeHtml(m.unit) : ''}
          </div>
          <div class="card-info">
            ${escapeHtml(m.reason || '')}
            ${m.refOrderNo ? `・ 來自 ${escapeHtml(m.refOrderNo)}` : ''}
          </div>
          <div class="card-info" style="font-size:12px;color:#9ca3af">
            ${escapeHtml(m.createdByName || '')} ・ ${dateStr}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function moveTypeLabel(t) {
  return {
    in: '進貨', out: '出貨', adjust: '調整', stocktake: '盤點',
    order_received: '叫貨收貨', order_shipped: '叫貨出貨',
  }[t] || t;
}

// ===== 工具 =====
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// 啟動
await loadBaseData();
await loadInventory();
