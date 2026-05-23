import { requireLogin } from "../core/auth.js";
import { 
  collection, getDocs, query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const currentUser = await requireLogin();
const db = window.firebaseDB;
const isAdmin = currentUser.role === 'admin';

// DOM
const storeFilter = document.getElementById('storeFilter');
const dateFrom = document.getElementById('dateFrom');
const dateTo = document.getElementById('dateTo');
const dateDisplay = document.getElementById('dateDisplay');
const dateCustom = document.getElementById('dateCustom');
const loadingMsg = document.getElementById('loadingMsg');

let allStores = [];
let allProducts = [];
let allOrders = [];
let allInventory = [];
let allMovements = [];
let currentTab = 'orderStat';
let revenueChart = null;

// 日期區間
let rangeFrom = null;
let rangeTo = null;

// ===== 啟動 =====
async function init() {
  await loadStores();
  setDateRange('month'); // 預設本月
  bindEvents();
  await loadAndRender();
}

async function loadStores() {
  const snap = await getDocs(collection(db, 'stores'));
  allStores = [];
  snap.forEach(d => allStores.push({ id: d.id, ...d.data() }));
  
  if (isAdmin) {
    storeFilter.innerHTML = '<option value="">全部分店</option>' +
      allStores.filter(s => s.active !== false).map(s => 
        `<option value="${s.id}">${escapeHtml(s.storeCode)} - ${escapeHtml(s.storeName)}</option>`
      ).join('');
  } else {
    const my = allStores.find(s => s.id === currentUser.storeId);
    storeFilter.innerHTML = my ? `<option value="${my.id}">${escapeHtml(my.storeName)}</option>` : '';
    storeFilter.disabled = true;
  }
}

// ===== 事件綁定 =====
function bindEvents() {
  // 日期快捷
  document.querySelectorAll('.date-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const r = btn.dataset.range;
      if (r === 'custom') {
        dateCustom.style.display = 'flex';
        return;
      }
      dateCustom.style.display = 'none';
      setDateRange(r);
      loadAndRender();
    });
  });
  
  document.getElementById('applyDateBtn').addEventListener('click', () => {
    if (!dateFrom.value || !dateTo.value) {
      alert('請選擇開始與結束日期');
      return;
    }
    rangeFrom = new Date(dateFrom.value + 'T00:00:00');
    rangeTo = new Date(dateTo.value + 'T23:59:59');
    updateDateDisplay();
    loadAndRender();
  });
  
  storeFilter.addEventListener('change', loadAndRender);
  
  // 分頁切換
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTab = btn.dataset.tab;
      switchTab(currentTab);
    });
  });
  
  // 庫存搜尋 / 只看不足
  document.getElementById('invSearch').addEventListener('input', renderInvMatrix);
  document.getElementById('invOnlyLow').addEventListener('change', renderInvMatrix);
  
  // 異動類型篩選
  document.getElementById('moveTypeFilter').addEventListener('change', renderMovement);
  
  // 營收分組
  document.getElementById('revenueGroupBy').addEventListener('change', renderRevenue);
  
  // 匯出
  document.getElementById('exportBtn').addEventListener('click', exportCurrentTab);
}

function setDateRange(range) {
  const now = new Date();
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  
  if (range === 'today') {
    // from 已是今日 0 點
  } else if (range === 'week') {
    const day = from.getDay();
    const diff = (day === 0 ? 6 : day - 1); // 週一為一週起始
    from.setDate(from.getDate() - diff);
  } else if (range === 'month') {
    from.setDate(1);
  } else if (range === '3m') {
    from.setMonth(from.getMonth() - 3);
  } else if (range === '6m') {
    from.setMonth(from.getMonth() - 6);
  } else if (range === '12m') {
    from.setMonth(from.getMonth() - 12);
  }
  
  rangeFrom = from;
  rangeTo = to;
  dateFrom.value = from.toISOString().slice(0, 10);
  dateTo.value = to.toISOString().slice(0, 10);
  updateDateDisplay();
}

function updateDateDisplay() {
  const f = rangeFrom.toISOString().slice(0, 10);
  const t = rangeTo.toISOString().slice(0, 10);
  const days = Math.ceil((rangeTo - rangeFrom) / 86400000);
  dateDisplay.textContent = `${f} ～ ${t}（共 ${days} 天）`;
}

// ===== 載入資料並渲染 =====
async function loadAndRender() {
  loadingMsg.style.display = 'block';
  try {
    if (currentTab === 'orderStat' || currentTab === 'revenue') {
      await loadOrders();
    }
    if (currentTab === 'invOverview') {
      await loadInventoryAll();
    }
    if (currentTab === 'movement') {
      await loadMovements();
    }
    switchTab(currentTab);
  } catch (err) {
    alert('載入失敗：' + err.message + (err.message.includes('index') ? '\n\n請點開 F12 主控台，找錯誤訊息中的連結建立索引' : ''));
    console.error(err);
  } finally {
    loadingMsg.style.display = 'none';
  }
}

function switchTab(tab) {
  document.getElementById('tabOrderStat').style.display = (tab === 'orderStat') ? 'block' : 'none';
  document.getElementById('tabInvOverview').style.display = (tab === 'invOverview') ? 'block' : 'none';
  document.getElementById('tabMovement').style.display = (tab === 'movement') ? 'block' : 'none';
  document.getElementById('tabRevenue').style.display = (tab === 'revenue') ? 'block' : 'none';
  
  // 切換時若無資料則載入
  if (tab === 'orderStat' || tab === 'revenue') {
    if (allOrders.length === 0) loadOrders().then(() => render(tab));
    else render(tab);
  } else if (tab === 'invOverview') {
    if (allInventory.length === 0) loadInventoryAll().then(renderInvMatrix);
    else renderInvMatrix();
  } else if (tab === 'movement') {
    if (allMovements.length === 0) loadMovements().then(renderMovement);
    else renderMovement();
  }
}

function render(tab) {
  if (tab === 'orderStat') renderOrderStat();
  else if (tab === 'revenue') renderRevenue();
}

// ===== 載入叫貨單 =====
async function loadOrders() {
  const sid = storeFilter.value;
  const constraints = [
    where('createdAt', '>=', rangeFrom),
    where('createdAt', '<=', rangeTo),
  ];
  if (sid) constraints.push(where('storeId', '==', sid));
  else if (!isAdmin) constraints.push(where('storeId', '==', currentUser.storeId));
  constraints.push(orderBy('createdAt', 'desc'));
  
  const snap = await getDocs(query(collection(db, 'orders'), ...constraints));
  allOrders = [];
  snap.forEach(d => allOrders.push({ id: d.id, ...d.data() }));
}

// ===== 載入庫存 =====
async function loadInventoryAll() {
  const sid = storeFilter.value;
  let snap;
  if (sid) {
    snap = await getDocs(query(collection(db, 'inventory'), where('storeId', '==', sid)));
  } else if (!isAdmin) {
    snap = await getDocs(query(collection(db, 'inventory'), where('storeId', '==', currentUser.storeId)));
  } else {
    snap = await getDocs(collection(db, 'inventory'));
  }
  allInventory = [];
  snap.forEach(d => allInventory.push({ id: d.id, ...d.data() }));
  
  if (allProducts.length === 0) {
    const pSnap = await getDocs(query(collection(db, 'products'), orderBy('sku')));
    allProducts = [];
    pSnap.forEach(d => allProducts.push({ id: d.id, ...d.data() }));
  }
}

// ===== 載入異動 =====
async function loadMovements() {
  const sid = storeFilter.value;
  const constraints = [
    where('createdAt', '>=', rangeFrom),
    where('createdAt', '<=', rangeTo),
  ];
  if (sid) constraints.push(where('storeId', '==', sid));
  else if (!isAdmin) constraints.push(where('storeId', '==', currentUser.storeId));
  constraints.push(orderBy('createdAt', 'desc'), limit(1000));
  
  const snap = await getDocs(query(collection(db, 'stockMovements'), ...constraints));
  allMovements = [];
  snap.forEach(d => allMovements.push({ id: d.id, ...d.data() }));
}

// ===== 叫貨統計 =====
function renderOrderStat() {
  // 總計
 // 總計（排除取消/退回單）
const validOrders = allOrders.filter(o => !['cancelled', 'rejected'].includes(o.status));
const totalCount = allOrders.length;
const totalAmount = validOrders.reduce((s, o) => s + (o.totalAmount || 0), 0);
const totalItems = validOrders.reduce((s, o) => s + (o.itemCount || 0), 0);
  const completed = allOrders.filter(o => o.status === 'received').length;
  const processing = allOrders.filter(o => ['pending', 'pending_confirm', 'approved', 'shipped', 'cancel_requested'].includes(o.status)).length;
  const cancelled = allOrders.filter(o => ['cancelled', 'rejected'].includes(o.status)).length;
  
  document.getElementById('orderSummary').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">總叫貨單數</div>
      <div class="stat-value">${totalCount}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">總金額</div>
      <div class="stat-value">$${totalAmount.toLocaleString()}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">總商品項次</div>
      <div class="stat-value">${totalItems}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">已完成 / 處理中</div>
      <div class="stat-value">${completed} / ${processing}</div>
      <div class="stat-sub">取消或退回：${cancelled}</div>
    </div>
  `;
  
  // 按分店分組
  const byStore = {};
  allOrders.forEach(o => {
    if (!byStore[o.storeId]) {
      byStore[o.storeId] = {
        storeName: o.storeName, storeCode: o.storeCode || '',
        count: 0, items: 0, amount: 0,
        completed: 0, processing: 0, cancelled: 0,
      };
    }
    const x = byStore[o.storeId];
    x.count++;
    x.items += (o.itemCount || 0);
    x.amount += (o.totalAmount || 0);
    if (o.status === 'received') x.completed++;
    else if (['cancelled', 'rejected'].includes(o.status)) x.cancelled++;
    else x.processing++;
  });
  
  const rows = Object.values(byStore).sort((a, b) => b.amount - a.amount);
  document.getElementById('orderStatBody').innerHTML = rows.length === 0 ?
    `<tr><td colspan="8" style="text-align:center;color:#9ca3af">無資料</td></tr>` :
    rows.map(r => `
      <tr>
        <td><b>${escapeHtml(r.storeName)}</b></td>
        <td class="num">${r.count}</td>
        <td class="num">${r.items}</td>
        <td class="num"><b>$${r.amount.toLocaleString()}</b></td>
        <td class="num">$${r.count > 0 ? Math.round(r.amount / r.count).toLocaleString() : 0}</td>
        <td class="num">${r.completed}</td>
        <td class="num">${r.processing}</td>
        <td class="num">${r.cancelled}</td>
      </tr>
    `).join('');
}

// ===== 庫存總覽（矩陣） =====
function renderInvMatrix() {
  const keyword = document.getElementById('invSearch').value.trim().toLowerCase();
  const onlyLow = document.getElementById('invOnlyLow').checked;
  
  // 篩選顯示的分店（依當前 storeFilter）
  const sid = storeFilter.value;
  let displayStores = allStores.filter(s => s.active !== false);
  if (sid) displayStores = displayStores.filter(s => s.id === sid);
  else if (!isAdmin) displayStores = displayStores.filter(s => s.id === currentUser.storeId);
  
  // 表頭
  document.getElementById('invMatrixHead').innerHTML = 
    `<th>商品</th>` + 
    displayStores.map(s => `<th>${escapeHtml(s.storeName)}</th>`).join('') +
    `<th>合計</th>`;
  
  // 篩選商品（依顯示的分店類型過濾）
  // 如果只顯示一家分店，就用該分店判斷；如果多家，只要任一是 stores 就保留 stores_only/all，任一是 hq 就保留 hq_only/all
  const hasHQ = displayStores.some(s => s.storeType === 'hq');
  const hasBranch = displayStores.some(s => s.storeType !== 'hq');
  
  let products = allProducts.filter(p => p.active !== false).filter(p => {
    const av = p.availableFor || 'all';
    if (av === 'all') return true;
    if (av === 'hq_only') return hasHQ;       // 顯示的分店中有總店才顯示
    if (av === 'stores_only') return hasBranch; // 顯示的分店中有分店才顯示
    return true;
  });
  
  if (keyword) {

    products = products.filter(p => 
      (p.name || '').toLowerCase().includes(keyword) ||
      (p.sku || '').toLowerCase().includes(keyword)
    );
  }
  
  // 為每個商品+分店組合查 inventory
  const rows = products.map(p => {
    const cells = displayStores.map(s => {
      const inv = allInventory.find(i => i.storeId === s.id && i.productId === p.id);
      const qty = inv?.qty ?? 0;
      const safety = inv?.safetyStock ?? 0;
      const isLow = safety > 0 && qty < safety;
      return { qty, isLow, isZero: qty === 0 };
    });
    const total = cells.reduce((s, c) => s + c.qty, 0);
    const hasLow = cells.some(c => c.isLow);
    return { p, cells, total, hasLow };
  });
  
  const filtered = onlyLow ? rows.filter(r => r.hasLow) : rows;
  
  document.getElementById('invMatrixBody').innerHTML = filtered.length === 0 ?
    `<tr><td colspan="${displayStores.length + 2}" style="text-align:center;color:#9ca3af">無資料</td></tr>` :
    filtered.map(r => `
      <tr>
        <td>
          <span class="code-tag">${escapeHtml(r.p.sku)}</span>
          ${escapeHtml(r.p.name)}
        </td>
        ${r.cells.map(c => 
          `<td class="num ${c.isLow ? 'low' : ''} ${c.isZero ? 'zero' : ''}">${c.qty}</td>`
        ).join('')}
        <td class="num"><b>${r.total}</b></td>
      </tr>
    `).join('');
}

// ===== 異動報表 =====
function renderMovement() {
  const type = document.getElementById('moveTypeFilter').value;
  let items = allMovements;
  if (type) items = items.filter(m => m.type === type);
  
  // 摘要
  const totalIn = items.filter(m => m.qtyChange > 0).reduce((s, m) => s + m.qtyChange, 0);
  const totalOut = items.filter(m => m.qtyChange < 0).reduce((s, m) => s + Math.abs(m.qtyChange), 0);
  
  document.getElementById('moveSummary').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">異動筆數</div>
      <div class="stat-value">${items.length}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">入庫總量</div>
      <div class="stat-value" style="color:#059669">+${totalIn.toLocaleString()}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">出庫總量</div>
      <div class="stat-value" style="color:#dc2626">−${totalOut.toLocaleString()}</div>
    </div>
  `;
  
  document.getElementById('moveTableBody').innerHTML = items.length === 0 ?
    `<tr><td colspan="10" style="text-align:center;color:#9ca3af">無資料</td></tr>` :
    items.map(m => {
      const d = m.createdAt?.toDate ? m.createdAt.toDate() : new Date(m.createdAt);
      const dateStr = isNaN(d) ? '' : d.toLocaleString('zh-TW', { hour12: false });
      const ch = m.qtyChange > 0 ? `+${m.qtyChange}` : m.qtyChange;
      return `
        <tr>
          <td>${dateStr}</td>
          <td>${escapeHtml(m.storeName || '')}</td>
          <td><span class="move-tag move-tag-${m.type}">${moveTypeLabel(m.type)}</span></td>
          <td>${escapeHtml(m.sku || '')}</td>
          <td>${escapeHtml(m.name || '')}</td>
          <td class="num">${m.qtyBefore}</td>
          <td class="num ${m.qtyChange > 0 ? 'plus' : (m.qtyChange < 0 ? 'minus' : '')}">${ch}</td>
          <td class="num"><b>${m.qtyAfter}</b></td>
          <td>${escapeHtml(m.reason || '')}${m.refOrderNo ? ' (' + escapeHtml(m.refOrderNo) + ')' : ''}</td>
          <td>${escapeHtml(m.createdByName || '')}</td>
        </tr>
      `;
    }).join('');
}

// ===== 營收統計 =====
function renderRevenue() {
  const groupBy = document.getElementById('revenueGroupBy').value;
  const grouped = {};
  
  // 只統計非取消/退回的單
  const validOrders = allOrders.filter(o => !['cancelled', 'rejected'].includes(o.status));
  
  validOrders.forEach(o => {
    const d = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt);
    if (isNaN(d)) return;
    let key;
    if (groupBy === 'day') {
      key = d.toISOString().slice(0, 10);
    } else if (groupBy === 'week') {
      const tmp = new Date(d);
      const day = tmp.getDay();
      const diff = (day === 0 ? 6 : day - 1);
      tmp.setDate(tmp.getDate() - diff);
      key = tmp.toISOString().slice(0, 10) + ' 起';
    } else { // month
      key = d.toISOString().slice(0, 7);
    }
    if (!grouped[key]) grouped[key] = { count: 0, items: 0, amount: 0 };
    grouped[key].count++;
    grouped[key].items += (o.itemCount || 0);
    grouped[key].amount += (o.totalAmount || 0);
  });
  
  const keys = Object.keys(grouped).sort();
  const labels = keys;
  const amounts = keys.map(k => grouped[k].amount);
  const totalAmt = amounts.reduce((s, n) => s + n, 0);
  const avgAmt = keys.length > 0 ? Math.round(totalAmt / keys.length) : 0;
  
  document.getElementById('revenueSummary').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">期間總金額</div>
      <div class="stat-value">$${totalAmt.toLocaleString()}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">期數</div>
      <div class="stat-value">${keys.length}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">平均每期</div>
      <div class="stat-value">$${avgAmt.toLocaleString()}</div>
    </div>
  `;
  
  // 圖表
  const ctx = document.getElementById('revenueChart');
  if (revenueChart) revenueChart.destroy();
  revenueChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: '叫貨金額',
        data: amounts,
        backgroundColor: '#1e40af',
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => '$' + v.toLocaleString() } }
      }
    }
  });
  
  // 表格
  document.getElementById('revenueTableBody').innerHTML = keys.length === 0 ?
    `<tr><td colspan="4" style="text-align:center;color:#9ca3af">無資料</td></tr>` :
    keys.map(k => `
      <tr>
        <td>${escapeHtml(k)}</td>
        <td class="num">${grouped[k].count}</td>
        <td class="num">${grouped[k].items}</td>
        <td class="num"><b>$${grouped[k].amount.toLocaleString()}</b></td>
      </tr>
    `).join('');
}

// ===== 匯出 Excel =====
function exportCurrentTab() {
  const wb = XLSX.utils.book_new();
  const dt = new Date().toISOString().slice(0, 10);
  const filename = `報表_${currentTab}_${dt}.xlsx`;
  
  if (currentTab === 'orderStat') {
    const data = [];
    document.querySelectorAll('#orderStatBody tr').forEach(tr => {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 8) return;
      data.push({
        分店: tds[0].textContent.trim(),
        叫貨單數: tds[1].textContent.trim(),
        商品項目數: tds[2].textContent.trim(),
        總金額: tds[3].textContent.trim(),
        平均單金額: tds[4].textContent.trim(),
        已完成: tds[5].textContent.trim(),
        處理中: tds[6].textContent.trim(),
        '取消/退回': tds[7].textContent.trim(),
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), '叫貨統計');
  } else if (currentTab === 'invOverview') {
    const headers = Array.from(document.querySelectorAll('#invMatrixHead th')).map(th => th.textContent.trim());
    const data = [];
    document.querySelectorAll('#invMatrixBody tr').forEach(tr => {
      const tds = tr.querySelectorAll('td');
      if (tds.length !== headers.length) return;
      const row = {};
      headers.forEach((h, i) => { row[h] = tds[i].textContent.trim(); });
      data.push(row);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), '庫存總覽');
  } else if (currentTab === 'movement') {
    const data = allMovements.map(m => {
      const d = m.createdAt?.toDate ? m.createdAt.toDate() : new Date(m.createdAt);
      return {
        日期: isNaN(d) ? '' : d.toLocaleString('zh-TW', { hour12: false }),
        分店: m.storeName || '',
        類型: moveTypeLabel(m.type),
        SKU: m.sku || '',
        商品: m.name || '',
        異動前: m.qtyBefore,
        變動: m.qtyChange,
        異動後: m.qtyAfter,
        原因: m.reason || '',
        關聯單號: m.refOrderNo || '',
        經手人: m.createdByName || '',
      };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), '異動報表');
  } else if (currentTab === 'revenue') {
    const data = [];
    document.querySelectorAll('#revenueTableBody tr').forEach(tr => {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 4) return;
      data.push({
        期間: tds[0].textContent.trim(),
        單數: tds[1].textContent.trim(),
        商品數: tds[2].textContent.trim(),
        總金額: tds[3].textContent.trim(),
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), '營收統計');
  }
  
  XLSX.writeFile(wb, filename);
}

// ===== 工具 =====
function moveTypeLabel(t) {
  return {
    in: '進貨', out: '出貨', adjust: '調整', stocktake: '盤點',
    order_received: '叫貨收貨', order_shipped: '叫貨出貨',
  }[t] || t;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// 啟動
init();
