const S = JSON.parse(localStorage.paper || '{"bal":10000,"pos":[],"hist":[]}');
S.cap = S.cap || 10000; // ทุนเริ่มต้น (พอร์ตเก่าที่ไม่มีค่านี้ถือว่า 10,000)
const save = () => localStorage.paper = JSON.stringify(S);
const CH = ['1', '5', '60', '240'];
const FEE = 0.0005;
const WHY = { TP: 'TP', SL: 'โดน SL', Liquidated: 'โดน Liq', Delisted: 'เหรียญถูกถอน' };
let cur = null, px = {};
let thb = 0, lock = false;
const $v = id => parseFloat($('#' + id).value);
const msg = t => $('#msg').textContent = t;

function openCoin(sym, dir) {
  cur = sym; msg('');
  if (!thb) fetchRate();
  $('#ty').value = dir === 'SHORT' ? 'SHORT' : 'LONG';
  ['tp', 'sl'].forEach(k => ['price', 'pct', 'pts'].forEach(s => $('#' + k + '-' + s).value = ''));
  $('#coin').hidden = false; $('#cname').textContent = sym;
  $('#charts').innerHTML = CH.map((_, i) => `<div id="tv${i}"></div>`).join('');
  CH.forEach((iv, i) => new TradingView.widget({
    container_id: 'tv' + i, symbol: 'BINANCE:' + sym + '.P', interval: iv, theme: 'dark',
    autosize: true, hide_side_toolbar: true, allow_symbol_change: false, timezone: 'Asia/Bangkok', locale: 'th_TH'
  }));
  tick();
}

function place(side) {
  const p = px[cur], m = +$('#mg').value, lv = +$('#lv').value, tp = +$('#tp-price').value || 0, sl = +$('#sl-price').value || 0;
  if (!p || !(m > 0) || !(lv >= 1)) return msg('กรอกมาร์จิ้นและ Leverage ให้ถูกต้อง');
  const fee = m * lv * FEE;
  if (m + fee > S.bal) return msg('เงินในพอร์ตไม่พอ');
  const L = side === 'LONG';
  if ((tp && (L ? tp <= p : tp >= p)) || (sl && (L ? sl >= p : sl <= p))) return msg('TP/SL อยู่ผิดฝั่งของราคาเข้า');
  const liq = p * (L ? 1 - 1 / lv + 0.005 : 1 + 1 / lv - 0.005);
  S.bal -= m + fee;
  S.pos.push({ id: Date.now(), sym: cur, side, entry: p, qty: m * lv / p, m, lv, tp, sl, liq, fee });
  save(); msg(''); draw();
}

function close(id, why, at) {
  const i = S.pos.findIndex(x => x.id == id); if (i < 0) return;
  const o = S.pos[i], p = at ?? px[o.sym];
  const pnl = (o.side === 'LONG' ? p - o.entry : o.entry - p) * o.qty;
  const back = why === 'Liquidated' ? 0 : Math.max(0, o.m + pnl - o.qty * p * FEE);
  S.bal += back;
  S.hist.unshift({ sym: o.sym, side: o.side, pnl: back - o.m - (o.fee || 0), why, entry: o.entry, exit: p, t: Date.now(), ot: Math.floor(o.id), lv: o.lv, auto: !!o.auto });
  S.hist = S.hist.slice(0, 2000);
  if (typeof autoClosed === 'function') autoClosed(o, S.hist[0]);
  S.pos.splice(i, 1); save();
}

async function tick() {
  try {
    const n = {}; (await j('/fapi/v1/ticker/price')).forEach(x => n[x.symbol] = +x.price);
    if (Object.keys(n).length > 100) S.pos.slice().forEach(o => { if (!(o.sym in n) && px[o.sym]) close(o.id, 'Delisted', px[o.sym]); });
    px = n;
    S.pos.slice().forEach(o => {
      const p = px[o.sym], L = o.side === 'LONG'; if (!p) return;
      if (L ? p <= o.liq : p >= o.liq) close(o.id, 'Liquidated', o.liq);
      else if (o.sl && (L ? p <= o.sl : p >= o.sl)) close(o.id, 'SL', o.sl);
      else if (o.tp && (L ? p >= o.tp : p <= o.tp)) close(o.id, 'TP', o.tp);
    });
    draw(); calcTick();
  } catch (e) {}
}

function draw() {
  let up = 0;
  const rows = S.pos.map(o => {
    const p = px[o.sym] || o.entry, pnl = (o.side === 'LONG' ? p - o.entry : o.entry - p) * o.qty; up += pnl;
    return `<div class="prow"><b>${o.sym.replace('USDT', '')}</b> <span class="tag ${o.side}">${o.side === 'LONG' ? 'Long' : 'Short'} x${o.lv}</span><br>
      เข้า ${o.entry} | ตอนนี้ ${p} | Liq ${+o.liq.toPrecision(6)}${o.tp ? ' | TP ' + o.tp : ''}${o.sl ? ' | SL ' + o.sl : ''}<br>
      <i class="${pnl >= 0 ? 'up' : 'dn'}">${pnl.toFixed(2)} USDT (${(pnl / o.m * 100).toFixed(1)}%)</i> <button data-c="${o.id}">ปิดออเดอร์</button></div>`;
  }).join('') || '<div class="prow">ยังไม่มีออเดอร์ที่เปิดอยู่</div>';
  const hist = S.hist.slice(0, 5).map(h => `<div class="prow">${h.sym.replace('USDT', '')} ${h.side === 'LONG' ? 'Long' : 'Short'} | ${WHY[h.why] || 'ปิดเอง'}${h.exit ? ' ' + +h.exit.toPrecision(6) : ''}${h.entry ? ' | เข้า ' + +h.entry.toPrecision(6) : ''}: <i class="${h.pnl >= 0 ? 'up' : 'dn'}">${h.pnl.toFixed(2)}</i></div>`).join('');
  const eq = S.bal + S.pos.reduce((s, o) => s + o.m, 0) + up;
  $('#acct').textContent = `พอร์ตจำลอง ${eq.toFixed(2)} USDT (ว่าง ${S.bal.toFixed(2)})`;
  document.querySelectorAll('.posbox').forEach(e => e.innerHTML = rows + (hist ? '<div class="prow"><b>ปิดล่าสุด</b></div>' + hist : ''));
  if (cur && px[cur]) $('#cpx').textContent = px[cur];
  $('#reset').textContent = 'รีเซ็ตพอร์ต ' + S.cap.toLocaleString('en-US') + ' USDT';
  if (typeof histDraw === 'function') histDraw();
}

document.addEventListener('click', e => {
  const c = e.target.dataset.c; if (c) { close(c); draw(); }
});
$('#go').onclick = () => place($('#ty').value);
$('#back').onclick = () => { $('#coin').hidden = true; cur = null; $('#charts').innerHTML = ''; };
$('#reset').onclick = () => { if (confirm('รีเซ็ตพอร์ตและลบออเดอร์ทั้งหมด?')) { S.bal = S.cap; S.pos = []; S.hist = []; save(); draw(); } };
const capMsg = t => $('#capMsg').textContent = t;
$('#cap').value = S.cap;
$('#cap').onchange = () => { // ปรับทุนทันที: เงินว่างเพิ่ม/ลดตามส่วนต่าง ออเดอร์และประวัติไม่ถูกล้าง
  const v = +$('#cap').value, d = v - S.cap;
  if (!(v > 0)) { $('#cap').value = S.cap; return capMsg('ทุนต้องมากกว่า 0'); }
  if (S.bal + d < 0) { $('#cap').value = S.cap; return capMsg('เงินว่างไม่พอสำหรับลดทุนขนาดนี้ (ว่าง ' + S.bal.toFixed(2) + ' USDT)'); }
  S.bal += d; S.cap = v; save(); capMsg(d ? 'ปรับเงินในพอร์ต ' + (d > 0 ? '+' : '') + d.toFixed(2) + ' USDT แล้ว' : ''); draw();
};
setInterval(tick, 3000); tick(); draw();

/* ---------- Calculator ---------- */

async function fetchRate() {
  const get = async u => (await fetch(u)).json();
  try { thb = +(await get('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usdt.json')).usdt.thb; }
  catch (e) { try { thb = +(await get('https://api.exchangerate-api.com/v4/latest/USD')).rates.THB; } catch (e2) { thb = 0; } }
  if (!(thb > 0)) thb = 0;
  $('#rate').textContent = thb ? 'USDT/THB ' + thb.toFixed(2) + ' (บาท)' : 'ดึงเรทบาทไม่ได้ จะลองใหม่ตอนเปิดหน้าเหรียญ';
  calc();
}

function sync(kind, src) {
  const en = px[cur]; if (lock || !en) return;
  lock = true;
  const d = (kind === 'tp' ? 1 : -1) * ($('#ty').value === 'LONG' ? 1 : -1);
  const P = $('#' + kind + '-price'), C = $('#' + kind + '-pct'), T = $('#' + kind + '-pts');
  if (src === 'price' && !P.value) { C.value = T.value = ''; }
  else {
    const price = src === 'price' ? +P.value : src === 'pct' ? en * (1 + d * +C.value / 100) : en + d * +T.value;
    if (price > 0) {
      if (src !== 'price') P.value = +price.toPrecision(6);
      if (src !== 'pct') C.value = (Math.abs(price - en) / en * 100).toFixed(3);
      if (src !== 'pts') T.value = +Math.abs(price - en).toPrecision(5);
    }
  }
  lock = false; calc();
}

function calc() {
  const L = $('#ty').value === 'LONG';
  $('#go').className = L ? 'LONG' : 'SHORT';
  $('#go').textContent = 'เข้าออเดอร์ ' + (L ? 'Long' : 'Short');
  const en = px[cur], R = $('#calcRes');
  if (!en) { R.innerHTML = ''; return; }
  const m = $v('mg') || 0, lv = $v('lv') || 1, size = m * lv, ex = $v('tp-price'), sl = $v('sl-price');
  const fee = size * FEE * 2, pnl = p => (L ? p - en : en - p) / en * size;
  const usd = v => (v >= 0 ? '+' : '') + v.toFixed(2) + ' USDT' + (thb ? ' (' + (v * thb).toFixed(0) + ' ฿)' : '');
  const row = (a, b, c) => `<div class="rr"><span>${a}</span><b class="${c || ''}">${b}</b></div>`;
  const liq = en * (L ? 1 - 1 / lv + 0.005 : 1 + 1 / lv - 0.005);
  let h = row('Entry (ราคาสด)', en) + row('Position size', size.toFixed(2) + ' USDT')
    + row('ค่าธรรมเนียมเข้า+ออก', '-' + fee.toFixed(2) + ' USDT') + row('Liq. (ประมาณ)', +liq.toPrecision(6), 'warn');
  if (ex) { const n = pnl(ex) - fee; h += row('ถึง TP (สุทธิ)', usd(n), n >= 0 ? 'up' : 'dn'); }
  if (sl) { const n = pnl(sl) - fee; h += row('โดน SL (สุทธิ)', usd(n), 'dn'); }
  if (ex && sl) { const rr = Math.abs(ex - en) / Math.abs(sl - en); h += row('R:R', '1 : ' + rr.toFixed(2), rr >= 2 ? 'up' : rr >= 1 ? 'warn' : 'dn'); }
  if (sl && (L ? sl <= liq : sl >= liq)) h += '<div class="warn">SL อยู่เลยราคา Liquidation ออเดอร์จะโดน Liq ก่อน</div>';
  if (m + size * FEE > S.bal) h += '<div class="warn">เงินในพอร์ตจำลองไม่พอสำหรับมาร์จิ้นนี้</div>';
  R.innerHTML = h;
}
function calcTick() { ['tp', 'sl'].forEach(k => $('#' + k + '-price').value && sync(k, 'price')); calc(); }

['tp', 'sl'].forEach(k => ['price', 'pct', 'pts'].forEach(s => $('#' + k + '-' + s).oninput = () => sync(k, s)));
['mg', 'lv'].forEach(id => $('#' + id).oninput = calc);
$('#ty').onchange = calcTick;
fetchRate();
