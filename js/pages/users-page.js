import { requireLogin } from "../core/auth.js";
import { 
  collection, getDocs, doc, setDoc, updateDoc, getDoc,
  serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  createUserWithEmailAndPassword, sendPasswordResetEmail,
  signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const currentUser = await requireLogin(['admin']);
const db = window.firebaseDB;
const auth = window.firebaseAuth;

const list = document.getElementById('userList');
const emptyMsg = document.getElementById('emptyMsg');
const modal = document.getElementById('modal');
const confirmModal = document.getElementById('confirmModal');
const searchInput = document.getElementById('searchInput');
const roleFilter = document.getElementById('roleFilter');
const storeFilter = document.getElementById('storeFilter');

const f = {
  email: document.getElementById('fEmail'),
  password: document.getElementById('fPassword'),
  displayName: document.getElementById('fDisplayName'),
  role: document.getElementById('fRole'),
  storeId: document.getElementById('fStoreId'),
  phone: document.getElementById('fPhone'),
  active: document.getElementById('fActive'),
};

let allUsers = [];
let allStores = [];
let editingId = null;

// 按鈕綁定
document.getElementById('addBtn').addEventListener('click', () => openModal());
document.getElementById('cancelBtn').addEventListener('click', () => modal.style.display = 'none');
document.getElementById('saveBtn').addEventListener('click', save);
searchInput.addEventListener('input', renderList);
roleFilter.addEventListener('change', renderList);
storeFilter.addEventListener('change', renderList);
f.role.addEventListener('change', toggleStoreField);

// ===== 載入基礎資料 =====
async function loadStores() {
  const snap = await getDocs(query(collection(db, 'stores'), orderBy('storeCode')));
  allStores = [];
  snap.forEach(d => allStores.push({ id: d.id, ...d.data() }));
  
  const activeStores = allStores.filter(s => s.active !== false);
  f.storeId.innerHTML = '<option value="">請選擇分店</option>' + 
    activeStores.map(s => `<option value="${s.id}">${escapeHtml(s.storeCode)} - ${escapeHtml(s.storeName)}${s.storeType === 'hq' ? ' (總店)' : ''}</option>`).join('');
  
  storeFilter.innerHTML = '<option value="">全部分店</option>' +
    activeStores.map(s => `<option value="${s.id}">${escapeHtml(s.storeName)}</option>`).join('') +
    '<option value="__none__">未綁定</option>';
}

async function loadUsers() {
  list.innerHTML = '<p class="loading">載入中...</p>';
  try {
    const snap = await getDocs(collection(db, 'users'));
    allUsers = [];
    snap.forEach(d => allUsers.push({ id: d.id, ...d.data() }));
    renderList();
  } catch (err) {
    list.innerHTML = `<p class="error-msg">載入失敗：${err.message}</p>`;
  }
}

function renderList() {
  const keyword = searchInput.value.trim().toLowerCase();
  const rf = roleFilter.value;
  const sf = storeFilter.value;
  let items = [...allUsers];
  
  if (keyword) {
    items = items.filter(u => 
      (u.displayName||'').toLowerCase().includes(keyword) ||
      (u.email||'').toLowerCase().includes(keyword)
    );
  }
  if (rf) items = items.filter(u => u.role === rf);
  if (sf === '__none__') items = items.filter(u => !u.storeId);
  else if (sf) items = items.filter(u => u.storeId === sf);
  
  // 排序：admin > manager > staff，再依姓名
  const roleOrder = { admin: 0, manager: 1, staff: 2 };
  items.sort((a, b) => {
    const ra = roleOrder[a.role] ?? 99;
    const rb = roleOrder[b.role] ?? 99;
    if (ra !== rb) return ra - rb;
    return (a.displayName||'').localeCompare(b.displayName||'');
  });
  
  if (items.length === 0) {
    list.innerHTML = '';
    emptyMsg.style.display = 'block';
    return;
  }
  emptyMsg.style.display = 'none';
  list.innerHTML = items.map(u => {
    const store = allStores.find(s => s.id === u.storeId);
    const roleInfo = roleLabel(u.role);
    const isSelf = u.id === currentUser.uid;
    return `
      <div class="data-card ${u.active === false ? 'inactive' : ''}">
        <div class="card-main">
          <div class="card-title">
            <span class="role-tag role-${u.role}">${roleInfo}</span>
            ${escapeHtml(u.displayName || '(未命名)')}
            ${isSelf ? '<span class="self-tag">您自己</span>' : ''}
            ${u.active === false ? '<span class="status-off">已停用</span>' : ''}
          </div>
          <div class="card-info">${escapeHtml(u.email || '')}</div>
          ${store ? `<div class="card-info">分店：${escapeHtml(store.storeName)}</div>` : 
            (u.role !== 'admin' ? '<div class="card-info" style="color:#dc2626">⚠ 未綁定分店</div>' : '')}
          ${u.phone ? `<div class="card-info">電話：${escapeHtml(u.phone)}</div>` : ''}
        </div>
        <div class="card-actions">
          <button class="btn-edit" data-id="${u.id}">編輯</button>
          ${!isSelf ? `<button class="btn-warn-sm" data-act="reset" data-id="${u.id}" data-email="${escapeHtml(u.email)}">重設密碼</button>` : ''}
          ${!isSelf && u.active !== false ? `<button class="btn-delete" data-act="disable" data-id="${u.id}" data-name="${escapeHtml(u.displayName||u.email)}">停用</button>` : ''}
          ${!isSelf && u.active === false ? `<button class="btn-edit" data-act="enable" data-id="${u.id}">啟用</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
  
  list.querySelectorAll('.btn-edit:not([data-act])').forEach(btn => {
    btn.addEventListener('click', () => openModal(allUsers.find(x => x.id === btn.dataset.id)));
  });
  list.querySelectorAll('[data-act="reset"]').forEach(btn => {
    btn.addEventListener('click', () => resetPassword(btn.dataset.email, btn.dataset.id));
  });
  list.querySelectorAll('[data-act="disable"]').forEach(btn => {
    btn.addEventListener('click', () => toggleActive(btn.dataset.id, false, btn.dataset.name));
  });
  list.querySelectorAll('[data-act="enable"]').forEach(btn => {
    btn.addEventListener('click', () => toggleActive(btn.dataset.id, true, ''));
  });
}

function roleLabel(role) {
  return { admin: '總部管理員', manager: '店長', staff: '店員' }[role] || role;
}

// ===== 新增/編輯彈窗 =====
function openModal(user = null) {
  editingId = user ? user.id : null;
  document.getElementById('modalTitle').textContent = user ? '編輯使用者' : '新增使用者';
  document.getElementById('warningMsg').style.display = 'none';
  
  f.email.value = user?.email || '';
  f.email.disabled = !!user; // 編輯時不可改 Email
  f.password.value = '';
  f.displayName.value = user?.displayName || '';
  f.role.value = user?.role || 'staff';
  f.storeId.value = user?.storeId || '';
  f.phone.value = user?.phone || '';
  f.active.value = user ? String(user.active !== false) : 'true';
  
  // 新增時才需要密碼
  document.getElementById('passwordRow').style.display = user ? 'none' : 'block';
  
  toggleStoreField();
  modal.style.display = 'flex';
}

function toggleStoreField() {
  const role = f.role.value;
  const isAdmin = role === 'admin';
  document.getElementById('storeLabel').style.display = isAdmin ? 'none' : 'block';
  f.storeId.style.display = isAdmin ? 'none' : 'block';
  document.getElementById('storeHint').style.display = isAdmin ? 'none' : 'block';
}

async function save() {
  const email = f.email.value.trim();
  const password = f.password.value;
  const displayName = f.displayName.value.trim();
  const role = f.role.value;
  const storeId = f.storeId.value;
  const isAdmin = role === 'admin';
  
  if (!email || !displayName) {
    return showWarning('請填寫 Email 與姓名');
  }
  if (!isAdmin && !storeId) {
    return showWarning('店長/店員必須綁定分店');
  }
  if (!editingId && (!password || password.length < 6)) {
    return showWarning('密碼至少 6 個字元');
  }
  
  const data = {
    email,
    displayName,
    role,
    storeId: isAdmin ? null : storeId,
    phone: f.phone.value.trim(),
    active: f.active.value === 'true',
    updatedAt: serverTimestamp(),
    updatedBy: currentUser.displayName,
  };
  
  const saveBtn = document.getElementById('saveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = '處理中...';
  
  try {
    if (editingId) {
      // 編輯模式：只更新 Firestore
      await updateDoc(doc(db, 'users', editingId), data);
      modal.style.display = 'none';
      await loadUsers();
      alert('儲存成功');
    } else {
      // 新增模式：建立 Firebase Auth 帳號，然後寫 Firestore
      // 警告：這會把當前管理員登出
      const proceed = confirm(
        '建立新帳號會暫時把您登出，建立後系統會請您重新登入。\n\n' +
        '確定要繼續嗎？'
      );
      if (!proceed) {
        saveBtn.disabled = false;
        saveBtn.textContent = '儲存';
        return;
      }
      
      // 1. 建立 Auth 帳號
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const newUid = cred.user.uid;
      
      // 2. 建立 Firestore users 文件
      data.createdAt = serverTimestamp();
      data.createdBy = currentUser.displayName;
      await setDoc(doc(db, 'users', newUid), data);
      
      // 3. 登出新建的帳號
      await signOut(auth);
      
      alert(
        '帳號建立成功！\n\n' +
        'Email: ' + email + '\n' +
        '密碼: ' + password + '\n\n' +
        '請將此密碼告知使用者，並請其首次登入後自行修改。\n' +
        '接下來請您重新登入。'
      );
      
      // 4. 跳回登入頁
      location.href = 'index.html';
    }
  } catch (err) {
    saveBtn.disabled = false;
    saveBtn.textContent = '儲存';
    let msg = err.message;
    if (err.code === 'auth/email-already-in-use') msg = '此 Email 已被註冊';
    else if (err.code === 'auth/invalid-email') msg = 'Email 格式不正確';
    else if (err.code === 'auth/weak-password') msg = '密碼強度不足（至少 6 字元）';
    showWarning('失敗：' + msg);
  }
}

function showWarning(msg) {
  const el = document.getElementById('warningMsg');
  el.textContent = msg;
  el.style.display = 'block';
  document.getElementById('saveBtn').disabled = false;
  document.getElementById('saveBtn').textContent = '儲存';
}

// ===== 重設密碼 =====
async function resetPassword(email, uid) {
  if (!confirm(`寄送密碼重設信至：\n${email}\n\n使用者收到信後可自行重設密碼。`)) return;
  try {
    await sendPasswordResetEmail(auth, email);
    
    // 記錄到 users 文件
    await updateDoc(doc(db, 'users', uid), {
      lastPasswordResetAt: serverTimestamp(),
      lastPasswordResetBy: currentUser.displayName,
    });
    
    alert('密碼重設信已寄出，請使用者查收 Email');
  } catch (err) {
    alert('寄送失敗：' + err.message);
  }
}

// ===== 啟用/停用 =====
async function toggleActive(uid, active, name) {
  const action = active ? '啟用' : '停用';
  if (!active && !confirm(`確定要停用「${name}」？\n\n停用後此帳號將無法登入系統。`)) return;
  
  try {
    await updateDoc(doc(db, 'users', uid), {
      active,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.displayName,
    });
    await loadUsers();
  } catch (err) {
    alert(action + '失敗：' + err.message);
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// 啟動
await loadStores();
await loadUsers();
