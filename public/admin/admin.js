const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const tl = n => Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
const date = ts => ts ? new Date(ts).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const STATUS = { pending: 'Ödeme bekleniyor', paid: 'Teslim bekliyor', delivered: 'Teslim edildi', failed: 'Başarısız', cancelled: 'İptal' };

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c != null && c !== false) e.append(c);
  return e;
}
const badge = s => el('span', { class: `st st-${s}` }, STATUS[s] || s);

async function api(path, opts = {}) {
  const r = await fetch('/api/admin/' + path, {
    method: opts.method || 'GET',
    headers: { 'X-Admin': '1', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== 'login') { showLogin(); throw new Error('Oturum sona erdi'); }
  if (!r.ok) throw new Error(j.error || 'Hata');
  return j;
}

function toast(msg, bad = false) {
  const t = $('#toast'); t.textContent = msg; t.style.borderLeftColor = bad ? 'var(--accent)' : 'var(--ok)';
  t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

function showLogin() { $('#app').hidden = true; $('#login').hidden = false; }
function showApp() { $('#login').hidden = true; $('#app').hidden = false; }

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#loginErr'); err.hidden = true;
  try {
    await api('login', { method: 'POST', body: { password: e.target.password.value } });
    e.target.reset(); showApp(); loadAll();
  } catch (x) { err.textContent = x.message; err.hidden = false; }
});
$('#logout').addEventListener('click', async () => { await api('logout', { method: 'POST' }).catch(() => {}); showLogin(); });

$$('.nav-btn').forEach(b => b.addEventListener('click', () => openTab(b.dataset.tab)));
function openTab(name) {
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach(t => t.hidden = t.id !== 'tab-' + name);
  if (name === 'dash') loadSummary();
  if (name === 'orders') loadOrders();
  if (name === 'stock') loadCodes();
}

let products = [];
async function loadSummary() {
  const s = await api('summary');
  products = s.stock;
  const waiting = s.byStatus.paid || 0;
  $('#navPaid').hidden = !waiting; $('#navPaid').textContent = waiting;
  $('#paidAlert').hidden = !waiting;
  $('#paidAlert').textContent = `${waiting} sipariş ödendi ama stok yetersiz olduğu için teslim bekliyor. Görmek için tıkla.`;

  $('#stats').replaceChildren(
    el('div', { class: 'stat' }, el('span', {}, 'Bugünkü ciro'), el('strong', {}, tl(s.today.s / 100)), el('small', { class: 'muted' }, `${s.today.n} sipariş`)),
    el('div', { class: 'stat' }, el('span', {}, 'Toplam ciro'), el('strong', {}, tl(s.all.s / 100)), el('small', { class: 'muted' }, `${s.all.n} sipariş`)),
    el('div', { class: 'stat' + (waiting ? ' warn' : '') }, el('span', {}, 'Teslim bekleyen'), el('strong', {}, String(waiting))),
    el('div', { class: 'stat' }, el('span', {}, 'Aktif ödeme'), el('strong', { style: 'font-size:1.1rem' }, s.providers.join(', ') || 'YOK')),
  );
  $('#stockGrid').replaceChildren(...s.stock.map(p => {
    const vp = p.id.replace('vp', '');
    return el('div', { class: 'stock-card' + (p.free < 3 ? ' low' : '') },
      el('img', { src: `/img/cards/vp-${vp}.svg`, alt: '' }),
      el('div', {}, el('small', { class: 'muted' }, p.title), el('b', {}, String(p.free)), el('small', { class: 'muted' }, `${p.used} kullanıldı`)));
  }));
  fillProductSelects();
}
$('#paidAlert').addEventListener('click', () => { $('#orderStatus').value = 'paid'; openTab('orders'); });

let searchTimer;
$('#orderSearch').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadOrders, 300); });
$('#orderStatus').addEventListener('change', loadOrders);

async function loadOrders() {
  const qs = new URLSearchParams({ status: $('#orderStatus').value, q: $('#orderSearch').value });
  const rows = await api('orders?' + qs);
  const head = el('thead', {}, el('tr', {}, ...['Sipariş', 'Tarih', 'Müşteri', 'Ürünler', 'Tutar', 'Ödeme', 'Durum'].map(h => el('th', {}, h))));
  const body = el('tbody', {}, ...(rows.length ? rows.map(o => el('tr', { class: 'click', onclick: () => openOrder(o.id) },
    el('td', {}, el('code', {}, o.id)),
    el('td', {}, date(o.created_at)),
    el('td', {}, o.name, el('br'), el('small', { class: 'muted' }, o.email)),
    el('td', {}, o.items.map(i => `${i.qty}× ${i.vp} VP`).join(', ')),
    el('td', {}, tl(o.total)),
    el('td', {}, o.provider),
    el('td', {}, badge(o.status)),
  )) : [el('tr', {}, el('td', { class: 'empty', colspan: '7' }, 'Sipariş yok'))]));
  $('#ordersTable').replaceChildren(head, body);
}

async function openOrder(id) {
  const o = await api('orders/' + encodeURIComponent(id));
  const link = `${location.origin}/siparis.html?id=${o.id}&t=${o.token}`;
  const inputs = {};
  const items = o.items.map(it => {
    const missing = it.qty - it.codes.length;
    const box = el('div', { class: 'od-item' },
      el('strong', {}, `${it.qty}× ${it.title}`), el('small', { class: 'muted' }, ` · ${tl(it.price * it.qty)}`),
      ...it.codes.map(c => el('code', {}, c)));
    if (o.status === 'paid' && missing > 0) {
      const ta = el('textarea', { rows: String(Math.min(missing, 4)), placeholder: `${missing} kod gir (her satıra bir)`, spellcheck: 'false' });
      inputs[it.id] = ta;
      box.append(el('p', { class: 'od-note' }, `${missing} kod eksik`), ta);
    }
    return box;
  });

  const actions = el('div', { class: 'od-actions' });
  if (Object.keys(inputs).length) actions.append(el('button', { class: 'btn btn-primary', onclick: async () => {
    const codes = {};
    for (const [pid, ta] of Object.entries(inputs)) codes[pid] = ta.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    try { const r = await api(`orders/${o.id}/deliver`, { method: 'POST', body: { codes } }); toast(r.status === 'delivered' ? 'Teslim edildi' : 'Kodlar eklendi'); refreshAfter(o.id); }
    catch (e) { toast(e.message, true); }
  } }, 'Kodları Teslim Et'));
  if (['pending', 'failed'].includes(o.status)) actions.append(el('button', { class: 'btn btn-outline', onclick: async () => {
    if (!confirm('Bu siparişin ödemesini aldığından emin misin? (ör. havale)')) return;
    try { await api(`orders/${o.id}/status`, { method: 'POST', body: { status: 'paid' } }); toast('Ödendi olarak işaretlendi'); refreshAfter(o.id); }
    catch (e) { toast(e.message, true); }
  } }, 'Ödendi Olarak İşaretle'));
  if (['pending', 'failed', 'paid'].includes(o.status) && !o.items.some(i => i.codes.length)) actions.append(el('button', { class: 'btn btn-danger', onclick: async () => {
    if (!confirm('Sipariş iptal edilsin mi? (Ödeme alındıysa iadeyi ödeme panelinden yapman gerekir.)')) return;
    try { await api(`orders/${o.id}/status`, { method: 'POST', body: { status: 'cancelled' } }); toast('İptal edildi'); refreshAfter(o.id); }
    catch (e) { toast(e.message, true); }
  } }, 'İptal Et'));
  actions.append(el('button', { class: 'btn btn-outline', onclick: async () => {
    try { await navigator.clipboard.writeText(link); toast('Müşteri bağlantısı kopyalandı'); } catch { prompt('Bağlantı:', link); }
  } }, 'Müşteri Linkini Kopyala'));

  $('#orderDetail').replaceChildren(
    el('h2', { style: 'margin-top:0' }, 'Sipariş ', el('code', {}, o.id), ' ', badge(o.status)),
    el('div', { class: 'od-grid' },
      ...[['Müşteri', o.name], ['E-posta', o.email], ['Telefon', o.phone], ['Tutar', tl(o.total)], ['Ödeme', `${o.provider}${o.paymentRef ? ' · ' + o.paymentRef : ''}`], ['IP', o.ip || '—'],
        ['Oluşturma', date(o.createdAt)], ['Ödeme zamanı', date(o.paidAt)], ['Teslim', date(o.deliveredAt)]]
        .map(([k, v]) => el('div', {}, el('span', {}, k), String(v ?? '—')))),
    o.note ? el('p', { class: 'od-note' }, 'Not: ' + o.note) : null,
    ...items, actions);
  $('#orderModal').classList.add('show');
}
async function refreshAfter(id) { await openOrder(id); loadOrders(); loadSummary(); }
$('#orderModal').addEventListener('click', e => { if (e.target.id === 'orderModal' || e.target.closest('[data-close]')) $('#orderModal').classList.remove('show'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#orderModal').classList.remove('show'); });

function fillProductSelects() {
  for (const sel of [$('#codeProduct'), $('#listProduct')]) {
    const cur = sel.value;
    sel.replaceChildren(...products.map(p => el('option', { value: p.id }, `${p.title} (${p.free} stok)`)));
    if (cur) sel.value = cur;
  }
}
$('#listProduct').addEventListener('change', loadCodes);
$('#listUsed').addEventListener('change', loadCodes);

async function loadCodes() {
  if (!products.length) await loadSummary();
  const pid = $('#listProduct').value || products[0]?.id;
  const used = $('#listUsed').value;
  const rows = await api(`codes?product=${encodeURIComponent(pid)}&used=${used}`);
  const head = el('thead', {}, el('tr', {}, ...['Kod', 'Eklenme', used === '1' ? 'Sipariş' : '', ''].map(h => el('th', {}, h))));
  const body = el('tbody', {}, ...(rows.length ? rows.map(c => el('tr', {},
    el('td', {}, el('code', {}, c.code)),
    el('td', {}, date(c.added_at)),
    el('td', {}, c.order_id ? el('a', { href: '#', onclick: e => { e.preventDefault(); openOrder(c.order_id); } }, c.order_id) : ''),
    el('td', {}, !c.order_id ? el('button', { class: 'btn btn-danger btn-sm', onclick: async () => {
      if (!confirm('Bu kod silinsin mi?')) return;
      try { await api('codes/' + c.id, { method: 'DELETE' }); toast('Silindi'); loadCodes(); loadSummary(); } catch (e) { toast(e.message, true); }
    } }, 'Sil') : ''),
  )) : [el('tr', {}, el('td', { class: 'empty', colspan: '4' }, 'Kod yok'))]));
  $('#codesTable').replaceChildren(head, body);
}

$('#addCodesForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  try {
    const r = await api('codes', { method: 'POST', body: { productId: f.productId.value, codes: f.codes.value } });
    toast(`${r.added} kod eklendi` + (r.duplicates ? `, ${r.duplicates} tekrar atlandı` : ''));
    f.codes.value = '';
    $('#listProduct').value = f.productId.value; $('#listUsed').value = '0';
    await loadSummary(); loadCodes();
  } catch (x) { toast(x.message, true); }
});

async function loadAll() { await loadSummary(); }
api('summary').then(() => { showApp(); loadAll(); }).catch(() => showLogin());
setInterval(() => { if (!$('#app').hidden && !$('#tab-dash').hidden) loadSummary().catch(() => {}); }, 15000);
