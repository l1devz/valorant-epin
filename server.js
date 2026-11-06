import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, createReadStream, watchFile } from 'node:fs';
import { join, extname, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const CONFIG_PATH = join(ROOT, 'config.json');

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    const ex = JSON.parse(readFileSync(join(ROOT, 'config.example.json'), 'utf8'));
    ex.admin.password = crypto.randomBytes(12).toString('base64url');
    writeFileSync(CONFIG_PATH, JSON.stringify(ex, null, 2));
    console.log('\n[kurulum] config.json oluşturuldu. Admin şifresi config.json içinde (admin.password).\n');
  }
  const c = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const ids = new Set();
  for (const p of c.products) {
    if (!/^[a-z0-9]{2,30}$/.test(p.id) || ids.has(p.id)) throw new Error(`Geçersiz/tekrarlı ürün id: ${p.id}`);
    if (!(p.price > 0)) throw new Error(`Geçersiz fiyat: ${p.id}`);
    ids.add(p.id);
  }
  if (!c.admin?.password || c.admin.password.length < 10) {
    console.warn('[uyarı] admin.password en az 10 karakter olmalı. Admin paneli kapalı.');
  }
  return c;
}
let config = loadConfig();
watchFile(CONFIG_PATH, { interval: 2000 }, () => {
  try { config = loadConfig(); console.log('[config] yeniden yüklendi'); }
  catch (e) { console.error('[config] HATA, eski ayarlar kullanılıyor:', e.message); }
});

const product = id => config.products.find(p => p.id === id);
const title = p => `${p.vp.toLocaleString('tr-TR')} Valorant Points`;
const kurus = tl => Math.round(tl * 100);
const tl = k => (k / 100).toFixed(2);

mkdirSync(join(ROOT, 'data'), { recursive: true });
const db = new DatabaseSync(join(ROOT, 'data', 'store.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, token TEXT NOT NULL, status TEXT NOT NULL,
    provider TEXT NOT NULL, name TEXT, email TEXT, phone TEXT,
    items TEXT NOT NULL, total INTEGER NOT NULL, ip TEXT,
    payment_data TEXT, payment_ref TEXT, note TEXT,
    created_at INTEGER NOT NULL, paid_at INTEGER, delivered_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, product_id TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE, order_id TEXT,
    added_at INTEGER NOT NULL, used_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_codes_free ON codes(product_id, order_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at);
`);

const q = {
  insertOrder: db.prepare(`INSERT INTO orders (id, token, status, provider, name, email, phone, items, total, ip, created_at)
                           VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`),
  getOrder: db.prepare('SELECT * FROM orders WHERE id = ?'),
  setPaymentData: db.prepare('UPDATE orders SET payment_data = ? WHERE id = ?'),
  setStatus: db.prepare('UPDATE orders SET status = ?, note = COALESCE(?, note) WHERE id = ?'),
  markPaid: db.prepare(`UPDATE orders SET status = 'paid', paid_at = ?, payment_ref = ? WHERE id = ?`),
  markDelivered: db.prepare(`UPDATE orders SET status = 'delivered', delivered_at = ? WHERE id = ?`),
  freeCodes: db.prepare('SELECT id FROM codes WHERE product_id = ? AND order_id IS NULL ORDER BY id LIMIT ?'),
  useCode: db.prepare('UPDATE codes SET order_id = ?, used_at = ? WHERE id = ? AND order_id IS NULL'),
  orderCodes: db.prepare('SELECT product_id, code FROM codes WHERE order_id = ? ORDER BY id'),
  countAssigned: db.prepare('SELECT COUNT(*) n FROM codes WHERE order_id = ? AND product_id = ?'),
  stock: db.prepare(`SELECT product_id, SUM(order_id IS NULL) free, SUM(order_id IS NOT NULL) used FROM codes GROUP BY product_id`),
  freeCount: db.prepare('SELECT COUNT(*) n FROM codes WHERE product_id = ? AND order_id IS NULL'),
  addCode: db.prepare('INSERT OR IGNORE INTO codes (product_id, code, added_at) VALUES (?, ?, ?)'),
  addUsedCode: db.prepare('INSERT INTO codes (product_id, code, order_id, added_at, used_at) VALUES (?, ?, ?, ?, ?)'),
  paidOrders: db.prepare(`SELECT id FROM orders WHERE status = 'paid' ORDER BY paid_at`),
};

const tx = fn => {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
};

function tryDeliver(orderId) {
  return tx(() => {
    const o = q.getOrder.get(orderId);
    if (!o || o.status !== 'paid') return o?.status;
    let complete = true;
    for (const it of JSON.parse(o.items)) {
      const need = it.qty - q.countAssigned.get(o.id, it.id).n;
      if (need <= 0) continue;
      const free = q.freeCodes.all(it.id, need);
      for (const c of free) q.useCode.run(o.id, Date.now(), c.id);
      if (free.length < need) complete = false;
    }
    if (complete) { q.markDelivered.run(Date.now(), o.id); return 'delivered'; }
    return 'paid';
  });
}

function markPaid(orderId, ref) {
  const changed = tx(() => {
    const o = q.getOrder.get(orderId);
    if (!o || !['pending', 'failed'].includes(o.status)) return false;
    q.markPaid.run(Date.now(), ref || null, o.id);
    return true;
  });
  if (!changed) return;
  const status = tryDeliver(orderId);
  const o = q.getOrder.get(orderId);
  notify(`💰 Yeni ödeme: **${o.id}** — ${tl(o.total)} ₺ (${o.provider})\n` +
    (status === 'delivered' ? '✅ Kodlar otomatik teslim edildi.' : '⚠️ Stok yetersiz — admin panelinden teslim et!'));
}

function deliverPendingOrders() {
  for (const { id } of q.paidOrders.all()) tryDeliver(id);
}

async function notify(text) {
  const url = config.notify?.discordWebhook;
  console.log('[bildirim]', text.replace(/\*\*/g, ''));
  if (!url || !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(url)) return;
  try {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text }) });
  } catch (e) { console.error('[bildirim] gönderilemedi:', e.message); }
}

const hmacB64 = (key, data) => crypto.createHmac('sha256', key).update(data).digest('base64');
const safeEq = (a, b) => {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};

const PROVIDERS = {
  demo: { label: 'Test Ödemesi (demo)', desc: 'Gerçek para çekilmez', ok: c => c.payment.demo?.enabled },
  paytr: {
    label: 'Kredi / Banka Kartı', desc: 'PayTR güvencesiyle',
    ok: c => { const p = c.payment.paytr; return p?.enabled && p.merchantId && p.merchantKey && p.merchantSalt; },
  },
  shopier: {
    label: 'Shopier ile Öde', desc: 'Kart ile güvenli ödeme',
    ok: c => { const p = c.payment.shopier; return p?.enabled && p.apiKey && p.apiSecret; },
  },
};
const enabledProviders = () => Object.entries(PROVIDERS).filter(([, p]) => p.ok(config)).map(([id, p]) => ({ id, label: p.label, desc: p.desc }));

async function paytrInit(o, items) {
  const c = config.payment.paytr;
  const base = config.site.baseUrl.replace(/\/$/, '');
  const basket = Buffer.from(JSON.stringify(items.map(it => [it.title, tl(it.price), it.qty]))).toString('base64');
  const noInst = c.maxInstallment > 1 ? 0 : 1;
  const maxInst = c.maxInstallment || 0;
  const testMode = c.testMode ? 1 : 0;
  const ip = o.ip;
  const hashStr = `${c.merchantId}${ip}${o.id}${o.email}${o.total}${basket}${noInst}${maxInst}TL${testMode}`;
  const body = new URLSearchParams({
    merchant_id: c.merchantId, user_ip: ip, merchant_oid: o.id, email: o.email,
    payment_amount: String(o.total), paytr_token: hmacB64(c.merchantKey, hashStr + c.merchantSalt),
    user_basket: basket, debug_on: c.debug ? '1' : '0', no_installment: String(noInst), max_installment: String(maxInst),
    user_name: o.name, user_address: 'Dijital ürün - adres gerekmez', user_phone: o.phone,
    merchant_ok_url: `${base}/siparis.html?id=${o.id}&t=${o.token}`,
    merchant_fail_url: `${base}/siparis.html?id=${o.id}&t=${o.token}`,
    timeout_limit: String(c.timeoutMinutes || 30), currency: 'TL', test_mode: String(testMode), lang: 'tr',
  });
  const r = await fetch('https://www.paytr.com/odeme/api/get-token', { method: 'POST', body, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (j.status !== 'success') throw new Error('PayTR: ' + (j.reason || 'token alınamadı'));
  return { type: 'iframe', url: `https://www.paytr.com/odeme/guvenli/${j.token}` };
}

function shopierInit(o) {
  const c = config.payment.shopier;
  const [first, ...rest] = o.name.trim().split(/\s+/);
  const random = String(crypto.randomInt(100000, 1000000));
  const total = tl(o.total);
  const currency = '0';
  const fields = {
    API_key: c.apiKey, website_index: String(c.websiteIndex || 1), platform_order_id: o.id,
    product_name: `${config.site.name} Sipariş ${o.id}`, product_type: String(c.productType ?? 1),
    buyer_name: first, buyer_surname: rest.join(' ') || first, buyer_email: o.email,
    buyer_account_age: '0', buyer_id_nr: '0', buyer_phone: o.phone,
    billing_address: 'Dijital ürün', billing_city: 'Istanbul', billing_country: 'Turkey', billing_postcode: '34000',
    shipping_address: 'Dijital ürün', shipping_city: 'Istanbul', shipping_country: 'Turkey', shipping_postcode: '34000',
    total_order_value: total, currency, platform: '0', is_in_frame: '0', current_language: '0',
    modul_version: '1.0.4', random_nr: random,
    signature: hmacB64(c.apiSecret, random + o.id + total + currency),
  };
  return { type: 'form', action: 'https://www.shopier.com/ShowProduct/api_pay4.php', fields };
}

const CSP = [
  "default-src 'self'", "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src https://fonts.gstatic.com",
  "img-src 'self' data:", "connect-src 'self'", "frame-src https://www.paytr.com",
  "form-action 'self' https://www.shopier.com", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'",
].join('; ');

function baseHeaders(extra = {}) {
  return {
    'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...(config.site.baseUrl.startsWith('https') ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
    ...extra,
  };
}
const json = (res, status, obj, extra = {}) => {
  res.writeHead(status, baseHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }));
  res.end(JSON.stringify(obj));
};
const text = (res, status, body) => { res.writeHead(status, baseHeaders({ 'Content-Type': 'text/plain; charset=utf-8' })); res.end(body); };

function readBody(req, limit = 64 * 1024) {
  return new Promise((ok, fail) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { fail(new HttpError(413, 'İstek çok büyük')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const ct = req.headers['content-type'] || '';
      try {
        if (ct.includes('application/json')) ok(raw ? JSON.parse(raw) : {});
        else if (ct.includes('application/x-www-form-urlencoded')) ok(Object.fromEntries(new URLSearchParams(raw)));
        else ok({});
      } catch { fail(new HttpError(400, 'Geçersiz veri')); }
    });
    req.on('error', fail);
  });
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function clientIp(req) {
  let ip = (config.site.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
  return ip.replace(/^::ffff:/, '');
}

const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  let h = hits.get(key);
  if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
  return ++h.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (h.reset < now) hits.delete(k); }, 60_000).unref();

const sessions = new Map();
function getCookie(req, name) {
  const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}
function isAdmin(req) {
  const s = sessions.get(getCookie(req, 'adm') || '');
  if (!s || s.exp < Date.now()) return false;
  s.exp = Date.now() + 12 * 3600_000;
  return true;
}

const RE = {
  name: /^[a-zA-ZçğıöşüÇĞİÖŞÜ ]{3,50}$/,
  email: /^[a-z0-9._+-]{1,64}@[a-z0-9.-]{1,80}\.[a-z]{2,}$/,
  phone: /^05[0-9]{9}$/,
  orderId: /^VPM[A-Z0-9]{8,20}$/,
};

function publicOrder(o) {
  const items = JSON.parse(o.items);
  const codes = q.orderCodes.all(o.id);
  return {
    id: o.id, status: o.status, provider: o.provider, total: o.total / 100, createdAt: o.created_at,
    items: items.map(it => ({ ...it, price: it.price / 100, codes: codes.filter(c => c.product_id === it.id).map(c => c.code) })),
    payment: o.status === 'pending' && o.payment_data ? JSON.parse(o.payment_data) : null,
    supportEmail: config.site.supportEmail,
  };
}

async function api(req, res, url) {
  const path = url.pathname, method = req.method;
  const ip = clientIp(req);

  if (path === '/api/store' && method === 'GET') {
    const stock = Object.fromEntries(q.stock.all().map(s => [s.product_id, s.free]));
    return json(res, 200, {
      name: config.site.name, supportEmail: config.site.supportEmail,
      allowBackorder: !!config.store.allowBackorder, maxQty: config.store.maxQtyPerItem || 20,
      providers: enabledProviders(),
      products: config.products.map(p => ({ id: p.id, vp: p.vp, price: p.price, old: p.old || 0, tags: p.tags || [], badge: p.badge || '', ok: !!p.ok, inStock: (stock[p.id] || 0) > 0 })),
    });
  }

  if (path === '/api/orders' && method === 'POST') {
    if (limited('order:' + ip, 10, 10 * 60_000)) throw new HttpError(429, 'Çok fazla deneme. Biraz sonra tekrar dene.');
    const b = await readBody(req);
    const name = String(b.name || '').trim().replace(/\s+/g, ' ');
    const email = String(b.email || '').trim().toLowerCase();
    const phone = String(b.phone || '').trim();
    if (!RE.name.test(name)) throw new HttpError(400, 'Ad soyad geçersiz.');
    if (!RE.email.test(email) || email.length > 80) throw new HttpError(400, 'E-posta geçersiz.');
    if (!RE.phone.test(phone)) throw new HttpError(400, 'Telefon 05 ile başlayan 11 hane olmalı.');
    if (!b.terms) throw new HttpError(400, 'Sözleşme onayı gerekli.');
    const provider = String(b.provider || '');
    if (!enabledProviders().some(p => p.id === provider)) throw new HttpError(400, 'Ödeme yöntemi geçersiz.');
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 10) throw new HttpError(400, 'Sepet geçersiz.');

    const maxQty = config.store.maxQtyPerItem || 20;
    const merged = new Map();
    for (const it of b.items) {
      const p = product(String(it?.id));
      const qty = Number(it?.qty);
      if (!p || !Number.isInteger(qty) || qty < 1) throw new HttpError(400, 'Sepette geçersiz ürün var.');
      merged.set(p.id, Math.min((merged.get(p.id) || 0) + qty, maxQty));
    }
    const items = [...merged].map(([id, qty]) => {
      const p = product(id);
      if (!config.store.allowBackorder && q.freeCount.get(id).n < qty) throw new HttpError(409, `${title(p)} için yeterli stok yok.`);
      return { id, qty, title: title(p), vp: p.vp, price: kurus(p.price) };
    });
    const total = items.reduce((s, it) => s + it.price * it.qty, 0);

    const id = 'VPM' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(4).toString('hex').toUpperCase();
    const token = crypto.randomBytes(18).toString('base64url');
    q.insertOrder.run(id, token, provider, name, email, phone, JSON.stringify(items), total, ip, Date.now());
    const o = q.getOrder.get(id);

    try {
      const pay = provider === 'paytr' ? await paytrInit(o, items)
        : provider === 'shopier' ? shopierInit(o)
        : { type: 'demo' };
      q.setPaymentData.run(JSON.stringify(pay), id);
    } catch (e) {
      console.error('[ödeme başlatma]', id, e.message);
      q.setStatus.run('failed', e.message, id);
      throw new HttpError(502, 'Ödeme başlatılamadı. Lütfen tekrar dene.');
    }
    return json(res, 201, { id, token });
  }

  let m = path.match(/^\/api\/orders\/([A-Z0-9]+)$/);
  if (m && method === 'GET') {
    if (limited('view:' + ip, 120, 60_000)) throw new HttpError(429, 'Çok fazla istek.');
    const o = RE.orderId.test(m[1]) ? q.getOrder.get(m[1]) : null;
    if (!o || !safeEq(o.token, url.searchParams.get('t') || '')) throw new HttpError(404, 'Sipariş bulunamadı.');
    return json(res, 200, publicOrder(o));
  }

  if (path === '/api/demo/pay' && method === 'POST') {
    if (!config.payment.demo?.enabled) throw new HttpError(404, 'Bulunamadı');
    const b = await readBody(req);
    const o = q.getOrder.get(String(b.id || ''));
    if (!o || o.provider !== 'demo' || !safeEq(o.token, String(b.t || ''))) throw new HttpError(404, 'Sipariş bulunamadı.');
    if (b.result === 'success') markPaid(o.id, 'DEMO');
    else if (o.status === 'pending') q.setStatus.run('failed', 'Demo: ödeme reddedildi', o.id);
    return json(res, 200, { ok: true });
  }

  if (path === '/api/callback/paytr' && method === 'POST') {
    const c = config.payment.paytr || {};
    const b = await readBody(req);
    const expected = hmacB64(c.merchantKey, `${b.merchant_oid}${c.merchantSalt}${b.status}${b.total_amount}`);
    if (!c.merchantKey || !safeEq(expected, b.hash || '')) { console.warn('[paytr] hatalı hash', ip); return text(res, 400, 'PAYTR notification failed: bad hash'); }
    const o = q.getOrder.get(String(b.merchant_oid));
    if (o) {
      if (b.status === 'success') {
        if (b.payment_amount && Number(b.payment_amount) !== o.total) {
          q.setStatus.run('failed', `Tutar uyuşmuyor: ${b.payment_amount}`, o.id);
          notify(`🚨 PayTR tutar uyuşmazlığı: ${o.id}`);
        } else markPaid(o.id, `PAYTR ${b.payment_type || ''}`.trim());
      } else if (o.status === 'pending') {
        q.setStatus.run('failed', `${b.failed_reason_code || ''} ${b.failed_reason_msg || ''}`.trim(), o.id);
      }
    }
    return text(res, 200, 'OK');
  }

  if (path === '/api/callback/shopier' && method === 'POST') {
    const c = config.payment.shopier || {};
    const b = await readBody(req);
    const expected = crypto.createHmac('sha256', c.apiSecret || '').update(`${b.random_nr}${b.platform_order_id}`).digest();
    const got = Buffer.from(String(b.signature || ''), 'base64');
    const valid = c.apiSecret && got.length === expected.length && crypto.timingSafeEqual(got, expected);
    const o = q.getOrder.get(String(b.platform_order_id || ''));
    if (!valid || !o) { console.warn('[shopier] geçersiz imza', ip); return text(res, 400, 'Geçersiz istek'); }
    if (String(b.status).toLowerCase() === 'success') markPaid(o.id, `SHOPIER ${b.payment_id || ''}`.trim());
    else if (o.status === 'pending') q.setStatus.run('failed', 'Shopier: ödeme başarısız', o.id);
    res.writeHead(303, baseHeaders({ Location: `/siparis.html?id=${o.id}&t=${o.token}` }));
    return res.end();
  }

  if (path.startsWith('/api/admin/')) return adminApi(req, res, url, ip);

  throw new HttpError(404, 'Bulunamadı');
}

async function adminApi(req, res, url, ip) {
  const path = url.pathname, method = req.method;
  const pw = config.admin?.password || '';

  if (method !== 'GET' && req.headers['x-admin'] !== '1') throw new HttpError(403, 'Yasak');

  if (path === '/api/admin/login' && method === 'POST') {
    if (pw.length < 10) throw new HttpError(503, 'Admin şifresi ayarlanmamış (config.json → admin.password, en az 10 karakter).');
    if (limited('login:' + ip, 5, 15 * 60_000)) throw new HttpError(429, 'Çok fazla hatalı deneme. 15 dakika bekle.');
    const b = await readBody(req, 4096);
    if (!safeEq(crypto.createHash('sha256').update(String(b.password || '')).digest(), crypto.createHash('sha256').update(pw).digest())) {
      await new Promise(r => setTimeout(r, 600));
      throw new HttpError(401, 'Şifre hatalı.');
    }
    hits.delete('login:' + ip);
    const sid = crypto.randomBytes(32).toString('base64url');
    sessions.set(sid, { exp: Date.now() + 12 * 3600_000 });
    const secure = config.site.baseUrl.startsWith('https') ? '; Secure' : '';
    return json(res, 200, { ok: true }, { 'Set-Cookie': `adm=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}` });
  }
  if (path === '/api/admin/logout' && method === 'POST') {
    sessions.delete(getCookie(req, 'adm') || '');
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'adm=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  if (!isAdmin(req)) throw new HttpError(401, 'Giriş gerekli');

  if (path === '/api/admin/summary' && method === 'GET') {
    const byStatus = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM orders GROUP BY status').all().map(r => [r.status, r.n]));
    const day = new Date(); day.setHours(0, 0, 0, 0);
    const rev = db.prepare(`SELECT COALESCE(SUM(total),0) s, COUNT(*) n FROM orders WHERE status IN ('paid','delivered') AND paid_at >= ?`);
    const stock = Object.fromEntries(q.stock.all().map(s => [s.product_id, s]));
    return json(res, 200, {
      byStatus, today: rev.get(day.getTime()), all: rev.get(0),
      stock: config.products.map(p => ({ id: p.id, title: title(p), free: stock[p.id]?.free || 0, used: stock[p.id]?.used || 0 })),
      providers: enabledProviders().map(p => p.id),
    });
  }

  if (path === '/api/admin/orders' && method === 'GET') {
    const status = url.searchParams.get('status') || '';
    const search = (url.searchParams.get('q') || '').trim().slice(0, 80);
    let sql = 'SELECT id, status, provider, name, email, phone, items, total, created_at, paid_at, note FROM orders WHERE 1=1';
    const args = [];
    if (status) { sql += ' AND status = ?'; args.push(status); }
    if (search) { sql += ' AND (id LIKE ? OR email LIKE ? OR phone LIKE ? OR name LIKE ?)'; args.push(...Array(4).fill(`%${search}%`)); }
    sql += ' ORDER BY created_at DESC LIMIT 200';
    return json(res, 200, db.prepare(sql).all(...args).map(o => ({ ...o, items: JSON.parse(o.items), total: o.total / 100 })));
  }

  let m = path.match(/^\/api\/admin\/orders\/([A-Z0-9]+)$/);
  if (m && method === 'GET') {
    const o = q.getOrder.get(m[1]);
    if (!o) throw new HttpError(404, 'Sipariş yok');
    return json(res, 200, { ...publicOrder(o), name: o.name, email: o.email, phone: o.phone, ip: o.ip, note: o.note, paymentRef: o.payment_ref, paidAt: o.paid_at, deliveredAt: o.delivered_at, token: o.token });
  }

  m = path.match(/^\/api\/admin\/orders\/([A-Z0-9]+)\/deliver$/);
  if (m && method === 'POST') {
    const b = await readBody(req);
    const o = q.getOrder.get(m[1]);
    if (!o) throw new HttpError(404, 'Sipariş yok');
    if (o.status !== 'paid') throw new HttpError(409, 'Sadece "ödendi, teslim bekliyor" durumundaki siparişe kod verilebilir.');
    tx(() => {
      for (const it of JSON.parse(o.items)) {
        const list = (b.codes?.[it.id] || []).map(c => String(c).trim()).filter(Boolean);
        const need = it.qty - q.countAssigned.get(o.id, it.id).n;
        if (list.length > need) throw new HttpError(400, `${it.title} için en fazla ${need} kod girilebilir.`);
        for (const code of list) {
          if (code.length < 4 || code.length > 100) throw new HttpError(400, `Geçersiz kod: ${code}`);
          try { q.addUsedCode.run(it.id, code, o.id, Date.now(), Date.now()); }
          catch { throw new HttpError(409, `Bu kod zaten sistemde var: ${code}`); }
        }
      }
    });
    const st = tryDeliver(o.id);
    return json(res, 200, { status: st });
  }

  m = path.match(/^\/api\/admin\/orders\/([A-Z0-9]+)\/status$/);
  if (m && method === 'POST') {
    const b = await readBody(req);
    const o = q.getOrder.get(m[1]);
    if (!o) throw new HttpError(404, 'Sipariş yok');
    if (b.status === 'paid') {
      if (!['pending', 'failed'].includes(o.status)) throw new HttpError(409, 'Bu sipariş zaten ödenmiş.');
      markPaid(o.id, 'ADMIN');
    } else if (b.status === 'cancelled') {
      if (q.orderCodes.all(o.id).length) throw new HttpError(409, 'Kod teslim edilmiş sipariş iptal edilemez.');
      if (o.status === 'delivered') throw new HttpError(409, 'Teslim edilmiş sipariş iptal edilemez.');
      q.setStatus.run('cancelled', 'Admin tarafından iptal', o.id);
    } else throw new HttpError(400, 'Geçersiz durum');
    return json(res, 200, { status: q.getOrder.get(o.id).status });
  }

  if (path === '/api/admin/codes' && method === 'GET') {
    const pid = url.searchParams.get('product') || '';
    const used = url.searchParams.get('used') === '1';
    const rows = db.prepare(`SELECT id, product_id, code, order_id, added_at, used_at FROM codes WHERE product_id = ? AND order_id IS ${used ? 'NOT ' : ''}NULL ORDER BY id DESC LIMIT 500`).all(pid);
    return json(res, 200, rows);
  }

  if (path === '/api/admin/codes' && method === 'POST') {
    const b = await readBody(req, 512 * 1024);
    const p = product(String(b.productId || ''));
    if (!p) throw new HttpError(400, 'Ürün seç.');
    const raw = String(b.codes || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const lines = [...new Set(raw)];
    if (!lines.length) throw new HttpError(400, 'Kod girilmedi.');
    if (lines.length > 5000) throw new HttpError(400, 'Tek seferde en fazla 5000 kod.');
    const bad = lines.filter(c => c.length < 4 || c.length > 100);
    if (bad.length) throw new HttpError(400, `Geçersiz kod(lar): ${bad.slice(0, 3).join(', ')}`);
    const added = tx(() => lines.reduce((n, c) => n + Number(q.addCode.run(p.id, c, Date.now()).changes), 0));
    deliverPendingOrders();
    return json(res, 200, { added, duplicates: raw.length - added });
  }

  m = path.match(/^\/api\/admin\/codes\/(\d+)$/);
  if (m && method === 'DELETE') {
    const r = db.prepare('DELETE FROM codes WHERE id = ? AND order_id IS NULL').run(Number(m[1]));
    if (!r.changes) throw new HttpError(409, 'Kod bulunamadı ya da kullanılmış.');
    return json(res, 200, { ok: true });
  }

  throw new HttpError(404, 'Bulunamadı');
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json' };

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/admin') { res.writeHead(301, baseHeaders({ Location: '/admin/' })); return res.end(); }
  if (p.endsWith('/')) p += 'index.html';
  const file = resolve(PUBLIC, '.' + p);
  if (!file.startsWith(PUBLIC + sep)) return text(res, 403, 'Yasak');
  let st;
  try { st = statSync(file); } catch { st = null; }
  if (!st || !st.isFile()) return text(res, 404, 'Sayfa bulunamadı');
  const ext = extname(file).toLowerCase();
  const etag = `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  const common = {
    ETag: etag,
    'Cache-Control': ext === '.svg' || ext === '.png' || ext === '.webp' ? 'public, max-age=3600' : 'no-cache',
    ...(p.startsWith('/admin/') ? { 'X-Robots-Tag': 'noindex, nofollow' } : {}),
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, baseHeaders(common));
    return res.end();
  }
  res.writeHead(200, baseHeaders({
    'Content-Type': TYPES[ext] || 'application/octet-stream', 'Content-Length': st.size, ...common,
  }));
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'Yöntem desteklenmiyor');
    serveStatic(req, res, url);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500 && !e.status) console.error('[hata]', req.method, url.pathname, e);
    if (!res.headersSent) json(res, status, { error: e.status ? e.message : 'Sunucu hatası' });
    else res.end();
  }
});

const port = Number(process.env.PORT) || config.site.port || 5500;
server.listen(port, () => {
  console.log(`\n  ${config.site.name} çalışıyor →  http://localhost:${port}`);
  console.log(`  Admin paneli           →  http://localhost:${port}/admin/`);
  console.log(`  Aktif ödeme yöntemleri : ${enabledProviders().map(p => p.id).join(', ') || 'YOK (config.json → payment)'}\n`);
});
