import { requireLogin } from '../core/auth-check.js';
import { initI18n, t, applyI18n } from '../core/i18n.js';
import {
  getFirestore, doc, getDoc, setDoc, collection, getDocs, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const user = requireLogin();
if (!user) throw new Error('not signed in');

// admin only
if (user.role !== 'admin') {
  alert(t('msg.adminOnly') || '僅限管理員');
  location.href = 'index.html';
  throw new Error('not admin');
}

await initI18n();
applyI18n();

const db = getFirestore();
const SETTINGS_DOC = doc(db, 'settings', 'global');

// ---------- 分頁切換 ----------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'sysinfo') loadSysInfo();
  });
});

// ---------- Toast ----------
const toast = document.getElementById('toast');
function showToast(msg, type = 'success') {
  toast.textContent = msg;
  toast.className = 'toast show ' + type;
  setTimeout(() => { toast.className = 'toast'; }, 2500);
}

// ---------- 載入既有設定 ----------
async function loadSettings() {
  const snap = await getDoc(SETTINGS_DOC);
  if (!snap.exists()) return;
  const s = snap.data();

  // 公司
  if (s.company) {
    document.getElementById('companyName').value = s.company.name || '';
    document.getElementById('companyAddress').value = s.company.address || '';
    document.getElementById('companyPhone').value = s.company.phone || '';
    document.getElementById('companyTaxId').value = s.company.taxId || '';
    if (s.company.logoUrl) {
      document.getElementById('logoPreview').innerHTML =
        `<img src="${s.company.logoUrl}" alt="logo">`;
    }
  }
  // 一般
  if (s.general) {
    document.getElementById('defaultLang').value = s.general.defaultLang || 'zh-TW';
    document.getElementById('currency').value = s.general.currency || 'NT$';
    document.getElementById('dateFormat').value = s.general.dateFormat || 'YYYY-MM-DD';
    document.getElementById('timezone').value = s.general.timezone || 'Asia/Taipei';
  }
  // 叫貨
  if (s.order) {
    document.getElementById('orderPrefix').value = s.order.prefix || 'OD';
    document.getElementById('orderMinAmount').value = s.order.minAmount ?? 0;
    document.getElementById('orderApproval').value = s.order.approval || 'manual';
    document.getElementById('orderAutoReject').value = s.order.autoReject ?? 7;
  }
  // 庫存
  if (s.inventory) {
    document.getElementById('defaultSafety').value = s.inventory.defaultSafety ?? 0;
    document.getElementById('negativeHandle').value = s.inventory.negativeHandle || 'warn';
    document.getElementById('lowStockAlert').checked = !!s.inventory.lowStockAlert;
  }
  // 通知
  if (s.notify) {
    document.getElementById('notifyNewOrder').checked = !!s.notify.newOrder;
    document.getElementById('notifyShipped').checked = !!s.notify.shipped;
    document.getElementById('notifyReceived').checked = !!s.notify.received;
    document.getElementById('notifyEmails').value = (s.notify.emails || []).join(', ');
  }
}

// ---------- 儲存（依分區）----------
async function saveSection(section) {
  let payload = {};
  if (section === 'company') {
    payload.company = {
      name: document.getElementById('companyName').value.trim(),
      address: document.getElementById('companyAddress').value.trim(),
      phone: document.getElementById('companyPhone').value.trim(),
      taxId: document.getElementById('companyTaxId').value.trim()
    };
    // logo base64 (若上傳新檔)
    const file = document.getElementById('companyLogo').files[0];
    if (file) {
      const b64 = await fileToBase64(file);
      payload.company.logoUrl = b64;
    }
  } else if (section === 'general') {
    payload.general = {
      defaultLang: document.getElementById('defaultLang').value,
      currency: document.getElementById('currency').value,
      dateFormat: document.getElementById('dateFormat').value,
      timezone: document.getElementById('timezone').value
    };
  } else if (section === 'order') {
    payload.order = {
      prefix: document.getElementById('orderPrefix').value.trim() || 'OD',
      minAmount: Number(document.getElementById('orderMinAmount').value) || 0,
      approval: document.getElementById('orderApproval').value,
      autoReject: Number(document.getElementById('orderAutoReject').value) || 7
    };
  } else if (section === 'inventory') {
    payload.inventory = {
      defaultSafety: Number(document.getElementById('defaultSafety').value) || 0,
      negativeHandle: document.getElementById('negativeHandle').value,
      lowStockAlert: document.getElementById('lowStockAlert').checked
    };
  } else if (section === 'notify') {
    const emailStr = document.getElementById('notifyEmails').value;
    payload.notify = {
      newOrder: document.getElementById('notifyNewOrder').checked,
      shipped: document.getElementById('notifyShipped').checked,
      received: document.getElementById('notifyReceived').checked,
      emails: emailStr.split(',').map(s => s.trim()).filter(Boolean)
    };
  }
  payload.updatedAt = serverTimestamp();
  payload.updatedBy = user.uid;

  try {
    await setDoc(SETTINGS_DOC, payload, { merge: true });
    showToast(t('msg.saved') || '已儲存', 'success');
  } catch (e) {
    console.error(e);
    showToast(t('msg.saveFail') || '儲存失敗: ' + e.message, 'error');
  }
}

document.querySelectorAll('[data-save]').forEach(btn => {
  btn.addEventListener('click', () => saveSection(btn.dataset.save));
});

// 即時切換預設語言（儲存後也立刻套用到當前頁）
document.getElementById('defaultLang').addEventListener('change', e => {
  localStorage.setItem('lang', e.target.value);
});

// ---------- Logo 預覽 ----------
document.getElementById('companyLogo').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 500 * 1024) {
    showToast(t('msg.fileTooLarge') || '檔案過大 (>500KB)', 'error');
    e.target.value = '';
    return;
  }
  const b64 = await fileToBase64(file);
  document.getElementById('logoPreview').innerHTML = `<img src="${b64}" alt="logo">`;
});

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// ---------- 系統資訊 ----------
async function loadSysInfo() {
  document.getElementById('sysFirebase').textContent = '✅ Connected';
  try {
    const [users, products, stores, orders] = await Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'products')),
      getDocs(collection(db, 'stores')),
      getDocs(collection(db, 'orders'))
    ]);
    document.getElementById('sysUserCount').textContent = users.size;
    document.getElementById('sysProductCount').textContent = products.size;
    document.getElementById('sysStoreCount').textContent = stores.size;
    document.getElementById('sysOrderCount').textContent = orders.size;

    const snap = await getDoc(SETTINGS_DOC);
    if (snap.exists() && snap.data().updatedAt) {
      const d = snap.data().updatedAt.toDate();
      document.getElementById('sysLastUpdate').textContent = d.toLocaleString();
    }
  } catch (e) {
    console.error(e);
    document.getElementById('sysFirebase').textContent = '⚠️ ' + e.message;
  }
}

// 初始載入
await loadSettings();
