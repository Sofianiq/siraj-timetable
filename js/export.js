/**
 * تصدير الجداول وطباعتها:
 *  - PDF عبر نافذة الطباعة في المتصفح («حفظ بتنسيق PDF»): الطريقة الأساسية، نص عربي واضح وقابل للنسخ.
 *  - تنزيل PDF مباشر كصورة (html2canvas + jsPDF): بديل، ويتحول تلقائياً لنافذة الطباعة عند الفشل.
 *  - Excel منسّق (ExcelJS) وطباعة مباشرة.
 * كل جدول يحمل ترويسة: الجامعة، الكلية، القسم، المرحلة، نوع الدراسة، الشعبة، الفصل والعام الدراسي.
 */
import { DAY_NAMES, SHIFTS, formatTime, assignLanes } from './timeutil.js';
import { esc, el, loadScript, download, modal, toast } from './ui.js';
import { settings, byId, store } from './store.js';
import { sessionsForView, viewHeader, subjectName, teacherName, roomName, groupLabel, collegeName, stageName } from './model.js';
import { themeKeyForDept, themeKeyForCollege, themeOf } from './themes.js';
import { subsOf, subgroupColor, subgroupLabel } from './subgroups.js';
import { UNIVERSITY } from './branding.js';

const HTML2CANVAS = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
const JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const EXCELJS = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';

/* ------------------------------ نموذج الجدول ------------------------------ */
const SEM_FULL = { 1: 'الفصل الدراسي الأول', 2: 'الفصل الدراسي الثاني' };
/** 8:30 (نظام 12 ساعة بدون لاحقة، كما في الجدول الرسمي) */
export const clock = (min) => { let h = Math.floor(min / 60) % 12; if (h === 0) h = 12; return `${h}:${String(min % 60).padStart(2, '0')}`; };
const period = (min) => (min < 720 ? 'صباحاً' : min < 900 ? 'ظهراً' : min < 1020 ? 'عصراً' : 'مساءً');
/** «من 8:30 إلى 9:30» مع إبراز الأرقام */
const rangeHTML = (a, b) => `من <b>${clock(a)}</b> إلى <b>${clock(b)}</b>`;

/** «من السبت إلى الأربعاء» إن كانت الأيام متتالية، وإلا تُسرد */
function daysText(days) {
  const sorted = [...days].sort((a, b) => a - b);
  const consecutive = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (sorted.length > 2 && consecutive) return `من ${DAY_NAMES[sorted[0]]} إلى ${DAY_NAMES[sorted[sorted.length - 1]]}`;
  return sorted.map((d) => DAY_NAMES[d]).join('، ');
}

/** ترويسة الجدول المطبوع: الجهة (يمين)، العنوان (وسط)، المرحلة/الأستاذ/القاعة والفصل والعام (يسار)، ولون القسم */
function printInfo(type, id, days) {
  const st = settings();
  const info = { org: [UNIVERSITY], title: 'الجدول الأسبوعي للمحاضرات', meta: [], shift: '', theme: 'teal', sign: 'رئيس القسم' };
  const deptOrg = (d) => [collegeName(d?.collegeId), d && !d.general ? d.name : ''];
  if (type === 'group' || type === 'loose') {
    let d, stage, g;
    if (type === 'group') { g = byId('groups', id); stage = byId('stages', g?.stageId); d = byId('departments', g?.deptId); }
    else {
      const [deptId, level = ''] = String(id).split('|');
      d = byId('departments', deptId);
      stage = store.data.stages.find((x) => x.deptId === deptId && String(x.level) === level) || (level ? { level: Number(level) } : null);
    }
    info.org.push(...deptOrg(d));
    const sub = g && g.name && g.name !== SHIFTS[g.shift] ? ` — شعبة ${g.name}` : '';
    info.meta.push(stage ? stageName(stage) + sub : 'محاضرات غير مرتبطة بشعبة');
    info.shift = g?.shift || 'morning';
    info.theme = themeKeyForDept(d?.id);
    if (d?.general) info.sign = 'عميد الكلية';
  } else if (type === 'dept') {
    const d = byId('departments', id);
    info.org.push(...deptOrg(d));
    info.meta.push(d?.general ? 'الجدول العام' : d?.short || d?.name || '');
    info.theme = themeKeyForDept(id);
  } else if (type === 'college') {
    info.org.push(collegeName(id));
    info.meta.push('الجدول العام');
    info.theme = themeKeyForCollege(id);
    info.sign = 'عميد الكلية';
  } else if (type === 'teacher') {
    const t = byId('teachers', id);
    const d = byId('departments', t?.deptId);
    info.org.push(...deptOrg(d));
    info.title = 'الجدول الأسبوعي للتدريسي';
    info.meta.push(`${t?.title ? `${t.title}: ` : ''}${t?.name || ''}`);
    info.theme = themeKeyForDept(t?.deptId);
    info.sign = 'معاون العميد للشؤون العلمية';
  } else if (type === 'room') {
    const r = byId('rooms', id);
    info.org.push(collegeName(r?.collegeId), r?.building || '');
    info.title = r?.type === 'lab' ? 'جدول إشغال المختبر الأسبوعي' : 'جدول إشغال القاعة الأسبوعي';
    info.meta.push(`${r?.name || ''}${r?.capacity ? ` <small>(سعة ${r.capacity})</small>` : ''}`);
    info.metaHTML = true;
    info.theme = r?.deptId ? themeKeyForDept(r.deptId) : themeKeyForCollege(r?.collegeId);
    info.sign = 'معاون العميد للشؤون العلمية';
  }
  info.org = info.org.filter(Boolean);
  info.meta.push(SEM_FULL[st.semester] || '');
  const [y1, y2] = String(st.academicYear || '').split(/[-–]/).map((x) => x.trim());
  info.year = y2 ? `${y1} – ${y2}` : y1 || '';
  // سطر الدوام: أيام الدوام ووقت دوام الشعبة (صباحي/مسائي)
  const sh = info.shift && st.shifts?.[info.shift];
  info.sub = `${info.shift === 'evening' ? 'الدوام المسائي' : 'الدوام الرسمي'}: ${daysText(days)}`
    + (sh ? ` • من <b>${clock(sh.start)}</b> ${period(sh.start)} إلى <b>${clock(sh.end)}</b> ${period(sh.end)}` : '');
  return info;
}

/**
 * في جدول الشعبة: محاضرات مجاميع العملي المختلفة (A, B, C…) المتداخلة زمنياً تُجمع في خانة واحدة مكدّسة،
 * لكل مجموعة سطر بلونها. المحاضرات للشعبة كاملة تبقى خانات عادية.
 */
export function stackSubgroups(items) {
  const out = [];
  for (const s of [...items].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const subs = subsOf(s);
    const st = subs.length && out.find((x) => x.stack && x.start < s.end && s.start < x.end
      && x.members.every((m) => !subsOf(m).some((v) => subs.includes(v))));
    if (st) { st.members.push(s); st.start = Math.min(st.start, s.start); st.end = Math.max(st.end, s.end); }
    else if (subs.length) out.push({ id: `stk-${s.id}`, stack: true, day: s.day, start: s.start, end: s.end, members: [s] });
    else out.push(s);
  }
  return out.map((x) => (x.stack && x.members.length === 1 ? x.members[0] : x));
}

/** أعضاء الخانة المكدّسة مرتبين بترتيب المجاميع في الشعبة */
function stackMembers(st) {
  const g = byId('groups', st.members[0].groupIds?.[0]);
  const order = (x) => { const i = (g?.subgroups || []).indexOf(subsOf(x)[0]); return i < 0 ? 99 : i; };
  return { g, members: [...st.members].sort((a, b) => order(a) - order(b)) };
}
const groupsCountAr = (n) => (n === 2 ? 'مجموعتان' : n <= 10 ? `${n} مجاميع` : `${n} مجموعة`);

/**
 * تجهيز بيانات جدول واحد بشكل خانات (Slots) صالح للطباعة وExcel.
 * المحور الزمني ثابت من إعدادات الطباعة (افتراضياً 8:30 إلى 3:30) ويتسع تلقائياً لأي محاضرة خارجه.
 */
export function tableModel(type, id) {
  const st = settings();
  const days = st.days?.length ? st.days : [1, 2, 3, 4, 5];
  const sessions = sessionsForView(type, id).filter((s) => days.includes(s.day));
  let from = st.printStart ?? 510, to = st.printEnd ?? 930;
  if (to <= from) to = from + 420;
  for (const s of sessions) {
    while (s.start < from) from -= 60;
    while (s.end > to) to += 60;
  }
  // خانة نصف ساعة، أو ربع ساعة إن وُجدت أوقات غير منتظمة
  const step = sessions.every((s) => (s.start - from) % 30 === 0 && (s.end - from) % 30 === 0) ? 30 : 15;
  const slots = [];
  for (let m = from; m < to; m += step) slots.push(m);
  const rows = [];
  for (const day of days) {
    const daySessions = sessions.filter((s) => s.day === day);
    const items = type === 'group' ? stackSubgroups(daySessions) : daySessions;
    const { lanes, count } = assignLanes(items);
    for (let lane = 0; lane < count; lane++) {
      rows.push({ day, lane, laneCount: count, items: items.filter((s) => lanes.get(s.id) === lane).sort((a, b) => a.start - b.start) });
    }
  }
  const print = printInfo(type, id, days);
  return { type, id, header: viewHeader(type, id), print, theme: themeOf(print.theme), step, from, to, slots, rows, days, count: sessions.length };
}

const KIND_LABEL = { theory: 'نظري', practical: 'عملي', external: 'حجز' };

/** أسطر التفاصيل داخل خانة المحاضرة حسب نوع الجدول */
function cardMeta(s, type) {
  const rows = [];
  const sub = subgroupLabel(s);
  const groups = (s.groupIds || []).map((gid) => groupLabel(byId('groups', gid), { withDept: type !== 'loose' })).join(' + ') + (sub ? ` (${sub})` : '');
  if (type !== 'teacher' && s.kind !== 'external') rows.push(['التدريسي', teacherName(s.teacherId)]);
  if (type !== 'room') rows.push(['القاعة', roomName(s.roomId)]);
  if ((type === 'teacher' || type === 'room') && groups) rows.push(['الشعبة', groups]);
  if (s.kind === 'external' && s.bookedBy) rows.push(['الجهة', s.bookedBy]);
  return rows;
}

/** خانة مكدّسة: مجاميع العملي في الوقت نفسه، لكل مجموعة سطر بلونها */
function stackHTML(st, m, span) {
  const { g, members } = stackMembers(st);
  const kinds = new Set(members.map((x) => x.kind));
  const kind = kinds.size === 1 ? [...kinds][0] : 'practical';
  const sameTime = members.every((x) => x.start === st.start && x.end === st.end);
  const sf = members.length <= 2 ? 1 : members.length <= 4 ? 0.9 : members.length <= 6 ? 0.8 : 0.7;
  const rows = members.map((x) => {
    const [c, bg] = subgroupColor(g, subsOf(x)[0]);
    const meta = [teacherName(x.teacherId), roomName(x.roomId)].filter(Boolean).join(' • ');
    return `<div class="sg-row" style="--sg:${c};--sgb:${bg}"><span class="sg-tag">${esc(subsOf(x).join('+'))}</span>
      <span class="sg-body"><span class="sg-name">${esc(subjectName(x))}${kinds.size > 1 ? ` (${KIND_LABEL[x.kind]})` : ''}</span>${meta ? `<span class="sg-meta">${esc(meta)}</span>` : ''}${sameTime ? '' : `<span class="sg-time">${rangeHTML(x.start, x.end)}</span>`}</span></div>`;
  }).join('');
  return `<td class="sc stk ${kind === 'theory' ? 'th' : 'pr'}" colspan="${span}" style="--sf:${sf}"><div class="cd">
    <div class="cd-top"><span class="badge">${KIND_LABEL[kind] || 'عملي'}</span><span class="tm">${rangeHTML(st.start, st.end)}</span><span class="stk-n">${groupsCountAr(members.length)}</span></div>
    <div class="sg-rows">${rows}</div>
  </div></td>`;
}

function cardHTML(s, m, span) {
  if (s.stack) return stackHTML(s, m, span);
  const kind = s.kind === 'practical' ? 'pr' : s.kind === 'external' ? 'ex' : 'th';
  const g1 = byId('groups', s.groupIds?.[0]);
  const subTag = m.type === 'group' ? subsOf(s).map((x) => `<span class="sg-tag" style="--sg:${subgroupColor(g1, x)[0]}">${esc(x)}</span>`).join('') : '';
  const size = span * m.step <= 60 ? ' narrow' : span * m.step >= 180 ? ' wide' : '';
  const meta = cardMeta(s, m.type).map(([k, v]) => `<div><span class="k">${esc(k)}:</span> <span class="v">${v ? esc(v) : '—'}</span></div>`).join('');
  return `<td class="sc ${kind}${size}" colspan="${span}"><div class="cd">
    <div class="cd-top">${subTag}<span class="badge">${KIND_LABEL[s.kind] || 'نظري'}</span><span class="tm">${rangeHTML(s.start, s.end)}</span></div>
    <div class="cd-name">${esc(subjectName(s))}</div>
    <div class="cd-meta">${meta}</div>
  </div></td>`;
}

/** HTML جدول قابل للطباعة على صفحة A4 أفقية، بتصميم الجدول الرسمي */
export function tableHTML(m, { page = 1, pages = 1 } = {}) {
  const t = m.theme, p = m.print;
  const perHour = 60 / m.step;
  const heads = [];
  for (let x = m.from; x < m.to; x += 60) {
    const span = Math.min(perHour, Math.round((m.to - x) / m.step));
    heads.push(`<th class="hr" colspan="${span}">${rangeHTML(x, Math.min(x + 60, m.to))}</th>`);
  }
  const gap = (from, to, between) => {
    const n = Math.round((to - from) / m.step);
    if (n <= 0) return '';
    return between && to - from >= 30
      ? `<td class="free" colspan="${n}"><div class="free-t">فترة حرة</div><div class="free-r">${rangeHTML(from, to)}</div></td>`
      : `<td class="empty" colspan="${n}"></td>`;
  };
  let body = '';
  for (const r of m.rows) {
    let cells = '';
    let cur = m.from;
    r.items.forEach((s, i) => {
      const a = Math.max(s.start, cur);
      cells += gap(cur, a, i > 0 && r.laneCount === 1);
      const span = Math.max(1, Math.round((Math.min(s.end, m.to) - a) / m.step));
      cells += cardHTML(s, m, span);
      cur = a + span * m.step;
    });
    if (cur < m.to) cells += gap(cur, m.to, false);
    const day = r.lane === 0 ? `<th class="day" rowspan="${r.laneCount}"><span>${DAY_NAMES[r.day]}</span></th>` : '';
    body += `<tr class="${r.items.length ? '' : 'none'}">${day}${cells}</tr>`;
  }
  const rowsCount = m.rows.length;
  // حجم الخط يتناسب مع عدد الصفوف حتى يتسع الجدول لصفحة واحدة دائماً
  const scale = rowsCount <= 4 ? 1.06 : rowsCount === 5 ? 0.97 : Math.max(0.6, 5.1 / rowsCount);
  const vars = `--d:${t.dark};--m:${t.main};--a:${t.accent};--ink:${t.ink};--th:${t.theory};--pr:${t.practical};--fs:${scale}`;
  const meta = p.meta.filter(Boolean);
  return `
  <div class="print-page sheet" style="${vars}">
    <div class="sh-frame">
      <header class="sh-head">
        <div class="sh-org">${p.org.map((x, i) => `<div class="o${i}">${esc(x)}</div>`).join('')}</div>
        <div class="sh-title"><h1>${esc(p.title)}</h1><div class="sub">${p.sub}</div></div>
        <div class="sh-meta">${meta.map((x, i) => `<div class="m${i}">${p.metaHTML && i === 0 ? x : esc(x)}</div>`).join('')}
          ${p.year ? `<div class="yr">العام الدراسي <b>${esc(p.year)}</b></div>` : ''}</div>
      </header>
      <div class="sh-body"><table class="sh-grid">
        <colgroup><col class="c-day">${m.slots.map(() => '<col>').join('')}</colgroup>
        <thead><tr><th class="corner">اليوم / الوقت</th>${heads.join('')}</tr></thead>
        <tbody>${body}</tbody>
      </table></div>
      ${m.count ? '' : '<div class="sh-none">لا توجد محاضرات مجدولة في هذا الجدول</div>'}
      <footer class="sh-foot">
        <div class="issued">تاريخ الإصدار: <span dir="ltr">${esc(new Date().toLocaleDateString('en-GB'))}</span>${pages > 1 ? ` &nbsp;•&nbsp; صفحة ${page} من ${pages}` : ''}</div>
        <div class="sign"><div class="line"></div><div>${esc(p.sign)}</div></div>
      </footer>
    </div>
  </div>`;
}

function buildPrintRoot(tables) {
  document.getElementById('print-root')?.remove();
  const root = el(`<div id="print-root" dir="rtl">${tables.map((t, i) => tableHTML(tableModel(t.type, t.id), { page: i + 1, pages: tables.length })).join('')}</div>`);
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

/** معاينة الصفحات كما ستُطبع تماماً، ومنها الحفظ كملف PDF أو الطباعة */
export async function previewTables(tables, filename) {
  const html = tables.map((t, i) => tableHTML(tableModel(t.type, t.id), { page: i + 1, pages: tables.length })).join('');
  const body = el(`<div class="pv-wrap"><div class="pv-pages" dir="rtl">${html}</div></div>`);
  const fit = () => {
    const pages = body.querySelector('.pv-pages');
    const sheet = pages.querySelector('.sheet');
    if (sheet) pages.style.zoom = Math.min(1, (body.clientWidth - 24) / sheet.offsetWidth).toFixed(3);
  };
  requestAnimationFrame(fit);
  window.addEventListener('resize', fit);
  const v = await modal({
    title: `👁 معاينة الطباعة — ${tables.length} ${tables.length === 1 ? 'صفحة' : tables.length === 2 ? 'صفحتان' : 'صفحات'}`, body, size: 'xl',
    buttons: [{ label: '📄 حفظ PDF', value: 'pdf', cls: 'btn-primary' }, { label: '🖨 طباعة', value: 'print' }, { label: 'إغلاق', value: null }],
  });
  window.removeEventListener('resize', fit);
  if (v === 'pdf') await savePDF(tables, filename);
  else if (v === 'print') printTables(tables, filename);
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
    const W = 297, H = 210, M = 0; // كل جدول مصمم بحجم صفحة A4 كاملة
    const pages = [...root.querySelectorAll('.print-page')];
    for (let i = 0; i < pages.length; i++) {
      // كل جدول يُرسم كصورة عالية الدقة ويُضبط ليتسع للصفحة (مع تقسيمه إن كان أطول من صفحة)
      const canvas = await window.html2canvas(pages[i], {
        scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false,
        scrollX: 0, scrollY: 0, windowWidth: Math.max(1240, document.documentElement.clientWidth),
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
  const listRows = [];

  const TNR = 'Times New Roman';
  const argb = (hex) => `FF${hex.replace('#', '').toUpperCase()}`;
  const plain = (html) => String(html).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/[⁦-⁩]/g, '');
  const clockRange = (a, b) => `من ${clock(a)} إلى ${clock(b)}`;
  const white = { argb: 'FFFFFFFF' };
  const gapLine = { style: 'thin', color: { argb: 'FFFFFFFF' } };
  const gapBorder = { top: gapLine, left: gapLine, bottom: gapLine, right: gapLine };

  for (const t of tables) {
    const m = tableModel(t.type, t.id);
    const th = m.theme, p = m.print;
    const fill = (hex) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } });
    let name = plain(`${p.meta[0] || ''} ${p.org[2] || p.org[1] || ''}`).replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 28) || 'جدول';
    let n = 2; const baseName = name;
    while (used.has(name)) name = `${baseName.slice(0, 25)} ${n++}`;
    used.add(name);
    const ws = wb.addWorksheet(name, {
      properties: { tabColor: { argb: argb(th.main) } },
      views: [{ rightToLeft: true, showGridLines: false }],
      pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true, verticalCentered: true,
        margins: { left: 0.25, right: 0.25, top: 0.3, bottom: 0.3, header: 0.1, footer: 0.1 } },
    });
    const totalCols = 1 + m.slots.length;
    const band = (row, value, { size = 12, bold = true, color = th.ink, bg = null, height = 22 } = {}) => {
      ws.mergeCells(row, 1, row, totalCols);
      const c = ws.getCell(row, 1);
      c.value = value;
      c.font = { name: TNR, size, bold, color: { argb: argb(color) } };
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      if (bg) c.fill = fill(bg);
      ws.getRow(row).height = height;
    };
    band(1, p.org.join('  —  '), { size: 15, color: '#FFFFFF', bg: th.dark, height: 28 });
    band(2, `${p.title}  —  ${plain(p.meta[0] || '')}`, { size: 18, bg: th.theory, height: 32 });
    band(3, [plain(p.meta[1] || ''), p.year ? `العام الدراسي ${p.year}` : '', plain(p.sub)].filter(Boolean).join('   •   '), { size: 11.5, bold: false, color: '#3A464D', bg: th.theory, height: 20 });
    ws.getCell(3, 1).border = { bottom: { style: 'medium', color: { argb: argb(th.accent) } } };
    ws.getRow(4).height = 6;

    // ترويسة الساعات: «من 8:30 إلى 9:30»
    const hr = 5;
    const corner = ws.getCell(hr, 1);
    corner.value = 'اليوم / الوقت';
    corner.fill = fill(th.accent);
    corner.font = { name: TNR, size: 11, bold: true, color: white };
    const perHour = 60 / m.step;
    for (let x = m.from, col = 2; x < m.to; x += 60, col += perHour) {
      const endCol = Math.min(col + perHour - 1, totalCols);
      const c = ws.getCell(hr, col);
      c.value = clockRange(x, Math.min(x + 60, m.to));
      if (endCol > col) ws.mergeCells(hr, col, hr, endCol);
      c.fill = fill(th.main);
      c.font = { name: TNR, size: 12, bold: true, color: white };
    }
    ws.getRow(hr).eachCell({ includeEmpty: true }, (c) => { c.alignment = { horizontal: 'center', vertical: 'middle' }; c.border = gapBorder; });
    ws.getRow(hr).height = 26;
    ws.getColumn(1).width = 13;
    for (let c = 2; c <= totalCols; c++) ws.getColumn(c).width = 34 / perHour;

    let row = hr + 1;
    const colOf = (min) => 2 + Math.round((min - m.from) / m.step);
    for (const r of m.rows) {
      ws.getRow(row).height = Math.max(54, 78 / Math.max(1, r.laneCount * 0.8));
      let cur = m.from;
      r.items.forEach((s, i) => {
        const a = Math.max(s.start, cur);
        if (i > 0 && r.laneCount === 1 && a - cur >= 30) {
          const g1 = colOf(cur), g2 = colOf(a) - 1;
          if (g2 > g1) ws.mergeCells(row, g1, row, g2);
          const g = ws.getCell(row, g1);
          g.value = `فترة حرة\n${clockRange(cur, a)}`;
          g.font = { name: TNR, size: 10, bold: true, color: { argb: 'FF8A96A0' } };
          g.fill = fill('#EEF1F4');
          g.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        }
        const c1 = colOf(a), c2 = colOf(Math.min(s.end, m.to)) - 1;
        if (c2 > c1) ws.mergeCells(row, c1, row, c2);
        const cell = ws.getCell(row, c1);
        const listRow = (x) => listRows.push([plain(`${p.meta[0]} — ${p.org.slice(1).join(' — ')}`), DAY_NAMES[x.day], formatTime(x.start), formatTime(x.end),
          subjectName(x) + (x.kind === 'practical' ? ' (عملي)' : x.kind === 'external' ? ' (حجز)' : ' (نظري)'),
          teacherName(x.teacherId), roomName(x.roomId), (x.groupIds || []).map((g) => groupLabel(byId('groups', g), { withDept: true })).join(' + ') + (subgroupLabel(x) ? ` (${subgroupLabel(x)})` : '')]);
        if (s.stack) {
          // خانة مكدّسة: سطر لكل مجموعة عملي بلونها
          const { g, members } = stackMembers(s);
          const runs = [{ text: `${KIND_LABEL[members[0].kind] || 'عملي'}  |  ${clockRange(s.start, s.end)}  —  ${groupsCountAr(members.length)}`, font: { name: TNR, size: 10, bold: true, color: { argb: argb(th.accent) } } }];
          for (const x of members) {
            const [c] = subgroupColor(g, subsOf(x)[0]);
            const meta = [teacherName(x.teacherId), roomName(x.roomId)].filter(Boolean).join(' • ');
            const time = x.start === s.start && x.end === s.end ? '' : `  (${clockRange(x.start, x.end)})`;
            runs.push({ text: `\n${subsOf(x).join('+')}: `, font: { name: TNR, size: 11, bold: true, color: { argb: argb(c) } } });
            runs.push({ text: `${subjectName(x)}${meta ? ` — ${meta}` : ''}${time}`, font: { name: TNR, size: 10, color: { argb: 'FF1B262C' } } });
            listRow(x);
          }
          cell.value = { richText: runs };
          cell.fill = fill(th.practical);
          cell.alignment = { wrapText: true, horizontal: 'center', vertical: 'middle' };
          cell.border = { ...gapBorder, top: { style: 'thick', color: { argb: argb(th.accent) } } };
          ws.getRow(row).height = Math.max(ws.getRow(row).height || 0, 22 + members.length * 15);
          cur = Math.max(cur, Math.min(s.end, m.to));
          return;
        }
        const tone = s.kind === 'practical' ? th.accent : s.kind === 'external' ? '#6B5A8C' : th.main;
        const subTxt = subgroupLabel(s);
        cell.value = { richText: [
          { text: `${KIND_LABEL[s.kind] || 'نظري'}${subTxt ? ` — ${subTxt}` : ''}  |  ${clockRange(s.start, s.end)}\n`, font: { name: TNR, size: 10, bold: true, color: { argb: argb(tone) } } },
          { text: `${subjectName(s)}\n`, font: { name: TNR, size: 12, bold: true, color: { argb: 'FF1B262C' } } },
          { text: cardMeta(s, m.type).map(([k, v]) => `${k}: ${v || '—'}`).join('\n'), font: { name: TNR, size: 10, color: { argb: argb(th.ink) } } },
        ] };
        cell.fill = fill(s.kind === 'practical' ? th.practical : s.kind === 'external' ? '#F0ECF6' : th.theory);
        cell.alignment = { wrapText: true, horizontal: 'center', vertical: 'middle' };
        cell.border = { ...gapBorder, top: { style: 'thick', color: { argb: argb(tone) } } };
        cur = Math.max(cur, Math.min(s.end, m.to));
        listRow(s);
      });
      for (let c = 2; c <= totalCols; c++) {
        const x = ws.getCell(row, c);
        if (!x.value && !x.isMerged) { x.fill = fill('#F3F5F7'); x.border = gapBorder; }
      }
      if (r.lane === 0) {
        const d = ws.getCell(row, 1);
        d.value = DAY_NAMES[r.day];
        d.font = { name: TNR, size: 15, bold: true, color: white };
        d.fill = fill(th.dark);
        d.alignment = { horizontal: 'center', vertical: 'middle' };
        d.border = { ...gapBorder, bottom: { style: 'medium', color: { argb: argb(th.accent) } } };
        if (r.laneCount > 1) ws.mergeCells(row, 1, row + r.laneCount - 1, 1);
      }
      row++;
    }
    // التذييل: تاريخ الإصدار والتوقيع
    ws.getRow(row).height = 14;
    const foot = row + 1;
    const signFrom = Math.max(2, totalCols - Math.min(5, totalCols - 2));
    ws.mergeCells(foot, 1, foot, Math.max(1, signFrom - 2));
    ws.getCell(foot, 1).value = `تاريخ الإصدار: ${new Date().toLocaleDateString('ar-IQ')}`;
    ws.getCell(foot, 1).font = { name: TNR, size: 9, color: { argb: 'FF8B959B' } };
    ws.mergeCells(foot, signFrom, foot, totalCols);
    const sign = ws.getCell(foot, signFrom);
    sign.value = p.sign;
    sign.font = { name: TNR, size: 13, bold: true, color: { argb: argb(th.ink) } };
    sign.alignment = { horizontal: 'center', vertical: 'bottom' };
    sign.border = { top: { style: 'thin', color: { argb: argb(th.accent) } } };
    ws.getRow(foot).height = 26;
    ws.pageSetup.printArea = `A1:${colLetter(totalCols)}${foot}`;
  }

  // ورقة القائمة التفصيلية
  const ls = wb.addWorksheet('قائمة المحاضرات', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ls.addRow(['الجدول', 'اليوم', 'من', 'إلى', 'المادة', 'الأستاذ', 'القاعة', 'الشعب']);
  ls.getRow(1).eachCell((c) => {
    c.font = { name: 'Times New Roman', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D4A57' } };
  });
  for (const r of listRows) ls.addRow(r).font = { name: 'Times New Roman', size: 11 };
  [34, 10, 10, 10, 34, 24, 18, 40].forEach((w, i) => { ls.getColumn(i + 1).width = w; });

  const buf = await wb.xlsx.writeBuffer();
  download(`${filename}.xlsx`, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

function colLetter(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
