/* ตารางออเดอร์เปิด/ปิด + ตัวกรองวันที่ + ปฏิทินกำไรขาดทุนรายเดือน */
const dk = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const money = v => (v >= 0 ? '+' : '') + v.toFixed(2);
const tfmt = t => t ? new Date(t).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : 'ไม่ทราบวันที่';
const short = s => s.replace('USDT', '');
const now0 = new Date();
const hv = { p: '7', from: '', to: '', y: now0.getFullYear(), m: now0.getMonth(), day: '' };
let lastKey = '';

const inRange = h => {
  if (!h.t) return !hv.from && !hv.to; // ออเดอร์เก่าที่ไม่มีวันที่ ขึ้นเฉพาะตอนเลือก "ทั้งหมด"
  const k = dk(h.t); return (!hv.from || k >= hv.from) && (!hv.to || k <= hv.to);
};
const HH = '<thead><tr><th>เวลาปิด</th><th>เหรียญ</th><th>ทิศ</th><th>ปิดที่</th><th>เข้า</th><th>กำไร/ขาดทุน</th></tr></thead>';
const hrow = h => `<tr><td>${tfmt(h.t)}</td><td><b>${short(h.sym)}</b>${h.auto ? ' <i class="mu">ออโต้</i>' : ''}</td><td><span class="tag ${h.side}">${h.side === 'LONG' ? 'Long' : 'Short'}${h.lv ? ' x' + h.lv : ''}</span></td><td>${WHY[h.why] || 'ปิดเอง'}${h.exit ? ' ' + +h.exit.toPrecision(6) : ''}</td><td>${h.entry ? +h.entry.toPrecision(6) : '-'}</td><td class="${h.pnl >= 0 ? 'up' : 'dn'}">${money(h.pnl)}</td></tr>`;

function drawOpen() {
  const tb = $('#openTb tbody'); if (!tb) return;
  tb.innerHTML = S.pos.map(o => {
    const p = px[o.sym] || o.entry, L = o.side === 'LONG', pnl = (L ? p - o.entry : o.entry - p) * o.qty;
    return `<tr><td><b>${short(o.sym)}</b>${o.auto ? ' <i class="mu">ออโต้</i>' : ''}<br><small class="mu">${tfmt(Math.floor(o.id))}</small></td><td><span class="tag ${o.side}">${L ? 'Long' : 'Short'} x${o.lv}</span></td><td>${+o.entry.toPrecision(6)}</td><td>${p}</td><td>${o.tp ? +o.tp.toPrecision(6) : '-'}</td><td>${o.sl ? +o.sl.toPrecision(6) : '-'}</td><td class="${pnl >= 0 ? 'up' : 'dn'}">${money(pnl)}<br><small>${(pnl / o.m * 100).toFixed(1)}%</small></td><td><button data-c="${o.id}">ปิด</button></td></tr>`;
  }).join('') || '<tr><td colspan="8">ยังไม่มีออเดอร์ที่เปิดอยู่</td></tr>';
}

function drawHist() {
  const a = S.hist.filter(inRange), w = a.filter(h => h.pnl > 0).length, sum = a.reduce((s, h) => s + h.pnl, 0);
  document.querySelectorAll('#hf [data-p]').forEach(b => b.classList.toggle('on', b.dataset.p === hv.p));
  $('#hsum').innerHTML = `${hv.from || hv.to ? (hv.from || '…') + ' ถึง ' + (hv.to || '…') : 'ทั้งหมด'} | ${a.length} ไม้ | ชนะ ${w} (${a.length ? Math.round(w / a.length * 100) : 0}%) | รวม <b class="${sum >= 0 ? 'up' : 'dn'}">${money(sum)} USDT</b>`;
  $('#histTb').innerHTML = HH + '<tbody>' + (a.map(hrow).join('') || '<tr><td colspan="6">ไม่มีรายการในช่วงนี้</td></tr>') + '</tbody>';
}

function drawCal() {
  const by = {};
  S.hist.forEach(h => { if (!h.t) return; const k = dk(h.t); by[k] = by[k] || { n: 0, pnl: 0 }; by[k].n++; by[k].pnl += h.pnl; });
  const first = new Date(hv.y, hv.m, 1), days = new Date(hv.y, hv.m + 1, 0).getDate();
  let n = 0, sum = 0, gd = 0, rd = 0;
  let cells = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map(x => `<div class="cd wd">${x}</div>`).join('') + '<div class="cd e"></div>'.repeat(first.getDay());
  for (let d = 1; d <= days; d++) {
    const k = hv.y + '-' + String(hv.m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0'), s = by[k];
    if (s) { n += s.n; sum += s.pnl; if (s.pnl >= 0) gd++; else rd++; }
    cells += s ? `<div class="cd h${hv.day === k ? ' sel' : ''}" data-d="${k}">${d}<b class="${s.pnl >= 0 ? 'up' : 'dn'}">${money(s.pnl)}</b><small>${s.n} ไม้</small></div>` : `<div class="cd">${d}</div>`;
  }
  $('#cal').innerHTML = `<div id="calh"><button data-mv="-1">‹</button><b>${first.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })}</b><button data-mv="1">›</button><span class="mu">${n} ไม้ | วันกำไร ${gd} วันขาดทุน ${rd} | รวม <b class="${sum >= 0 ? 'up' : 'dn'}">${money(sum)} USDT</b></span></div><div id="calg">${cells}</div>`;
  const dl = $('#dayList');
  if (hv.day && by[hv.day]) {
    const [y, m, d] = hv.day.split('-');
    dl.innerHTML = `<h3>รายการวันที่ ${new Date(+y, m - 1, +d).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}</h3><div class="tw"><table class="tb">${HH}<tbody>${S.hist.filter(h => h.t && dk(h.t) === hv.day).map(hrow).join('')}</tbody></table></div>`;
  } else dl.innerHTML = '<div class="mu">กดที่วันในปฏิทินเพื่อดูรายการของวันนั้น</div>';
}

function histDraw() { // เรียกจาก draw() ทุก 3 วินาที: ตารางออเดอร์เปิดวาดใหม่ทุกครั้ง ส่วนประวัติกับปฏิทินวาดเมื่อข้อมูลหรือตัวกรองเปลี่ยนเท่านั้น (เลื่อนดูค้างไว้ได้)
  drawOpen();
  const key = S.hist.length + ':' + (S.hist[0] ? S.hist[0].t + ':' + S.hist[0].pnl : '') + JSON.stringify(hv);
  if (key !== lastKey) { lastKey = key; drawHist(); drawCal(); }
}

function preset(p) {
  hv.p = p; hv.day = '';
  if (p === 'all') hv.from = hv.to = '';
  else { const now = Date.now(); hv.from = dk(now - (+p - 1) * 864e5); hv.to = dk(now); }
  $('#hfrom').value = hv.from; $('#hto').value = hv.to; histDraw();
}

$('#hf').innerHTML = [['1', 'วันนี้'], ['7', '7 วัน'], ['30', '30 วัน'], ['all', 'ทั้งหมด']].map(([p, t]) => `<button data-p="${p}">${t}</button>`).join('') + '<input type="date" id="hfrom"> ถึง <input type="date" id="hto">';
$('#hf').onclick = e => { const p = e.target.dataset.p; if (p) preset(p); };
$('#hf').onchange = e => { if (e.target.type === 'date') { hv.p = ''; hv.from = $('#hfrom').value; hv.to = $('#hto').value; histDraw(); } };
$('#cal').onclick = e => {
  const b = e.target.closest('[data-mv]');
  if (b) { const d = new Date(hv.y, hv.m + +b.dataset.mv, 1); hv.y = d.getFullYear(); hv.m = d.getMonth(); hv.day = ''; return histDraw(); }
  const c = e.target.closest('[data-d]');
  if (c) { hv.day = hv.day === c.dataset.d ? '' : c.dataset.d; histDraw(); }
};
preset('7');
