/* ออโต้เทรดจำลอง: สแกน (ป้ายย่อ/สวนเทรนด์) -> รอสัญญาณกดไกบน 5m -> เปิดออเดอร์จำลองพร้อม SL/TP */
const DEF = { mode: 'fixed', margin: 100, lev: 10, maxSl: 1, trail: 0.5, risk: 1, rr: 2, maxOpen: 3, dayLoss: 3, minScore: 3, cool: 60, beR: 1 };
const A = Object.assign({ stats: [], cool: {}, day: { k: '', eq: 0, pnl: 0 } }, JSON.parse(localStorage.auto || '{}'));
A.c = Object.assign({}, DEF, A.c); A.on = false; // เริ่มปิดทุกครั้งที่เปิดหน้า
const persist = () => localStorage.auto = JSON.stringify(A);
const BAD = ['สวนทิศ BTC', 'ใกล้รอบ Funding', 'ATR ต่ำ']; // R:R ให้ aOpen เช็กด้วย SL จริงบน 5m แทน
let watch = [], logs = [], seen = {}, busy = false, chk = null, lastErrLog = 0;

const aLog = t => { logs.unshift(new Date().toLocaleTimeString('th-TH') + ' ' + t); logs.length = Math.min(logs.length, 30); aDraw(); };
const aEq = () => S.bal + S.pos.reduce((s, o) => { const p = px[o.sym] || o.entry; return s + o.m + (o.side === 'LONG' ? p - o.entry : o.entry - p) * o.qty; }, 0);
function aDay() { const k = new Date().toDateString(); if (A.day.k !== k) { A.day = { k, eq: aEq(), pnl: 0 }; persist(); } }
const aBlocked = () => { aDay(); return A.day.pnl <= -A.day.eq * A.c.dayLoss / 100; };

function autoOnScan(out) {
  watch = out.filter(x => x.dir && x.s >= A.c.minScore && !BAD.some(b => x.warn.includes(b)));
  aDraw();
}

async function aTrigger(x) {
  const k = (await j(`/fapi/v1/klines?symbol=${x.sym}&interval=5m&limit=60`)).slice(0, -1);
  const key = k.at(-1)[0]; if (seen[x.sym] === key) return undefined; seen[x.sym] = key; // ตรวจแท่ง 5m ที่ปิดแล้วแท่งละครั้ง
  const o = k.map(q => +q[1]), h = k.map(q => +q[2]), l = k.map(q => +q[3]), c = k.map(q => +q[4]), n = k.length - 1, L = x.dir === 'LONG';
  const ok = x.tag === 'PB'
    ? (L ? c[n] > o[n] && c[n] > h[n - 1] : c[n] < o[n] && c[n] < l[n - 1])          // ย่อในเทรนด์: แท่งกลับไปทางเทรนด์และปิดผ่านแท่งก่อน
    : (L ? c[n] > Math.max(...h.slice(n - 6, n)) : c[n] < Math.min(...l.slice(n - 6, n))); // สวนเทรนด์: ปิดหลุดโครงสร้าง 6 แท่ง
  if (!ok) return null;
  const tr = c.slice(-14).map((_, i) => { const q = n - 13 + i; return Math.max(h[q] - l[q], Math.abs(h[q] - c[q - 1]), Math.abs(l[q] - c[q - 1])); });
  return { atr: tr.reduce((a, b) => a + b, 0) / 14, swing: L ? Math.min(...l.slice(-10)) : Math.max(...h.slice(-10)) };
}

function aOpen(x, t) {
  const en = px[x.sym]; if (!en) return;
  const L = x.dir === 'LONG', R = A.c.rr, skip = w => aLog(`ข้าม ${x.sym}: ${w}`);
  let d = Math.abs(en - t.swing) + 0.1 * t.atr;                 // SL ใต้/เหนือ swing 10 แท่ง 5m
  d = d > 3 * t.atr ? 1.5 * t.atr : Math.max(d, t.atr);          // swing ไกลเกินใช้ 1.5 ATR / แคบเกินใช้ 1 ATR
  if (d / en < 0.002) return skip('SL แคบเกินเทียบค่าธรรมเนียม');
  if (d / en * 100 > A.c.maxSl) return skip(`SL กว้างเกิน ${(d / en * 100).toFixed(2)}% (เพดาน ${A.c.maxSl}%)`);
  const sl = en + (L ? -d : d); let tp = en + (L ? R : -R) * d;
  const lvl = L ? x.res : x.sup;
  if (isFinite(lvl) && (L ? lvl > en : lvl < en)) {
    const dr = Math.abs(lvl - en) / d;
    if (dr < 1.2) return skip('แนวรับ/ต้านใกล้เกินไป R:R ต่ำ');
    if (dr < R) tp = lvl * (L ? 0.999 : 1.001);                  // TP ก่อนถึงแนวเล็กน้อย
  }
  if (Math.abs(tp - en) < d) return skip('TP ใกล้กว่า SL (กำไรน้อยกว่าเสี่ยง)');
  let lv, notional;
  if (A.c.mode === 'fixed') { lv = Math.max(1, Math.round(A.c.lev)); notional = A.c.margin * lv; }   // มาร์จิ้นและ Leverage คงที่
  else {                                                                                               // คิดจากความเสี่ยง %
    const riskUsd = aEq() * A.c.risk / 100 * (x.tag === 'CT' ? 0.5 : 1);
    lv = Math.max(1, Math.min(10, Math.floor(en / (2 * d))));
    notional = Math.min(riskUsd / (d / en), S.bal * 0.25 * lv);
  }
  const m = notional / lv, fee = notional * FEE;
  const liq = en * (L ? 1 - 1 / lv + 0.005 : 1 + 1 / lv - 0.005);
  if (L ? liq >= sl : liq <= sl) return skip('ราคา Liq อยู่ก่อน SL');
  if (m < 5 || m + fee > S.bal) return skip('เงินว่างไม่พอ');
  S.bal -= m + fee;
  S.pos.push({ id: Date.now() + Math.random(), sym: x.sym, side: x.dir, entry: en, qty: notional / en, m, lv, tp, sl, liq, fee, auto: true, tag: x.tag, d, riskUsd: notional * d / en, be: false });
  save(); draw();
  aLog(`เข้า ${x.dir} ${x.sym} [${x.tag === 'PB' ? 'ย่อในเทรนด์' : 'สวนเทรนด์'}] @${en} SL ${+sl.toPrecision(6)} TP ${+tp.toPrecision(6)} x${lv} มาร์จิ้น ${m.toFixed(0)} เสี่ยง ${(notional * d / en).toFixed(2)} USDT`);
}

async function aLoop() {
  if (!A.on || busy) return; busy = true;
  const p = { t: Date.now(), w: watch.length, fresh: 0, sig: 0, err: 0, msg: 'ปกติ' }; let lastErr = '';
  try {
    if (aBlocked()) { p.msg = 'หยุดทั้งวัน (ขาดทุนถึงเพดาน)'; return; }
    for (const x of watch) {
      if (S.pos.length >= A.c.maxOpen) { p.msg = 'ออเดอร์เต็มแล้ว'; break; }
      if (S.pos.some(o => o.sym === x.sym)) continue;
      if (Date.now() - (A.cool[x.sym] || 0) < A.c.cool * 6e4) continue;
      try {
        const t = await aTrigger(x);           // undefined = ยังไม่มีแท่งใหม่, null = แท่งใหม่แต่ไม่มีสัญญาณ
        if (t !== undefined) p.fresh++;
        if (t) { p.sig++; aOpen(x, t); }
      } catch (e) { p.err++; lastErr = x.sym + ': ' + e.message; }
    }
    if (p.err) {
      p.msg = `error ${p.err} เหรียญ (${lastErr})`;
      if (Date.now() - lastErrLog > 3e5) { lastErrLog = Date.now(); aLog('ดึงข้อมูล 5m ไม่สำเร็จ ' + lastErr); }
    }
  } catch (e) { p.msg = 'error: ' + e.message; }
  finally { chk = p; busy = false; aDraw(); }
}

function aTick() { // เมื่อกำไรถึง beR ย้าย SL มาเท่าทุน แล้วตามหลังราคาที่ดีที่สุดที่ระยะ trail (R) จนกว่าจะถึง TP หรือโดน SL
  S.pos.forEach(o => {
    const p = px[o.sym]; if (!o.auto || !p) return;
    const L = o.side === 'LONG';
    if (!o.be) {
      if ((L ? p - o.entry : o.entry - p) < A.c.beR * o.d) return;
      o.be = true; o.best = p; o.sl = o.entry * (L ? 1.001 : 0.999);
      save(); draw(); aLog(`ขยับ SL ${o.sym} มาเท่าทุน`);
    }
    if (!(A.c.trail > 0)) return;
    o.best = L ? Math.max(o.best ?? p, p) : Math.min(o.best ?? p, p);
    const ns = o.best + (L ? -1 : 1) * A.c.trail * o.d;
    if (L ? ns > o.sl : ns < o.sl) { o.sl = ns; save(); draw(); }  // SL ขยับได้ทางเดียว ไม่ถอยกลับ
  });
}

function autoClosed(o, h) {
  if (!o.auto) return;
  A.stats.push({ t: Date.now(), sym: o.sym, tag: o.tag, side: o.side, pnl: h.pnl, R: o.riskUsd ? h.pnl / o.riskUsd : 0, why: h.why, be: o.be });
  A.stats = A.stats.slice(-500);
  if (h.why === 'SL' && h.pnl < 0) A.cool[o.sym] = Date.now();
  aDay(); A.day.pnl += h.pnl; persist();
  aLog(`ปิด ${o.sym} (${h.why || 'ปิดเอง'}) ${h.pnl.toFixed(2)} USDT`);
}

function aDraw() {
  if (!$('#aSt')) return;
  const nAuto = S.pos.filter(o => o.auto).length;
  $('#aSt').textContent = `${A.on ? 'กำลังทำงาน' : 'ปิดอยู่'} | เฝ้าดู ${watch.length} เหรียญ | ออเดอร์ที่เปิด ${S.pos.length}/${A.c.maxOpen} (ออโต้ ${nAuto}) | วันนี้ ${A.day.pnl.toFixed(2)} USDT${A.on && aBlocked() ? ' | หยุดทั้งวัน: ขาดทุนถึงเพดานแล้ว' : ''}`;
  const g = k => { const a = A.stats.filter(s => k === 'ALL' || s.tag === k), n = a.length;
    return { n, w: a.filter(s => s.pnl > 0).length, wr: n ? a.filter(s => s.pnl > 0).length / n * 100 : 0, r: n ? a.reduce((s, x) => s + x.R, 0) / n : 0, pnl: a.reduce((s, x) => s + x.pnl, 0) }; };
  $('#aChk').textContent = chk ? `ตรวจ 5m ล่าสุด ${new Date(chk.t).toLocaleTimeString('th-TH')} | เฝ้า ${chk.w} เหรียญ | แท่งใหม่ที่ตรวจ ${chk.fresh} | เจอสัญญาณ ${chk.sig} | ${chk.msg}` : 'ยังไม่ได้ตรวจ (รอรอบแรกภายใน 30 วินาที หลังติ๊กเปิดออโต้)';
  $('#aTb tbody').innerHTML = [['ย่อในเทรนด์', 'PB'], ['สวนเทรนด์', 'CT'], ['รวม', 'ALL']].map(([t, k]) => { const s = g(k);
    return `<tr><td>${t}</td><td>${s.w}/${s.n} ${s.wr.toFixed(0)}%</td><td>${s.r.toFixed(2)}</td><td class="${s.pnl >= 0 ? 'up' : 'dn'}">${s.pnl.toFixed(2)}</td></tr>`; }).join('');
  $('#aLog').innerHTML = logs.map(l => `<div>${l}</div>`).join('') || 'ยังไม่มีเหตุการณ์ (ควรมีไม้อย่างน้อย 30 ไม้ก่อนเชื่อสถิติ)';
}

const AF = [['margin', 'มาร์จิ้นต่อไม้ (USDT) [โหมดคงที่]'], ['lev', 'Leverage (x) [โหมดคงที่]'], ['maxSl', 'SL กว้างสุด (% ของราคา) เกินนี้ไม่เข้า'], ['risk', 'เสี่ยงต่อไม้ (% พอร์ต) [โหมดความเสี่ยง]'], ['rr', 'R:R เป้าหมาย'], ['maxOpen', 'ออเดอร์พร้อมกันสูงสุด'], ['dayLoss', 'หยุดทั้งวันเมื่อขาดทุน (% พอร์ต)'],
  ['minScore', 'คะแนนต่ำสุดที่ยอมเข้า'], ['cool', 'พักเหรียญหลังโดน SL (นาที)'], ['beR', 'เริ่มขยับ SL (เท่าทุน) เมื่อกำไรถึง (R)'], ['trail', 'ระยะ SL ตามหลังราคาสูงสุด (R) ใส่ 0 = ไม่ตาม']];
$('#autoBox').innerHTML = `<label><input type="checkbox" id="aOn"> เปิดออโต้เทรดจำลอง (ต้องเปิดหน้านี้ทิ้งไว้ และใช้ TF ที่เลือกอยู่ในการสแกน)</label>
  <div class="sr4"><label>โหมดไซซ์ต่อไม้<select data-a="mode"><option value="fixed">มาร์จิ้นคงที่ (USDT + Leverage)</option><option value="risk">คิดจากความเสี่ยง %</option></select></label>${AF.map(([k, t]) => `<label>${t}<input type="number" step="any" data-a="${k}" value="${A.c[k]}"></label>`).join('')}</div>
  <div id="aSt"></div><div id="aChk"></div>
  <table id="aTb"><thead><tr><th>ป้าย</th><th>ชนะ/ทั้งหมด</th><th>เฉลี่ย R</th><th>PnL สุทธิ</th></tr></thead><tbody></tbody></table>
  <div id="aLog"></div><button id="aRst">ล้างสถิติออโต้</button>`;
$('#autoBox select').value = A.c.mode;
$('#aOn').onchange = e => { A.on = e.target.checked; aLog(A.on ? 'เปิดออโต้เทรดจำลอง' : 'ปิดออโต้เทรดจำลอง'); if (A.on) aLoop(); };
$('#autoBox').addEventListener('change', e => { const k = e.target.dataset.a; if (k === 'mode') { A.c.mode = e.target.value; persist(); } else if (k && (+e.target.value > 0 || (k === 'trail' && e.target.value !== ''))) { A.c[k] = +e.target.value; persist(); aDraw(); } });
$('#aRst').onclick = () => { if (confirm('ล้างสถิติออโต้ทั้งหมด?')) { A.stats = []; A.cool = {}; persist(); aDraw(); } };
setInterval(aLoop, 30000); setInterval(aTick, 5000); aDraw();
