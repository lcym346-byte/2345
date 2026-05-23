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
  pending:          { label: '待審核',     color: '#f59e0b', bg: '#fef3c7' },
  pending_confirm:  { label: '待分店確認', color: '#f97316', bg: '#ffedd5' },
  approved:         { label: '已審核',     color: '#3b82f6', bg: '#dbeafe' },
  shipped:          { label: '已出貨',     color: '#8b5cf6', bg: '#ede9fe' },
  received:         { label: '已收貨',     color: '#10b981', bg: '#d1fae5' },
  rejected:         { label: '已退回',     color: '#dc2626', bg: '#fee2e2' },
  cancel_requested: { label: '取消申請中', color: '#ea580c', bg: '#ffedd5' },
  cancelled:        { label: '已取消',     color: '#6b7280', bg: '#f3f4f6' },
};

// DOM
const orderList = document.getElementById('orderList');
const emptyMsg = document.getElementById('emptyMsg');
const newOrderModal = document.getElementById('newOrderModal');
const detailModal = document.getElementById('detailModal');
const scanModal = document.getElementById('scanModal');
const cartList = document.getElementById('cartList');
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
let allOrders = [];
let cart = [];
let qrScanner = null;
let editingOrderId = null;    // 編輯中的叫貨單 id（null = 新建）
let editingMode = null;       // 'create' | 'edit_branch' | 'revise_hq'

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
  const [pSnap, sSnap] = await Promise.all([
    getDocs(query(collection(db, 'products'), orderBy('sku'))),
    getDocs(query(collection(db, 'stores'), orderBy('storeCode'))),
  ]);
  allProducts = [];
  pSnap.forEach(d => allProducts.push({ id: d.id, ...d.data() }));
  allStores = [];
  sSnap.forEach(d => allStores.push({ id: d.id, ...d.data() }));

  const activeStores = allStores.filter(s => s.active !== false);
  if (isAdmin) {
    orderStoreId.innerHTML = activeStores.map(s => 
      `<option value="${s.id}">${escapeHtml(s.storeCode)} - ${escapeHtml(s.storeName)}</option>`
    ).join('');
    storeFilter.innerHTML = '<option value="">全部分店</option>' + 
      activeStores.map(s => `<option value="${s.id}">${escapeHtml(s.storeName)}</option>`).join('');
  } else {
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
  editingOrderId = null;
  editingMode = 'create';
  cart = [];
  orderNote.value = '';
  productSearch.value = '';
  orderStoreId.disabled = !isAdmin;
  document.querySelector('#newOrderModal h2').textContent = '新建叫貨單';
  document.getElementById('submitOrderBtn').textContent = '送出叫貨單';
  renderCart();
  renderProductPicker();
  newOrderModal.style.display = 'flex';
}

// ===== 開啟編輯叫貨單（分店改 pending、總店改數量） =====
function openEditOrderModal(order, mode) {
  editingOrderId = order.id;
  editingMode = mode; // 'edit_branch' | 'revise_hq'
  cart = (order.items || []).map(it => ({
    productId: it.productId,
    sku: it.sku,
    name: it.name,
    unit: it.unit,
    price: Number(it.price || 0),
    qty: Number(it.qty || 1),
  }));
  orderNote.value = order.note || '';
  // 分店欄位鎖死（不可改分店）
  orderStoreId.innerHTML = `<option value="${order.storeId}">${escapeHtml(order.storeName)}</option>`;
  orderStoreId.value = order.storeId;
  orderStoreId.disabled = true;
  
  if (mode === 'edit_branch') {
    document.querySelector('#newOrderModal h2').textContent = '編輯叫貨單 ' + order.orderNo;
    document.getElementById('submitOrderBtn').textContent = '儲存修改';
  } else if (mode === 'revise_hq') {
    document.querySelector('#newOrderModal h2').textContent = '總店修改數量 ' + order.orderNo;
    document.getElementById('submitOrderBtn').textContent = '送回分店確認';
  }
  
  productSearch.value = '';
  renderCart();
  renderProductPicker();
  newOrderModal.style.display = 'flex';
}

// 切換分店
orderStoreId.addEventListener('change', () => {
  if (cart.length > 0 && !orderStoreId.disabled) {
    if (!confirm('切換分店會清空已選商品，確定切換？')) {
      return;
    }
    cart = [];
    renderCart();
  }
  renderProductPicker();
});

// ===== 商品選擇器 =====
function renderProductPicker() {
  const keyword = productSearch.value.trim().toLowerCase();
  let items = allProducts.filter(p => p.active !== false);
  
  const selectedStoreId = orderStoreId.value;
  const selectedStore = allStores.find(s => s.id === selectedStoreId);
  if (selectedStore) {
    const isHQ = selectedStore.storeType === 'hq';
    items = items.filter(p => {
      const av = p.availableFor || 'all';
      if (av === 'all') return true;
      if (av === 'hq_only') return isHQ;
      if (av === 'stores_only') return !isHQ;
      return true;
    });
  }
  
  if (keyword) {
    items = items.filter(p => 
      (p.name || '').toLowerCase().includes(keyword) ||
      (p.sku || '').toLowerCase().includes(keyword) ||
      (p.barcode || '').toLowerCase().includes(keyword)
    );
  }
  items = items.slice(0, 30);

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

function renderCart() {
  cartCount.textContent = cart.length;
  if (cart.length === 0) {
    cartList.innerHTML = '<p class="empty-msg">尚未加入商品</p>';
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
      inp.addEventListener('change', () => {
        const item = cart.find(c => c.productId === inp.dataset.id);
        if (!item) return;
        item.qty = Math.max(1, parseInt(inp.value) || 1);
        renderCart();
      });
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

// ===== 送出 / 儲存 =====
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
  const items = cart.map(c => ({
    productId: c.productId,
    sku: c.sku,
    name: c.name,
    unit: c.unit,
    price: c.price,
    qty: c.qty,
    subtotal: c.price * c.qty,
  }));
  
  const submitBtn = document.getElementById('submitOrderBtn');
  submitBtn.disabled = true;
  
  try {
    if (editingMode === 'create') {
      // ===== 新建 =====
      const orderNo = 'OD' + Date.now();
      const data = {
        orderNo,
        storeId,
        storeName: store.storeName,
        storeCode: store.storeCode,
        items,
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
      await setDoc(doc(db, 'orders', orderNo), data);
      newOrderModal.style.display = 'none';
      await loadOrders();
      alert('叫貨單建立成功：' + orderNo);
    } else if (editingMode === 'edit_branch') {
      // ===== 分店修改 pending 中的叫貨單 =====
      const ref = doc(db, 'orders', editingOrderId);
      const snap = await getDoc(ref);
      const cur = snap.data();
      const newTimeline = [...(cur.timeline || []), {
        action: 'edited',
        label: '分店修改叫貨單',
        by: currentUser.displayName,
        at: new Date().toISOString(),
      }];
      await updateDoc(ref, {
        items,
        totalAmount: total,
        itemCount: cart.length,
        note: orderNote.value.trim(),
        timeline: newTimeline,
        updatedAt: serverTimestamp(),
      });
      newOrderModal.style.display = 'none';
      await loadOrders();
      alert('修改完成');
    } else if (editingMode === 'revise_hq') {
      // ===== 總店改數量 → 送回分店確認 =====
      const ref = doc(db, 'orders', editingOrderId);
      const snap = await getDoc(ref);
      const cur = snap.data();
      
      // 將原始版本暫存（讓分店看到差異）
      const newTimeline = [...(cur.timeline || []), {
        action: 'revised_by_hq',
        label: '總店修改數量（待分店確認）',
        by: currentUser.displayName,
        at: new Date().toISOString(),
        note: '原合計 $' + Number(cur.totalAmount||0).toLocaleString() + ' → 改為 $' + total.toLocaleString(),
      }];
      await updateDoc(ref, {
        items,
        totalAmount: total,
        itemCount: cart.length,
        status: 'pending_confirm',
        originalItems: cur.originalItems || cur.items,   // 保留最原始版本
        revisedAt: serverTimestamp(),
        revisedBy: currentUser.displayName,
        timeline: newTimeline,
        updatedAt: serverTimestamp(),
      });
      newOrderModal.style.display = 'none';
      await loadOrders();
      alert('已送回分店確認');
    }
  } catch (err) {
    alert('操作失敗：' + err.message);
  } finally {
    submitBtn.disabled = false;
  }
}

// ===== 載入叫貨單列表 =====
async function loadOrders() {
  orderList.innerHTML = '<p class="loading">載入中...</p>';
  try {
    let q;
    if (isAdmin) {
      q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
    } else {
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

// ===== 詳細 =====
async function openDetail(orderId) {
  const o = allOrders.find(x => x.id === orderId);
  if (!o) return;
  const st = STATUS[o.status] || {};
  const isMyStore = currentUser.storeId === o.storeId;
  const isCreator = o.createdBy === currentUser.uid;
  
  document.getElementById('detailTitle').textContent = '叫貨單 ' + o.orderNo;
  
  // 商品明細（pending_confirm 顯示新舊對照）
  let itemsHtml = '';
  if (o.status === 'pending_confirm' && o.originalItems) {
    itemsHtml = (o.items || []).map(it => {
      const orig = (o.originalItems || []).find(x => x.productId === it.productId);
      const changed = orig && orig.qty !== it.qty;
      return `
        <div class="detail-item ${changed ? 'changed-row' : ''}">
          <div class="di-main">
            <span class="code-tag">${escapeHtml(it.sku)}</span>
            ${escapeHtml(it.name)}
          </div>
          <div class="di-qty">
            ${changed ? `<s style="color:#dc2626">${orig.qty}</s> → ` : ''}
            <b style="${changed ? 'color:#dc2626' : ''}">${it.qty}</b> ${escapeHtml(it.unit||'個')}
          </div>
          <div class="di-price">$${Number(it.price||0).toLocaleString()}</div>
          <div class="di-sum">$${Number(it.subtotal||0).toLocaleString()}</div>
        </div>
      `;
    }).join('');
    // 還要顯示被「整個刪掉」的商品
    const deleted = (o.originalItems || []).filter(orig => !(o.items || []).find(x => x.productId === orig.productId));
    if (deleted.length > 0) {
      itemsHtml += deleted.map(it => `
        <div class="detail-item changed-row" style="text-decoration:line-through;opacity:0.6">
          <div class="di-main">
            <span class="code-tag">${escapeHtml(it.sku)}</span>
            ${escapeHtml(it.name)}（已刪除）
          </div>
          <div class="di-qty">${it.qty} ${escapeHtml(it.unit||'個')}</div>
          <div class="di-price">$${Number(it.price||0).toLocaleString()}</div>
          <div class="di-sum">$${Number(it.subtotal||0).toLocaleString()}</div>
        </div>
      `).join('');
    }
  } else {
    itemsHtml = (o.items || []).map(it => `
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
  }
  
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
  
  // ===== 操作按鈕（依角色 + 狀態）=====
  const actions = document.getElementById('detailActions');
  let btns = `<button class="btn-cancel" id="closeDetailBtn">關閉</button>`;
  
  // --- 待審核（pending）---
  if (o.status === 'pending') {
    if (isAdmin) {
      // 總店：通過 / 改數量退回 / 駁回
      btns += `<button class="btn-warn" data-act="reject" data-id="${o.id}">駁回</button>`;
      btns += `<button class="btn-edit-order" data-act="revise" data-id="${o.id}">改數量退回確認</button>`;
      btns += `<button class="btn-primary" data-act="approve" data-id="${o.id}">審核通過</button>`;
    }
    if (isMyStore || isCreator || isAdmin) {
      // 分店建立者：可編輯 / 取消
      if (!isAdmin) {
        btns += `<button class="btn-edit-order" data-act="edit" data-id="${o.id}">修改</button>`;
      }
      btns += `<button class="btn-warn" data-act="cancel_direct" data-id="${o.id}">取消</button>`;
    }
  }
  
  // --- 待分店確認（pending_confirm）---
  if (o.status === 'pending_confirm') {
    if (isMyStore || isCreator) {
      btns += `<button class="btn-warn" data-act="reject_revise" data-id="${o.id}">拒絕（取消）</button>`;
      btns += `<button class="btn-primary" data-act="accept_revise" data-id="${o.id}">接受修改</button>`;
    }
    if (isAdmin) {
      btns += `<span class="hint-text">等待分店確認中</span>`;
    }
  }
  
  // --- 已審核（approved）---
  if (o.status === 'approved') {
    if (isAdmin) {
      btns += `<button class="btn-primary" data-act="ship" data-id="${o.id}">確認出貨</button>`;
    }
    if (isMyStore || isCreator) {
      btns += `<button class="btn-warn" data-act="request_cancel" data-id="${o.id}">申請取消</button>`;
    }
  }
  
  // --- 已出貨（shipped）---
  if (o.status === 'shipped') {
    if (isMyStore || isCreator || isAdmin) {
      btns += `<button class="btn-primary" data-act="receive" data-id="${o.id}">確認收貨</button>`;
    }
  }
  
  // --- 取消申請中（cancel_requested）---
  if (o.status === 'cancel_requested') {
    if (isAdmin) {
      btns += `<button class="btn-warn" data-act="reject_cancel" data-id="${o.id}">駁回取消</button>`;
      btns += `<button class="btn-primary" data-act="approve_cancel" data-id="${o.id}">同意取消</button>`;
    }
    if (isMyStore || isCreator) {
      btns += `<span class="hint-text">等待總店審核取消申請</span>`;
    }
  }
  
  actions.innerHTML = btns;
  document.getElementById('closeDetailBtn').addEventListener('click', () => detailModal.style.display = 'none');
  actions.querySelectorAll('button[data-act]').forEach(btn => {
    btn.addEventListener('click', () => handleAction(btn.dataset.act, btn.dataset.id));
  });
  
  detailModal.style.display = 'flex';
}

// ===== 動作處理 =====
async function handleAction(action, orderId) {
  // 編輯類，直接開編輯彈窗
  if (action === 'edit') {
    const o = allOrders.find(x => x.id === orderId);
    if (!o) return;
    detailModal.style.display = 'none';
    openEditOrderModal(o, 'edit_branch');
    return;
  }
  if (action === 'revise') {
    const o = allOrders.find(x => x.id === orderId);
    if (!o) return;
    detailModal.style.display = 'none';
    openEditOrderModal(o, 'revise_hq');
    return;
  }
  
  // 狀態變更類
  const actionMap = {
    approve:        { status: 'approved',         label: '審核通過',     confirm: '確定通過此叫貨單？' },
    reject:         { status: 'rejected',         label: '駁回',         confirm: '確定駁回此叫貨單？', needNote: true, noteLabel: '駁回原因' },
    ship:           { status: 'shipped',          label: '確認出貨',     confirm: '確認已出貨？' },
    receive:        { status: 'received',         label: '確認收貨',     confirm: '確認已收到貨？' },
    cancel_direct:  { status: 'cancelled',        label: '取消叫貨單',   confirm: '確定取消此叫貨單？' },
    accept_revise:  { status: 'approved',         label: '分店接受修改（自動通過）', confirm: '確定接受總店修改的數量？接受後將自動進入「已審核」狀態。' },
    reject_revise:  { status: 'cancelled',        label: '分店拒絕修改（取消叫貨單）', confirm: '拒絕後此叫貨單將直接取消，確定？' },
    request_cancel: { status: 'cancel_requested', label: '分店申請取消', confirm: '送出取消申請？需待總店同意才會取消。', needNote: true, noteLabel: '取消原因' },
    approve_cancel: { status: 'cancelled',        label: '總店同意取消', confirm: '確定同意取消此叫貨單？' },
    reject_cancel:  { status: 'approved',         label: '總店駁回取消申請（恢復已審核）', confirm: '駁回後此叫貨單將回到「已審核」狀態，確定？', needNote: true, noteLabel: '駁回理由' },
  };
  const cfg = actionMap[action];
  if (!cfg) return;
  
  let note = '';
  if (cfg.needNote) {
    note = prompt(cfg.noteLabel + '：') || '';
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
    
    // ===== 庫存連動 =====
    // 確認出貨 → 總店庫存減少
    if (action === 'ship') {
      await updateStockOnShip(current);
    }
    // 確認收貨 → 分店庫存增加
    if (action === 'receive') {
      await updateStockOnReceive(current);
    }
    
    detailModal.style.display = 'none';
    await loadOrders();
  } catch (err) {
    alert('操作失敗：' + err.message);
  }
}

// ===== 確認出貨：總店庫存減少 =====
async function updateStockOnShip(order) {
  const hqStore = allStores.find(s => s.storeType === 'hq' && s.active !== false);
  if (!hqStore) {
    console.warn('找不到總店，跳過總店庫存扣減');
    return;
  }
  await batchStockChange({
    storeId: hqStore.id,
    storeName: hqStore.storeName,
    items: order.items,
    type: 'order_shipped',
    reason: '叫貨出貨',
    refOrderNo: order.orderNo,
    direction: -1, // 減
  });
}

// ===== 確認收貨：分店庫存增加 =====
async function updateStockOnReceive(order) {
  await batchStockChange({
    storeId: order.storeId,
    storeName: order.storeName,
    items: order.items,
    type: 'order_received',
    reason: '叫貨收貨',
    refOrderNo: order.orderNo,
    direction: +1, // 加
  });
}

async function batchStockChange({ storeId, storeName, items, type, reason, refOrderNo, direction }) {
  for (const it of items) {
    try {
      const invId = storeId + '_' + it.productId;
      const invRef = doc(db, 'inventory', invId);
      const invSnap = await getDoc(invRef);
      const curQty = invSnap.exists() ? (invSnap.data().qty || 0) : 0;
      const change = direction * it.qty;
      const after = curQty + change;
      
      // 更新庫存
      await setDoc(invRef, {
        storeId,
        productId: it.productId,
        sku: it.sku,
        name: it.name,
        unit: it.unit || '個',
        qty: after,
        safetyStock: invSnap.exists() ? (invSnap.data().safetyStock || 0) : 0,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.displayName,
      }, { merge: true });
      
      // 寫異動紀錄
      const { addDoc, collection: col } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      await addDoc(col(db, 'stockMovements'), {
        storeId,
        storeName: storeName || '',
        productId: it.productId,
        sku: it.sku,
        name: it.name,
        unit: it.unit || '個',
        type,
        qtyBefore: curQty,
        qtyChange: change,
        qtyAfter: after,
        reason,
        refOrderNo: refOrderNo || '',
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid,
        createdByName: currentUser.displayName,
      });
    } catch (e) {
      console.warn('庫存更新失敗', it.sku, e);
    }
  }
}


// ===== 掃碼 =====
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
