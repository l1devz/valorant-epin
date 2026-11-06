if (window.top !== window.self) window.top.location.href = location.href;

const $ = s => document.querySelector(s);
const tl = n => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
const params = new URLSearchParams(location.search);
const id = params.get('id') || '', t = params.get('t') || '';

const ICON = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
};
const svg = (name, cls = '') => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'ico ' + cls); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICON[name];
  return s;
};
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === 'class' ? (e.className = v) : e.setAttribute(k, v);
  for (const c of children) if (c != null) e.append(c);
  return e;
}

const STATUS = {
  pending:   { icon: 'clock', cls: 'st-wait', title: 'Ödeme bekleniyor', text: 'Ödemen henüz tamamlanmadı.' },
  paid:      { icon: 'clock', cls: 'st-wait', title: 'Ödeme alındı, kodların hazırlanıyor', text: 'Kodların kısa süre içinde bu sayfada görünecek. Sayfayı kapatabilirsin; bu bağlantıyı saklaman yeterli.' },
  delivered: { icon: 'check', cls: 'st-ok', title: 'Kodların teslim edildi!', text: 'Kodlarını aşağıda görebilirsin. Oyun içinde Mağaza → VP Satın Al → Ön ödemeli kod alanına gir.' },
  failed:    { icon: 'x', cls: 'st-bad', title: 'Ödeme başarısız', text: 'Ödemen alınamadı. Kartından para çekildiyse destek ekibimize sipariş numaranla yaz.' },
  cancelled: { icon: 'x', cls: 'st-bad', title: 'Sipariş iptal edildi', text: 'Bu sipariş iptal edildi.' },
};

let last = null, celebrated = false;

function toast(msg) {
  const e = $('#toast'); e.textContent = msg; e.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('show'), 2000);
}

function render(o) {
  const s = STATUS[o.status] || STATUS.pending;
  const head = el('div', { class: `status-card ${s.cls}` },
    el('div', { class: 'status-ico' }, svg(s.icon)),
    el('div', {}, el('h1', {}, s.title), el('p', { class: 'muted' }, s.text)));

  const steps = ['Sipariş', 'Ödeme', 'Teslim'];
  const idx = { pending: 1, paid: 2, delivered: 3, failed: 1, cancelled: 0 }[o.status] ?? 0;
  const timeline = el('ol', { class: 'timeline' }, ...steps.map((name, i) =>
    el('li', { class: i < idx ? 'done' : i === idx && !['failed', 'cancelled'].includes(o.status) ? 'now' : '' }, el('span', {}), name)));

  const items = el('div', { class: 'order-items' }, ...o.items.map(it => {
    const codes = it.codes.map(code => {
      const btn = el('button', { class: 'icon-btn', 'aria-label': 'Kodu kopyala', title: 'Kopyala' }, svg('copy'));
      btn.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(code); toast('Kod kopyalandı'); }
        catch { toast('Kopyalanamadı, elle seç'); }
      });
      return el('div', { class: 'code-row' }, el('code', {}, code), btn);
    });
    const missing = it.qty - it.codes.length;
    const waiting = missing > 0 && ['paid', 'delivered'].includes(o.status)
      ? Array.from({ length: missing }, () => el('div', { class: 'code-row code-wait' },
          el('span', { class: 'code-skel' }),
          el('span', { class: 'wait-label' }, el('span', { class: 'mini-spin' }), 'Hazırlanıyor')))
      : [];
    const done = it.codes.length;
    return el('div', { class: 'order-item' },
      el('div', { class: 'oi-head' }, el('img', { src: `img/cards/vp-${it.vp}.svg`, alt: '' }),
        el('div', { class: 'oi-title' }, el('strong', {}, it.title), el('small', { class: 'muted' }, `${it.qty} adet · ${tl(it.price * it.qty)}`)),
        ['paid', 'delivered'].includes(o.status)
          ? el('span', { class: `oi-count ${missing > 0 ? 'wait' : 'ok'}` }, `${done}/${it.qty} kod`)
          : null),
      codes.length || waiting.length ? el('div', { class: 'codes' }, ...codes, ...waiting) : null);
  }));

  const info = el('div', { class: 'order-info' },
    el('div', {}, el('span', { class: 'muted' }, 'Sipariş No'), el('b', {}, o.id)),
    el('div', {}, el('span', { class: 'muted' }, 'Tarih'), el('b', {}, new Date(o.createdAt).toLocaleString('tr-TR'))),
    el('div', {}, el('span', { class: 'muted' }, 'Toplam'), el('b', {}, tl(o.total))));

  const actions = el('div', { class: 'order-actions' });
  if (o.status === 'pending' && o.payment) actions.append(el('a', { class: 'btn btn-primary', href: `/odeme.html?id=${encodeURIComponent(id)}&t=${encodeURIComponent(t)}` }, 'Ödemeye Devam Et'));
  actions.append(el('a', { class: 'btn btn-outline', href: `mailto:${o.supportEmail}?subject=${encodeURIComponent('Sipariş ' + o.id)}` }, 'Destek'));

  $('#view').replaceChildren(head, timeline, info, items, actions,
    el('p', { class: 'muted small keep-link' }, 'Bu sayfanın bağlantısını sakla — kodlarına tekrar buradan ulaşabilirsin.'));

  if (o.status === 'delivered' && !celebrated) {
    celebrated = true;
    let seen = false;
    try { seen = sessionStorage.getItem('cel_' + o.id) === '1'; sessionStorage.setItem('cel_' + o.id, '1'); } catch {}
    if (!seen) confetti();
  }
  last = signature(o);
}

const signature = o => o.status + ':' + o.items.map(i => i.codes.length).join(',');

async function load() {
  try {
    const r = await fetch(`/api/orders/${encodeURIComponent(id)}?t=${encodeURIComponent(t)}`, { cache: 'no-store' });
    const o = await r.json();
    if (!r.ok) throw new Error(o.error || 'Sipariş bulunamadı.');
    if (signature(o) !== last) render(o);
    if (['pending', 'paid'].includes(o.status)) setTimeout(load, 4000);
  } catch (e) {
    $('#view').replaceChildren(el('div', { class: 'pay-error' }, el('h2', {}, 'Sipariş bulunamadı'), el('p', { class: 'muted' }, e.message)));
  }
}

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = $('#confetti'), ctx = c.getContext('2d');
  c.width = innerWidth; c.height = innerHeight;
  const colors = ['#ff4655', '#ffd166', '#5ce1e6', '#b69cff', '#2fd18b', '#ffffff'];
  const parts = Array.from({ length: 160 }, () => ({ x: innerWidth / 2, y: innerHeight / 3, vx: (Math.random() - .5) * 18, vy: Math.random() * -16 - 4, s: 5 + Math.random() * 7, r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: colors[Math.random() * colors.length | 0] }));
  let f = 0;
  (function draw() {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const p of parts) { p.vy += .45; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); }
    if (++f < 160) requestAnimationFrame(draw); else ctx.clearRect(0, 0, c.width, c.height);
  })();
}

if (!id || !t) $('#view').replaceChildren(el('div', { class: 'pay-error' }, el('h2', {}, 'Geçersiz bağlantı')));
else load();
