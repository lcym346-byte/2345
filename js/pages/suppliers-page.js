import { requireLogin } from "../core/auth.js";
import { 
  collection, getDocs, doc, setDoc, deleteDoc, serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const currentUser = await requireLogin(['admin']);
const db = window.firebaseDB;

const list = document.getElementById('supplierList');
const emptyMsg = document.getElementById('emptyMsg');
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modalTitle');

document.getElementById('addBtn').addEventListener('click', () => openModal());
document.getElementById('cancelBtn').addEventListener('click', () => modal.style.display = 'none');
document.getElementById('saveBtn').addEventListener('click', save);

const f = {
  code: document.getElementById('fCode'),
  name: document.getElementById('fName'),
  contact: document.getElementById('fContact'),
  phone: document.getElementById('fPhone'),
  email: document.getElementById('fEmail'),
  address: document.getElementById('fAddress'),
  note: document.getElementById('fNote'),
  active: document.getElementById('fActive'),
};

let editingId = null;

function openModal(item = null) {
  editingId = item ? item.id : null;
  modalTitle.textContent = item ? '編輯供應商' : '新增供應商';
  f.code.value = item?.code || '';
  f.name.value = item?.name || '';
  f.contact.value = item?.contact || '';
  f.phone.value = item?.phone || '';
  f.email.value = item?.email || '';
  f.address.value = item?.address || '';
  f.note.value = item?.note || '';
  f.active.value = item ? String(item.active !== false) : 'true';
  f.code.disabled = !!item;
  modal.style.display = 'flex';
}

async function save() {
  const code = f.code.value.trim();
  const name = f.name.value.trim();
  if (!code || !name) {
    alert('請填寫供應商代碼與名稱');
    return;
  }
  const data = {
    code, name,
    contact: f.contact.value.trim(),
    phone: f.phone.value.trim(),
    email: f.email.value.trim(),
    address: f.address.value.trim(),
    note: f.note.value.trim(),
    active: f.active.value === 'true',
    updatedAt: serverTimestamp(),
  };
  if (!editingId) data.createdAt = serverTimestamp();
  try {
    await setDoc(doc(db, 'suppliers', editingId || code), data, { merge: true });
    modal.style.display = 'none';
    await load();
  } catch (err) {
    alert('儲存失敗：' + err.message);
  }
}

async function remove(id, name) {
  if (!confirm(`確定刪除供應商「${name}」？`)) return;
  try {
    await deleteDoc(doc(db, 'suppliers', id));
    await load();
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

async function load() {
  list.innerHTML = '<p class="loading">載入中...</p>';
  try {
    const snap = await getDocs(query(collection(db, 'suppliers'), orderBy('code')));
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));
    if (items.length === 0) {
      list.innerHTML = '';
      emptyMsg.style.display = 'block';
      return;
    }
    emptyMsg.style.display = 'none';
    list.innerHTML = items.map(s => `
      <div class="data-card ${s.active === false ? 'inactive' : ''}">
        <div class="card-main">
          <div class="card-title">
            <span class="code-tag">${escapeHtml(s.code)}</span>
            ${escapeHtml(s.name)}
            ${s.active === false ? '<span class="status-off">已停用</span>' : ''}
          </div>
          <div class="card-info">
            ${s.contact ? `${escapeHtml(s.contact)}` : ''}
            ${s.phone ? ` ・ ${escapeHtml(s.phone)}` : ''}
          </div>
          ${s.email ? `<div class="card-info">${escapeHtml(s.email)}</div>` : ''}
          ${s.note ? `<div class="card-info note">${escapeHtml(s.note)}</div>` : ''}
        </div>
        <div class="card-actions">
          <button class="btn-edit" data-id="${s.id}">編輯</button>
          <button class="btn-delete" data-id="${s.id}" data-name="${escapeHtml(s.name)}">刪除</button>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => openModal(items.find(x => x.id === btn.dataset.id)));
    });
    list.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', () => remove(btn.dataset.id, btn.dataset.name));
    });
  } catch (err) {
    list.innerHTML = `<p class="error-msg">載入失敗：${err.message}</p>`;
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

load();
