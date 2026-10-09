/**
 * تصدير الجداول وطباعتها:
 *  - PDF عبر نافذة الطباعة في المتصفح («حفظ بتنسيق PDF»): الطريقة الأساسية، نص عربي واضح وقابل للنسخ.
 *  - تنزيل PDF مباشر كصورة (html2canvas + jsPDF): بديل، ويتحول تلقائياً لنافذة الطباعة عند الفشل.
 *  - Excel منسّق (ExcelJS) وطباعة مباشرة.
 * كل جدول يحمل ترويسة: الجامعة، الكلية، القسم، المرحلة، نوع الدراسة، الشعبة، الفصل والعام الدراسي.
 */
import { DAY_NAMES, formatRange, formatTime, assignLanes } from './timeutil.js';
import { esc, el, loadScript, download, colorFor, modal, toast } from './ui.js';
import { settings, byId } from './store.js';
import { sessionsForView, viewHeader, sessionLines, subjectName, teacherName, roomName, groupLabel, collegeName } from './model.js';
import { UNIVERSITY } from './branding.js';

const HTML2CANVAS = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
const JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const EXCELJS = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';

/** تجهيز بيانات جدول واحد بشكل خانات (Slots) صالح للطباعة وExcel */
export function tableModel(type, id) {
  const st = settings();
  const step = st.slotMinutes || 30;
  const days = st.days?.length ? st.days : [1, 2, 3, 4, 5];
  const sessions = sessionsForView(type, id);
  // حصر المحور الزمني بالساعات المستخدمة فعلاً (مع حد أدنى من إعدادات الدوام)
  let from = st.dayStart ?? 480, to = st.dayEnd ?? 1200;
  if (sessions.length) {
    from = Math.min(...sessions.map((s) => s.start));
    to = Math.max(...sessions.map((s) => s.end));
    from = Math.floor(from / 60) * 60;
    to = Math.ceil(to / 60) * 60;
  } else { to = Math.min(to, from + 6 * 60); }
  const slots = [];
  for (let m = from; m < to; m += step) slots.push(m);
  const rows = [];
  for (const day of days) {
    const items = sessions.filter((s) => s.day === day);
    const { lanes, count } = assignLanes(items);
    for (let lane = 0; lane < count; lane++) {
      rows.push({ day, lane, laneCount: count, items: items.filter((s) => lanes.get(s.id) === lane).sort((a, b) => a.start - b.start) });
    }
  }
  return { type, id, header: viewHeader(type, id), step, from, to, slots, rows, days, count: sessions.length };
}

function sessionText(s, type) {
  return [...sessionLines(s, type), formatRange(s.start, s.end)];
}

/** HTML جدول قابل للطباعة */
export function tableHTML(m) {
  const colsPerHour = 60 / m.step;
  const hourHeads = [];
  for (let t = m.from; t < m.to; t += 60) {
    hourHeads.push(`<th colspan="${Math.min(colsPerHour, (m.to - t) / m.step)}">${formatTime(t)}</th>`);
  }
  let body = '';
  for (const r of m.rows) {
    let cells = '';
    let cur = m.from;
    for (const s of r.items) {
      const st = Math.max(s.start, m.from);
      if (st > cur) cells += '<td class="empty"></td>'.repeat(Math.round((st - cur) / m.step));
      const span = Math.max(1, Math.round((Math.min(s.end, m.to) - st) / m.step));
      const lines = sessionText(s, m.type);
      cells += `<td class="sess" colspan="${span}" style="background:${colorFor(s.subjectId || s.title || s.id)}">
        <b>${esc(lines[0])}</b>${lines.slice(1).map((l) => `<div>${esc(l)}</div>`).join('')}</td>`;
      cur = st + span * m.step;
    }
    if (cur < m.to) cells += '<td class="empty"></td>'.repeat(Math.round((m.to - cur) / m.step));
    body += `<tr>${r.lane === 0 ? `<th class="day" rowspan="${r.laneCount}">${DAY_NAMES[r.day]}</th>` : ''}${cells}</tr>`;
  }
  const info = m.header.lines.filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `<span><b>${esc(k)}:</b> <span dir="ltr" style="display:inline-block">${esc(String(v).replace(/[\u2066-\u2069]/g, ''))}</span></span>`).join('');
  return `
  <div class="print-page">
    <div class="print-head">
      <div class="ph-org"><div>${esc(UNIVERSITY)}</div>${m.header.collegeId ? `<div>${esc(collegeName(m.header.collegeId))}</div>` : ''}</div>
      <div class="ph-title">${esc(m.header.title)}</div>
      <div class="ph-info">${info}</div>
    </div>
    <table class="print-table">
      <thead><tr><th class="day">اليوم</th>${hourHeads.join('')}</tr></thead>
      <tbody>${body}</tbody>
    </table>
    ${m.count ? '' : '<p class="muted" style="text-align:center">لا توجد محاضرات مجدولة</p>'}
    <div class="print-foot"><span>تاريخ الإصدار: ${new Date().toLocaleDateString('ar-IQ')}</span></div>
  </div>`;
}

function buildPrintRoot(tables) {
  document.getElementById('print-root')?.remove();
  const root = el(`<div id="print-root" dir="rtl">${tables.map((t) => tableHTML(tableModel(t.type, t.id))).join('')}</div>`);
  document.body.appendChild(root);
  return root;
}

/* ------------------------------ الطباعة وحفظ PDF عبر نافذة الطباعة ------------------------------ */
let builtAt = 0;
let printProvider = null;
let savedTitle = null;

/** صفحة الجداول تسجل هنا الجداول المعروضة، فيطبع Ctrl+P الجدول بالتنسيق الرسمي */
export function setPrintProvider(fn) {
  printProvider = fn;
  if (!fn) { builtAt = 0; clearPrint(); } // مغادرة صفحة الجداول: لا تُطبع جداول قديمة
}

function preparePrint(tables, title) {
  buildPrintRoot(tables);
  document.body.classList.add('printing');
  builtAt = Date.now();
  // اسم الصفحة يصبح الاسم الافتراضي لملف PDF المحفوظ
  if (title) { if (savedTitle === null) savedTitle = document.title; document.title = title; }
}
function clearPrint() {
  document.body.classList.remove('printing');
  document.getElementById('print-root')?.remove();
}
window.addEventListener('beforeprint', () => {
  if (Date.now() - builtAt < 5000) return; // طباعة بدأت من أزرار النظام وجاهزة
  const tables = printProvider?.();
  if (tables?.length && tables[0].id) preparePrint(tables);
  else clearPrint();
});
window.addEventListener('afterprint', () => {
  // لا نحذف محتوى الطباعة هنا (بعض المتصفحات تطلق الحدث قبل اكتمال المعاينة)؛ يُستبدل عند الطباعة التالية
  setTimeout(() => { if (savedTitle !== null) { document.title = savedTitle; savedTitle = null; } }, 1500);
});

export function printTables(tables, title) {
  preparePrint(tables, title);
  window.print();
}

const HINT_KEY = 'siraj-pdf-hint-hidden';
/** حفظ PDF عبر نافذة الطباعة مع إرشادات مختصرة (تظهر حتى يطلب المستخدم إخفاءها) */
export async function savePDF(tables, filename) {
  let hidden = false;
  try { hidden = localStorage.getItem(HINT_KEY) === '1'; } catch { /* تجاهل */ }
  if (!hidden) {
    const body = el(`<div class="pdf-hint">
      <p>ستفتح نافذة الطباعة الآن، ومنها تحفظ الجدول كملف PDF:</p>
      <ol>
        <li>في خانة <b>الطابعة / الوجهة</b> (Destination) اختر <b>«حفظ بتنسيق PDF»</b> (Save as PDF) أو <b>Microsoft Print to PDF</b>.</li>
        <li>تأكد أن <b>التخطيط</b> (Layout) هو <b>أفقي</b> (Landscape).</li>
        <li>إذا لم تظهر الألوان: من <b>إعدادات إضافية</b> (More settings) فعّل <b>رسومات الخلفية</b> (Background graphics).</li>
        <li>اضغط <b>حفظ</b> (Save) واختر مكان الملف.</li>
      </ol>
      <p class="muted small">على الهاتف: من نافذة الطباعة اضغط زر المشاركة ثم «حفظ في الملفات».</p>
      <label class="chk"><input type="checkbox" id="noHint"> لا تُظهر هذه الإرشادات مجدداً</label>
    </div>`);
    const go = await modal({
      title: '📄 حفظ الجدول كملف PDF', body, size: 'sm',
      buttons: [{ label: 'فتح نافذة الطباعة', value: true, cls: 'btn-primary' }, { label: 'إلغاء', value: false }],
      onButton: (v, root) => {
        if (v && root.querySelector('#noHint').checked) { try { localStorage.setItem(HINT_KEY, '1'); } catch { /* تجاهل */ } }
        return true;
      },
    });
    if (!go) return;
  }
  printTables(tables, filename);
}

/** تنزيل PDF مباشر (الجدول كصورة). عند أي خطأ يُحوَّل المستخدم إلى الحفظ عبر نافذة الطباعة. */
export async function exportPDF(tables, filename) {
  try {
    await Promise.all([loadScript(HTML2CANVAS), loadScript(JSPDF)]);
  } catch (e) {
    toast('تعذر تحميل مكتبة إنشاء PDF (تحقق من الإنترنت). سنستخدم نافذة الطباعة بدلاً منها.', 'warn', 6000);
    return savePDF(tables, filename);
  }
  const root = buildPrintRoot(tables);
  root.classList.add('pdf-render');
  const cover = el('<div class="pdf-cover"><div class="spinner"></div><p>جارٍ إنشاء ملف PDF…</p></div>');
  document.body.appendChild(cover);
  const scrollY = window.scrollY, scrollX = window.scrollX;
  window.scrollTo(0, 0);
  try {
    await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 4000))]);
    const pdf = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
    const W = 297, H = 210, M = 6;
    const pages = [...root.querySelectorAll('.print-page')];
    for (let i = 0; i < pages.length; i++) {
      // كل جدول يُرسم كصورة عالية الدقة ويُضبط ليتسع للصفحة (مع تقسيمه إن كان أطول من صفحة)
      const canvas = await window.html2canvas(pages[i], {
        scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false,
        scrollX: 0, scrollY: 0, windowWidth: Math.max(1200, document.documentElement.clientWidth),
      });
      if (!canvas.width || !canvas.height) throw new Error('صورة الجدول فارغة');
      const imgW = W - 2 * M;
      const pxPerMm = canvas.width / imgW;
      const pageHpx = Math.floor((H - 2 * M) * pxPerMm);
      for (let y = 0, first = true; y < canvas.height; y += pageHpx, first = false) {
        const sliceH = Math.min(pageHpx, canvas.height - y);
        const slice = document.createElement('canvas');
        slice.width = canvas.width; slice.height = sliceH;
        slice.getContext('2d').drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
        if (i > 0 || !first) pdf.addPage();
        pdf.addImage(slice.toDataURL('image/jpeg', 0.95), 'JPEG', M, M, imgW, sliceH / pxPerMm);
      }
    }
    download(`${filename}.pdf`, pdf.output('blob'));
    toast('تم تنزيل ملف PDF — تجده في مجلد التنزيلات', 'success', 4000);
  } catch (e) {
    console.error(e);
    toast(`تعذر إنشاء PDF مباشرة (${e.message || e}). سنستخدم نافذة الطباعة بدلاً منها.`, 'warn', 7000);
    root.remove(); cover.remove();
    return savePDF(tables, filename);
  } finally {
    root.remove();
    cover.remove();
    window.scrollTo(scrollX, scrollY);
  }
}

/** Excel منسّق: ورقة لكل جدول + ورقة قائمة تفصيلية */
export async function exportExcel(tables, filename) {
  await loadScript(EXCELJS);
  const wb = new window.ExcelJS.Workbook();
  wb.creator = UNIVERSITY;
  wb.created = new Date();
  const used = new Set();
  const thin = { style: 'thin', color: { argb: 'FF9AA5B1' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const listRows = [];

  for (const t of tables) {
    const m = tableModel(t.type, t.id);
    let name = m.header.title.replace(/[\\/*?:[\]]/g, ' ').slice(0, 28) || 'جدول';
    let n = 2; const baseName = name;
    while (used.has(name)) name = `${baseName.slice(0, 25)} ${n++}`;
    used.add(name);
    const ws = wb.addWorksheet(name, {
      views: [{ rightToLeft: true, state: 'frozen', ySplit: 6, xSplit: 1 }],
      pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
        margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
      headerFooter: { oddFooter: '&Lصفحة &P من &N' },
    });
    const totalCols = 1 + m.slots.length;
    const title = (row, text, size, fill) => {
      ws.mergeCells(row, 1, row, totalCols);
      const c = ws.getCell(row, 1);
      c.value = text;
      c.font = { name: 'Arial', size, bold: true, color: { argb: fill ? 'FFFFFFFF' : 'FF1F2937' } };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      if (fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      ws.getRow(row).height = size * 1.9;
    };
    title(1, [UNIVERSITY, collegeName(m.header.collegeId)].filter(Boolean).join(' — '), 14, 'FF0F4C81');
    title(2, m.header.title, 13);
    title(3, m.header.lines.filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}: ${v}`).join('    |    '), 10);
    ws.getRow(4).height = 6;

    // ترويسة الساعات
    const hr = 5;
    ws.getCell(hr, 1).value = 'اليوم';
    ws.mergeCells(hr, 1, hr + 1, 1);
    const colsPerHour = 60 / m.step;
    m.slots.forEach((slot, i) => {
      const col = 2 + i;
      ws.getCell(hr + 1, col).value = formatTime(slot);
      if ((slot - m.from) % 60 === 0) {
        const endCol = Math.min(col + colsPerHour - 1, totalCols);
        ws.getCell(hr, col).value = `${formatTime(slot)}`;
        if (endCol > col) ws.mergeCells(hr, col, hr, endCol);
      }
    });
    for (const r of [hr, hr + 1]) {
      ws.getRow(r).eachCell({ includeEmpty: true }, (c) => {
        c.font = { name: 'Arial', bold: true, size: r === hr ? 10 : 8, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E6FB8' } };
        c.alignment = { horizontal: 'center', vertical: 'middle' };
        c.border = border;
      });
    }
    ws.getColumn(1).width = 12;
    for (let c = 2; c <= totalCols; c++) ws.getColumn(c).width = 60 / colsPerHour * 0.36 + 4;

    let row = hr + 2;
    for (const r of m.rows) {
      const rowStart = row;
      ws.getRow(row).height = 62;
      for (const s of r.items) {
        const c1 = 2 + Math.round((Math.max(s.start, m.from) - m.from) / m.step);
        const c2 = 1 + Math.round((Math.min(s.end, m.to) - m.from) / m.step);
        if (c2 > c1) ws.mergeCells(row, c1, row, c2);
        const cell = ws.getCell(row, c1);
        cell.value = sessionText(s, m.type).join('\n');
        const hsl = colorFor(s.subjectId || s.title || s.id);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hslToArgb(hsl) } };
        cell.font = { name: 'Arial', size: 9 };
        cell.alignment = { wrapText: true, horizontal: 'center', vertical: 'middle' };
        listRows.push([m.header.title, DAY_NAMES[s.day], formatTime(s.start), formatTime(s.end), subjectName(s) + (s.kind === 'practical' ? ' (عملي)' : s.kind === 'external' ? ' (حجز)' : ' (نظري)'),
          teacherName(s.teacherId), roomName(s.roomId), (s.groupIds || []).map((g) => groupLabel(byId('groups', g), { withDept: true })).join(' + ')]);
      }
      if (r.lane === 0) {
        ws.getCell(row, 1).value = DAY_NAMES[r.day];
        if (r.laneCount > 1) ws.mergeCells(row, 1, row + r.laneCount - 1, 1);
      }
      row++;
      if (rowStart) for (let c = 1; c <= totalCols; c++) ws.getCell(rowStart, c).border = border;
    }
    for (let r = hr + 2; r < row; r++) {
      const c = ws.getCell(r, 1);
      c.font = { name: 'Arial', bold: true, size: 11 };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FA' } };
    }
    ws.getCell(row + 1, 1).value = `تاريخ الإصدار: ${new Date().toLocaleDateString('ar-IQ')}`;
    ws.mergeCells(row + 1, 1, row + 1, totalCols);
    ws.getCell(row + 1, 1).font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF6B7280' } };
    ws.pageSetup.printArea = `A1:${colLetter(totalCols)}${row + 1}`;
  }

  // ورقة القائمة التفصيلية
  const ls = wb.addWorksheet('قائمة المحاضرات', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ls.addRow(['الجدول', 'اليوم', 'من', 'إلى', 'المادة', 'الأستاذ', 'القاعة', 'الشعب']);
  ls.getRow(1).eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E6FB8' } };
  });
  for (const r of listRows) ls.addRow(r);
  [34, 10, 10, 10, 34, 24, 18, 40].forEach((w, i) => { ls.getColumn(i + 1).width = w; });

  const buf = await wb.xlsx.writeBuffer();
  download(`${filename}.xlsx`, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

function colLetter(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function hslToArgb(hsl) {
  const [h, s, l] = hsl.match(/[\d.]+/g).map(Number);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `FF${f(0)}${f(8)}${f(4)}`.toUpperCase();
}
