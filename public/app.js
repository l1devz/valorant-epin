let PRODUCTS = [];
let STORE = { providers: [], allowBackorder: true, maxQty: 20 };

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const tl = n => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
const num = n => n.toLocaleString('tr-TR');
const img = p => `img/cards/vp-${p.vp}.svg`;
const title = p => `${num(p.vp)} Valorant Points`;
const byId = id => PRODUCTS.find(p => p.id === id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const discount = p => (p.old > p.price ? Math.round((1 - p.price / p.old) * 100) : 0);

const state = { filter: 'all', sort: 'asc', q: '' };
let cart = {};
try { cart = JSON.parse(localStorage.getItem('vpm_cart')) || {}; } catch { cart = {}; }
if (typeof cart !== 'object' || Array.isArray(cart) || cart === null) cart = {};
function sanitizeCart() {
  for (const id of Object.keys(cart)) {
    const q = Math.floor(Number(cart[id]));
    if (!byId(id) || !Number.isFinite(q) || q < 1) delete cart[id];
    else cart[id] = Math.min(q, STORE.maxQty);
  }
}
const saveCart = () => { try { localStorage.setItem('vpm_cart', JSON.stringify(cart)); } catch {} };

const cartLines = () => Object.entries(cart).map(([id, q]) => ({ p: byId(id), q })).filter(l => l.p);
const totals = () => cartLines().reduce((t, { p, q }) => {
  t.count += q; t.total += p.price * q; t.sub += (p.old || p.price) * q; return t;
}, { count: 0, total: 0, sub: 0 });

function renderProducts() {
  let list = PRODUCTS.filter(p => {
    if (state.filter === 'popular' && !p.tags.includes('popular')) return false;
    if (state.filter === 'sale' && !p.old) return false;
    if (state.q && !(`${p.vp} ${num(p.vp)} valorant points vp`).includes(state.q)) return false;
    return true;
  });
  const sorters = {
    asc: (a, b) => a.price - b.price,
    desc: (a, b) => b.price - a.price,
    value: (a, b) => a.price / a.vp - b.price / b.vp,
  };
  list.sort(sorters[state.sort]);

  $('#emptyResult').hidden = list.length > 0;
  $('#products').innerHTML = list.map(p => {
    const d = discount(p);
    return `
    <article class="card">
      <button class="card-media" data-detail="${p.id}" aria-label="${title(p)} detay">
        <img src="${img(p)}" alt="${title(p)} e-pin kartı" loading="lazy" width="600" height="400">
        <div class="badges">
          ${d ? `<span class="badge dark">-%${d}</span>` : ''}
          ${p.badge ? `<span class="badge ${p.ok ? 'ok' : ''}">${esc(p.badge)}</span>` : ''}
        </div>
      </button>
      <div class="card-body">
        <div class="card-meta"><span class="instant"><svg class="ico ico-zap" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg> Anında teslim</span><span>TR Bölgesi</span></div>
        <h3 data-detail="${p.id}">${title(p)}</h3>
        <p class="unit">1 VP ≈ ${(p.price / p.vp).toLocaleString('tr-TR', { maximumFractionDigits: 3 })} ₺</p>
        <div class="card-foot">
          <div class="price-box">
            <s>${p.old ? tl(p.old) : ''}</s>
            <div class="price">${tl(p.price)}</div>
          </div>
          ${p.inStock || STORE.allowBackorder
            ? `<button class="btn btn-primary add-btn" data-add="${p.id}">Sepete Ekle</button>`
            : '<button class="btn btn-outline add-btn" disabled>Tükendi</button>'}
        </div>
      </div>
    </article>`;
  }).join('');
  observeReveal($$('#products .card'));
}

function renderCart() {
  const t = totals();
  const lines = cartLines();
  $('#cartCount').textContent = t.count;
  $('#cartCount2').textContent = t.count ? `(${t.count} ürün)` : '';
  $('#cartSub').textContent = tl(t.sub);
  $('#cartSave').textContent = '-' + tl(t.sub - t.total);
  $('#cartSaveRow').hidden = t.sub === t.total;
  $('#cartTotal').textContent = tl(t.total);
  $('#checkoutBtn').disabled = !lines.length;

  $('#cartItems').innerHTML = lines.length ? lines.map(({ p, q }) => `
    <div class="ci">
      <img src="${img(p)}" alt="">
      <div>
        <strong>${title(p)}</strong>
        <small>${tl(p.price)} / adet</small><br>
        <button class="remove" data-remove="${p.id}">Kaldır</button>
      </div>
      <div class="ci-right">
        <span class="ci-price">${tl(p.price * q)}</span>
        <div class="qty"><button data-dec="${p.id}" aria-label="Azalt">−</button><span>${q}</span><button data-inc="${p.id}" aria-label="Arttır">+</button></div>
      </div>
    </div>`).join('') : `
    <div class="cart-empty">
      <div class="big"><svg class="ico " viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg></div>
      <p>Sepetin şu an boş.</p>
      <a href="#paketler" class="btn btn-outline" data-close-cart>Paketlere Göz At</a>
    </div>`;
}

function addToCart(id, qty = 1, srcImg = null) {
  cart[id] = Math.min((cart[id] || 0) + qty, STORE.maxQty);
  saveCart();
  const btn = $('#cartOpen');
  const done = () => {
    renderCart();
    btn.classList.remove('bump'); void btn.offsetWidth; btn.classList.add('bump');
  };
  if (srcImg && !reduceMotion) flyToCart(srcImg, done); else done();
  toast(`${title(byId(id))} sepete eklendi`);
}

function flyToCart(srcImg, cb) {
  const from = srcImg.getBoundingClientRect();
  const to = $('#cartOpen').getBoundingClientRect();
  const el = srcImg.cloneNode();
  el.className = 'fly';
  Object.assign(el.style, { left: from.left + 'px', top: from.top + 'px', width: from.width + 'px' });
  document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    el.style.transform = `translate(${dx}px, ${dy}px) scale(.08) rotate(20deg)`;
    el.style.opacity = '.4';
  }));
  setTimeout(() => { el.remove(); cb(); }, 800);
}

let lastFocus = null;
function lock() { document.body.classList.toggle('lock', !!document.querySelector('.drawer.open, .modal.show')); }
function openCart() {
  lastFocus = document.activeElement;
  $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false');
  $('#overlay').classList.add('show'); lock();
  $('#cartClose').focus();
}
function closeCart() {
  $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true');
  $('#overlay').classList.remove('show'); lock();
}
function openModal(el) { lastFocus = lastFocus || document.activeElement; el.classList.add('show'); lock(); el.querySelector('.modal-close').focus(); }
function closeModals() {
  $$('.modal.show').forEach(m => m.classList.remove('show'));
  $('#checkoutView').hidden = false; $('#successView').hidden = true;
  lock(); lastFocus?.focus?.(); lastFocus = null;
}

let pm = { id: null, qty: 1 };
function openProduct(id) {
  const p = byId(id); if (!p) return;
  pm = { id, qty: 1 };
  $('#pmImg').src = img(p); $('#pmImg').alt = title(p) + ' e-pin kartı';
  $('#pmTitle').textContent = title(p);
  $('#pmPrice').textContent = tl(p.price);
  $('#pmOld').textContent = p.old ? tl(p.old) : '';
  $('#pmDisc').textContent = discount(p) ? `%${discount(p)} indirim` : '';
  $('#pmQty').textContent = 1;
  openModal($('#productModal'));
}

function openCheckout() {
  const lines = cartLines(); if (!lines.length) return;
  const t = totals();
  $('#coItems').innerHTML = lines.map(({ p, q }) => `
    <div class="co-line"><img src="${img(p)}" alt=""><div>${title(p)}<small>${q} adet</small></div><b>${tl(p.price * q)}</b></div>`).join('');
  $('#coTotal').textContent = tl(t.total);
  $('#payTotal').textContent = tl(t.total);
  $('#formError').hidden = true;
  renderPayMethods();
  closeCart(); openModal($('#checkoutModal'));
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2200);
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-add],[data-inc],[data-dec],[data-remove],[data-detail],[data-close],[data-close-cart]');
  if (!t) return;
  const d = t.dataset;
  if (d.add) addToCart(d.add, 1, t.closest('.card')?.querySelector('.card-media img'));
  else if (d.detail) openProduct(d.detail);
  else if (d.inc) { cart[d.inc] = Math.min(cart[d.inc] + 1, STORE.maxQty); saveCart(); renderCart(); }
  else if (d.dec) { if (--cart[d.dec] <= 0) delete cart[d.dec]; saveCart(); renderCart(); }
  else if (d.remove) { delete cart[d.remove]; saveCart(); renderCart(); }
  else if ('close' in d) closeModals();
  else if ('closeCart' in d) closeCart();
});

$('#cartOpen').addEventListener('click', openCart);
$('#cartClose').addEventListener('click', closeCart);
$('#overlay').addEventListener('click', closeCart);
$('#checkoutBtn').addEventListener('click', openCheckout);
$$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) closeModals(); }));
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModals(); closeCart(); } });

$('#pmInc').addEventListener('click', () => { pm.qty = Math.min(pm.qty + 1, STORE.maxQty); $('#pmQty').textContent = pm.qty; });
$('#pmDec').addEventListener('click', () => { pm.qty = Math.max(pm.qty - 1, 1); $('#pmQty').textContent = pm.qty; });
$('#pmAdd').addEventListener('click', () => {
  const src = $('#pmImg');
  addToCart(pm.id, pm.qty, src);
  closeModals();
});

$$('.tab').forEach(b => b.addEventListener('click', () => {
  $$('.tab').forEach(x => x.classList.toggle('active', x === b));
  state.filter = b.dataset.filter; renderProducts();
}));
$('#sort').addEventListener('change', e => { state.sort = e.target.value; renderProducts(); });
$('#search').addEventListener('input', e => {
  state.q = e.target.value.trim().toLocaleLowerCase('tr-TR').replace(/\./g, '');
  renderProducts();
  if (state.q && window.scrollY < $('#paketler').offsetTop - 200) $('#paketler').scrollIntoView({ behavior: 'smooth' });
});

function renderPayMethods() {
  const fs = $('#payMethods');
  const cur = fs.querySelector('input:checked')?.value;
  fs.querySelectorAll('.pm-opt, .no-pay').forEach(n => n.remove());
  if (!STORE.providers.length) {
    const p = document.createElement('p');
    p.className = 'form-error no-pay';
    p.textContent = 'Şu an aktif ödeme yöntemi yok. Lütfen daha sonra tekrar dene.';
    fs.append(p);
  }
  STORE.providers.forEach((pr, i) => {
    const label = document.createElement('label');
    label.className = 'pm-opt';
    const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'provider', value: pr.id });
    input.checked = cur ? cur === pr.id : i === 0;
    const span = document.createElement('span');
    const b = document.createElement('b'); b.textContent = pr.label;
    const small = document.createElement('small'); small.textContent = pr.desc;
    span.append(b, small); label.append(input, span); fs.append(label);
  });
  $('#demoNote').hidden = !STORE.providers.some(p => p.id === 'demo');
  $('#payBtn').disabled = !STORE.providers.length;
}

$('#checkoutForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  let firstBad = null;
  for (const el of f.querySelectorAll('[data-only]')) el.value = FILTERS[el.dataset.only](el.value.trim()).slice(0, el.maxLength);
  for (const el of f.querySelectorAll('input[required]')) {
    const ok = el.checkValidity();
    el.classList.toggle('invalid', !ok);
    if (!ok && !firstBad) firstBad = el;
  }
  if (firstBad) {
    const msg = firstBad.name === 'terms' ? 'Devam etmek için sözleşmeyi onaylaman gerekiyor.'
      : firstBad.name === 'email' ? 'Geçerli bir e-posta adresi gir.'
      : firstBad.name === 'phone' ? 'Telefon numarası 05 ile başlayan 11 haneli olmalı (sadece rakam).'
      : firstBad.name === 'name' ? 'Ad soyad en az 3 harf olmalı.'
      : 'Lütfen zorunlu alanları doldur.';
    $('#formError').textContent = msg; $('#formError').hidden = false;
    firstBad.focus(); return;
  }
  const btn = $('#payBtn');
  btn.disabled = true;
  try {
    const r = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: f.name.value, email: f.email.value, phone: f.phone.value, terms: f.terms.checked,
        provider: f.querySelector('input[name=provider]:checked')?.value,
        items: cartLines().map(({ p, q }) => ({ id: p.id, qty: q })),
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Sipariş oluşturulamadı.');
    cart = {}; saveCart();
    location.href = `/odeme.html?id=${encodeURIComponent(j.id)}&t=${encodeURIComponent(j.token)}`;
  } catch (err) {
    $('#formError').textContent = err.message; $('#formError').hidden = false;
    btn.disabled = false;
  }
});
$('#checkoutForm').addEventListener('input', e => e.target.classList.remove('invalid'));

const FILTERS = {
  digits: v => v.replace(/\D+/g, ''),
  name: v => v.replace(/[^a-zA-ZçğıöşüÇĞİÖŞÜ ]+/g, '').replace(/ {2,}/g, ' '),
  email: v => v.replace(/[^a-zA-Z0-9@._+-]+/g, '').toLowerCase(),
};
document.addEventListener('input', e => {
  const el = e.target, f = FILTERS[el.dataset?.only];
  if (!f) return;
  const clean = f(el.value).slice(0, el.maxLength > 0 ? el.maxLength : undefined);
  if (clean !== el.value) el.value = clean;
}, true);

const isField = el => el && el.closest && el.closest('input, textarea, select');
['copy', 'cut'].forEach(ev => document.addEventListener(ev, e => { if (!isField(e.target)) e.preventDefault(); }));
document.addEventListener('contextmenu', e => { if (!isField(e.target)) e.preventDefault(); });
document.addEventListener('dragstart', e => e.preventDefault());
document.addEventListener('selectstart', e => { if (!isField(e.target)) e.preventDefault(); });
document.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  if (mod && ['u', 's', 'p'].includes(k)) e.preventDefault();
  if (mod && ['c', 'x', 'a'].includes(k) && !isField(e.target)) e.preventDefault();
});

const io = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    en.target.classList.add('in');
    io.unobserve(en.target);
  }
}, { threshold: .12, rootMargin: '0px 0px -40px 0px' }) : null;

function observeReveal(els) {
  els.forEach((el, i) => {
    const siblings = [...el.parentElement.children].filter(c => c.matches('[data-reveal], .card'));
    el.style.setProperty('--rd', (siblings.indexOf(el) * 0.08).toFixed(2) + 's');
    if (el.classList.contains('card')) {
      el.addEventListener('animationend', () => el.classList.add('shown'), { once: true });
    }
    if (io && !reduceMotion) io.observe(el); else el.classList.add('in', 'shown');
  });
  revealVisible();
}

function revealVisible() {
  for (const el of $$('[data-reveal]:not(.in), .card:not(.in)')) {
    const r = el.getBoundingClientRect();
    if (r.top < innerHeight - 20 && r.bottom > 0) { el.classList.add('in'); io?.unobserve(el); }
  }
}

const canHover = matchMedia('(hover: hover)').matches;
if (canHover && !reduceMotion) {
  $('#products').addEventListener('pointermove', e => {
    const card = e.target.closest('.card.shown'); if (!card) return;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    card.style.setProperty('--mx', x * 100 + '%');
    card.style.setProperty('--my', y * 100 + '%');
    card.style.transform = `perspective(900px) rotateX(${(0.5 - y) * 8}deg) rotateY(${(x - 0.5) * 10}deg) translateY(-6px)`;
  });
  $('#products').addEventListener('pointerout', e => {
    const card = e.target.closest('.card');
    if (card && !card.contains(e.relatedTarget)) card.style.transform = '';
  });

  const hv = $('#heroVisual');
  $('#hero').addEventListener('pointermove', e => {
    const x = e.clientX / innerWidth - 0.5, y = e.clientY / innerHeight - 0.5;
    hv.querySelectorAll('.layer').forEach(l => {
      const d = +l.dataset.depth;
      l.style.transform = `translate3d(${-x * d}px, ${-y * d}px, 0)`;
    });
  });
}

document.addEventListener('pointerdown', e => {
  const b = e.target.closest('.btn-primary'); if (!b || reduceMotion) return;
  const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height);
  const w = document.createElement('span');
  w.className = 'ripple';
  Object.assign(w.style, { width: s + 'px', height: s + 'px', left: e.clientX - r.left - s / 2 + 'px', top: e.clientY - r.top - s / 2 + 'px' });
  b.appendChild(w);
  setTimeout(() => w.remove(), 650);
});

const onScroll = () => {
  const h = document.documentElement;
  $('#progress').style.transform = `scaleX(${h.scrollTop / (h.scrollHeight - h.clientHeight || 1)})`;
  $('.header').classList.toggle('scrolled', h.scrollTop > 40);
  revealVisible();
};
addEventListener('scroll', onScroll, { passive: true });

function typeLoop() {
  const words = ['anında', 'güvenle', 'ucuza', 'saniyede'];
  const el = $('#typed');
  let w = 0, i = words[0].length, del = true;
  const tick = () => {
    const word = words[w];
    i += del ? -1 : 1;
    el.textContent = word.slice(0, i) || '​';
    let wait = del ? 55 : 95;
    if (!del && i === word.length) { del = true; wait = 2200; }
    else if (del && i === 0) { del = false; w = (w + 1) % words.length; wait = 300; }
    setTimeout(tick, wait);
  };
  setTimeout(tick, 2600);
}

function confetti() {
  if (reduceMotion) return;
  const c = $('#confetti'), ctx = c.getContext('2d');
  c.width = innerWidth; c.height = innerHeight;
  const colors = ['#ff4655', '#ffd166', '#5ce1e6', '#b69cff', '#2fd18b', '#ffffff'];
  const parts = Array.from({ length: 160 }, () => ({
    x: innerWidth / 2, y: innerHeight / 2 - 40,
    vx: (Math.random() - .5) * 18, vy: Math.random() * -16 - 4,
    s: 5 + Math.random() * 7, r: Math.random() * 6, vr: (Math.random() - .5) * .4,
    c: colors[Math.random() * colors.length | 0],
  }));
  let frame = 0;
  (function draw() {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const p of parts) {
      p.vy += .45; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    if (++frame < 160) requestAnimationFrame(draw); else ctx.clearRect(0, 0, c.width, c.height);
  })();
}

$('#year').textContent = new Date().getFullYear();
observeReveal($$('[data-reveal]'));
(async function loadStore() {
  try {
    const r = await fetch('/api/store', { cache: 'no-store' });
    if (!r.ok) throw new Error();
    STORE = await r.json();
    PRODUCTS = STORE.products;
  } catch {
    $('#emptyResult').textContent = 'Ürünler yüklenemedi. Sayfayı yenile.';
    $('#emptyResult').hidden = false;
  }
  sanitizeCart(); saveCart();
  renderProducts();
  renderCart();
})();
onScroll();

const t0 = performance.now();
let started = false;
function start() {
  if (started) return; started = true;
  setTimeout(() => {
    document.body.classList.remove('is-loading');
    document.body.classList.add('ready');
    revealVisible();
    if (!reduceMotion) typeLoop();
  }, Math.max(0, 700 - (performance.now() - t0)));
}
addEventListener('load', start);
setTimeout(start, 1500);
