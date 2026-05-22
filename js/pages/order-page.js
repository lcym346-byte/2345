import { requireLogin } from "../core/auth.js";
import { 
  collection, getDocs, doc, setDoc, updateDoc, getDoc,
  serverTimestamp, query, orderBy, where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const currentUser = await requireLogin();
const db = window.firebaseDB;
const isAdmin = currentUser.role === 'admin';

// 狀態定義
const STATUS = {
  pending: { label: '待審核', color: '#f59e0b', bg: '#fef3c7' },
  approved: { label: '已審核', color: '#3b82f6', bg: '#dbeafe' },
  shipped: { label: '已出貨', color: '#8b5cf6', bg: '#ede9fe' },
  received: { label: '已收貨', color: '#10b981', bg: '#d1fae5' },
  rejected: { label: '已退回', color: '#dc2626', bg: '#fee2e2' },
  cancelled: { label: '已取消', color: '#6b7280', bg: '#f3f4f6' },
};

// DOM
const orderList = document.getElementById('orderList');
const emptyMsg = document.getElementById('emptyMsg');
const newOrderModal = document.getElementById('newOrderModal');
const detailModal = document.getElementById('detailModal');
const scanModal = document.getElementById('scanModal');
const cartList = document.getElementById('cartList');
const cartEmpty = document.getElementById('cartEmpty');
const cartCount = document.getElementById('cartCount');
const totalAmount = document.getElementById('totalAmount');
const productPickerList = document.getElementById('productPickerList');
const productSearch = document.getElementById('productSearch');
const orderStoreId = document.getElementById('orderStoreId');
const orderNote = document.getElementById('orderNote');
const statusFilter = document.getElementById('statusFilter');
const storeFilter = document.getElementById('storeFilter');
const dateFilter = document.getElementById('dateFilter');

let allProducts = [];
let allStores = [];
let allSuppliers = [];
let allOrders = [];
let cart = []; // [{productId, sku, name, unit, price, qty}]
let qrScanner = null;

// 按鈕綁定
document.getElementById('newOrderBtn').addEventListener('click', openNewOrderModal);
document.getElementById('cancelOrderBtn').addEventListener('click', () => newOrderModal.style.display = 'none');
document.getElementById('submitOrderBtn').addEventListener('click', submitOrder);
document.getElementById('scanProductBtn').addEventListener('click', startScan);
document.getElementById('closeScanBtn').addEventListener('click', stopScan);
productSearch.addEventListener('input', renderProductPicker);
statusFilter.addEventListener('change', renderOrderList);
storeFilter.addEventListener('change', renderOrderList);
dateFilter.addEventListener('change', renderOrderList);

// ===== 載入基礎資料 =====
async function loadBaseData() {
  const [pSnap, sSnap, supSnap] = await Promise.all([
    getDocs(query(collection(db, 'products'), orderBy('sku'))),
    getDocs(query(collection(db, 'stores'), orderBy('storeCode'))),
    getDocs(query(collection(db, 'suppliers'), orderBy('code'))),
  ]);
  allProducts = [];
  pSnap.forEach(d => allProducts.push({ id: d.id, ...d.data() }));
  allStores = [];
  sSnap.forEach(d => allStores.push({ id: d.id, ...d.data() }));
  allSuppliers = [];
  supSnap.forEach(d => allSuppliers.push({ id: d.id, ...d.data() }));

  // 填分店下拉
  const activeStores = allStores.filter(s => s.active !== false);
  if (isAdmin) {
    orderStoreId.innerHTML = activeStores.map(s => 
      `<option value="${s.id}">${escapeHtml(s.storeCode)} - ${escapeHtml(s.storeName)}</option>`
    ).join('');
    storeFilter.innerHTML = '<option value="">全部分店</option>' + 
      activeStores.map(s => `<option value="${s.id}">${escapeHtml(s.storeName)}</option>`).join('');
  } else {
    // 非管理員只能用自己的分店
    const myStore = allStores.find(s => s.id === currentUser.storeId);
    if (myStore) {
      orderStoreId.innerHTML = `<option value="${myStore.id}">${escapeHtml(myStore.storeName)}</option>`;
      orderStoreId.disabled = true;
    }
    storeFilter.style.display = 'none';
  }
}

// ===== 開啟新建叫貨單 =====
function openNewOrderModal() {
  if (allStores.filter(s => s.active !== false).length === 0) {
    alert('請先建立分店資料');
    return;
  }
  if (allProducts.filter(p => p.active !== false).length === 0) {
    alert('請先建立商品資料');
    return;
  }
  cart = [];
  orderNote.value = '';
  productSearch.value = '';
  renderCart();
  renderProductPicker();
  newOrderModal.style.display = 'flex';
}

// ===== 商品選擇器 =====
function renderProductPicker() {
  const keyword = productSearch.value.trim().toLowerCase();
  let items = allProducts.filter(p => p.active !== false);
  if (keyword) {
    items = items.filter(p => 
      (p.name || '').toLowerCase().includes(keyword) ||
      (p.sku || '').toLowerCase().includes(keyword) ||
      (p.barcode || '').toLowerCase().includes(keyword)
    );
  }
  items = items.slice(0, 30); // 最多顯示 30 筆

  if (items.length === 0) {
    productPickerList.innerHTML = '<p class="empty-msg-sm">無符合商品</p>';
    return;
  }
  productPickerList.innerHTML = items.map(p => {
    const inCart = cart.find(c => c.productId === p.id);
    return `
      <div class="picker-item">
        <div class="picker-info">
          <div class="picker-name">
            <span class="code-tag">${escapeHtml(p.sku)}</span>
            ${escapeHtml(p.name)}
          </div>
          <div class="picker-meta">$${Number(p.price||0).toLocaleString()} / ${escapeHtml(p.unit||'個')}</div>
        </div>
        ${inCart ? 
          `<span class="picker-in-cart">已加入</span>` :
          `<button class="btn-add-sm" data-id="${p.id}">加入</button>`
        }
      </div>
    `;
  }).join('');
  productPickerList.querySelectorAll('.btn-add-sm').forEach(btn => {
    btn.addEventListener('click', () => addToCart(btn.dataset.id));
  });
}

function addToCart(productId) {
  const p = allProducts.find(x => x.id === productId);
  if (!p) return;
  if (cart.find(c => c.productId === productId)) return;
  cart.push({
    productId: p.id,
    sku: p.sku,
    name: p.name,
    unit: p.unit || '個',
    price: Number(p.price || 0),
    qty: 1,
  });
  renderCart();
  renderProductPicker();
}

function removeFromCart(productId) {
  cart = cart.filter(c => c.productId !== productId);
  renderCart();
  renderProductPicker();
}

function updateCartQty(productId, qty) {
  const item = cart.find(c => c.productId === productId);
  if (!item) return;
  item.qty = Math.max(1, parseInt(qty) || 1);
  renderCartTotal();
}

function renderCart() {
  cartCount.textContent = cart.length;
  if (cart.length === 0) {
    cartEmpty.style.display = 'block';
    cartList.innerHTML = '<p class="empty-msg" id="cartEmpty">尚未加入商品</p>';
  } else {
    cartList.innerHTML = cart.map(c => `
      <div class="cart-item">
        <div class="cart-info">
          <div class="cart-name">${escapeHtml(c.name)}</div>
          <div class="cart-meta">$${c.price.toLocaleString()} / ${escapeHtml(c.unit)}</div>
        </div>
        <div class="cart-qty">
          <button class="qty-btn" data-action="dec" data-id="${c.productId}">−</button>
          <input type="number" class="qty-input" data-id="${c.productId}" value="${c.qty}" min="1">
          <button class="qty-btn" data-action="inc" data-id="${c.productId}">+</button>
        </div>
        <div class="cart-sum">$${(c.price * c.qty).toLocaleString()}</div>
        <button class="btn-del-cart" data-id="${c.productId}">×</button>
      </div>
    `).join('');
    cartList.querySelectorAll('.qty-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const item = cart.find(c => c.productId === id);
        if (!item) return;
        if (btn.dataset.action === 'inc') item.qty++;
        else item.qty = Math.max(1, item.qty - 1);
        renderCart();
      });
    });
    cartList.querySelectorAll('.qty-input').forEach(inp => {
      inp.addEventListener('change', () => updateCartQty(inp.dataset.id, inp.value));
    });
    cartList.querySelectorAll('.btn-del-cart').forEach(btn => {
      btn.addEventListener('click', () => removeFromCart(btn.dataset.id));
    });
  }
  renderCartTotal();
}

function renderCartTotal() {
  const total = cart.reduce((sum, c) => sum + c.price * c.qty, 0);
  totalAmount.textContent = '$' + total.toLocaleString();
}

// ===== 送出叫貨單 =====
async function submitOrder() {
  if (cart.length === 0) {
    alert('請至少加入一項商品');
    return;
  }
  const storeId = orderStoreId.value;
  if (!storeId) {
    alert('請選擇分店');
    return;
  }
  const store = allStores.find(s => s.id === storeId);
  const total = cart.reduce((sum, c) => sum + c.price * c.qty, 0);
  const orderNo = 'OD' + Date.now();
  
  const data = {
    orderNo,
    storeId,
    storeName: store.storeName,
    storeCode: store.storeCode,
    items: cart.map(c => ({
      productId: c.productId,
      sku: c.sku,
      name: c.name,
      unit: c.unit,
      price: c.price,
      qty: c.qty,
      subtotal: c.price * c.qty,
    })),
    totalAmount: total,
    itemCount: cart.length,
    note: orderNote.value.trim(),
    status: 'pending',
    createdBy: currentUser.uid,
    createdByName: currentUser.displayName,
    createdAt: serverTimestamp(),
    timeline: [{
      action: 'created',
      label: '建立叫貨單',
      by: currentUser.displayName,
      at: new Date().toISOString(),
    }],
  };
  
  try {
    document.getElementById('submitOrderBtn').disabled = true;
    await setDoc(doc(db, 'orders', orderNo), data);
    newOrderModal.style.display = 'none';
    await loadOrders();
    alert('叫貨單建立成功：' + orderNo);
  } catch (err) {
    alert('送出失敗：' + err.message);
  } finally {
    document.getElementById('submitOrderBtn').disabled = false;
  }
}

// ===== 載入叫貨單列表 =====
async function loadOrders() {
  orderList.innerHTML = '<p class="loading">載入中...</p>';
  try {
    let q;
    if (isAdmin) {
      // 管理員：看全部
      q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
    } else {
      // 分店人員：只查自己分店
      if (!currentUser.storeId) {
        orderList.innerHTML = '<p class="error-msg">您的帳號未綁定分店，請聯絡管理員</p>';
        return;
      }
      q = query(
        collection(db, 'orders'),
        where('storeId', '==', currentUser.storeId),
        orderBy('createdAt', 'desc')
      );
    }
    const snap = await getDocs(q);
    allOrders = [];
    snap.forEach(d => allOrders.push({ id: d.id, ...d.data() }));
    renderOrderList();
  } catch (err) {
    orderList.innerHTML = `<p class="error-msg">載入失敗：${err.message}</p>`;
  }
}


function renderOrderList() {
  let items = allOrders;
  const sf = statusFilter.value;
  const stf = storeFilter.value;
  const df = dateFilter.value;
  if (sf) items = items.filter(o => o.status === sf);
  if (stf) items = items.filter(o => o.storeId === stf);
  if (df) {
    items = items.filter(o => {
      const d = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt);
      const ds = d.toISOString().slice(0, 10);
      return ds === df;
    });
  }
  
  if (items.length === 0) {
    orderList.innerHTML = '';
    emptyMsg.style.display = 'block';
    return;
  }
  emptyMsg.style.display = 'none';
  orderList.innerHTML = items.map(o => {
    const st = STATUS[o.status] || { label: o.status, color: '#6b7280', bg: '#f3f4f6' };
    const d = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt);
    const dateStr = isNaN(d) ? '' : d.toLocaleString('zh-TW', { hour12: false });
    return `
      <div class="data-card order-card" data-id="${o.id}">
        <div class="card-main">
          <div class="card-title">
            <span class="status-badge" style="color:${st.color};background:${st.bg}">${st.label}</span>
            ${escapeHtml(o.orderNo)}
          </div>
          <div class="card-info">
            <b>${escapeHtml(o.storeName || '')}</b>
            ・ ${o.itemCount} 項商品
            ・ 共 <b>$${Number(o.totalAmount||0).toLocaleString()}</b>
          </div>
          <div class="card-info">
            建立：${escapeHtml(o.createdByName || '')} ${dateStr}
          </div>
          ${o.note ? `<div class="card-info note">備註：${escapeHtml(o.note)}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
  orderList.querySelectorAll('.order-card').forEach(card => {
    card.addEventListener('click', () => openDetail(card.dataset.id));
  });
}

// ===== 叫貨單詳細 =====
async function openDetail(orderId) {
  const o = allOrders.find(x => x.id === orderId);
  if (!o) return;
  const st = STATUS[o.status] || {};
  
  document.getElementById('detailTitle').textContent = '叫貨單 ' + o.orderNo;
  
  const itemsHtml = (o.items || []).map(it => `
    <div class="detail-item">
      <div class="di-main">
        <span class="code-tag">${escapeHtml(it.sku)}</span>
        ${escapeHtml(it.name)}
      </div>
      <div class="di-qty">${it.qty} ${escapeHtml(it.unit||'個')}</div>
      <div class="di-price">$${Number(it.price||0).toLocaleString()}</div>
      <div class="di-sum">$${Number(it.subtotal||0).toLocaleString()}</div>
    </div>
  `).join('');
  
  const timelineHtml = (o.timeline || []).map(t => `
    <div class="timeline-item">
      <div class="tl-dot"></div>
      <div class="tl-content">
        <div class="tl-label">${escapeHtml(t.label)}</div>
        <div class="tl-meta">${escapeHtml(t.by || '')} ・ ${fmtTime(t.at)}</div>
        ${t.note ? `<div class="tl-note">${escapeHtml(t.note)}</div>` : ''}
      </div>
    </div>
  `).join('');
  
  document.getElementById('detailContent').innerHTML = `
    <div class="detail-status">
      <span class="status-badge" style="color:${st.color};background:${st.bg};font-size:14px">${st.label}</span>
    </div>
    <div class="detail-section">
      <div class="ds-row"><span>分店</span><b>${escapeHtml(o.storeName)}</b></div>
      <div class="ds-row"><span>建立人</span><b>${escapeHtml(o.createdByName||'')}</b></div>
      ${o.note ? `<div class="ds-row"><span>備註</span><b>${escapeHtml(o.note)}</b></div>` : ''}
    </div>
    <div class="section-title">商品明細</div>
    <div class="detail-items">
      <div class="detail-item detail-header">
        <div class="di-main">商品</div>
        <div class="di-qty">數量</div>
        <div class="di-price">單價</div>
        <div class="di-sum">小計</div>
      </div>
      ${itemsHtml}
      <div class="detail-total">
        <span>合計</span>
        <span class="total-amount">$${Number(o.totalAmount||0).toLocaleString()}</span>
      </div>
    </div>
    <div class="section-title">處理進度</div>
    <div class="timeline">${timelineHtml}</div>
  `;
  
  // 操作按鈕（依角色與狀態顯示）
  const actions = document.getElementById('detailActions');
  let btns = `<button class="btn-cancel" onclick="document.getElementById('detailModal').style.display='none'">關閉</button>`;
  
  if (isAdmin) {
    if (o.status === 'pending') {
      btns += `<button class="btn-warn" data-act="reject" data-id="${o.id}">退回</button>`;
      btns += `<button class="btn-primary" data-act="approve" data-id="${o.id}">審核通過</button>`;
    } else if (o.status === 'approved') {
      btns += `<button class="btn-primary" data-act="ship" data-id="${o.id}">確認出貨</button>`;
    }
  }
  // 分店人員可在已出貨時確認收貨
  if (o.status === 'shipped' && (isAdmin || currentUser.storeId === o.storeId)) {
    btns += `<button class="btn-primary" data-act="receive" data-id="${o.id}">確認收貨</button>`;
  }
  // 建立者可在待審核時取消
  if (o.status === 'pending' && (isAdmin || o.createdBy === currentUser.uid)) {
    btns += `<button class="btn-warn" data-act="cancel" data-id="${o.id}">取消叫貨單</button>`;
  }
  
  actions.innerHTML = btns;
  actions.querySelectorAll('button[data-act]').forEach(btn => {
    btn.addEventListener('click', () => handleAction(btn.dataset.act, btn.dataset.id));
  });
  
  detailModal.style.display = 'flex';
}

async function handleAction(action, orderId) {
  const actionMap = {
    approve: { status: 'approved', label: '審核通過', confirm: '確定通過此叫貨單？' },
    reject: { status: 'rejected', label: '退回', confirm: '確定退回此叫貨單？' },
    ship: { status: 'shipped', label: '確認出貨', confirm: '確認已出貨？' },
    receive: { status: 'received', label: '確認收貨', confirm: '確認已收到貨？' },
    cancel: { status: 'cancelled', label: '取消叫貨單', confirm: '確定取消此叫貨單？' },
  };
  const cfg = actionMap[action];
  if (!cfg) return;
  
  let note = '';
  if (action === 'reject') {
    note = prompt('退回原因：') || '';
    if (!note) return;
  } else {
    if (!confirm(cfg.confirm)) return;
  }
  
  try {
    const ref = doc(db, 'orders', orderId);
    const snap = await getDoc(ref);
    const current = snap.data();
    const newTimeline = [...(current.timeline || []), {
      action,
      label: cfg.label,
      by: currentUser.displayName,
      at: new Date().toISOString(),
      note,
    }];
    await updateDoc(ref, {
      status: cfg.status,
      timeline: newTimeline,
      updatedAt: serverTimestamp(),
    });
    detailModal.style.display = 'none';
    await loadOrders();
  } catch (err) {
    alert('操作失敗：' + err.message);
  }
}

// ===== 掃碼加商品 =====
function startScan() {
  scanModal.style.display = 'flex';
  document.getElementById('qrReader').innerHTML = '';
  qrScanner = new Html5Qrcode("qrReader");
  
  const formats = [
    Html5QrcodeSupportedFormats.QR_CODE,
    Html5QrcodeSupportedFormats.EAN_13,
    Html5QrcodeSupportedFormats.EAN_8,
    Html5QrcodeSupportedFormats.CODE_128,
    Html5QrcodeSupportedFormats.CODE_39,
    Html5QrcodeSupportedFormats.UPC_A,
    Html5QrcodeSupportedFormats.UPC_E,
  ];
  
  qrScanner.start(
    { facingMode: "environment" },
    {
      fps: 15,
      qrbox: (w, h) => {
        const m = Math.min(w, h);
        return { width: Math.floor(m * 0.85), height: Math.floor(m * 0.4) };
      },
      formatsToSupport: formats,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    },
    (decodedText) => {
      const p = allProducts.find(x => x.barcode === decodedText || x.sku === decodedText);
      if (p) {
        if (navigator.vibrate) navigator.vibrate(200);
        addToCart(p.id);
        stopScan();
      } else {
        // 不停止掃描，提示找不到
        productSearch.value = decodedText;
        renderProductPicker();
        stopScan();
        alert('查無此條碼商品：' + decodedText + '\n已填入搜尋欄');
      }
    },
    () => {}
  ).catch(err => {
    alert('無法啟動相機：' + err);
    scanModal.style.display = 'none';
  });
}

function stopScan() {
  if (qrScanner) {
    qrScanner.stop().then(() => {
      qrScanner.clear();
      qrScanner = null;
    }).catch(() => { qrScanner = null; });
  }
  scanModal.style.display = 'none';
}

// ===== 工具 =====
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function fmtTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('zh-TW', { hour12: false });
  } catch { return iso; }
}

// 啟動
await loadBaseData();
await loadOrders();
