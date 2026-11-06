const $ = s => document.querySelector(s);
const tl = n => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
const params = new URLSearchParams(location.search);
const id = params.get('id') || '', t = params.get('t') || '';
const orderUrl = `/siparis.html?id=${encodeURIComponent(id)}&t=${encodeURIComponent(t)}`;

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === 'class' ? (e.className = v) : e.setAttribute(k, v);
  for (const c of children) e.append(c);
  return e;
}
function showError(msg) {
  $('#payPanel').replaceChildren(el('div', { class: 'pay-error' },
    el('h2', {}, 'Bir sorun oluştu'), el('p', { class: 'muted' }, msg),
    el('a', { class: 'btn btn-primary', href: '/' }, 'Mağazaya Dön')));
}

async function load() {
  const r = await fetch(`/api/orders/${encodeURIComponent(id)}?t=${encodeURIComponent(t)}`);
  const o = await r.json().catch(() => ({}));
  if (!r.ok) return showError(o.error || 'Sipariş bulunamadı.');
  if (o.status !== 'pending') return location.replace(orderUrl);

  $('#oid').textContent = o.id;
  $('#items').replaceChildren(...o.items.map(it =>
    el('div', { class: 'co-line' }, el('img', { src: `img/cards/vp-${it.vp}.svg`, alt: '' }),
      el('div', {}, it.title, el('small', {}, `${it.qty} adet`)), el('b', {}, tl(it.price * it.qty)))));
  $('#total').textContent = tl(o.total);
  $('#summary').hidden = false;

  const p = o.payment;
  if (!p) return showError('Ödeme bilgisi bulunamadı.');

  if (p.type === 'iframe') {
    const frame = el('iframe', { src: p.url, class: 'pay-frame', title: 'Ödeme formu', allow: 'payment' });
    $('#payPanel').replaceChildren(el('h2', {}, 'Kart Bilgileri'),
      el('p', { class: 'muted small' }, 'Kart bilgilerin bizim sunucumuza gelmez, doğrudan ödeme kuruluşunun güvenli sayfasına girilir.'), frame);
    pollUntilPaid();
  } else if (p.type === 'form') {
    const form = el('form', { method: 'POST', action: p.action });
    for (const [k, v] of Object.entries(p.fields)) form.append(el('input', { type: 'hidden', name: k, value: v }));
    $('#payPanel').replaceChildren(el('div', { class: 'pay-loading' }, el('div', { class: 'spinner' }), el('p', {}, 'Shopier ödeme sayfasına yönlendiriliyorsun…')), form);
    setTimeout(() => form.submit(), 600);
  } else if (p.type === 'demo') {
    const ok = el('button', { class: 'btn btn-primary btn-lg' }, 'Ödeme Başarılı (test)');
    const no = el('button', { class: 'btn btn-outline btn-lg' }, 'Ödeme Başarısız (test)');
    const send = async result => {
      ok.disabled = no.disabled = true;
      await fetch('/api/demo/pay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, t, result }) });
      location.replace(orderUrl);
    };
    ok.addEventListener('click', () => send('success'));
    no.addEventListener('click', () => send('fail'));
    $('#payPanel').replaceChildren(el('div', { class: 'demo-pay' },
      el('span', { class: 'chip' }, 'DEMO MODU'), el('h2', {}, 'Test Ödemesi'),
      el('p', { class: 'muted' }, 'Gerçek para çekilmez. Canlıya geçmeden önce config.json içinde demo ödemeyi kapat.'),
      el('div', { class: 'demo-actions' }, ok, no)));
  }
}

function pollUntilPaid() {
  const tick = async () => {
    try {
      const r = await fetch(`/api/orders/${encodeURIComponent(id)}?t=${encodeURIComponent(t)}`);
      const o = await r.json();
      if (r.ok && o.status !== 'pending') return location.replace(orderUrl);
    } catch {}
    setTimeout(tick, 4000);
  };
  setTimeout(tick, 4000);
}

if (!id || !t) showError('Geçersiz bağlantı.'); else load().catch(() => showError('Bağlantı hatası. Sayfayı yenile.'));
