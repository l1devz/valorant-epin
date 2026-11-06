import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'img', 'cards');
mkdirSync(out, { recursive: true });

const TIERS = [
  { vp: 475,   name: 'BRONZ',   a: '#3a1d14', b: '#8a4b2a', c: '#e0915a' },
  { vp: 1000,  name: 'GÜMÜŞ',   a: '#1c2230', b: '#4c5a72', c: '#c9d3e3' },
  { vp: 2050,  name: 'ALTIN',   a: '#2e2108', b: '#8d6614', c: '#ffd166' },
  { vp: 3650,  name: 'PLATİN',  a: '#082a2e', b: '#147d86', c: '#5ce1e6' },
  { vp: 5350,  name: 'ELMAS',   a: '#1c1236', b: '#5b3bb0', c: '#b69cff' },
  { vp: 11000, name: 'EFSANE',  a: '#2c0a12', b: '#a8182c', c: '#ff4655' },
];

const fmt = n => n.toLocaleString('tr-TR');

function card({ vp, name, a, b, c }) {
  const id = `t${vp}`;
  let s = vp;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const shards = Array.from({ length: 7 }, () => {
    const x = 380 + rnd() * 240, y = rnd() * 400, w = 40 + rnd() * 120;
    return `<polygon points="${x},${y} ${x + w},${y + w * 0.35} ${x + w * 0.4},${y + w}" fill="${c}" opacity="${(0.06 + rnd() * 0.14).toFixed(2)}"/>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400" width="600" height="400">
  <defs>
    <linearGradient id="bg${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${a}"/><stop offset=".55" stop-color="#0d1017"/><stop offset="1" stop-color="${a}"/>
    </linearGradient>
    <radialGradient id="glow${id}" cx=".72" cy=".45" r=".55">
      <stop offset="0" stop-color="${c}" stop-opacity=".55"/><stop offset="1" stop-color="${c}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="coin${id}" cx=".35" cy=".3" r=".85">
      <stop offset="0" stop-color="${c}"/><stop offset=".45" stop-color="${b}"/><stop offset="1" stop-color="${a}"/>
    </radialGradient>
    <linearGradient id="edge${id}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/>
    </linearGradient>
    <pattern id="grid${id}" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M24 0H0V24" fill="none" stroke="#fff" stroke-opacity=".04"/>
    </pattern>
  </defs>
  <rect width="600" height="400" rx="28" fill="url(#bg${id})"/>
  <rect width="600" height="400" rx="28" fill="url(#grid${id})"/>
  <rect width="600" height="400" rx="28" fill="url(#glow${id})"/>
  ${shards}
  <g transform="translate(482 182)">
    <circle r="112" fill="${c}" opacity=".08"/>
    <circle r="94" fill="url(#coin${id})"/>
    <circle r="94" fill="none" stroke="${c}" stroke-opacity=".6" stroke-width="2"/>
    <g transform="scale(1.36) translate(-64 -64)">
      <circle cx="64" cy="64" r="59" fill="none" stroke="#fff" stroke-opacity=".32" stroke-width="10"/>
      <path d="M31 37 75 91.5H53L31 64.5Z M97.5 37V64.5L90 73.5H69Z" fill="#fff"/>
    </g>
    <path d="M-87 -34 A94 94 0 0 1 34 -87" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="3" stroke-linecap="round"/>
  </g>
  <rect x="36" y="36" width="96" height="30" rx="6" fill="${c}"/>
  <text x="84" y="57" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="800" font-size="15" fill="#0d1017" letter-spacing="2">E-PIN</text>
  <text x="146" y="57" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="14" fill="#fff" fill-opacity=".6" letter-spacing="3">TR BÖLGESİ</text>
  <text x="36" y="214" font-family="Segoe UI, Arial, sans-serif" font-weight="900" font-size="${vp >= 10000 ? 78 : 88}" fill="#fff" letter-spacing="-2">${fmt(vp)}</text>
  <text x="40" y="254" font-family="Segoe UI, Arial, sans-serif" font-weight="800" font-size="22" fill="${c}" letter-spacing="5">VALORANT POINTS</text>
  <rect x="40" y="276" width="180" height="3" fill="url(#edge${id})"/>
  <text x="36" y="354" font-family="Segoe UI, Arial, sans-serif" font-weight="800" font-size="16" fill="#fff" fill-opacity=".85" letter-spacing="4">${name} PAKET</text>
  <text x="564" y="354" text-anchor="end" font-family="Consolas, monospace" font-size="14" fill="#fff" fill-opacity=".35" letter-spacing="2">XXXX-XXXX-XXXX</text>
  <rect x="1" y="1" width="598" height="398" rx="27" fill="none" stroke="${c}" stroke-opacity=".35" stroke-width="2"/>
</svg>
`;
}

for (const t of TIERS) {
  writeFileSync(join(out, `vp-${t.vp}.svg`), card(t));
  console.log('yazıldı:', `img/cards/vp-${t.vp}.svg`);
}
