import { requireLogin } from "../core/auth.js";
import { 
  collection, getDocs, doc, setDoc, deleteDoc, serverTimestamp, query, orderBy, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const currentUser = await requireLogin(['admin']);
const db = window.firebaseDB;

const storeList = document.getElementById('storeList');
const emptyMsg = document.getElementById('emptyMsg');
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modalTitle');
const addBtn = document.getElementById('addBtn');
const cancelBtn = document.getElementById('cancelBtn');
const saveBtn = document.getElementById('saveBtn');

const f = {
  storeCode: document.getElementById('fStoreCode'),
  storeName: document.getElementById('fStoreName'),
  address: document.getElementById('fAddress'),
  phone: document.getElementById('fPhone'),
  manager: document.getElementById('fManager'),
  storeType: document.getElementById('fStoreType'),
  active: document.getElementById('fActive'),
};

let editingId = null;

addBtn.addEventListener('click', () => openModal());
cancelBtn.addEventListener('click', () => modal.style.display = 'none');
saveBtn.addEventListener('click', saveStore);

function openModal(store = null) {
  editingId = store ? store.id : null;
  modalTitle.textContent = store ? '編輯分店' : '新增分店';
  f.storeCode.value = store?.storeCode || '';
  f.storeName.value = store?.storeName || '';
  f.address.value = store?.address || '';
  f.phone.value = store?.phone || '';
  f.manager.value = store?.manager || '';
  f.storeType.value = store?.storeType || 'branch';
  f.active.value = store ? String(store.active !== false) : 'true';
  f.storeCode.disabled = !!store;
  modal.style.display = 'flex';
}

async function saveStore() {
  const storeCode = f.storeCode.value.trim();
  const storeName = f.storeName.value.trim();
  if (!storeCode || !storeName) {
    alert('請填寫分店代碼與名稱');
    return;
  }
  const data = {
    storeCode,
    storeName,
    address: f.address.value.trim(),
    phone: f.phone.value.trim(),
    manager: f.manager.value.trim(),
    storeType: f.storeType.value || 'branch',
    active: f.active.value === 'true',
    updatedAt: serverTimestamp(),
  };

  const isNew = !editingId;
  if (isNew) {
    data.createdAt = serverTimestamp();
  }
  
  saveBtn.disabled = true;
  
  try {
    const id = editingId || storeCode;
    await setDoc(doc(db, 'stores', id), data, { merge: true });
    
    // 新增分店 → 自動為所有商品建立庫存記錄（qty=0）
    if (isNew) {
      await createInventoryForAllProducts(id, data);
    }
    
    modal.style.display = 'none';
    await loadStores();
  } catch (err) {
    alert('儲存失敗：' + err.message);
  } finally {
    saveBtn.disabled = false;
  }
}

// 新增分店 → 自動為所有商品建立庫存記錄
async function createInventoryForAllProducts(storeId, storeData) {
  try {
    const pSnap = await getDocs(collection(db, 'products'));
    const products = [];
    pSnap.forEach(d => products.push({ id: d.id, ...d.data() }));
    const activeProducts = products.filter(p => p.active !== false);
    if (activeProducts.length === 0) return;
    
    // Firestore batch 上限 500，分批處理
    const chunks = [];
    for (let i = 0; i < activeProducts.length; i += 400) {
      chunks.push(activeProducts.slice(i, i + 400));
    }
    
    for (const chunk of chunks) {
      const batch = writeBatch(db);
      chunk.forEach(p => {
        const invId = storeId + '_' + p.id;
        batch.set(doc(db, 'inventory', invId), {
          storeId,
          productId: p.id,
          sku: p.sku,
          name: p.name,
          unit: p.unit || '個',
          qty: 0,
          safetyStock: p.safetyStock || 0,
          updatedAt: serverTimestamp(),
          updatedBy: currentUser.displayName,
        });
      });
      await batch.commit();
    }
  } catch (e) {
    console.warn('自動建立分店庫存失敗', e);
  }
}

async function deleteStore(id, name) {
  if (!confirm(`確定刪除分店「${name}」？\n（此分店的庫存記錄會一併刪除）`)) return;
  try {
    await deleteDoc(doc(db, 'stores', id));
    // 順便刪掉此分店的所有庫存
    const invSnap = await getDocs(collection(db, 'inventory'));
    const refs = [];
    invSnap.forEach(d => {
      if (d.data().storeId === id) refs.push(d.ref);
    });
    // 分批刪
    for (let i = 0; i < refs.length; i += 400) {
      const batch = writeBatch(db);
      refs.slice(i, i + 400).forEach(r => batch.delete(r));
      await batch.commit();
    }
    await loadStores();
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

async function loadStores() {
  storeList.innerHTML = '<p class="loading">載入中...</p>';
  try {
    const q = query(collection(db, 'stores'), orderBy('storeCode'));
    const snap = await getDocs(q);
    const stores = [];
    snap.forEach(d => stores.push({ id: d.id, ...d.data() }));
    
    if (stores.length === 0) {
      storeList.innerHTML = '';
      emptyMsg.style.display = 'block';
      return;
    }
    emptyMsg.style.display = 'none';
    storeList.innerHTML = stores.map(s => `
      <div class="data-card ${s.active === false ? 'inactive' : ''}">
        <div class="card-main">
          <div class="card-title">
            <span class="code-tag">${escapeHtml(s.storeCode)}</span>
            ${escapeHtml(s.storeName)}
            ${s.storeType === 'hq' ? '<span class="type-hq">總店</span>' : ''}
            ${s.active === false ? '<span class="status-off">已停用</span>' : ''}
          </div>
          <div class="card-info">
            ${s.manager ? `店長：${escapeHtml(s.manager)}` : ''}
            ${s.phone ? ` ・ ${escapeHtml(s.phone)}` : ''}
          </div>
          ${s.address ? `<div class="card-info">${escapeHtml(s.address)}</div>` : ''}
        </div>
        <div class="card-actions">
          <button class="btn-edit" data-id="${s.id}">編輯</button>
          <button class="btn-delete" data-id="${s.id}" data-name="${escapeHtml(s.storeName)}">刪除</button>
        </div>
      </div>
    `).join('');

    storeList.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = stores.find(x => x.id === btn.dataset.id);
        openModal(s);
      });
    });
    storeList.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteStore(btn.dataset.id, btn.dataset.name));
    });
  } catch (err) {
    storeList.innerHTML = `<p class="error-msg">載入失敗：${err.message}</p>`;
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

loadStores();
