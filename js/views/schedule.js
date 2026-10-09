/**
 * صفحة الجداول: العرض حسب (الشعبة، القسم، الأستاذ، القاعة) مع السحب والإفلات والتعديل الحر للوقت،
 * والكشف الفوري عن التعارضات، والتصدير والطباعة ومشاركة الرابط.
 */
import { store, byId, settings, batchWrite, canEditDept, isAdmin, canEdit, myDeptId, uid, collegeOfDept } from '../store.js';
import { checkSession, checkAll, hasErrors } from '../conflicts.js';
import { renderGrid, renderList } from '../grid.js';
import { esc, el, $, $$, modal, toast, confirmDialog } from '../ui.js';
import { DAY_NAMES, SESSION_KINDS, SHIFTS, toHHMM, toMinutes, formatRange } from '../timeutil.js';
import {
  ctx, currentTerm, termSessions, sessionsForView, groupsSorted, groupLabel, deptName, sortByName,
  VIEW_TYPES, viewHeader, stageName, currentCollegeId, setCurrentCollege, managedColleges, deptsOfCollege, deptOptionsHTML,
  collegeName, collegeShort,
} from '../model.js';
import { exportPDF, exportExcel, printTables } from '../export.js';

const state = {
  type: 'group', id: '', deptId: '',
  mode: window.matchMedia('(max-width: 700px)').matches ? 'list' : 'grid',
};

export function setScheduleView(type, id) { state.type = type; state.id = id; }

/** ترتيب عناصر مشتركة (أساتذة/قاعات) بحسب الكلية: الكلية المختارة أولاً */
function byCollegeGroups(items, collegeOf, label, cur) {
  const order = new Map(managedColleges().map((c, i) => [c.id, i]));
  const rank = (cid) => (cid && cid === cur ? -1 : order.get(cid) ?? 999);
  return sortByName(items)
    .map((x) => ({ x, cid: collegeOf(x) || '' }))
    .sort((a, b) => rank(a.cid) - rank(b.cid))
    .map(({ x, cid }) => ({ value: x.id, label: label(x), group: cid ? collegeName(cid) : 'مشترك / بدون كلية' }));
}

/** مفاتيح الاختيار حسب نوع العرض */
function optionsFor(type, deptId, cur) {
  if (type === 'group') return groupsSorted(deptId).map((g) => ({ value: g.id, label: groupLabel(g) }));
  if (type === 'dept') return deptsOfCollege(cur).map((d) => ({ value: d.id, label: d.name, group: cur ? '' : collegeName(d.collegeId) }));
  if (type === 'college') return managedColleges().map((c) => ({ value: c.id, label: c.name }));
  if (type === 'teacher') {
    return byCollegeGroups(store.data.teachers, (t) => collegeOfDept(t.deptId),
      (t) => t.name + (t.deptId ? ` — ${byId('departments', t.deptId)?.short || deptName(t.deptId)}` : ''), cur);
  }
  if (type === 'room') return byCollegeGroups(store.data.rooms, (r) => r.collegeId, (r) => `${r.name}${r.capacity ? ` (${r.capacity})` : ''}`, cur);
  return [];
}

function optionsHTML(opts, selected) {
  const one = (o) => `<option value="${esc(o.value)}" ${o.value === selected ? 'selected' : ''}>${esc(o.label)}</option>`;
  const groups = [...new Set(opts.map((o) => o.group || ''))];
  if (groups.length <= 1) return opts.map(one).join('');
  return groups.map((g) => `<optgroup label="${esc(g)}">${opts.filter((o) => (o.group || '') === g).map(one).join('')}</optgroup>`).join('');
}

export function renderSchedule(container, params = {}, { publicMode = false } = {}) {
  if (params.type && VIEW_TYPES[params.type]) state.type = params.type;
  if (params.id) state.id = params.id;
  if (params.dept) state.deptId = params.dept;
  // روابط المشاركة تحدد الكلية والقسم تلقائياً من الجدول المطلوب
  if (params.id) {
    const linkCollege = viewHeader(state.type, state.id).collegeId;
    if (linkCollege && linkCollege !== currentCollegeId()) {
      setCurrentCollege(linkCollege);
      window.dispatchEvent(new Event('siraj:college'));
    }
    if (state.type === 'group') state.deptId = byId('groups', state.id)?.deptId || state.deptId;
  }
  const cur = currentCollegeId();
  const collegeDepts = deptsOfCollege(cur);
  if (!collegeDepts.some((d) => d.id === state.deptId)) state.deptId = '';
  if (!state.deptId) state.deptId = (collegeDepts.some((d) => d.id === myDeptId()) && myDeptId()) || collegeDepts[0]?.id || '';
  if (state.type === 'dept' && !state.id) state.id = state.deptId;
  if (state.type === 'college' && !state.id) state.id = cur || managedColleges()[0]?.id || '';

  let opts = optionsFor(state.type, state.deptId, cur);
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
      ${state.type === 'group' ? `<select id="deptSel" aria-label="القسم">${deptOptionsHTML(state.deptId, { collegeId: cur })}</select>` : ''}
      <select id="idSel" aria-label="اختيار">${optionsHTML(opts, state.id) || '<option value="">لا توجد بيانات</option>'}</select>
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
          <button data-exp="pdf-all">PDF — كل شعب ${state.type === 'college' ? 'الكلية' : 'القسم'}</button>
          <button data-exp="xlsx-all">Excel — كل شعب ${state.type === 'college' ? 'الكلية' : 'القسم'}</button>
          <button data-exp="print-all">طباعة كل شعب ${state.type === 'college' ? 'الكلية' : 'القسم'}</button>
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
    state.id = state.type === 'dept' ? state.deptId : state.type === 'college' ? cur : '';
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
  } else if (state.type === 'dept' || state.type === 'college') {
    // عرض القسم/الكلية: جدول لكل شعبة
    const groups = state.type === 'dept' ? groupsSorted(state.id) : groupsSorted('', { collegeId: state.id });
    if (!groups.length) box.innerHTML = `<div class="empty-state">لا توجد شعب في ${state.type === 'dept' ? 'هذا القسم' : 'هذه الكلية'}</div>`;
    let lastDept = null;
    for (const g of groups) {
      if (state.type === 'college' && g.deptId !== lastDept) {
        lastDept = g.deptId;
        box.appendChild(el(`<h3 class="college-dept-title">${esc(deptName(g.deptId))}</h3>`));
      }
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
    else if (state.type === 'college') d.deptId = deptsOfCollege(state.id).find((x) => canEditDept(x.id))?.id;
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
      if (state.type === 'college') return groupsSorted('', { collegeId: state.id }).map((g) => ({ type: 'group', id: g.id }));
      return [{ type: state.type, id: state.id }];
    }
    if (state.type === 'college') return groupsSorted('', { collegeId: state.id }).map((g) => ({ type: 'group', id: g.id }));
    const deptId = state.type === 'dept' ? state.id : state.type === 'group' ? byId('groups', state.id)?.deptId : state.deptId;
    return groupsSorted(deptId).map((g) => ({ type: 'group', id: g.id }));
  }

  async function doExport(kind) {
    menu.hidden = true;
    const allMode = kind.endsWith('-all');
    const tables = tablesForExport(allMode);
    if (!tables.length || !tables[0].id) { toast('لا يوجد جدول للتصدير', 'warn'); return; }
    const name = (state.type === 'college' ? `جداول ${collegeName(state.id)}`
      : allMode ? `جداول ${deptName(byId('groups', tables[0].id)?.deptId)}` : viewHeader(state.type, state.id).title).replace(/[\\/:*?"<>|]/g, '-');
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
  // الأقسام المعروضة: أقسام كلية المحاضرة فقط (أو الكلية المختارة)، ولغير المدير: الأقسام التي يحق له تعديلها
  const editorCollege = collegeOfDept(s.deptId) || currentCollegeId();
  const deptFilter = (d) => readOnlyDept(d.id) || canEditDept(d.id);
  const readOnlyDept = (id) => !canEdit() || id === s.deptId;

  const body = el(`<div class="session-editor">
    <div class="form-grid">
      <div class="field"><label>نوع المحاضرة</label>
        <select name="kind">${Object.entries(SESSION_KINDS).filter(([k]) => k !== 'external' || isAdmin() || s.kind === 'external').map(([k, v]) => `<option value="${k}" ${s.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field" data-for="normal"><label>${editorCollege ? `القسم — ${esc(collegeShort(editorCollege))}` : 'القسم'}</label>
        <select name="deptId">${deptOptionsHTML(s.deptId, { collegeId: editorCollege, filter: deptFilter })}</select></div>
      <div class="field full" data-for="normal"><label>المادة <span class="req">*</span>
          <small class="muted" id="subjHint"></small></label><select name="subjectId"></select>
        <label class="chk small"><input type="checkbox" id="allSubjects"> عرض كل مواد القسم (كل المراحل والفصول)</label></div>
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
  /** مواد القسم المختار فقط، للفصل الحالي، ولمرحلة الشعب المختارة (ما لم يُطلب عرض الكل) */
  function refreshSubjects() {
    const deptId = f('deptId').value;
    const keep = f('subjectId').value || s.subjectId;
    const sem = Number(st.semester || 1);
    const showAll = $('#allSubjects', body).checked;
    const levels = new Set((currentGroups().length ? currentGroups() : s.groupIds || [])
      .map((gid) => byId('stages', byId('groups', gid)?.stageId)?.level).filter(Boolean).map(Number));
    let subs = store.data.subjects.filter((x) => x.deptId === deptId);
    if (!showAll) subs = subs.filter((x) => Number(x.semester || 1) === sem && (levels.size !== 1 || levels.has(Number(x.stageLevel))) || x.id === keep);
    subs.sort((a, b) => (a.stageLevel - b.stageLevel) || ((a.semester || 1) - (b.semester || 1)) || a.name.localeCompare(b.name, 'ar'));
    const byStage = new Map();
    for (const x of subs) {
      const k = stageName({ level: x.stageLevel });
      if (!byStage.has(k)) byStage.set(k, []);
      byStage.get(k).push(x);
    }
    const opt = (x) => `<option value="${x.id}" ${x.id === keep ? 'selected' : ''}>${esc(x.name)}${showAll ? ` — الفصل ${x.semester || 1}` : ''} — نظري ${x.theoryHours || 0}، عملي ${x.practicalHours || 0}</option>`;
    f('subjectId').innerHTML = `<option value="">${subs.length ? '— اختر المادة —' : '— لا توجد مواد لهذا القسم في هذا الفصل —'}</option>` +
      (byStage.size > 1 ? [...byStage].map(([k, list]) => `<optgroup label="${esc(k)}">${list.map(opt).join('')}</optgroup>`).join('') : subs.map(opt).join(''));
    $('#subjHint', body).textContent = showAll ? '' : `(${levels.size === 1 ? `مواد ${stageName({ level: [...levels][0] })} — ` : ''}الفصل ${sem})`;
  }
  function refreshGroups() {
    const deptId = f('deptId').value;
    const chosen = new Set(currentGroups().length ? currentGroups() : s.groupIds || []);
    $('#groupsBox', body).innerHTML = groupsSorted(deptId).map((g) =>
      `<label class="chk"><input type="checkbox" value="${g.id}" ${chosen.has(g.id) ? 'checked' : ''}> ${esc(groupLabel(g))} <small class="muted">(${g.students || 0})</small></label>`).join('') || '<span class="muted">لا توجد شعب</span>';
  }
  const currentGroups = () => $$('#groupsBox input:checked', body).map((i) => i.value);
  /** الأساتذة مشتركون بين الكليات: أساتذة القسم أولاً ثم الكلية ثم بقية الكليات */
  function refreshTeachers() {
    const deptId = f('deptId').value;
    const cid = collegeOfDept(deptId);
    const keep = f('teacherId').value || s.teacherId;
    const ts = sortByName(store.data.teachers);
    const own = ts.filter((t) => t.deptId === deptId);
    const college = ts.filter((t) => t.deptId !== deptId && cid && collegeOfDept(t.deptId) === cid);
    const other = ts.filter((t) => !own.includes(t) && !college.includes(t));
    const opt = (t, tag = '') => `<option value="${t.id}" ${t.id === keep ? 'selected' : ''}>${esc(t.name)}${tag}</option>`;
    const tagOf = (t) => (t.deptId ? ` — ${esc(collegeShort(collegeOfDept(t.deptId)))}` : '');
    f('teacherId').innerHTML = '<option value="">— بدون —</option>' +
      (own.length ? `<optgroup label="أساتذة القسم">${own.map((t) => opt(t)).join('')}</optgroup>` : '') +
      (college.length ? `<optgroup label="أساتذة الكلية">${college.map((t) => opt(t, ` — ${esc(byId('departments', t.deptId)?.short || deptName(t.deptId))}`)).join('')}</optgroup>` : '') +
      (other.length ? `<optgroup label="أساتذة من كليات أخرى (مشتركون)">${other.map((t) => opt(t, tagOf(t))).join('')}</optgroup>` : '');
  }
  /** القاعات مشتركة على مستوى الجامعة؛ يظهر اسم الكلية المالكة إن كانت غير كلية المحاضرة */
  function refreshRooms() {
    const cid = collegeOfDept(f('deptId').value) || editorCollege;
    const keep = f('roomId').value || s.roomId;
    const rs = sortByName(store.data.rooms).sort((a, b) => (a.collegeId === cid ? 0 : 1) - (b.collegeId === cid ? 0 : 1));
    const grp = (type, label) => {
      const list = rs.filter((r) => (r.type || 'hall') === type && (r.active !== false || r.id === keep));
      return list.length ? `<optgroup label="${label}">${list.map((r) => `<option value="${r.id}" ${r.id === keep ? 'selected' : ''}>${esc(r.name)}${r.capacity ? ` (سعة ${r.capacity})` : ''}${r.labKind ? ` — ${esc(r.labKind)}` : ''}${r.collegeId && r.collegeId !== cid ? ` — ${esc(collegeShort(r.collegeId))}` : ''}</option>`).join('')}</optgroup>` : '';
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

  refreshKind(); refreshGroups(); refreshSubjects(); refreshTeachers(); refreshRooms();
  f('kind').onchange = () => { refreshKind(); refreshIssues(); };
  f('deptId').onchange = () => { refreshGroups(); refreshSubjects(); refreshTeachers(); refreshRooms(); refreshIssues(); };
  $('#allSubjects', body).onchange = () => refreshSubjects();
  $('#groupsBox', body).addEventListener('change', () => refreshSubjects());
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
