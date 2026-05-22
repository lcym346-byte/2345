import { requireLogin } from "../core/auth.js";
import { 
  collection, getDocs, doc, setDoc, deleteDoc, serverTimestamp, query, orderBy
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
  f.active.value = store ? String(store.active !== false) : 'true';
  f.storeCode.disabled = !!store; // 編輯時代碼不可改
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
    active: f.active.value === 'true',
    updatedAt: serverTimestamp(),
  };
  if (!editingId) {
    data.createdAt = serverTimestamp();
  }
  try {
    const id = editingId || storeCode;
    await setDoc(doc(db, 'stores', id), data, { merge: true });
    modal.style.display = 'none';
    await loadStores();
  } catch (err) {
    alert('儲存失敗：' + err.message);
  }
}

async function deleteStore(id, name) {
  if (!confirm(`確定刪除分店「${name}」？\n刪除後無法復原。`)) return;
  try {
    await deleteDoc(doc(db, 'stores', id));
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
