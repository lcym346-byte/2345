import { requireLogin } from "../core/auth.js";
import { 
  collection, getDocs, doc, setDoc, deleteDoc, serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const currentUser = await requireLogin(['admin']);
const db = window.firebaseDB;

const list = document.getElementById('productList');
const emptyMsg = document.getElementById('emptyMsg');
const modal = document.getElementById('modal');
const catModal = document.getElementById('catModal');
const scanModal = document.getElementById('scanModal');
const searchInput = document.getElementById('searchInput');
const categoryFilter = document.getElementById('categoryFilter');

const f = {
  sku: document.getElementById('fSku'),
  name: document.getElementById('fName'),
  barcode: document.getElementById('fBarcode'),
  category: document.getElementById('fCategory'),
  supplier: document.getElementById('fSupplier'),
  unit: document.getElementById('fUnit'),
  price: document.getElementById('fPrice'),
  spec: document.getElementById('fSpec'),
  safetyStock: document.getElementById('fSafetyStock'),
  active: document.getElementById('fActive'),
};

let allProducts = [];
let allCategories = [];
let allSuppliers = [];
let editingId = null;
let qrScanner = null;

// ===== 商品 CRUD =====
document.getElementById('addBtn').addEventListener('click', () => openModal());
document.getElementById('cancelBtn').addEventListener('click', () => modal.style.display = 'none');
document.getElementById('saveBtn').addEventListener('click', saveProduct);
searchInput.addEventListener('input', renderList);
categoryFilter.addEventListener('change', renderList);

function openModal(item = null) {
  editingId = item ? item.id : null;
  document.getElementById('modalTitle').textContent = item ? '編輯商品' : '新增商品';
  f.sku.value = item?.sku || '';
  f.name.value = item?.name || '';
  f.barcode.value = item?.barcode || '';
  f.category.value = item?.categoryId || '';
  f.supplier.value = item?.supplierId || '';
  f.unit.value = item?.unit || '個';
  f.price.value = item?.price ?? '';
  f.spec.value = item?.spec || '';
  f.safetyStock.value = item?.safetyStock ?? 0;
  f.active.value = item ? String(item.active !== false) : 'true';
  f.sku.disabled = !!item;
  modal.style.display = 'flex';
}

async function saveProduct() {
  const sku = f.sku.value.trim();
  const name = f.name.value.trim();
  const price = parseFloat(f.price.value);
  if (!sku || !name || isNaN(price)) {
    alert('請填寫 SKU、名稱與進貨單價');
    return;
  }
  const data = {
    sku, name,
    barcode: f.barcode.value.trim(),
    categoryId: f.category.value || null,
    supplierId: f.supplier.value || null,
    unit: f.unit.value.trim() || '個',
    price: price,
    spec: f.spec.value.trim(),
    safetyStock: parseInt(f.safetyStock.value) || 0,
    active: f.active.value === 'true',
    updatedAt: serverTimestamp(),
  };
  if (!editingId) data.createdAt = serverTimestamp();
  try {
    await setDoc(doc(db, 'products', editingId || sku), data, { merge: true });
    modal.style.display = 'none';
    await loadProducts();
  } catch (err) {
    alert('儲存失敗：' + err.message);
  }
}

async function removeProduct(id, name) {
  if (!confirm(`確定刪除商品「${name}」？`)) return;
  try {
    await deleteDoc(doc(db, 'products', id));
    await loadProducts();
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

async function loadProducts() {
  list.innerHTML = '<p class="loading">載入中...</p>';
  try {
    const snap = await getDocs(query(collection(db, 'products'), orderBy('sku')));
    allProducts = [];
    snap.forEach(d => allProducts.push({ id: d.id, ...d.data() }));
    renderList();
  } catch (err) {
    list.innerHTML = `<p class="error-msg">載入失敗：${err.message}</p>`;
  }
}

function renderList() {
  const keyword = searchInput.value.trim().toLowerCase();
  const catFilter = categoryFilter.value;
  let items = allProducts;
  if (keyword) {
    items = items.filter(p => 
      (p.name || '').toLowerCase().includes(keyword) ||
      (p.sku || '').toLowerCase().includes(keyword) ||
      (p.barcode || '').toLowerCase().includes(keyword)
    );
  }
  if (catFilter) items = items.filter(p => p.categoryId === catFilter);
  
  if (items.length === 0) {
    list.innerHTML = '';
    emptyMsg.style.display = 'block';
    return;
  }
  emptyMsg.style.display = 'none';
  list.innerHTML = items.map(p => {
    const cat = allCategories.find(c => c.id === p.categoryId);
    const sup = allSuppliers.find(s => s.id === p.supplierId);
    return `
      <div class="data-card ${p.active === false ? 'inactive' : ''}">
        <div class="card-main">
          <div class="card-title">
            <span class="code-tag">${escapeHtml(p.sku)}</span>
            ${escapeHtml(p.name)}
            ${p.active === false ? '<span class="status-off">已停用</span>' : ''}
          </div>
          <div class="card-info">
            ${cat ? `[${escapeHtml(cat.name)}]` : ''}
            ${p.spec ? ` ${escapeHtml(p.spec)}` : ''}
          </div>
          <div class="card-info">
            單價：<b>$${Number(p.price || 0).toLocaleString()}</b> / ${escapeHtml(p.unit || '個')}
            ${p.safetyStock > 0 ? ` ・ 安全庫存：${p.safetyStock}` : ''}
          </div>
          ${sup ? `<div class="card-info">供應商：${escapeHtml(sup.name)}</div>` : ''}
          ${p.barcode ? `<div class="card-info barcode">條碼：${escapeHtml(p.barcode)}</div>` : ''}
        </div>
        <div class="card-actions">
          <button class="btn-edit" data-id="${p.id}">編輯</button>
          <button class="btn-delete" data-id="${p.id}" data-name="${escapeHtml(p.name)}">刪除</button>
        </div>
      </div>
    `;
  }).join('');
  list.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', () => openModal(allProducts.find(x => x.id === btn.dataset.id)));
  });
  list.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', () => removeProduct(btn.dataset.id, btn.dataset.name));
  });
}

// ===== 分類管理 =====
document.getElementById('manageCatBtn').addEventListener('click', openCatModal);
document.getElementById('closeCatBtn').addEventListener('click', () => catModal.style.display = 'none');
document.getElementById('addCatBtn').addEventListener('click', addCategory);

async function openCatModal() {
  await loadCategories();
  renderCatList();
  catModal.style.display = 'flex';
}

async function loadCategories() {
  const snap = await getDocs(query(collection(db, 'categories'), orderBy('name')));
  allCategories = [];
  snap.forEach(d => allCategories.push({ id: d.id, ...d.data() }));
  fillCategorySelects();
}

function fillCategorySelects() {
  const opts = '<option value="">未分類</option>' + 
    allCategories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  f.category.innerHTML = opts;
  categoryFilter.innerHTML = '<option value="">全部分類</option>' +
    allCategories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

function renderCatList() {
  const catList = document.getElementById('catList');
  if (allCategories.length === 0) {
    catList.innerHTML = '<p class="empty-msg">尚無分類</p>';
    return;
  }
  catList.innerHTML = allCategories.map(c => `
    <div class="cat-row">
      <span>${escapeHtml(c.name)}</span>
      <button class="btn-delete-sm" data-id="${c.id}" data-name="${escapeHtml(c.name)}">刪除</button>
    </div>
  `).join('');
  catList.querySelectorAll('.btn-delete-sm').forEach(btn => {
    btn.addEventListener('click', () => removeCategory(btn.dataset.id, btn.dataset.name));
  });
}

async function addCategory() {
  const name = document.getElementById('newCatName').value.trim();
  if (!name) return;
  const id = 'cat_' + Date.now();
  try {
    await setDoc(doc(db, 'categories', id), {
      name, createdAt: serverTimestamp()
    });
    document.getElementById('newCatName').value = '';
    await loadCategories();
    renderCatList();
  } catch (err) {
    alert('新增失敗：' + err.message);
  }
}

async function removeCategory(id, name) {
  const used = allProducts.filter(p => p.categoryId === id).length;
  if (used > 0) {
    alert(`此分類有 ${used} 項商品使用中，無法刪除`);
    return;
  }
  if (!confirm(`確定刪除分類「${name}」？`)) return;
  await deleteDoc(doc(db, 'categories', id));
  await loadCategories();
  renderCatList();
  renderList();
}

// ===== 供應商下拉 =====
async function loadSuppliers() {
  const snap = await getDocs(query(collection(db, 'suppliers'), orderBy('code')));
  allSuppliers = [];
  snap.forEach(d => allSuppliers.push({ id: d.id, ...d.data() }));
  f.supplier.innerHTML = '<option value="">無</option>' +
    allSuppliers.filter(s => s.active !== false).map(s => 
      `<option value="${s.id}">${escapeHtml(s.name)}</option>`
    ).join('');
}

// ===== 條碼掃描 =====
document.getElementById('scanBtn').addEventListener('click', startScan);
document.getElementById('closeScanBtn').addEventListener('click', stopScan);

function startScan() {
  scanModal.style.display = 'flex';
  document.getElementById('qrReader').innerHTML = '';
  
  qrScanner = new Html5Qrcode("qrReader");
  
  // 支援格式：QR Code + 各種一維條碼
  const formats = [
    Html5QrcodeSupportedFormats.QR_CODE,
    Html5QrcodeSupportedFormats.EAN_13,
    Html5QrcodeSupportedFormats.EAN_8,
    Html5QrcodeSupportedFormats.CODE_128,
    Html5QrcodeSupportedFormats.CODE_39,
    Html5QrcodeSupportedFormats.CODE_93,
    Html5QrcodeSupportedFormats.UPC_A,
    Html5QrcodeSupportedFormats.UPC_E,
    Html5QrcodeSupportedFormats.ITF,
    Html5QrcodeSupportedFormats.CODABAR,
  ];
  
  const config = {
    fps: 15,
    qrbox: function(w, h) {
      // 長方形掃描框，適合一維條碼
      const minEdge = Math.min(w, h);
      const boxW = Math.floor(minEdge * 0.85);
      const boxH = Math.floor(boxW * 0.5);
      return { width: boxW, height: boxH };
    },
    aspectRatio: 1.333,
    formatsToSupport: formats,
    experimentalFeatures: {
      useBarCodeDetectorIfSupported: true
    },
    rememberLastUsedCamera: true,
  };
  
  qrScanner.start(
    { facingMode: "environment" },
    config,
    (decodedText) => {
      f.barcode.value = decodedText;
      if (navigator.vibrate) navigator.vibrate(200);
      stopScan();
    },
    () => {}
  ).catch(err => {
    alert('無法啟動相機：' + err + '\n\n請確認：\n1. 已允許瀏覽器使用相機\n2. 使用 HTTPS 網址\n3. 手機有後鏡頭');
    scanModal.style.display = 'none';
  });
}

function stopScan() {
  if (qrScanner) {
    qrScanner.stop().then(() => {
      qrScanner.clear();
      qrScanner = null;
    }).catch(() => {
      qrScanner = null;
    });
  }
  scanModal.style.display = 'none';
}



function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// 啟動
await loadCategories();
await loadSuppliers();
await loadProducts();
