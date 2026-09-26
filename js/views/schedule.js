/**
 * صفحة الجداول: العرض حسب (الشعبة، القسم، الأستاذ، القاعة) مع السحب والإفلات والتعديل الحر للوقت،
 * والكشف الفوري عن التعارضات، والتصدير والطباعة ومشاركة الرابط.
 */
import { store, byId, settings, batchWrite, canEditDept, isAdmin, canEdit, myDeptId, uid } from '../store.js';
import { checkSession, checkAll, hasErrors } from '../conflicts.js';
import { renderGrid, renderList } from '../grid.js';
import { esc, el, $, $$, modal, toast, confirmDialog } from '../ui.js';
import { DAY_NAMES, SESSION_KINDS, SHIFTS, toHHMM, toMinutes, formatRange } from '../timeutil.js';
import {
  ctx, currentTerm, termSessions, sessionsForView, groupsSorted, groupLabel, deptName, sortByName,
  VIEW_TYPES, viewHeader, stageName,
} from '../model.js';
import { exportPDF, exportExcel, printTables } from '../export.js';

const state = {
  type: 'group', id: '', deptId: '',
  mode: window.matchMedia('(max-width: 700px)').matches ? 'list' : 'grid',
};

export function setScheduleView(type, id) { state.type = type; state.id = id; }

/** مفاتيح الاختيار حسب نوع العرض */
function optionsFor(type, deptId) {
  if (type === 'group') return groupsSorted(deptId).map((g) => ({ value: g.id, label: groupLabel(g) }));
  if (type === 'dept') return sortByName(store.data.departments).map((d) => ({ value: d.id, label: d.name }));
  if (type === 'teacher') return sortByName(store.data.teachers).map((t) => ({ value: t.id, label: t.name + (t.deptId ? ` — ${byId('departments', t.deptId)?.short || deptName(t.deptId)}` : '') }));
  if (type === 'room') return sortByName(store.data.rooms).map((r) => ({ value: r.id, label: `${r.name}${r.capacity ? ` (${r.capacity})` : ''}` }));
  return [];
}

export function renderSchedule(container, params = {}, { publicMode = false } = {}) {
  if (params.type && VIEW_TYPES[params.type]) state.type = params.type;
  if (params.id) state.id = params.id;
  if (params.dept) state.deptId = params.dept;
  if (!state.deptId) state.deptId = myDeptId() || store.data.departments[0]?.id || '';
  if (state.type === 'dept' && !state.id) state.id = state.deptId;

  let opts = optionsFor(state.type, state.deptId);
  if (!opts.some((o) => o.value === state.id)) state.id = opts[0]?.value || '';

  const st = settings();
  const editable = !publicMode && canEdit();

  container.innerHTML = '';
  const page = el(`<div class="page schedule-page">
    <div class="page-head no-print">
      <h2>${publicMode ? 'الجداول الدراسية' : 'الجداول الدراسية'}</h2>
      <span class="term-badge">${esc(viewHeader('dept', '').lines.slice(-2).map((x) => x[1]).join(' — '))}</span>
    </div>
    <div class="toolbar no-print">
      <div class="seg" role="tablist">
        ${Object.entries(VIEW_TYPES).map(([k, v]) => `<button class="${k === state.type ? 'active' : ''}" data-type="${k}">${v}</button>`).join('')}
      </div>
      ${state.type === 'group' ? `<select id="deptSel" aria-label="القسم">${sortByName(store.data.departments).map((d) => `<option value="${d.id}" ${d.id === state.deptId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>` : ''}
      <select id="idSel" aria-label="اختيار">${opts.map((o) => `<option value="${esc(o.value)}" ${o.value === state.id ? 'selected' : ''}>${esc(o.label)}</option>`).join('') || '<option value="">لا توجد بيانات</option>'}</select>
      <div class="seg small">
        <button data-mode="grid" class="${state.mode === 'grid' ? 'active' : ''}" title="عرض الشبكة">▦ شبكة</button>
        <button data-mode="list" class="${state.mode === 'list' ? 'active' : ''}" title="عرض القائمة">☰ قائمة</button>
      </div>
      <span class="spacer"></span>
      ${editable ? '<button class="btn btn-primary" id="addBtn">＋ محاضرة</button>' : ''}
      ${editable && isAdmin() ? '<button class="btn" id="extBtn" title="حجز قاعة لكلية أو جهة أخرى">＋ حجز خارجي</button>' : ''}
      <div class="dropdown">
        <button class="btn" id="expBtn">⬇ تصدير / طباعة</button>
        <div class="dropdown-menu" hidden>
          <button data-exp="pdf">PDF — هذا الجدول</button>
          <button data-exp="xlsx">Excel — هذا الجدول</button>
          <button data-exp="print">طباعة هذا الجدول</button>
          <hr>
          <button data-exp="pdf-all">PDF — كل شعب القسم</button>
          <button data-exp="xlsx-all">Excel — كل شعب القسم</button>
          <button data-exp="print-all">طباعة كل شعب القسم</button>
        </div>
      </div>
      <button class="btn" id="shareBtn" title="نسخ رابط العرض للطلبة">🔗 مشاركة</button>
    </div>
    <div id="summary" class="summary no-print"></div>
    <div id="gridBox" class="grid-box"></div>
    ${editable ? '<p class="hint no-print">💡 اسحب المحاضرة لتغيير يومها أو وقتها، واسحب حافتها اليسرى لتغيير مدتها. انقر عليها للتعديل، وانقر مرتين على مكان فارغ لإضافة محاضرة.</p>' : ''}
  </div>`);
  container.appendChild(page);

  // الأحداث
  $$('[data-type]', page).forEach((b) => b.onclick = () => {
    state.type = b.dataset.type;
    state.id = state.type === 'dept' ? state.deptId : '';
    rerender();
  });
  $$('[data-mode]', page).forEach((b) => b.onclick = () => { state.mode = b.dataset.mode; rerender(); });
  $('#deptSel', page)?.addEventListener('change', (e) => { state.deptId = e.target.value; state.id = ''; rerender(); });
  $('#idSel', page).onchange = (e) => {
    state.id = e.target.value;
    if (state.type === 'dept') state.deptId = state.id;
    rerender();
  };
  $('#addBtn', page)?.addEventListener('click', () => openEditor(null, defaultsForView()));
  $('#extBtn', page)?.addEventListener('click', () => openEditor(null, { ...defaultsForView(), kind: 'external', groupIds: [] }));
  $('#shareBtn', page).onclick = () => share();
  const menu = $('.dropdown-menu', page);
  $('#expBtn', page).onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
  document.addEventListener('click', () => { menu.hidden = true; }, { once: true });
  $$('[data-exp]', page).forEach((b) => b.onclick = () => doExport(b.dataset.exp));

  function rerender() { renderSchedule(container, {}, { publicMode }); }

  // المحتوى
  const sessions = sessionsForView(state.type, state.id);
  const all = termSessions();
  const c = ctx();
  const conflicts = checkAll(all, c);
  const days = st.days?.length ? st.days : [1, 2, 3, 4, 5];
  const box = $('#gridBox', page);

  if (!state.id) {
    box.innerHTML = '<div class="empty-state">لا توجد بيانات للعرض. أضف البيانات الأساسية أولاً.</div>';
  } else if (state.type === 'dept') {
    // عرض القسم: جدول لكل شعبة من شعب القسم
    const groups = groupsSorted(state.id);
    if (!groups.length) box.innerHTML = '<div class="empty-state">لا توجد شعب في هذا القسم</div>';
    for (const g of groups) {
      const sec = el(`<section class="dept-section"><h3 class="dept-sec-title">${esc(groupLabel(g))} <small class="muted">(${g.students || 0} طالب)</small></h3></section>`);
      sec.appendChild(draw(sessionsForView('group', g.id), 'group'));
      box.appendChild(sec);
    }
    const loose = sessions.filter((s) => !(s.groupIds || []).length);
    if (loose.length) {
      const sec = el('<section class="dept-section"><h3 class="dept-sec-title">محاضرات غير مرتبطة بشعبة</h3></section>');
      sec.appendChild(draw(loose, 'dept'));
      box.appendChild(sec);
    }
  } else {
    box.appendChild(draw(sessions, state.type));
  }

  function draw(list, viewType) {
    if (state.mode === 'list') return renderList({ sessions: list, viewType, days, conflicts, onOpen: (s) => openEditor(s) });
    return renderGrid({
      sessions: list, viewType, days,
      dayStart: st.dayStart ?? 480, dayEnd: st.dayEnd ?? 1200, step: st.slotMinutes || 30,
      conflicts,
      canDrag: (s) => editable && canModify(s),
      onOpen: (s) => openEditor(s),
      onMove: editable ? moveSession : null,
      validate: (s, pos) => checkSession({ ...s, ...pos }, termSessions(), ctx()),
      onCreate: editable ? (pos) => openEditor(null, { ...defaultsForView(), day: pos.day, start: pos.start, end: pos.start + 120 }) : null,
    });
  }

  // الملخص
  const viewIssues = sessions.flatMap((s) => conflicts.get(s.id) || []);
  const errs = viewIssues.filter((i) => i.level === 'error').length;
  const warns = viewIssues.length - errs;
  const hours = sessions.reduce((n, s) => n + (s.end - s.start) / 60, 0);
  const sum = $('#summary', page);
  sum.innerHTML = `
    <span class="chip">📚 ${sessions.length} محاضرة</span>
    <span class="chip">⏱ ${hours.toFixed(1).replace('.0', '')} ساعة أسبوعياً</span>
    ${errs ? `<span class="chip chip-error">⛔ ${errs} تعارض</span>` : '<span class="chip chip-ok">✓ لا توجد تعارضات</span>'}
    ${warns ? `<span class="chip chip-warn">⚠️ ${warns} تنبيه</span>` : ''}`;
  if (state.type === 'group' && state.id && !publicMode) sum.appendChild(coverage(state.id, sessions));

  function canModify(s) {
    if (publicMode) return false;
    if (s.kind === 'external') return isAdmin();
    return canEditDept(s.deptId);
  }

  function defaultsForView() {
    const d = { kind: 'theory', day: days[0], start: st.shifts?.morning?.start ?? 480, end: (st.shifts?.morning?.start ?? 480) + 120, groupIds: [] };
    if (state.type === 'group') {
      const g = byId('groups', state.id);
      d.groupIds = g ? [g.id] : [];
      d.deptId = g?.deptId;
      if (g?.shift === 'evening' && st.shifts?.evening) { d.start = st.shifts.evening.start; d.end = d.start + 120; }
    } else if (state.type === 'dept') d.deptId = state.id;
    else if (state.type === 'teacher') { d.teacherId = state.id; d.deptId = byId('teachers', state.id)?.deptId; }
    else if (state.type === 'room') d.roomId = state.id;
    if (!d.deptId) d.deptId = myDeptId() || state.deptId;
    return d;
  }

  async function moveSession(s, pos) {
    const issues = checkSession({ ...s, ...pos }, termSessions(), ctx());
    if (hasErrors(issues)) {
      toast(`لا يمكن النقل: ${issues.find((i) => i.level === 'error').message}`, 'error', 6000);
      rerender();
      return;
    }
    try {
      await batchWrite([{ op: 'update', col: 'sessions', id: s.id, data: { ...pos, auto: false } }]);
      toast(`تم النقل إلى ${DAY_NAMES[pos.day]} ${formatRange(pos.start, pos.end)}${issues.length ? ' (مع تنبيهات)' : ''}`, issues.length ? 'warn' : 'success');
    } catch (e) { toast('تعذر الحفظ: ' + e.message, 'error'); rerender(); }
  }

  function tablesForExport(all) {
    if (!all) {
      if (state.type === 'dept') return groupsSorted(state.id).map((g) => ({ type: 'group', id: g.id }));
      return [{ type: state.type, id: state.id }];
    }
    const deptId = state.type === 'dept' ? state.id : state.type === 'group' ? byId('groups', state.id)?.deptId : state.deptId;
    return groupsSorted(deptId).map((g) => ({ type: 'group', id: g.id }));
  }

  async function doExport(kind) {
    menu.hidden = true;
    const allMode = kind.endsWith('-all');
    const tables = tablesForExport(allMode);
    if (!tables.length || !tables[0].id) { toast('لا يوجد جدول للتصدير', 'warn'); return; }
    const name = (allMode ? `جداول ${deptName(byId('groups', tables[0].id)?.deptId)}` : viewHeader(state.type, state.id).title).replace(/[\\/:*?"<>|]/g, '-');
    try {
      toast('جارٍ التجهيز…');
      if (kind.startsWith('pdf')) await exportPDF(tables, name);
      else if (kind.startsWith('xlsx')) await exportExcel(tables, name);
      else printTables(tables);
    } catch (e) { toast(e.message, 'error'); }
  }

  function share() {
    const url = `${location.origin}${location.pathname}#/public?type=${state.type}&id=${encodeURIComponent(state.id)}`;
    const body = el(`<div>
      <p>أرسل هذا الرابط للطلبة أو الأساتذة. يعرض الجدول للقراءة فقط ويتحدث تلقائياً عند أي تعديل.</p>
      <div class="share-row"><input readonly value="${esc(url)}" id="shareUrl"><button class="btn btn-primary" id="copyBtn">نسخ</button></div>
      <p class="muted">رابط عام لكل الجداول: <code>${esc(`${location.origin}${location.pathname}#/public`)}</code></p>
    </div>`);
    $('#copyBtn', body).onclick = async () => {
      try { await navigator.clipboard.writeText(url); toast('تم نسخ الرابط', 'success'); } catch { $('#shareUrl', body).select(); }
    };
    modal({ title: 'مشاركة الجدول', body });
  }

  return { rerender };
}

/** شريط تغطية الساعات: الساعات المطلوبة لكل مادة مقابل المجدولة للشعبة */
function coverage(groupId, sessions) {
  const g = byId('groups', groupId);
  const stage = byId('stages', g?.stageId);
  const sem = Number(settings().semester || 1);
  const subjects = store.data.subjects.filter((s) => s.deptId === g?.deptId && Number(s.stageLevel) === Number(stage?.level) && Number(s.semester || sem) === sem);
  if (!subjects.length) return el('<span></span>');
  const rows = subjects.map((s) => {
    const done = (kind) => sessions.filter((x) => x.subjectId === s.id && x.kind === kind).reduce((n, x) => n + (x.end - x.start) / 60, 0);
    const th = done('theory'), pr = done('practical');
    const ok = th >= (s.theoryHours || 0) && pr >= (s.practicalHours || 0);
    return `<tr class="${ok ? '' : 'miss'}"><td>${esc(s.name)}</td><td>${th}/${s.theoryHours || 0}</td><td>${pr}/${s.practicalHours || 0}</td><td>${ok ? '✓' : '✗'}</td></tr>`;
  });
  const missing = rows.filter((r) => r.includes('class="miss"')).length;
  const d = el(`<details class="coverage"><summary class="chip ${missing ? 'chip-warn' : 'chip-ok'}">📋 تغطية المواد: ${subjects.length - missing}/${subjects.length}</summary>
    <table class="mini-table"><thead><tr><th>المادة</th><th>نظري (مجدول/مطلوب)</th><th>عملي</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table></details>`);
  return d;
}

/* ============================ نافذة تحرير المحاضرة ============================ */
export async function openEditor(session, defaults = {}) {
  const isNew = !session;
  const s = { ...(defaults || {}), ...(session || {}) };
  const st = settings();
  const readOnly = !canEdit() || (!isNew && (s.kind === 'external' ? !isAdmin() : !canEditDept(s.deptId)));
  const days = st.days?.length ? st.days : [1, 2, 3, 4, 5];
  const step = st.slotMinutes || 30;
  const myDept = myDeptId();
  const depts = sortByName(store.data.departments).filter((d) => !myDept || d.id === myDept || isAdmin());

  const body = el(`<div class="session-editor">
    <div class="form-grid">
      <div class="field"><label>نوع المحاضرة</label>
        <select name="kind">${Object.entries(SESSION_KINDS).filter(([k]) => k !== 'external' || isAdmin() || s.kind === 'external').map(([k, v]) => `<option value="${k}" ${s.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field" data-for="normal"><label>القسم</label>
        <select name="deptId">${depts.map((d) => `<option value="${d.id}" ${d.id === s.deptId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></div>
      <div class="field full" data-for="normal"><label>المادة <span class="req">*</span></label><select name="subjectId"></select></div>
      <div class="field full" data-for="external"><label>الغرض / اسم النشاط <span class="req">*</span></label><input name="title" value="${esc(s.title || '')}" placeholder="مثال: محاضرة كلية الصيدلة"></div>
      <div class="field full" data-for="external"><label>الجهة الحاجزة</label><input name="bookedBy" value="${esc(s.bookedBy || '')}" placeholder="مثال: كلية الصيدلة — قسم ..."></div>
      <div class="field full" data-for="normal"><label>الشعب / المجموعات</label><div class="checklist" id="groupsBox"></div>
        <small class="muted">اختر أكثر من شعبة لمحاضرة مشتركة (مثلاً النظري لكل شعب المرحلة).</small></div>
      <div class="field" data-for="normal"><label>الأستاذ</label><select name="teacherId"></select></div>
      <div class="field"><label>القاعة / المختبر</label><select name="roomId"></select></div>
      <div class="field"><label>اليوم</label><select name="day">${days.map((d) => `<option value="${d}" ${d === s.day ? 'selected' : ''}>${DAY_NAMES[d]}</option>`).join('')}</select></div>
      <div class="field"><label>من الساعة</label><input type="time" name="start" step="${step * 60}" value="${toHHMM(s.start ?? 480)}"></div>
      <div class="field"><label>إلى الساعة</label><input type="time" name="end" step="${step * 60}" value="${toHHMM(s.end ?? 600)}"></div>
      <div class="field"><label>&nbsp;</label><label class="chk"><input type="checkbox" name="locked" ${s.locked ? 'checked' : ''}> 🔒 تثبيت (لا يغيّرها التوليد التلقائي)</label></div>
      <div class="field full"><label>ملاحظة</label><input name="note" value="${esc(s.note || '')}"></div>
    </div>
    <div id="issues" class="issues"></div>
    ${s.updatedBy ? `<p class="muted small">آخر تعديل: ${esc(s.updatedBy)} — ${new Date(s.updatedAt).toLocaleString('ar-IQ')}</p>` : ''}
  </div>`);
  const f = (n) => body.querySelector(`[name="${n}"]`);

  function refreshKind() {
    const ext = f('kind').value === 'external';
    $$('[data-for="normal"]', body).forEach((x) => { x.hidden = ext; });
    $$('[data-for="external"]', body).forEach((x) => { x.hidden = !ext; });
  }
  function refreshSubjects() {
    const deptId = f('deptId').value;
    const subs = store.data.subjects.filter((x) => x.deptId === deptId)
      .sort((a, b) => (a.stageLevel - b.stageLevel) || (a.semester - b.semester) || a.name.localeCompare(b.name, 'ar'));
    f('subjectId').innerHTML = '<option value="">— اختر المادة —</option>' + subs.map((x) =>
      `<option value="${x.id}" ${x.id === s.subjectId ? 'selected' : ''}>${esc(x.name)} — ${esc(stageName({ level: x.stageLevel }))} — الفصل ${x.semester || 1} — نظري ${x.theoryHours || 0}، عملي ${x.practicalHours || 0}</option>`).join('');
  }
  function refreshGroups() {
    const deptId = f('deptId').value;
    const chosen = new Set(currentGroups().length ? currentGroups() : s.groupIds || []);
    $('#groupsBox', body).innerHTML = groupsSorted(deptId).map((g) =>
      `<label class="chk"><input type="checkbox" value="${g.id}" ${chosen.has(g.id) ? 'checked' : ''}> ${esc(groupLabel(g))} <small class="muted">(${g.students || 0})</small></label>`).join('') || '<span class="muted">لا توجد شعب</span>';
  }
  const currentGroups = () => $$('#groupsBox input:checked', body).map((i) => i.value);
  function refreshTeachers() {
    const deptId = f('deptId').value;
    const ts = sortByName(store.data.teachers);
    const own = ts.filter((t) => t.deptId === deptId), other = ts.filter((t) => t.deptId !== deptId);
    const opt = (t) => `<option value="${t.id}" ${t.id === s.teacherId ? 'selected' : ''}>${esc(t.name)}</option>`;
    f('teacherId').innerHTML = '<option value="">— بدون —</option>' +
      (own.length ? `<optgroup label="أساتذة القسم">${own.map(opt).join('')}</optgroup>` : '') +
      (other.length ? `<optgroup label="أساتذة من أقسام أخرى">${other.map(opt).join('')}</optgroup>` : '');
  }
  function refreshRooms() {
    const rs = sortByName(store.data.rooms);
    const grp = (type, label) => {
      const list = rs.filter((r) => (r.type || 'hall') === type);
      return list.length ? `<optgroup label="${label}">${list.map((r) => `<option value="${r.id}" ${r.id === s.roomId ? 'selected' : ''}>${esc(r.name)}${r.capacity ? ` (سعة ${r.capacity})` : ''}${r.labKind ? ` — ${esc(r.labKind)}` : ''}</option>`).join('')}</optgroup>` : '';
    };
    f('roomId').innerHTML = '<option value="">— بدون —</option>' + grp('hall', 'القاعات') + grp('lab', 'المختبرات') + grp('other', 'أخرى');
  }
  function values() {
    const kind = f('kind').value;
    const v = {
      kind, day: Number(f('day').value), start: toMinutes(f('start').value), end: toMinutes(f('end').value),
      roomId: f('roomId').value || null, locked: f('locked').checked, note: f('note').value.trim(), term: s.term || currentTerm(),
    };
    if (kind === 'external') Object.assign(v, { title: f('title').value.trim(), bookedBy: f('bookedBy').value.trim(), groupIds: [], teacherId: null, subjectId: null, deptId: null });
    else Object.assign(v, { deptId: f('deptId').value, subjectId: f('subjectId').value || null, groupIds: currentGroups(), teacherId: f('teacherId').value || null });
    return v;
  }
  function refreshIssues() {
    const v = { ...values(), id: s.id || '__new__' };
    const issues = checkSession(v, termSessions(), ctx());
    $('#issues', body).innerHTML = issues.length
      ? issues.map((i) => `<div class="issue ${i.level}">${i.level === 'error' ? '⛔' : '⚠️'} ${esc(i.message)}</div>`).join('')
      : '<div class="issue ok">✓ لا توجد تعارضات</div>';
    return issues;
  }

  refreshKind(); refreshSubjects(); refreshGroups(); refreshTeachers(); refreshRooms();
  f('kind').onchange = () => { refreshKind(); refreshIssues(); };
  f('deptId').onchange = () => { refreshSubjects(); refreshGroups(); refreshTeachers(); refreshIssues(); };
  f('subjectId').onchange = () => {
    const sub = byId('subjects', f('subjectId').value);
    if (sub) {
      // اقتراح الأستاذ والشعب تلقائياً من بيانات المادة
      const tid = f('kind').value === 'practical' ? (sub.practicalTeacherId || sub.theoryTeacherId) : (sub.theoryTeacherId || sub.practicalTeacherId);
      if (tid && !f('teacherId').value) f('teacherId').value = tid;
      if (!currentGroups().length) {
        const stage = store.data.stages.find((x) => x.deptId === sub.deptId && Number(x.level) === Number(sub.stageLevel));
        $$('#groupsBox input', body).forEach((i) => { i.checked = byId('groups', i.value)?.stageId === stage?.id; });
      }
    }
    refreshIssues();
  };
  body.addEventListener('change', refreshIssues);
  body.addEventListener('input', (e) => { if (e.target.type === 'time') refreshIssues(); });
  refreshIssues();

  if (readOnly) $$('input,select', body).forEach((x) => { x.disabled = true; });

  const buttons = readOnly ? [{ label: 'إغلاق', value: null }] : [
    { label: isNew ? 'إضافة' : 'حفظ', value: 'save', cls: 'btn-primary' },
    ...(!isNew ? [{ label: 'نسخ', value: 'dup' }, { label: 'حذف', value: 'del', cls: 'btn-danger' }] : []),
    { label: 'إلغاء', value: null },
  ];
  await modal({
    title: isNew ? 'إضافة محاضرة' : readOnly ? 'تفاصيل المحاضرة' : 'تعديل المحاضرة', body, size: 'lg', buttons,
    onButton: async (val) => {
      if (val === 'del') {
        if (!(await confirmDialog('هل تريد حذف هذه المحاضرة؟', { danger: true, okLabel: 'حذف' }))) return false;
        await batchWrite([{ op: 'delete', col: 'sessions', id: s.id }]);
        toast('تم الحذف', 'success');
        return true;
      }
      if (val === 'save' || val === 'dup') {
        const v = values();
        if (v.kind === 'external' && !v.title) throw new Error('اكتب غرض الحجز');
        if (v.kind === 'external' && !v.roomId) throw new Error('اختر القاعة المحجوزة');
        if (v.kind !== 'external' && !v.subjectId) throw new Error('اختر المادة');
        if (v.kind !== 'external' && !canEditDept(v.deptId)) throw new Error('لا تملك صلاحية التعديل على هذا القسم');
        const issues = refreshIssues();
        if (val === 'dup') {
          // النسخة تبدأ مباشرة بعد المحاضرة الحالية
          const dur = v.end - v.start;
          v.start = v.end; v.end = v.start + dur;
          const dupIssues = checkSession({ ...v, id: '__dup__' }, termSessions(), ctx());
          if (hasErrors(dupIssues)) throw new Error(`لا يمكن إنشاء النسخة بعد المحاضرة مباشرة: ${dupIssues.find((i) => i.level === 'error').message}`);
          await batchWrite([{ op: 'set', col: 'sessions', id: uid(), data: { ...v, auto: false } }]);
          toast('تم إنشاء نسخة بعد المحاضرة مباشرة — اسحبها إلى المكان المناسب', 'success');
          return true;
        }
        if (hasErrors(issues)) throw new Error('لا يمكن الحفظ بسبب وجود تعارض. عدّل الوقت أو القاعة أو الأستاذ.');
        await batchWrite([{ op: isNew ? 'set' : 'update', col: 'sessions', id: s.id || uid(), data: { ...v, auto: false } }]);
        toast(isNew ? 'تمت الإضافة' : 'تم الحفظ', 'success');
        return true;
      }
      return true;
    },
  });
}

export { SHIFTS };
