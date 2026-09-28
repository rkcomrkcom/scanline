const API = 'https://fapi.binance.com';
const $ = s => document.querySelector(s);
const j = async p => { const r = await fetch(API + p); if (!r.ok) throw new Error(r.status); return r.json(); };
const TFS = ['5m', '15m', '1h', '4h', '1d'];
let tf = localStorage.tf || '1h';
const cfg = Object.assign({ minVol: 50, minAtr: 0.4, volMult: 2, look: 20 }, JSON.parse(localStorage.cfg || '{}'));
const cache = {};

const ema = (a, n) => { const k = 2 / (n + 1); let e = a[0]; return a.map(v => e = v * k + e * (1 - k)); };
const rsi = (c, n = 14) => {
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; d > 0 ? g += d : l -= d; }
  g /= n; l /= n;
  for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
  return l ? 100 - 100 / (1 + g / l) : 100;
};
const adx = (h, l, c, n = 14) => {
  let tr = 0, p = 0, m = 0; const dx = [];
  for (let i = 1; i < c.length; i++) {
    const t = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    const u = h[i] - h[i - 1], d = l[i - 1] - l[i];
    const P = u > d && u > 0 ? u : 0, M = d > u && d > 0 ? d : 0;
    if (i <= n) { tr += t; p += P; m += M; } else { tr = tr - tr / n + t; p = p - p / n + P; m = m - m / n + M; }
    if (i >= n) { const pi = 100 * p / tr, mi = 100 * m / tr; dx.push(100 * Math.abs(pi - mi) / ((pi + mi) || 1)); }
  }
  let a = dx.slice(0, n).reduce((s, v) => s + v, 0) / n;
  for (let i = n; i < dx.length; i++) a = (a * (n - 1) + dx[i]) / n;
  return a;
};

function analyze(t, k, f) {
  const live = +k[k.length - 1][4], openCur = +k[k.length - 1][1]; k = k.slice(0, -1); // สัญญาณหลักใช้แท่งที่ปิดแล้ว
  const h = k.map(x => +x[2]), l = k.map(x => +x[3]), c = k.map(x => +x[4]), v = k.map(x => +x[5]);
  const n = cfg.look, last = c.length - 1;
  const vr = v[last] / (v.slice(-n - 1, -1).reduce((s, x) => s + x, 0) / n);
  const hi = Math.max(...h.slice(-n - 1, -1)), lo = Math.min(...l.slice(-n - 1, -1));
  const up = ema(c, 20)[last] > ema(c, 50)[last], ax = adx(h, l, c), r = rsi(c);
  let s = 0, dir = up ? 'LONG' : 'SHORT'; const why = [];
  if (vr >= cfg.volMult) { s += 2; why.push('วอลุ่ม x' + vr.toFixed(1)); }
  if (c[last] > hi) { s += 2; dir = 'LONG'; why.push('ทะลุ High ' + n + ' แท่ง'); }
  else if (c[last] < lo) { s += 2; dir = 'SHORT'; why.push('หลุด Low ' + n + ' แท่ง'); }
  else if (live > Math.max(hi, h[last])) { s += 1; dir = 'LONG'; why.push('กำลังทะลุ High (แท่งยังไม่ปิด)'); }
  else if (live < Math.min(lo, l[last])) { s += 1; dir = 'SHORT'; why.push('กำลังหลุด Low (แท่งยังไม่ปิด)'); }
  if (ax > 25 && (dir === 'LONG') === up) { s += 1; why.push('เทรนด์ ADX ' + ax.toFixed(0)); }
  if (Math.abs(f) >= 0.05) { s += 1; why.push('Funding ' + f.toFixed(3) + '%'); }
  const trs = c.slice(-14).map((_, i) => { const q = c.length - 14 + i; return Math.max(h[q] - l[q], Math.abs(h[q] - c[q - 1]), Math.abs(l[q] - c[q - 1])); });
  const atr = trs.reduce((a, x) => a + x, 0) / 14, atrp = atr / c[last] * 100;
  why.push('ATR ' + atrp.toFixed(2) + '%');
  const swing = (a, upv) => a.filter((v, i) => i > 1 && i < a.length - 2 && [-2, -1, 1, 2].every(o => upv ? v > a[i + o] : v < a[i + o]));
  const res = Math.min(...swing(h.slice(-60), true).filter(x => x > live), Infinity);
  const sup = Math.max(...swing(l.slice(-60), false).filter(x => x < live), -Infinity);
  const warn = [r > 75 ? 'RSI สูง ระวังกลับตัว' : r < 25 ? 'RSI ต่ำ ระวังกลับตัว' : '', atrp < cfg.minAtr ? 'ATR ต่ำ อาจไม่คุ้มค่าธรรมเนียม' : '',
    Math.abs(c[last] - ema(c, 20)[last]) > 2.5 * atr ? 'ไกลจาก EMA20 ระวังไล่ราคา' : ''].filter(Boolean).join(' | ');
  return { sym: t.symbol, price: +t.lastPrice, chg: (live / openCur - 1) * 100, s, dir, tag: 'BO', why, warn, spark: c.slice(-48), f, atr, res, sup, vr, hi, lo, ax, r, up, live, n };
}

let btcNote = '';
const TOD = { '5m': 1000, '15m': 960, '1h': 240 };
const W = (x, t) => { x.warn += (x.warn ? ' | ' : '') + t; };
async function btcTrend() {
  try {
    const c = (await j('/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=100')).slice(0, -1).map(q => +q[4]);
    return { up: ema(c, 20).at(-1) > ema(c, 50).at(-1), chg: (c.at(-1) / c.at(-2) - 1) * 100 };
  } catch (e) { return null; }
}
async function extras(x, nx, btc) {
  const L = x.dir === 'LONG';
  const [k4, oi, kt] = await Promise.all([
    j(`/fapi/v1/klines?symbol=${x.sym}&interval=4h&limit=60`).catch(() => null),
    j(`/futures/data/openInterestHist?symbol=${x.sym}&period=${tf}&limit=6`).catch(() => null),
    TOD[tf] ? j(`/fapi/v1/klines?symbol=${x.sym}&interval=${tf}&limit=${TOD[tf]}`).catch(() => null) : null]);
  if (k4) {
    const c4 = k4.slice(0, -1).map(q => +q[4]);
    if (L === (ema(c4, 20).at(-1) > ema(c4, 50).at(-1))) { x.s += 1; x.why.push('4h ตรงทิศ'); } else W(x, '4h สวนทาง');
  }
  if (oi && oi.length > 1) {
    const d = (+oi.at(-1).sumOpenInterestValue / +oi[0].sumOpenInterestValue - 1) * 100, pd = x.spark.at(-1) - x.spark.at(-6);
    if (d > 1 && (pd > 0) === L) { x.s += 1; x.why.push('OI +' + d.toFixed(1) + '%'); }
    else if (d < -1) W(x, 'OI ลด ' + d.toFixed(1) + '% อาจเป็นแค่การปิดสถานะ');
  }
  if (kt && kt.length > 3) {
    const last = kt.at(-2), same = kt.slice(0, -2).filter(q => (last[0] - q[0]) % 864e5 === 0);
    if (same.length >= 2) {
      const r = +last[5] / (same.reduce((a, q) => a + +q[5], 0) / same.length);
      if (r >= 2) { x.s += 1; x.why.push('วอลุ่มเทียบเวลาเดียวกัน x' + r.toFixed(1)); }
      else if (r < 1.2 && x.why.some(w => w.startsWith('วอลุ่ม x'))) W(x, 'วอลุ่มสูงเป็นปกติของช่วงเวลานี้');
    }
  }
  const tgt = L ? x.res : x.sup;
  if (isFinite(tgt)) {
    const dist = Math.abs(tgt - x.price), rr = dist / (1.5 * x.atr);
    x.why.push((L ? 'ต้านใกล้สุด +' : 'รับใกล้สุด -') + (dist / x.price * 100).toFixed(2) + '% (R:R ~1:' + rr.toFixed(1) + ')');
    if (rr < 1) W(x, 'แนวใกล้ R:R ต่ำ');
  }
  if (Math.abs(x.f) >= 0.05) {
    const m = Math.round((nx[x.sym] - Date.now()) / 6e4);
    x.why = x.why.map(w => w.startsWith('Funding') ? w + ' (อีก ' + m + ' นาที)' : w);
    if (m <= 30) W(x, 'ใกล้รอบ Funding');
  }
  if (btc && x.sym !== 'BTCUSDT' && L !== btc.up) W(x, 'สวนทิศ BTC 1h');
}
let info = { t: 0, set: new Set() }, prevSet = null, note = '';
async function tradable() {
  if (Date.now() - info.t > 6e5) {
    const d = await j('/fapi/v1/exchangeInfo');
    info = { t: Date.now(), set: new Set(d.symbols.filter(x => x.status === 'TRADING' && x.contractType === 'PERPETUAL' && x.quoteAsset === 'USDT').map(x => x.symbol)) };
  }
  return info.set;
}
function noteChanges(s) {
  note = '';
  if (prevSet) {
    const add = [...s].filter(x => !prevSet.has(x)), del = [...prevSet].filter(x => !s.has(x));
    if (add.length || del.length) note = (add.length ? ' | เหรียญใหม่: ' + add.join(', ') : '') + (del.length ? ' | ถูกถอน: ' + del.join(', ') : '');
  }
  prevSet = new Set(s);
}

async function scan(force) {
  if (!force && cache[tf] && Date.now() - cache[tf].t < 9e4) return render(cache[tf].d);
  $('#status').textContent = 'กำลังสแกน…';
  try {
    const [tk, pi, ok] = await Promise.all([j('/fapi/v1/ticker/24hr'), j('/fapi/v1/premiumIndex'), tradable()]);
    const fr = {}, nx = {}; pi.forEach(x => { fr[x.symbol] = +x.lastFundingRate * 100; nx[x.symbol] = +x.nextFundingTime; });
    const cand = tk.filter(t => ok.has(t.symbol) && +t.quoteVolume >= cfg.minVol * 1e6)
      .sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 80);
    noteChanges(ok);
    const out = []; let i = 0;
    await Promise.all(Array(8).fill(0).map(async () => {
      while (i < cand.length) {
        const t = cand[i++];
        try { out.push(analyze(t, await j(`/fapi/v1/klines?symbol=${t.symbol}&interval=${tf}&limit=100`), fr[t.symbol] || 0)); } catch (e) {}
      }
    }));
    const btc = await btcTrend();
    btcNote = btc ? ' | BTC 1h: ' + (btc.up ? 'ขาขึ้น' : 'ขาลง') + ' (แท่งล่าสุด ' + btc.chg.toFixed(2) + '%)' + (Math.abs(btc.chg) > 1.5 ? ' เหวี่ยงแรง ระวัง' : '') : '';
    await Promise.all(out.filter(x => x.s >= 2).map(async x => {
      try {
        await extras(x, nx, btc);
      } catch (e) {}
    }));
    out.sort((a, b) => b.s - a.s);
    cache[tf] = { t: Date.now(), d: out };
    render(out);
    if (typeof autoOnScan === 'function') autoOnScan(out);
  } catch (e) {
    $('#status').textContent = 'ดึงข้อมูลไม่สำเร็จ (' + e.message + ') ตรวจว่าเครือข่ายเข้า Binance ได้ แล้วกดสแกนใหม่';
  }
}

function spark(a, up) {
  const mn = Math.min(...a), mx = Math.max(...a), w = 96, h = 32;
  const pts = a.map((x, i) => (i * w / (a.length - 1)).toFixed(1) + ',' + (h - (x - mn) / ((mx - mn) || 1) * h).toFixed(1)).join(' ');
  return `<svg width="${w}" height="${h}"><polyline fill="none" stroke="${up ? '#3fb68b' : '#e5605b'}" stroke-width="1.5" points="${pts}"/></svg>`;
}

const rowHtml = x => `<div class="row" data-s="${x.sym}" data-d="${x.dir}"><b>${x.sym.replace('USDT', '')}</b>
    <span class="tag ${x.dir}">${x.dir === 'LONG' ? 'Long' : 'Short'}</span>${spark(x.spark, x.spark.at(-1) >= x.spark[0])}
    <span class="px">${x.price}<i class="${x.chg >= 0 ? 'up' : 'dn'}">${x.chg.toFixed(1)}%</i></span><span class="sc">${x.s}</span>
    <small>${x.why.join(' + ')}${x.warn ? ' | ' + x.warn : ''}</small></div>`;

function render(d) {
  d = d.filter(x => x.s >= 2);
  const at = new Date().toLocaleTimeString('th-TH');
  $('#status').textContent = (d.length ? `${d.length} เหรียญเข้าเงื่อนไข (TF ${tf})` : 'ไม่มีเหรียญเข้าเงื่อนไขใน TF นี้ ลองลดเงื่อนไขในตั้งค่า') + ` | อัปเดต ${at}` + btcNote + note;
  $('#list').innerHTML = d.map(rowHtml).join('');
}

$('#tfs').innerHTML = TFS.map(x => `<button data-tf="${x}" class="${x === tf ? 'on' : ''}">${x}</button>`).join('');
$('#tfs').onclick = e => {
  const b = e.target.dataset.tf; if (!b) return;
  tf = localStorage.tf = b;
  document.querySelectorAll('#tfs button').forEach(x => x.classList.toggle('on', x.dataset.tf === b));
  scan();
  if ($('#q').value.trim()) search();
};
$('#rescan').onclick = () => scan(true);
const F = [['minVol', 'วอลุ่ม 24 ชม. ขั้นต่ำ (ล้าน USDT)'], ['minAtr', 'ATR ขั้นต่ำ (% ของราคา) ต่ำกว่านี้จะเตือน'], ['volMult', 'วอลุ่มพุ่งกี่เท่าของค่าเฉลี่ย'], ['look', 'จำนวนแท่งย้อนหลัง (Breakout)']];
$('#cfgBody').innerHTML = F.map(([k, t]) => `<label>${t}<input type="number" step="any" data-k="${k}" value="${cfg[k]}"></label>`).join('');
$('#cfgBody').onchange = e => {
  cfg[e.target.dataset.k] = +e.target.value; localStorage.cfg = JSON.stringify(cfg);
  for (const k in cache) delete cache[k];
  scan(true);
};
$('#list').onclick = $('#qres').onclick = e => { const r = e.target.closest('.row'); if (r) openCoin(r.dataset.s, r.dataset.d); };
function statusHtml(x) {
  const tr = x.ax > 25 ? 'เทรนด์' + (x.up ? 'ขึ้น' : 'ลง') : 'ยังไม่มีเทรนด์ชัด', rs = [];
  const toHi = (x.hi / x.live - 1) * 100, toLo = (1 - x.lo / x.live) * 100, has = p => x.why.some(w => w.includes(p));
  if (x.vr < cfg.volMult) rs.push('วอลุ่มแท่งล่าสุด x' + x.vr.toFixed(1) + ' ต่ำกว่าเกณฑ์ (x' + cfg.volMult + ')');
  if (!has('High') && !has('Low')) rs.push('ยังไม่ทะลุ High ' + x.n + ' แท่ง (ต้องขึ้นอีก ' + toHi.toFixed(2) + '%) และยังไม่หลุด Low (ต้องลงอีก ' + toLo.toFixed(2) + '%)');
  if (!has('เทรนด์ ADX')) rs.push('ADX ' + x.ax.toFixed(0) + ' ไม่เกิน 25 หรือทิศสัญญาณไม่ตรงเทรนด์ ไม่ได้คะแนนเทรนด์');
  rs.push('คะแนนรวม ' + x.s + ' ต่ำกว่าเกณฑ์แสดง (2)');
  return `<div class="row" data-s="${x.sym}" data-d="${x.dir}"><b>${x.sym.replace('USDT', '')}</b>
    <span class="tag NA">สถานะ</span>${spark(x.spark, x.spark.at(-1) >= x.spark[0])}
    <span class="px">${x.price}<i class="${x.chg >= 0 ? 'up' : 'dn'}">${x.chg.toFixed(1)}%</i></span><span class="sc">-</span>
    <small><b>ยังไม่เข้าเงื่อนไข</b> ${tr} (ADX ${x.ax.toFixed(0)}) + RSI ${x.r.toFixed(0)} + วอลุ่ม x${x.vr.toFixed(1)} + ${x.why.join(' + ')} | สาเหตุ: ${rs.join(' | ')}</small></div>`;
}
async function search() {
  const q = $('#q').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''), R = $('#qres');
  if (!q) { R.innerHTML = ''; return; }
  const sym = q.endsWith('USDT') ? q : q + 'USDT';
  R.textContent = 'กำลังค้นหา ' + sym + '…';
  try {
    if (!(await tradable()).has(sym)) { R.textContent = 'ไม่พบ ' + sym + ' ใน USDT Perpetual ที่ซื้อขายอยู่บน Binance'; return; }
    const [t, k, pi, btc] = await Promise.all([j('/fapi/v1/ticker/24hr?symbol=' + sym), j(`/fapi/v1/klines?symbol=${sym}&interval=${tf}&limit=100`), j('/fapi/v1/premiumIndex?symbol=' + sym), btcTrend()]);
    if (k.length < 60) { R.textContent = sym + ' มีข้อมูลน้อยเกินไปใน TF ' + tf + ' (เพิ่งเปิดเทรด) วิเคราะห์ไม่ได้'; return; }
    const x = analyze(t, k, +pi.lastFundingRate * 100);
    if (x.s >= 2) await extras(x, { [sym]: +pi.nextFundingTime }, btc);
    R.innerHTML = x.s >= 2 ? rowHtml(x) : statusHtml(x);
  } catch (e) { R.textContent = 'ค้นหาไม่สำเร็จ (' + e.message + ')'; }
}
$('#qb').onclick = search;
$('#q').onkeydown = e => { if (e.key === 'Enter') search(); };
scan(); setInterval(() => scan(true), 3e5);
