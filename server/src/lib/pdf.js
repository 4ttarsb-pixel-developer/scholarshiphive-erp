import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { ROOT_DIR, config } from '../config.js';
import { pkr, monthLabel } from './money.js';

const LOGO = path.join(ROOT_DIR, 'client', 'public', 'scholarshiphive-logo.png');
const NAVY = '#0b1733', BLUE = '#1d4ed8', GREY = '#64748b', LINE = '#e2e8f0', ZEBRA = '#f8fafc';
const NAVY_BAND = '#0b1633';

const stamp = () => new Date().toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' });
// Standard PDF fonts cannot draw every Unicode character — keep text printable.
const safe = s => String(s ?? '').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF\u2013\u2014\u2022\u20AC\u203A\u2039]/g, '?');

function header(doc, title, subtitle) {
  const { left, right } = doc.page.margins;
  const width = doc.page.width - left - right;
  if (fs.existsSync(LOGO)) doc.image(LOGO, left, 26, { height: 34 });
  doc.font('Helvetica-Bold').fontSize(15).fillColor(NAVY).text(safe(title), left, 28, { width, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(GREY).text(safe(subtitle || ''), left, 47, { width, align: 'right' });
  doc.moveTo(left, 70).lineTo(left + width, 70).lineWidth(1).strokeColor(BLUE).stroke();
  doc.y = 82;
}

function footer(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const { left, right, bottom } = doc.page.margins;
    const width = doc.page.width - left - right;
    const y = doc.page.height - bottom + 12;
    doc.page.margins.bottom = 0; // allow writing in the footer area
    doc.font('Helvetica').fontSize(7.5).fillColor(GREY)
      .text(`Generated ${stamp()}  •  © ${new Date().getFullYear()} All rights reserved by ${config.companyName}`, left, y, { width: width - 60, lineBreak: false })
      .text(`Page ${i - range.start + 1} of ${range.count}`, left, y, { width, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}

// ═════════ Branded table report (same look as the ScholarshipHive "Revenue Report") ═════════
const MM = 2.8346;
const RGB = {
  navy: [15, 23, 42], green: [5, 150, 105], amber: [217, 119, 6], rose: [225, 29, 72], purple: [124, 58, 237], blue: [37, 99, 235], cyan: [8, 145, 178], sky: [2, 132, 199], fuchsia: [192, 38, 211],
};
const STATUS_RGB = {
  approved: RGB.green, verified: RGB.green, paid: RGB.green, active: RGB.green, 'Paid': RGB.green,
  pending: RGB.amber, 'to verify': RGB.amber, in_process: RGB.amber, paused: RGB.amber, 'Partially Paid': RGB.amber, 'Partial': RGB.amber, 'not approved': RGB.amber,
  'Pending': RGB.sky, rejected: RGB.rose, blocked: RGB.rose, 'Overdue': RGB.rose, ended: [100, 116, 139], 'Refunded': RGB.fuchsia, 'no receipt': RGB.amber,
};
const hex = ([r, g, b]) => '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
function kpiColor(s) {
  if (s.color) return Array.isArray(s.color) ? s.color : RGB[s.color] || RGB.navy;
  const l = String(s.label || '').toLowerCase();
  if (/reject|refund|overdue|loss|negative/.test(l)) return RGB.rose;
  if (/approved|collected|received|verified|paid|closing|balance|top-?up|credit/.test(l)) return RGB.green;
  if (/pending|outstanding|to verify|waiting|spent|debit/.test(l)) return RGB.amber;
  if (/rate|%|margin|average/.test(l)) return RGB.purple;
  if (/records|deals|entries|count|users|employees|items|cycles|active|customers|payments|salaries$/.test(l)) return RGB.blue;
  return RGB.navy;
}
const money = n => {
  const x = Math.round(Number(n || 0) * 100) / 100;
  return 'PKR ' + (Number.isInteger(x) ? x.toLocaleString('en-PK') : x.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
};
const stamp12 = () => new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });

/**
 * Branded tabular PDF report.
 * columns: [{ key, label, width (relative), align, money:boolean, total:false, get(row), status:boolean }]
 * summary: [{ label, value, color? }]  → KPI cards
 * filters: [[label, value], ...]       → "Filters:" line
 * company: { name, tagline, contact }  → header band
 */
export function tablePdf(stream, { title, subtitle, columns, rows, summary = [], landscape, filters = [], company = {}, note }) {
  const land = landscape ?? columns.length > 6;
  const doc = new PDFDocument({ size: 'A4', layout: land ? 'landscape' : 'portrait', margins: { top: 14 * MM, left: 14 * MM, right: 14 * MM, bottom: 16 * MM }, bufferPages: true, info: { Title: title, Author: company.name || config.companyName } });
  doc.pipe(stream);
  const W = doc.page.width, H = doc.page.height, L = 14 * MM, R = W - 14 * MM, width = R - L;
  const name = safe(company.name || config.companyName);
  const tagline = safe(company.tagline || 'Dreams to Degrees');
  const contact = safe(company.contact || '');
  const reportTitle = safe(String(title).toUpperCase().endsWith('REPORT') ? title : `${title} Report`);

  // ── header band ──
  doc.rect(0, 0, W, 32 * MM).fill(NAVY_BAND);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text(name, L, 8.6 * MM, { width: width * 0.62, lineBreak: false, ellipsis: true });
  doc.font('Helvetica').fontSize(9).text(tagline, L, 17.4 * MM, { width: width * 0.62, lineBreak: false });
  if (contact) doc.text(contact, L, 24.4 * MM, { width: width * 0.7, lineBreak: false, ellipsis: true });
  doc.font('Helvetica-Bold').fontSize(14).text(reportTitle.toUpperCase(), L + width * 0.45, 11.2 * MM, { width: width * 0.55, align: 'right', lineBreak: false, ellipsis: true });
  if (subtitle) doc.font('Helvetica').fontSize(8.5).fillColor('#c7d2fe').text(safe(subtitle), L + width * 0.45, 18.6 * MM, { width: width * 0.55, align: 'right', lineBreak: false, ellipsis: true });

  // ── generated / filters ──
  let y = 37.4 * MM;
  doc.font('Helvetica').fontSize(9).fillColor('#5a5a5a').text(`Generated: ${stamp12()}`, L, y, { width, lineBreak: false });
  y += 5 * MM;
  const fText = filters.length ? 'Filters: ' + filters.map(([k, v]) => `${safe(k)}: ${safe(v)}`).join('   |   ') : 'Filters: None (all records)';
  doc.text(fText, L, y, { width });
  y = Math.max(y + 5 * MM, doc.y + 2 * MM);
  if (note) { doc.fontSize(8).fillColor('#8a8a8a').text(safe(note), L, y, { width }); y = doc.y + 2 * MM; }

  // ── KPI cards ──
  if (summary.length) {
    const per = Math.min(summary.length, land ? 6 : 4);
    const gap = 4 * MM, bw = (width - gap * (per - 1)) / per, bh = 16 * MM;
    summary.forEach((s, i) => {
      const col = i % per, row = Math.floor(i / per);
      const x = L + col * (bw + gap), by = y + row * (bh + 3 * MM);
      doc.roundedRect(x, by, bw, bh, 2 * MM).lineWidth(0.6).fillAndStroke('#f8fafc', '#e2e8f0');
      doc.font('Helvetica').fontSize(7.5).fillColor('#646464').text(safe(s.label), x + 3 * MM, by + 2.9 * MM, { width: bw - 6 * MM, lineBreak: false, ellipsis: true });
      doc.font('Helvetica-Bold').fontSize(11).fillColor(hex(kpiColor(s))).text(safe(s.value), x + 3 * MM, by + 8.6 * MM, { width: bw - 6 * MM, lineBreak: false, ellipsis: true });
    });
    y += Math.ceil(summary.length / per) * (bh + 3 * MM) + 3 * MM;
  }

  // ── table ──
  const totalW = columns.reduce((a, c) => a + (c.width || 1), 0);
  const widths = columns.map(c => ((c.width || 1) / totalW) * width);
  const pad = 2 * MM, fs = 7.5;
  const cellText = (c, r) => {
    const val = typeof c.get === 'function' ? c.get(r) : r[c.key];
    if (c.money) return val == null || val === '' ? '' : money(val);
    if (val == null) return '';
    return safe(val);
  };
  const align = c => c.align || (c.money ? 'right' : 'left');
  const isStatus = c => c.status || c.key === 'status';
  const bottom = () => H - 16 * MM - 2;
  const head = () => {
    doc.font('Helvetica-Bold').fontSize(fs);
    const h = Math.max(7 * MM, ...columns.map((c, i) => doc.heightOfString(safe(c.label), { width: widths[i] - pad * 2 }) + pad * 2));
    doc.rect(L, y, width, h).fill('#2563eb');
    let x = L;
    doc.fillColor('#ffffff');
    columns.forEach((c, i) => { doc.text(safe(c.label), x + pad, y + pad, { width: widths[i] - pad * 2, align: isStatus(c) ? 'center' : align(c) }); x += widths[i]; });
    y += h;
  };
  head();
  if (!rows.length) {
    doc.rect(L, y, width, 12 * MM).fill('#f8fafc');
    doc.font('Helvetica-Oblique').fontSize(fs).fillColor('#787878').text('No records found for the selected filters.', L, y + 4.6 * MM, { width, align: 'center' });
    y += 12 * MM;
  }
  rows.forEach((r, ri) => {
    const cells = columns.map(c => cellText(c, r));
    doc.font('Helvetica').fontSize(fs);
    const h = Math.max(6.4 * MM, ...cells.map((t, i) => doc.heightOfString(t || ' ', { width: widths[i] - pad * 2 }) + pad * 2));
    if (y + h > bottom()) { doc.addPage(); y = 14 * MM; head(); doc.font('Helvetica').fontSize(fs); }
    if (ri % 2 === 1) doc.rect(L, y, width, h).fill('#f8fafc');
    let x = L;
    cells.forEach((t, i) => {
      const c = columns[i];
      const st = isStatus(c) ? STATUS_RGB[String(t).toLowerCase()] || STATUS_RGB[String(t)] : null;
      doc.font(st ? 'Helvetica-Bold' : 'Helvetica').fillColor(st ? hex(st) : '#141414').text(t, x + pad, y + pad, { width: widths[i] - pad * 2, align: isStatus(c) ? 'center' : align(c) });
      x += widths[i];
    });
    doc.moveTo(L, y + h).lineTo(R, y + h).lineWidth(0.4).strokeColor('#e2e8f0').stroke();
    y += h;
  });
  const moneyCols = columns.map((c, i) => (c.money && c.total !== false ? i : -1)).filter(i => i >= 0);
  if (rows.length && moneyCols.length) {
    const h = 7.4 * MM;
    if (y + h > bottom()) { doc.addPage(); y = 14 * MM; head(); }
    doc.rect(L, y, width, h).fill('#f1f5f9');
    const first = moneyCols[0];
    const labelW = widths.slice(0, first).reduce((a, b) => a + b, 0);
    doc.font('Helvetica-Bold').fontSize(fs).fillColor('#141414');
    if (labelW > 20) doc.text(`Total (${rows.length} record${rows.length > 1 ? 's' : ''})`, L + pad, y + pad, { width: labelW - pad * 2, align: 'right', lineBreak: false });
    let x = L;
    columns.forEach((c, i) => {
      if (moneyCols.includes(i)) {
        const t = money(rows.reduce((a, r) => a + Math.round(Number((typeof c.get === 'function' ? c.get(r) : r[c.key]) || 0) * 100), 0) / 100);
        doc.text(t, x + 1, y + pad, { width: widths[i] - pad - 1, align: 'right', lineBreak: false });
      }
      x += widths[i];
    });
    y += h;
  }

  // ── footer on every page ──
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const mb = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.moveTo(L, H - 11 * MM).lineTo(R, H - 11 * MM).lineWidth(0.5).strokeColor('#e2e8f0').stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor('#8c8c8c')
      .text(`${name} - ${reportTitle}`, L, H - 8.3 * MM, { width: width - 120, lineBreak: false, ellipsis: true })
      .text(`Page ${i - range.start + 1} of ${range.count}`, L, H - 8.3 * MM, { width, align: 'right', lineBreak: false });
    doc.page.margins.bottom = mb;
  }
  doc.end();
}

/** Bank-slip style salary slip. */
export function payslipPdf(stream, { pm, user, approvedBy, payments, deals }) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 30, left: 40, right: 40, bottom: 42 }, bufferPages: true, info: { Title: `Salary Slip ${pm.slip_no}` } });
  doc.pipe(stream);
  header(doc, 'SALARY SLIP', `${monthLabel(pm.month)}  •  ${pm.slip_no}`);
  const left = 40, width = doc.page.width - 80;
  let y = doc.y + 4;

  // Status ribbon
  const paid = pm.status === 'paid';
  doc.roundedRect(left, y, width, 26, 5).fill(paid ? '#dcfce7' : '#dbeafe');
  doc.font('Helvetica-Bold').fontSize(10).fillColor(paid ? '#166534' : '#1e40af')
    .text(paid ? `PAID  •  ${new Date(pm.paid_at).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })}  •  ${pm.payment_method || ''}` : `APPROVED  •  ${new Date(pm.approved_at).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })}`, left + 10, y + 8, { width: width - 20 });
  y += 38;

  const box = (x, yy, w, rows, title) => {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(BLUE).text(title, x, yy);
    let ry = yy + 15;
    rows.forEach(([k, val]) => {
      doc.font('Helvetica').fontSize(8.5).fillColor(GREY).text(k, x, ry, { width: w * 0.45 });
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#0f172a').text(safe(val || '-'), x + w * 0.45, ry, { width: w * 0.55 });
      ry += 16;
    });
    return ry;
  };
  const half = (width - 20) / 2;
  const y1 = box(left, y, half, [['Employee ID', user.employee_code], ['Name', user.full_name], ['Father name', user.father_name], ['CNIC', user.cnic], ['Designation', user.designation]], 'EMPLOYEE');
  const y2 = box(left + half + 20, y, half, [['Pay period', monthLabel(pm.month)], ['Slip number', pm.slip_no], ['Issued', stamp()], ['Approved by', approvedBy], ['Deals / payments', `${deals} deals / ${payments} payments`]], 'PAY DETAILS');
  y = Math.max(y1, y2) + 12;

  // Earnings & deductions table
  const rows = [
    ['Base salary', pm.snap_base, ''],
    [`Commission (${Number(pm.snap_commission_pct)}% of ${pkr(pm.snap_sales)} monthly sales)`, pm.snap_commission, ''],
    ['Bonus', pm.bonus, ''],
    ['Deductions' + (pm.adjustment_note ? ` (${pm.adjustment_note})` : ''), '', pm.deductions],
  ];
  doc.rect(left, y, width, 22).fill(NAVY);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#fff').text('DESCRIPTION', left + 10, y + 7).text('EARNINGS', left + width * 0.55, y + 7, { width: width * 0.2, align: 'right' }).text('DEDUCTIONS', left + width * 0.77, y + 7, { width: width * 0.2, align: 'right' });
  y += 22;
  rows.forEach(([d, e, ded], i) => {
    const h = Math.max(22, doc.font('Helvetica').fontSize(9).heightOfString(safe(d), { width: width * 0.52 }) + 10);
    if (i % 2) doc.rect(left, y, width, h).fill(ZEBRA);
    doc.font('Helvetica').fontSize(9).fillColor('#0f172a').text(safe(d), left + 10, y + 6, { width: width * 0.52 });
    doc.text(e === '' ? '' : pkr(e), left + width * 0.55, y + 6, { width: width * 0.2, align: 'right' });
    doc.text(ded === '' ? '' : pkr(ded), left + width * 0.77, y + 6, { width: width * 0.2, align: 'right' });
    y += h;
  });
  doc.moveTo(left, y).lineTo(left + width, y).strokeColor(LINE).stroke();
  y += 10;
  doc.roundedRect(left, y, width, 40, 6).fill('#eff6ff');
  doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text('NET SALARY', left + 14, y + 14);
  doc.fontSize(16).fillColor(BLUE).text(pkr(pm.snap_net), left, y + 11, { width: width - 14, align: 'right' });
  y += 58;
  doc.font('Helvetica').fontSize(8).fillColor(GREY).text('This is a computer-generated salary slip and does not require a signature. Amounts are in Pakistani Rupees (PKR). Commission is calculated on money received in the pay period (payments minus refunds).', left, y, { width });
  footer(doc);
  doc.end();
}

/** Customer receipt / invoice for one sale — branded header, QR code, installment plan, payments. */
export async function invoicePdf(stream, { sale, payments, refunds, installments = [], owner = {} }) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, left: 40, right: 40, bottom: 46 }, bufferPages: true, info: { Title: `Receipt ${sale.invoice_no}`, Author: config.companyName } });
  doc.pipe(stream);
  const W = doc.page.width, H = doc.page.height, L = 40, width = W - 80;
  const name = safe(owner.company_name || config.companyName);
  const contact = safe([owner.address, owner.phone, owner.email].filter(Boolean).join('  |  ') || 'Lahore, Pakistan');
  // header band
  doc.rect(0, 0, W, 92).fill('#0b1633');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text(name, L, 24, { width: width * 0.6, lineBreak: false });
  doc.font('Helvetica').fontSize(9).text('Dreams to Degrees', L, 48).text(contact, L, 64, { width: width * 0.62, lineBreak: false, ellipsis: true });
  doc.font('Helvetica-Bold').fontSize(15).text('PAYMENT RECEIPT', L, 28, { width, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor('#c7d2fe').text(`${sale.invoice_no}  •  ${sale.sale_date}`, L, 50, { width, align: 'right' });
  let qr = null;
  try {
    const QR = (await import('qrcode')).default;
    qr = await QR.toBuffer(`${config.companyName}|${sale.invoice_no}|${sale.customer_name}|${sale.total_amount}|${sale.status}`, { margin: 1, width: 220 });
  } catch (e) { console.error('[qr]', e.message); }
  let y = 108;
  // status ribbon
  const tone = { Paid: ['#dcfce7', '#166534'], 'Partially Paid': ['#fef3c7', '#92400e'], Pending: ['#e0f2fe', '#075985'], Overdue: ['#ffe4e6', '#9f1239'], Refunded: ['#fae8ff', '#86198f'] }[sale.status] || ['#f1f5f9', '#0f172a'];
  doc.roundedRect(L, y, width - (qr ? 104 : 0), 26, 5).fill(tone[0]);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(tone[1]).text(`STATUS: ${safe(sale.status).toUpperCase()}${sale.due ? `   •   Next due ${sale.due}` : ''}`, L + 10, y + 8);
  if (qr) doc.image(qr, L + width - 92, y - 4, { width: 92 });
  y += 38;
  const rows = [
    ['Client', sale.customer_name], ['Phone', sale.customer_phone || '-'], ['Email', sale.customer_email || '-'], ['Destination', sale.destination || '-'],
    ['Service', sale.service || '-'], ['Package', sale.package], ['Category', sale.revenue_category || '-'], ['Consultant', sale.employee_name],
  ];
  const colW = (width - (qr ? 104 : 0)) / 2;
  rows.forEach(([k, val], i) => {
    const x = L + (i % 2) * colW, yy = y + Math.floor(i / 2) * 18;
    doc.font('Helvetica').fontSize(8.5).fillColor(GREY).text(k, x, yy, { width: 72 });
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text(safe(val), x + 74, yy, { width: colW - 80, lineBreak: false, ellipsis: true });
  });
  y += Math.ceil(rows.length / 2) * 18 + 14;
  // money boxes
  const boxes = [['Total package', sale.total_amount, '#0f172a'], ['Received', sale.paid, '#059669'], ['Refunded', sale.refunded, '#e11d48'], ['Balance due', sale.outstanding, '#d97706']];
  const bw = (width - 24) / 4;
  boxes.forEach(([k, val, col], i) => {
    const x = L + i * (bw + 8);
    doc.roundedRect(x, y, bw, 40, 5).lineWidth(0.6).fillAndStroke('#f8fafc', LINE);
    doc.font('Helvetica').fontSize(7.5).fillColor(GREY).text(k.toUpperCase(), x + 8, y + 7, { width: bw - 16 });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(col).text(pkr(val), x + 8, y + 20, { width: bw - 16, lineBreak: false, ellipsis: true });
  });
  y += 54;
  const table = (title, head, body, widths, aligns) => {
    if (y > H - 140) { doc.addPage(); y = 50; }
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text(title, L, y); y += 15;
    doc.rect(L, y, width, 20).fill('#2563eb');
    let x = L;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
    head.forEach((h, i) => { doc.text(h, x + 6, y + 6, { width: widths[i] * width - 12, align: aligns[i] || 'left' }); x += widths[i] * width; });
    y += 20;
    if (!body.length) { doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(GREY).text('None', L + 6, y + 6); y += 22; return; }
    body.forEach((row, ri) => {
      if (y > H - 70) { doc.addPage(); y = 50; }
      if (ri % 2) doc.rect(L, y, width, 18).fill('#f8fafc');
      let xx = L;
      row.forEach((cell, i) => {
        const st = typeof cell === 'object' && cell ? cell : { t: cell };
        doc.font(st.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(st.color || '#0f172a').text(safe(st.t ?? ''), xx + 6, y + 5, { width: widths[i] * width - 12, align: aligns[i] || 'left', lineBreak: false, ellipsis: true });
        xx += widths[i] * width;
      });
      doc.moveTo(L, y + 18).lineTo(L + width, y + 18).lineWidth(0.4).strokeColor(LINE).stroke();
      y += 18;
    });
    y += 12;
  };
  if (installments.length) {
    table('Payment plan', ['#', 'Due date', 'Amount', 'Paid', 'Remaining', 'Status'],
      installments.map(i => [i.seq === 0 ? 'Advance' : String(i.seq), i.due_date, pkr(i.amount), pkr(i.paid_amount), pkr(i.remaining),
        { t: i.paid ? 'Paid' : i.overdue ? 'Overdue' : 'Pending', bold: true, color: i.paid ? '#059669' : i.overdue ? '#e11d48' : '#d97706' }]),
      [0.1, 0.17, 0.19, 0.19, 0.19, 0.16], ['left', 'left', 'right', 'right', 'right', 'center']);
  }
  table('Payments received', ['Date', 'Method', 'Reference', 'Amount'], payments.map(p => [p.payment_date, p.method, p.reference || '-', pkr(p.amount)]), [0.22, 0.24, 0.32, 0.22], ['left', 'left', 'left', 'right']);
  if (refunds.length) table('Refunds', ['Date', 'Reason', 'Amount'], refunds.map(r => [r.refund_date, r.reason, pkr(r.amount)]), [0.22, 0.56, 0.22], ['left', 'left', 'right']);
  if (y > H - 110) { doc.addPage(); y = 50; }
  doc.roundedRect(L, y, width, 38, 6).fill('#eff6ff');
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#0b1633').text('BALANCE DUE', L + 14, y + 13);
  doc.fontSize(15).fillColor('#1d4ed8').text(pkr(sale.outstanding), L, y + 11, { width: width - 14, align: 'right' });
  y += 54;
  if (sale.notes) { doc.font('Helvetica').fontSize(8.5).fillColor(GREY).text(`Note: ${safe(sale.notes_type ? sale.notes_type + ' — ' : '')}${safe(sale.notes)}`, L, y, { width }); y = doc.y + 8; }
  doc.font('Helvetica').fontSize(8).fillColor(GREY).text('Thank you for choosing ScholarshipHive. This is a computer-generated receipt and does not require a signature. Scan the QR code to verify the invoice number and amount.', L, y, { width });
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const mb = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    doc.moveTo(L, H - 32).lineTo(L + width, H - 32).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor('#8c8c8c').text(`${name} - Payment Receipt ${sale.invoice_no}`, L, H - 24, { width: width - 80, lineBreak: false })
      .text(`Page ${i - range.start + 1} of ${range.count}`, L, H - 24, { width, align: 'right', lineBreak: false });
    doc.page.margins.bottom = mb;
  }
  doc.end();
}
