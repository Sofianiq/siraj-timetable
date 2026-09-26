/**
 * صفحات إدارة البيانات الأساسية (إضافة / تعديل / حذف):
 * الكليات، الأقسام، المراحل والشعب، الأساتذة وأوقات توفرهم، القاعات والمختبرات، المواد الدراسية (مع الاستيراد من Excel).
 */
import { store, byId, batchWrite, uid, isAdmin, canEditDept, myDeptId, settings } from '../store.js';
import { esc, el, $, $$, modal, toast, confirmDialog, buildForm, readForm, loadScript, download } from '../ui.js';
import { ROOM_TYPES, SHIFTS, STAGE_NAMES, SEMESTERS, DAY_NAMES, formatTime } from '../timeutil.js';
import { sortByName, deptName, groupLabel, teacherName } from '../model.js';

const EXCELJS = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';

const opt = (arr, label = (x) => x.name) => arr.map((x) => ({ value: x.id, label: label(x) }));
const deptOptions = () => opt(sortByName(store.data.departments));
const collegeOptions = () => opt(sortByName(store.data.colleges));
const teacherOptions = () => opt(sortByName(store.data.teachers));
const stageLevelOptions = () => [1, 2, 3, 4, 5, 6].map((l) => ({ value: l, label: `المرحلة ${STAGE_NAMES[l]}` }));

/* =============================== تعريف الكيانات =============================== */
const ENTITIES = {
  colleges: {
    title: 'الكليات', single: 'كلية', icon: '🏛',
    canEdit: () => isAdmin(),
    fields: () => [
      { key: 'name', label: 'اسم الكلية', required: true, full: true },
      { key: 'own', label: 'كليتنا', type: 'checkbox', checkLabel: 'هذه هي كلية التقنيات الصحية والطبية (المُدارة في النظام)' },
    ],
    columns: [['name', 'الاسم'], [(r) => (r.own ? 'نعم' : '—'), 'كليتنا']],
    help: 'أضف الكليات الأخرى في الجامعة لتسجيل قاعاتها المشتركة وحجوزاتها، فيمنع النظام التعارض على مستوى الجامعة.',
  },
  departments: {
    title: 'الأقسام', single: 'قسم', icon: '🏢',
    canEdit: () => isAdmin(),
    fields: () => [
      { key: 'name', label: 'اسم القسم', required: true, full: true },
      { key: 'short', label: 'الاسم المختصر', placeholder: 'مثال: الأشعة' },
      { key: 'collegeId', label: 'الكلية', type: 'select', options: collegeOptions(), required: true },
    ],
    columns: [['name', 'القسم'], ['short', 'مختصر'], [(r) => byId('colleges', r.collegeId)?.name || '', 'الكلية'],
      [(r) => store.data.groups.filter((g) => g.deptId === r.id).length, 'عدد الشعب']],
  },
  teachers: {
    title: 'الأساتذة', single: 'أستاذ', icon: '👨‍🏫', deptScoped: true,
    canEdit: (r) => isAdmin() || canEditDept(r ? r.deptId : myDeptId()),
    fields: () => [
      { key: 'name', label: 'الاسم', required: true, full: true, placeholder: 'مثال: د. أحمد علي' },
      { key: 'title', label: 'اللقب العلمي', type: 'select', options: ['أستاذ', 'أستاذ مساعد', 'مدرس', 'مدرس مساعد', 'محاضر'].map((x) => ({ value: x, label: x })) },
      { key: 'deptId', label: 'القسم الأساسي', type: 'select', options: deptOptions(), required: true, default: myDeptId() || '' },
      { key: 'phone', label: 'الهاتف' },
      { key: 'email', label: 'البريد الإلكتروني', type: 'email' },
      { key: 'maxDailyHours', label: 'أقصى ساعات يومياً', type: 'number', min: 1, max: 12 },
    ],
    columns: [['name', 'الاسم'], ['title', 'اللقب'], [(r) => deptName(r.deptId), 'القسم'],
      [(r) => availabilitySummary(r.availability), 'أوقات التوفر'],
      [(r) => store.data.sessions.filter((s) => s.teacherId === r.id).reduce((n, s) => n + (s.end - s.start) / 60, 0), 'ساعات مجدولة']],
    rowActions: [{ label: '🕒 أوقات التوفر', run: (r) => editAvailability(r) }],
    onDelete: (r) => store.data.sessions.filter((s) => s.teacherId === r.id).map((s) => ({ op: 'update', col: 'sessions', id: s.id, data: { teacherId: null } })),
  },
  rooms: {
    title: 'القاعات والمختبرات', single: 'قاعة/مختبر', icon: '🚪',
    canEdit: () => isAdmin(),
    fields: () => [
      { key: 'name', label: 'الاسم', required: true, placeholder: 'مثال: القاعة 5 أو مختبر الأشعة 2' },
      { key: 'type', label: 'النوع', type: 'select', options: Object.entries(ROOM_TYPES).map(([value, label]) => ({ value, label })), required: true, default: 'hall' },
      { key: 'labKind', label: 'نوع المختبر (للمختبرات)', placeholder: 'مثال: مختبر أشعة', help: 'يطابق حقل «نوع المختبر» في المادة ليختار المولّد المختبر المناسب' },
      { key: 'capacity', label: 'السعة (عدد الطلبة)', type: 'number', min: 1, required: true },
      { key: 'collegeId', label: 'الكلية المالكة', type: 'select', options: collegeOptions() },
      { key: 'deptId', label: 'قسم له الأولوية (اختياري)', type: 'select', options: deptOptions() },
      { key: 'building', label: 'المبنى / الطابق' },
      { key: 'active', label: 'الحالة', type: 'checkbox', checkLabel: 'متاحة للجدولة', default: true },
    ],
    columns: [['name', 'الاسم'], [(r) => ROOM_TYPES[r.type] || '', 'النوع'], ['labKind', 'نوع المختبر'], ['capacity', 'السعة'],
      [(r) => byId('colleges', r.collegeId)?.name || '', 'الكلية'], ['building', 'المبنى'], [(r) => (r.active === false ? 'معطلة' : 'متاحة'), 'الحالة']],
    onDelete: (r) => store.data.sessions.filter((s) => s.roomId === r.id).map((s) => ({ op: 'update', col: 'sessions', id: s.id, data: { roomId: null } })),
  },
  subjects: {
    title: 'المواد الدراسية', single: 'مادة', icon: '📘', deptScoped: true,
    canEdit: (r) => isAdmin() || canEditDept(r ? r.deptId : myDeptId()),
    fields: () => [
      { key: 'name', label: 'اسم المادة', required: true, full: true },
      { key: 'deptId', label: 'القسم', type: 'select', options: deptOptions(), required: true, default: myDeptId() || '' },
      { key: 'stageLevel', label: 'المرحلة', type: 'select', options: stageLevelOptions(), required: true },
      { key: 'semester', label: 'الفصل', type: 'select', options: Object.entries(SEMESTERS).map(([value, label]) => ({ value, label })), required: true, default: settings().semester || 1 },
      { key: 'code', label: 'رمز المادة' },
      { key: 'theoryHours', label: 'الساعات النظرية أسبوعياً', type: 'number', min: 0, step: 0.5, default: 2 },
      { key: 'practicalHours', label: 'الساعات العملية أسبوعياً', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'labType', label: 'نوع المختبر المطلوب', placeholder: 'مثال: مختبر أشعة' },
      { key: 'theoryTeacherId', label: 'أستاذ النظري', type: 'select', options: teacherOptions() },
      { key: 'practicalTeacherId', label: 'أستاذ العملي', type: 'select', options: teacherOptions() },
      { key: 'combineTheory', label: 'النظري', type: 'checkbox', checkLabel: 'يُدرَّس النظري لكل شعب المرحلة معاً (في نوع الدراسة نفسه)', default: true, full: true },
    ],
    columns: [['name', 'المادة'], [(r) => deptName(r.deptId), 'القسم'], [(r) => STAGE_NAMES[r.stageLevel] || r.stageLevel, 'المرحلة'],
      [(r) => r.semester || 1, 'الفصل'], ['theoryHours', 'نظري'], ['practicalHours', 'عملي'], ['labType', 'المختبر'],
      [(r) => [teacherName(r.theoryTeacherId), teacherName(r.practicalTeacherId)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' / '), 'الأستاذ'],
      [(r) => (r.needsReview ? '<span class="chip chip-warn" title="الساعات قيم افتراضية، يرجى مراجعتها">مراجعة</span>' : ''), '', true]],
    toolbar: [
      { label: '⬆ استيراد المناهج من Excel', run: () => importSubjects() },
      { label: '⬇ نموذج ملف المناهج', run: () => downloadTemplate() },
    ],
    beforeSave: (v) => ({ ...v, stageLevel: Number(v.stageLevel), semester: Number(v.semester), theoryHours: Number(v.theoryHours) || 0, practicalHours: Number(v.practicalHours) || 0, needsReview: false }),
    onDelete: (r) => store.data.sessions.filter((s) => s.subjectId === r.id).map((s) => ({ op: 'delete', col: 'sessions', id: s.id })),
    deleteWarning: 'سيتم حذف كل محاضرات هذه المادة من الجداول.',
  },
};

function availabilitySummary(av) {
  if (!av || !Object.keys(av).length) return 'متاح دائماً';
  return Object.keys(av).filter((d) => av[d]?.length).map((d) => DAY_NAMES[d]).join('، ') || 'غير متاح';
}

/* =============================== صفحة عامة =============================== */
const filters = {};

export function renderEntity(container, col) {
  const E = ENTITIES[col];
  const f = filters[col] || (filters[col] = { q: '', dept: E.deptScoped ? (myDeptId() || '') : '' });
  let rows = [...store.data[col]];
  if (f.dept) rows = rows.filter((r) => r.deptId === f.dept);
  if (f.q) rows = rows.filter((r) => JSON.stringify(r).includes(f.q));
  rows = col === 'subjects'
    ? rows.sort((a, b) => deptName(a.deptId).localeCompare(deptName(b.deptId), 'ar') || a.stageLevel - b.stageLevel || (a.semester || 1) - (b.semester || 1) || a.name.localeCompare(b.name, 'ar'))
    : sortByName(rows);

  container.innerHTML = '';
  const page = el(`<div class="page">
    <div class="page-head"><h2>${E.icon} ${E.title}</h2><span class="muted">${rows.length} عنصر</span></div>
    ${E.help ? `<p class="muted">${esc(E.help)}</p>` : ''}
    <div class="toolbar">
      <input type="search" id="q" placeholder="بحث…" value="${esc(f.q)}">
      ${E.deptScoped ? `<select id="dept"><option value="">كل الأقسام</option>${sortByName(store.data.departments).map((d) => `<option value="${d.id}" ${d.id === f.dept ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>` : ''}
      <span class="spacer"></span>
      ${(E.toolbar || []).filter(() => E.canEdit()).map((t, i) => `<button class="btn" data-tb="${i}">${esc(t.label)}</button>`).join('')}
      ${E.canEdit() ? `<button class="btn btn-primary" id="add">＋ إضافة ${E.single}</button>` : ''}
    </div>
    <div class="table-wrap"><table class="data-table">
      <thead><tr>${E.columns.map(([, h]) => `<th>${esc(h)}</th>`).join('')}<th></th></tr></thead>
      <tbody>${rows.map((r) => `<tr data-id="${esc(r.id)}">${E.columns.map(([k, , raw]) => {
        const v = typeof k === 'function' ? k(r) : r[k];
        return `<td data-label="">${raw ? v : esc(v ?? '')}</td>`;
      }).join('')}
        <td class="actions">${(E.rowActions || []).map((a, i) => `<button class="btn btn-sm" data-ra="${i}">${esc(a.label)}</button>`).join('')}
          ${E.canEdit(r) ? '<button class="btn btn-sm" data-edit>تعديل</button><button class="btn btn-sm btn-danger-ghost" data-del>حذف</button>' : ''}</td></tr>`).join('')
        || `<tr><td colspan="${E.columns.length + 1}" class="empty-state">لا توجد بيانات بعد</td></tr>`}</tbody>
    </table></div>
  </div>`);
  container.appendChild(page);
  // تسميات الأعمدة لعرض البطاقات على الهاتف
  $$('tbody tr', page).forEach((tr) => $$('td', tr).forEach((td, i) => { if (E.columns[i]) td.dataset.label = E.columns[i][1]; }));

  const q = $('#q', page);
  q.oninput = () => { f.q = q.value; clearTimeout(q._t); q._t = setTimeout(() => { renderEntity(container, col); $('#q', container)?.focus(); }, 300); };
  $('#dept', page)?.addEventListener('change', (e) => { f.dept = e.target.value; renderEntity(container, col); });
  $('#add', page)?.addEventListener('click', () => editEntity(col, null));
  $$('[data-tb]', page).forEach((b) => b.onclick = () => E.toolbar[b.dataset.tb].run());
  page.addEventListener('click', async (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const r = byId(col, tr.dataset.id);
    if (e.target.matches('[data-edit]')) editEntity(col, r);
    else if (e.target.matches('[data-del]')) deleteEntity(col, r);
    else if (e.target.matches('[data-ra]')) E.rowActions[e.target.dataset.ra].run(r);
  });
}

export async function editEntity(col, row, preset = {}) {
  const E = ENTITIES[col];
  const fields = E.fields();
  const form = buildForm(fields, { ...preset, ...(row || {}) });
  await modal({
    title: row ? `تعديل ${E.single}` : `إضافة ${E.single}`, body: form, size: 'lg',
    buttons: [{ label: 'حفظ', value: 'save', cls: 'btn-primary' }, { label: 'إلغاء', value: null }],
    onButton: async (v) => {
      if (v !== 'save') return true;
      let data = readForm(form, fields);
      if (E.beforeSave) data = E.beforeSave(data);
      if (!E.canEdit(data)) throw new Error('لا تملك صلاحية الحفظ في هذا القسم');
      await batchWrite([{ op: row ? 'update' : 'set', col, id: row?.id || uid(), data }]);
      toast('تم الحفظ', 'success');
      return true;
    },
  });
}

async function deleteEntity(col, row) {
  const E = ENTITIES[col];
  if (col === 'departments' && (store.data.stages.some((s) => s.deptId === row.id) || store.data.subjects.some((s) => s.deptId === row.id))) {
    toast('لا يمكن حذف قسم يحتوي على مراحل أو مواد. احذفها أولاً.', 'error', 5000);
    return;
  }
  if (col === 'colleges' && store.data.departments.some((d) => d.collegeId === row.id)) {
    toast('لا يمكن حذف كلية تحتوي على أقسام.', 'error');
    return;
  }
  if (!(await confirmDialog(`حذف «${row.name}»؟ ${E.deleteWarning || ''}`, { danger: true, okLabel: 'حذف' }))) return;
  await batchWrite([...(E.onDelete ? E.onDelete(row) : []), { op: 'delete', col, id: row.id }]);
  toast('تم الحذف', 'success');
}

/* =============================== أوقات توفر الأستاذ =============================== */
async function editAvailability(t) {
  if (!ENTITIES.teachers.canEdit(t)) { toast('للعرض فقط', 'warn'); return; }
  const st = settings();
  const days = st.days?.length ? st.days : [1, 2, 3, 4, 5];
  const from = st.dayStart ?? 480, to = st.dayEnd ?? 1200;
  const hours = [];
  for (let m = from; m < to; m += 60) hours.push(m);
  const av = t.availability || {};
  const isOn = (d, m) => (av[d] || []).some(([s, e]) => s <= m && m + 60 <= e);
  const body = el(`<div>
    <p class="muted">حدّد الساعات التي يكون فيها الأستاذ <b>متاحاً</b>. إن تركت الجدول فارغاً يُعتبر متاحاً في كل الأوقات.</p>
    <div class="toolbar"><button class="btn btn-sm" data-fill="all">تحديد الكل</button><button class="btn btn-sm" data-fill="morning">الصباحي فقط</button>
      <button class="btn btn-sm" data-fill="evening">المسائي فقط</button><button class="btn btn-sm" data-fill="none">مسح (متاح دائماً)</button></div>
    <div class="table-wrap"><table class="avail">
      <thead><tr><th></th>${hours.map((m) => `<th>${formatTime(m)}</th>`).join('')}</tr></thead>
      <tbody>${days.map((d) => `<tr><th>${DAY_NAMES[d]}</th>${hours.map((m) => `<td><button class="av ${isOn(d, m) ? 'on' : ''}" data-d="${d}" data-m="${m}" aria-label="${DAY_NAMES[d]} ${formatTime(m)}"></button></td>`).join('')}</tr>`).join('')}</tbody>
    </table></div></div>`);
  let painting = null;
  body.addEventListener('pointerdown', (e) => {
    if (!e.target.classList.contains('av')) return;
    painting = !e.target.classList.contains('on');
    e.target.classList.toggle('on', painting);
  });
  body.addEventListener('pointerover', (e) => { if (painting !== null && e.target.classList.contains('av')) e.target.classList.toggle('on', painting); });
  document.addEventListener('pointerup', () => { painting = null; });
  $$('[data-fill]', body).forEach((b) => b.onclick = () => {
    const sh = st.shifts || {};
    $$('.av', body).forEach((c) => {
      const m = Number(c.dataset.m);
      const k = b.dataset.fill;
      c.classList.toggle('on', k === 'all' || (k !== 'none' && sh[k] && m >= sh[k].start && m + 60 <= sh[k].end));
    });
  });
  await modal({
    title: `أوقات توفر: ${t.name}`, body, size: 'lg',
    buttons: [{ label: 'حفظ', value: 'save', cls: 'btn-primary' }, { label: 'إلغاء', value: null }],
    onButton: async (v) => {
      if (v !== 'save') return true;
      const out = {};
      $$('.av.on', body).forEach((c) => {
        const d = c.dataset.d, m = Number(c.dataset.m);
        (out[d] = out[d] || []).push([m, m + 60]);
      });
      for (const d of Object.keys(out)) {
        out[d] = out[d].sort((a, b) => a[0] - b[0]).reduce((acc, r) => {
          const last = acc[acc.length - 1];
          if (last && last[1] === r[0]) last[1] = r[1]; else acc.push(r);
          return acc;
        }, []);
      }
      await batchWrite([{ op: 'update', col: 'teachers', id: t.id, data: { availability: out } }]);
      toast('تم حفظ أوقات التوفر', 'success');
      return true;
    },
  });
}

/* =============================== المراحل والشعب =============================== */
export function renderStages(container) {
  const deptF = filters.stages || (filters.stages = { dept: myDeptId() || store.data.departments[0]?.id || '' });
  const depts = sortByName(store.data.departments);
  const deptId = deptF.dept;
  const canE = canEditDept(deptId);
  const stages = store.data.stages.filter((s) => s.deptId === deptId).sort((a, b) => a.level - b.level);
  container.innerHTML = '';
  const page = el(`<div class="page">
    <div class="page-head"><h2>🎓 المراحل الدراسية والشعب</h2></div>
    <p class="muted">يمكن تقسيم كل مرحلة إلى أكثر من شعبة/مجموعة، ولكل شعبة نوع دراسة (صباحي أو مسائي) وعدد طلبة. مثال: «أ - صباحي»، «ب - صباحي»، «مسائي».</p>
    <div class="toolbar">
      <select id="dept">${depts.map((d) => `<option value="${d.id}" ${d.id === deptId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
      <span class="spacer"></span>
      ${canE ? '<button class="btn btn-primary" id="addStage">＋ إضافة مرحلة</button>' : ''}
    </div>
    <div class="cards">${stages.map((st) => {
      const gs = store.data.groups.filter((g) => g.stageId === st.id).sort((a, b) => (a.shift || '').localeCompare(b.shift || '') || String(a.name).localeCompare(String(b.name), 'ar'));
      return `<div class="card" data-stage="${st.id}">
        <div class="card-head"><h3>${esc(st.name || `المرحلة ${STAGE_NAMES[st.level]}`)}</h3>
          ${canE ? `<div><button class="btn btn-sm" data-edit-stage>تعديل</button><button class="btn btn-sm btn-danger-ghost" data-del-stage>حذف</button></div>` : ''}</div>
        <table class="mini-table"><thead><tr><th>الشعبة</th><th>الدراسة</th><th>الطلبة</th><th></th></tr></thead><tbody>
        ${gs.map((g) => `<tr data-group="${g.id}"><td>${esc(g.name)}</td><td><span class="chip ${g.shift === 'evening' ? 'chip-evening' : 'chip-morning'}">${SHIFTS[g.shift] || ''}</span></td><td>${g.students || 0}</td>
          <td class="actions">${canE ? '<button class="btn btn-sm" data-edit-group>تعديل</button><button class="btn btn-sm btn-danger-ghost" data-del-group>حذف</button>' : ''}</td></tr>`).join('')
          || '<tr><td colspan="4" class="muted">لا توجد شعب</td></tr>'}
        </tbody></table>
        ${canE ? '<button class="btn btn-sm" data-add-group>＋ شعبة / مجموعة</button>' : ''}
      </div>`;
    }).join('') || '<div class="empty-state">لا توجد مراحل لهذا القسم</div>'}</div>
  </div>`);
  container.appendChild(page);
  $('#dept', page).onchange = (e) => { deptF.dept = e.target.value; renderStages(container); };

  const stageFields = [
    { key: 'level', label: 'رقم المرحلة', type: 'select', options: stageLevelOptions(), required: true },
    { key: 'name', label: 'الاسم المعروض', placeholder: 'مثال: المرحلة الأولى' },
  ];
  const groupFields = [
    { key: 'name', label: 'اسم الشعبة/المجموعة', required: true, placeholder: 'مثال: أ أو صباحي' },
    { key: 'shift', label: 'نوع الدراسة', type: 'select', options: Object.entries(SHIFTS).map(([value, label]) => ({ value, label })), required: true, default: 'morning' },
    { key: 'students', label: 'عدد الطلبة', type: 'number', min: 0, default: 0 },
  ];
  const edit = async (title, fields, values, save) => {
    const form = buildForm(fields, values);
    await modal({ title, body: form, buttons: [{ label: 'حفظ', value: 1, cls: 'btn-primary' }, { label: 'إلغاء', value: null }],
      onButton: async (v) => { if (!v) return true; await save(readForm(form, fields)); toast('تم الحفظ', 'success'); return true; } });
  };
  $('#addStage', page)?.addEventListener('click', () => edit('إضافة مرحلة', stageFields, { level: stages.length + 1 }, (v) =>
    batchWrite([{ op: 'set', col: 'stages', id: uid(), data: { deptId, level: Number(v.level), name: v.name || `المرحلة ${STAGE_NAMES[v.level]}` } }])));

  page.addEventListener('click', async (e) => {
    const card = e.target.closest('[data-stage]');
    if (!card) return;
    const st = byId('stages', card.dataset.stage);
    const tr = e.target.closest('[data-group]');
    const g = tr && byId('groups', tr.dataset.group);
    if (e.target.matches('[data-edit-stage]')) edit('تعديل مرحلة', stageFields, st, (v) => batchWrite([{ op: 'update', col: 'stages', id: st.id, data: { level: Number(v.level), name: v.name } }]));
    if (e.target.matches('[data-del-stage]')) {
      const gs = store.data.groups.filter((x) => x.stageId === st.id);
      if (!(await confirmDialog(`حذف ${st.name} وكل شعبها (${gs.length}) ومحاضراتها؟`, { danger: true, okLabel: 'حذف' }))) return;
      const gids = new Set(gs.map((x) => x.id));
      await batchWrite([
        ...store.data.sessions.filter((s) => (s.groupIds || []).some((x) => gids.has(x))).map((s) => ({ op: 'delete', col: 'sessions', id: s.id })),
        ...gs.map((x) => ({ op: 'delete', col: 'groups', id: x.id })),
        { op: 'delete', col: 'stages', id: st.id },
      ]);
    }
    if (e.target.matches('[data-add-group]')) edit(`إضافة شعبة — ${st.name}`, groupFields, {}, (v) =>
      batchWrite([{ op: 'set', col: 'groups', id: uid(), data: { ...v, students: Number(v.students) || 0, stageId: st.id, deptId } }]));
    if (e.target.matches('[data-edit-group]')) edit('تعديل شعبة', groupFields, g, (v) =>
      batchWrite([{ op: 'update', col: 'groups', id: g.id, data: { ...v, students: Number(v.students) || 0 } }]));
    if (e.target.matches('[data-del-group]')) {
      if (!(await confirmDialog(`حذف الشعبة ${groupLabel(g)}؟ ستُزال من محاضراتها.`, { danger: true, okLabel: 'حذف' }))) return;
      const ops = [];
      for (const s of store.data.sessions.filter((x) => (x.groupIds || []).includes(g.id))) {
        const rest = s.groupIds.filter((x) => x !== g.id);
        ops.push(rest.length ? { op: 'update', col: 'sessions', id: s.id, data: { groupIds: rest } } : { op: 'delete', col: 'sessions', id: s.id });
      }
      await batchWrite([...ops, { op: 'delete', col: 'groups', id: g.id }]);
    }
  });
}

/* =============================== استيراد المناهج من Excel =============================== */
const HEADER_MAP = {
  dept: ['القسم'], stage: ['المرحلة'], semester: ['الفصل', 'الفصل الدراسي', 'الكورس'],
  name: ['المادة', 'اسم المادة', 'المادة الدراسية'], code: ['الرمز', 'رمز المادة', 'الكود'],
  th: ['نظري', 'الساعات النظرية', 'ساعات نظري', 'النظري'], pr: ['عملي', 'الساعات العملية', 'ساعات عملي', 'العملي'],
  lab: ['نوع المختبر', 'المختبر'], tt: ['أستاذ النظري', 'التدريسي', 'اسم التدريسي', 'الأستاذ'], pt: ['أستاذ العملي'],
  units: ['الوحدات', 'عدد الوحدات'],
};
const norm = (s) => String(s ?? '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();

export function parseStage(v) {
  const n = Number(v);
  if (n >= 1 && n <= 6) return n;
  const s = norm(v);
  const words = ['الاولي', 'الثانيه', 'الثالثه', 'الرابعه', 'الخامسه', 'السادسه'];
  const alt = ['اول', 'ثاني', 'ثالث', 'رابع', 'خامس', 'سادس'];
  for (let i = 0; i < 6; i++) if (s.includes(words[i]) || s.includes(alt[i])) return i + 1;
  const d = s.match(/\d/);
  return d ? Number(d[0]) : null;
}

function cellText(c) {
  const v = c?.value;
  if (v == null) return '';
  if (typeof v === 'object') return v.richText ? v.richText.map((x) => x.text).join('') : v.result ?? v.text ?? '';
  return String(v);
}

export async function importSubjects() {
  await loadScript(EXCELJS);
  const depts = sortByName(store.data.departments).filter((d) => isAdmin() || d.id === myDeptId());
  const body = el(`<div>
    <p>اختر ملف Excel يحتوي على المناهج. يتعرف النظام تلقائياً على الأعمدة: <b>المادة، المرحلة، الفصل، نظري، عملي</b> (إلزامية) و<b>القسم، الرمز، نوع المختبر، أستاذ النظري، أستاذ العملي</b> (اختيارية). يمكن أن يحتوي الملف على عدة أوراق.</p>
    <div class="form-grid">
      <div class="field"><label>القسم الافتراضي (عند عدم وجود عمود القسم)</label><select id="defDept">${depts.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></div>
      <div class="field"><label>ملف Excel</label><input type="file" id="file" accept=".xlsx"></div>
    </div>
    <div id="preview"></div>
  </div>`);
  let parsed = [];
  $('#file', body).onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      parsed = await readCurriculum(await file.arrayBuffer(), $('#defDept', body).value);
      const newT = new Set(parsed.flatMap((r) => [r.tt, r.pt]).filter((n) => n && !findTeacher(n)));
      $('#preview', body).innerHTML = `<p><b>${parsed.length}</b> مادة جاهزة للاستيراد${newT.size ? ` — سيُضاف ${newT.size} أستاذ جديد` : ''}.</p>
        <div class="table-wrap" style="max-height:300px"><table class="mini-table"><thead><tr><th>القسم</th><th>المرحلة</th><th>الفصل</th><th>المادة</th><th>ن</th><th>ع</th><th>الأستاذ</th></tr></thead><tbody>
        ${parsed.map((r) => `<tr class="${r.exists ? 'muted' : ''}"><td>${esc(deptName(r.deptId))}</td><td>${r.stageLevel}</td><td>${r.semester}</td><td>${esc(r.name)}${r.exists ? ' (تحديث)' : ''}</td><td>${r.theoryHours}</td><td>${r.practicalHours}</td><td>${esc(r.tt || '')}</td></tr>`).join('')}
        </tbody></table></div>`;
    } catch (err) { $('#preview', body).innerHTML = `<div class="issue error">${esc(err.message)}</div>`; }
  };
  await modal({
    title: 'استيراد المناهج الدراسية', body, size: 'lg',
    buttons: [{ label: 'استيراد', value: 1, cls: 'btn-primary' }, { label: 'إلغاء', value: null }],
    onButton: async (v) => {
      if (!v) return true;
      if (!parsed.length) throw new Error('اختر ملفاً صالحاً أولاً');
      const n = await applyCurriculum(parsed);
      toast(`تم استيراد ${n} مادة`, 'success');
      return true;
    },
  });
}

function findTeacher(name) {
  const n = norm(name).replace(/^(د|ا\.?د|م\.?م|م)\.?\s*/, '');
  return store.data.teachers.find((t) => norm(t.name).replace(/^(د|ا\.?د|م\.?م|م)\.?\s*/, '') === n);
}

async function readCurriculum(buffer, defaultDept) {
  const wb = new window.ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const out = [];
  wb.eachSheet((ws) => {
    // البحث عن صف العناوين ضمن أول 15 صف
    let headerRow = null, map = null;
    for (let r = 1; r <= Math.min(15, ws.rowCount); r++) {
      const row = ws.getRow(r);
      const m = {};
      row.eachCell({ includeEmpty: false }, (c, col) => {
        const t = norm(cellText(c));
        for (const [k, names] of Object.entries(HEADER_MAP)) if (!m[k] && names.some((n) => t === norm(n) || (t.startsWith(norm(n)) && t.length < norm(n).length + 6))) m[k] = col;
      });
      if (m.name && (m.th || m.pr)) { headerRow = r; map = m; break; }
    }
    if (!map) return;
    let lastStage = null, lastSem = null, lastDept = null;
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const get = (k) => (map[k] ? cellText(row.getCell(map[k])).trim() : '');
      const name = get('name');
      if (!name) continue;
      const stage = parseStage(get('stage')) || lastStage || parseStage(ws.name);
      const sem = Number(get('semester').match(/\d/)?.[0]) || (norm(get('semester')).includes('ثاني') ? 2 : norm(get('semester')).includes('اول') ? 1 : null) || lastSem || 1;
      let deptId = lastDept || defaultDept;
      if (get('dept')) {
        const dn = norm(get('dept'));
        const d = store.data.departments.find((x) => norm(x.name) === dn || (x.short && dn.includes(norm(x.short))) || norm(x.name).includes(dn));
        if (d) deptId = d.id;
      }
      lastStage = stage; lastSem = sem; lastDept = deptId === defaultDept ? lastDept : deptId;
      if (!stage) continue;
      const th = Number(get('th')) || 0, pr = Number(get('pr')) || 0;
      const exists = store.data.subjects.find((s) => s.deptId === deptId && Number(s.stageLevel) === stage && Number(s.semester || 1) === sem && norm(s.name) === norm(name));
      out.push({ deptId, stageLevel: stage, semester: sem, name, code: get('code'), theoryHours: th, practicalHours: pr, labType: get('lab'), tt: get('tt'), pt: get('pt'), exists });
    }
  });
  if (!out.length) throw new Error('لم يُعثر على جدول مناهج. تأكد من وجود صف عناوين يحتوي «المادة» و«نظري» أو «عملي».');
  return out;
}

async function applyCurriculum(rows) {
  const ops = [];
  const newTeachers = new Map();
  const teacherId = (name, deptId) => {
    if (!name) return null;
    const t = findTeacher(name);
    if (t) return t.id;
    if (!newTeachers.has(norm(name))) {
      const id = uid();
      newTeachers.set(norm(name), id);
      ops.push({ op: 'set', col: 'teachers', id, data: { name, deptId, availability: {} } });
    }
    return newTeachers.get(norm(name));
  };
  for (const r of rows) {
    if (!canEditDept(r.deptId)) continue;
    const data = {
      deptId: r.deptId, stageLevel: r.stageLevel, semester: r.semester, name: r.name, code: r.code || '',
      theoryHours: r.theoryHours, practicalHours: r.practicalHours, labType: r.labType || '',
      theoryTeacherId: teacherId(r.tt, r.deptId) || r.exists?.theoryTeacherId || null,
      practicalTeacherId: teacherId(r.pt, r.deptId) || r.exists?.practicalTeacherId || null,
      combineTheory: r.exists?.combineTheory ?? true, needsReview: false,
    };
    ops.push({ op: r.exists ? 'update' : 'set', col: 'subjects', id: r.exists?.id || uid(), data });
  }
  await batchWrite(ops);
  return rows.length;
}

async function downloadTemplate() {
  await loadScript(EXCELJS);
  const wb = new window.ExcelJS.Workbook();
  const ws = wb.addWorksheet('المناهج', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws.addRow(['القسم', 'المرحلة', 'الفصل', 'المادة', 'الرمز', 'نظري', 'عملي', 'نوع المختبر', 'أستاذ النظري', 'أستاذ العملي']);
  ws.addRow(['قسم تقنيات الأشعة والسونار', 'الأولى', 1, 'الفيزياء العامة', 'RAD101', 2, 2, 'مختبر فيزياء', 'د. مثال', '']);
  ws.addRow(['قسم تقنيات الأشعة والسونار', 'الأولى', 1, 'اللغة الإنكليزية', 'RAD102', 2, 0, '', '', '']);
  ws.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E6FB8' } }; });
  [30, 10, 8, 36, 10, 8, 8, 18, 24, 24].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const buf = await wb.xlsx.writeBuffer();
  download('نموذج_المناهج.xlsx', new Blob([buf]));
}
