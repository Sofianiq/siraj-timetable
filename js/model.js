/**
 * دوال مساعدة على نموذج البيانات: الأسماء المعروضة، الفصل الحالي، تصفية المحاضرات حسب طريقة العرض.
 */
import { store, byId, settings, collegeOfDept, myCollegeId } from './store.js';
import { buildCtx } from './conflicts.js';
import { STAGE_NAMES, SHIFTS, SEMESTERS } from './timeutil.js';
import { subgroupLabel } from './subgroups.js';

export function currentTerm() {
  const s = settings();
  return `${s.academicYear || ''}/${s.semester || 1}`;
}
/** عزل النص اللاتيني/الرقمي حتى لا ينقلب «2025-2026» داخل النص العربي */
export const ltr = (v) => (v ? `\u2066${v}\u2069` : '');

export function termLabel(term = currentTerm()) {
  const [y, sem] = term.split('/');
  return `${SEMESTERS[sem] || ''} ${y ? `— العام الدراسي ${ltr(y)}` : ''}`.trim();
}

export const termSessions = (term = currentTerm()) => store.data.sessions.filter((s) => (s.term || '') === term);

export function ctx() {
  return buildCtx({
    rooms: store.data.rooms, groups: store.data.groups, teachers: store.data.teachers,
    subjects: store.data.subjects, settings: settings(),
  });
}

export const sortByName = (arr) => [...arr].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));

export function deptName(id) { return byId('departments', id)?.name || ''; }

/* ------------------------------ الكليات ------------------------------ */
const byOrder = (a, b) => (a.order ?? 50) - (b.order ?? 50) || String(a.name).localeCompare(String(b.name), 'ar');
/** الكليات المُدارة في النظام (لها أقسام وجداول) مرتبة */
export const managedColleges = () => store.data.colleges.filter((c) => c.own !== false).sort(byOrder);
export const allCollegesSorted = () => [...store.data.colleges].sort(byOrder);
export function collegeName(id) { return byId('colleges', id)?.name || ''; }
export function collegeShort(id) { const c = byId('colleges', id); return c?.short || c?.name || ''; }
export { collegeOfDept };

/** الكلية المختارة حالياً في أعلى الصفحة ('' = كل الكليات). تُحفظ في متصفح المستخدم. */
const COLLEGE_KEY = 'siraj-current-college';
let currentCollege;
export function currentCollegeId() {
  if (currentCollege === undefined) {
    try { currentCollege = localStorage.getItem(COLLEGE_KEY); } catch { currentCollege = null; }
    if (currentCollege === null) currentCollege = myCollegeId() || '';
  }
  if (currentCollege && !byId('colleges', currentCollege)) currentCollege = '';
  return currentCollege;
}
export function setCurrentCollege(id) {
  currentCollege = id || '';
  try { localStorage.setItem(COLLEGE_KEY, currentCollege); } catch { /* وضع التصفح الخاص */ }
}

/** أقسام كلية معيّنة (أو كل الأقسام إن لم تُحدد) مرتبة حسب الكلية ثم الاسم */
export function deptsOfCollege(collegeId = '') {
  const order = new Map(allCollegesSorted().map((c, i) => [c.id, i]));
  return store.data.departments
    .filter((d) => !collegeId || d.collegeId === collegeId)
    .sort((a, b) => (order.get(a.collegeId) ?? 999) - (order.get(b.collegeId) ?? 999) ||
      (b.general ? 1 : 0) - (a.general ? 1 : 0) || String(a.name).localeCompare(String(b.name), 'ar'));
}

/** خيارات <select> للأقسام مجمّعة حسب الكلية */
export function deptOptionsHTML(selected, { collegeId = '', filter = () => true, placeholder = '' } = {}) {
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const depts = deptsOfCollege(collegeId).filter(filter);
  const groups = new Map();
  for (const d of depts) {
    if (!groups.has(d.collegeId)) groups.set(d.collegeId, []);
    groups.get(d.collegeId).push(d);
  }
  const opt = (d) => `<option value="${esc(d.id)}" ${d.id === selected ? 'selected' : ''}>${esc(d.general ? `${d.name} (الكلية كاملة)` : d.name)}</option>`;
  const body = groups.size <= 1 ? depts.map(opt).join('')
    : [...groups].map(([cid, list]) => `<optgroup label="${esc(collegeName(cid) || 'بدون كلية')}">${list.map(opt).join('')}</optgroup>`).join('');
  return (placeholder ? `<option value="">${esc(placeholder)}</option>` : '') + body;
}
export function stageOf(group) { return group ? byId('stages', group.stageId) : null; }
export function stageName(stage) { return stage ? (stage.name || `المرحلة ${STAGE_NAMES[stage.level] || stage.level}`) : ''; }

/** اسم الشعبة الكامل: المرحلة الأولى / صباحي / أ */
export function groupLabel(g, { withDept = false } = {}) {
  if (!g) return '';
  const st = stageOf(g);
  const parts = [stageName(st), SHIFTS[g.shift] || '', g.name && g.name !== SHIFTS[g.shift] ? g.name : ''].filter(Boolean);
  if (withDept) {
    const d = byId('departments', g.deptId);
    parts.unshift(d?.general ? collegeShort(d.collegeId) || d.name : d?.short || d?.name || '');
  }
  return parts.join(' / ');
}

const shiftOrder = (s) => (s === 'evening' ? 1 : 0);

export function groupsSorted(deptId, { collegeId = '' } = {}) {
  return store.data.groups
    .filter((g) => (!deptId || g.deptId === deptId) && (!collegeId || collegeOfDept(g.deptId) === collegeId))
    .map((g) => ({ g, st: stageOf(g) }))
    .sort((a, b) => deptName(a.g.deptId).localeCompare(deptName(b.g.deptId), 'ar') ||
      (a.st?.level || 0) - (b.st?.level || 0) || shiftOrder(a.g.shift) - shiftOrder(b.g.shift) ||
      String(a.g.name).localeCompare(String(b.g.name), 'ar'))
    .map((x) => x.g);
}

export function teacherName(id) { return byId('teachers', id)?.name || ''; }

/**
 * كادر الكليات: لكل أستاذ كلية أساسية (كلية قسمه)، ويمكن أن يدرّس أيضاً في كليات أخرى (sharedColleges).
 * الأستاذ المشترك سجل واحد، لذلك يمنع النظام تعارض أوقاته بين الكليات كلها.
 */
export const teacherCollege = (t) => collegeOfDept(t?.deptId) || '';
export const teacherColleges = (t) => [...new Set([teacherCollege(t), ...(t?.sharedColleges || [])].filter(Boolean))];
/** هل الأستاذ ضمن كادر الكلية (أساسي أو مشترك)؟ */
export const teachesIn = (t, collegeId) => !collegeId || teacherColleges(t).includes(collegeId);
/** هل الأستاذ مشترك في الكلية من كلية أخرى؟ */
export const sharedInto = (t, collegeId) => !!collegeId && teacherCollege(t) !== collegeId && (t?.sharedColleges || []).includes(collegeId);
export function roomName(id) { return byId('rooms', id)?.name || ''; }
export function subjectName(s) {
  if (s.kind === 'external') return s.title || 'حجز خارجي';
  return byId('subjects', s.subjectId)?.name || s.title || 'محاضرة';
}

/** أنواع العرض */
export const VIEW_TYPES = {
  group: 'المرحلة والشعبة',
  dept: 'القسم',
  college: 'الكلية',
  teacher: 'الأستاذ',
  room: 'القاعة / المختبر',
};

/**
 * محاضرات القسم غير المرتبطة بأي شعبة (بيانات قديمة أو مُدخلة قبل إنشاء الشعب).
 * تُعرض وتُطبع في جدول خاص لكل مرحلة (حسب مرحلة المادة)، معرّفه «القسم|المرحلة».
 */
const isLoose = (s) => s.kind !== 'external' && !(s.groupIds || []).length;
const looseLevel = (s) => String(byId('subjects', s.subjectId)?.stageLevel ?? '');
const looseStage = (deptId, level) => store.data.stages.find((x) => x.deptId === deptId && String(x.level) === level) || (level ? { level: Number(level) } : null);

export function looseKeys(deptId, term = currentTerm()) {
  const levels = new Set(termSessions(term).filter((s) => s.deptId === deptId && isLoose(s)).map(looseLevel));
  return [...levels].sort((a, b) => (Number(a) || 99) - (Number(b) || 99)).map((l) => `${deptId}|${l}`);
}

/** عنوان الجدول الخاص بمحاضرات بلا شعبة */
export function looseLabel(id) {
  const [deptId, level = ''] = String(id).split('|');
  return `${level ? stageName(looseStage(deptId, level)) : 'مرحلة غير محددة'} — محاضرات غير مرتبطة بشعبة`;
}

/** جداول القسم بالترتيب: لكل مرحلة جداول شعبها، ثم جدول محاضراتها غير المرتبطة بشعبة إن وُجدت */
export function deptTables(deptId) {
  if (!deptId) return [];
  const items = [
    ...groupsSorted(deptId).map((g) => ({ level: Number(stageOf(g)?.level) || 0, t: { type: 'group', id: g.id } })),
    ...looseKeys(deptId).map((id) => ({ level: Number(id.split('|')[1]) || 99, t: { type: 'loose', id } })),
  ];
  return items.sort((a, b) => a.level - b.level).map((x) => x.t);
}

/** جداول الكلية: جداول كل قسم بالترتيب */
export function collegeTables(collegeId) {
  return deptsOfCollege(collegeId).flatMap((d) => deptTables(d.id));
}

/** المحاضرات المطلوب عرضها لطريقة عرض ومعرّف */
export function sessionsForView(type, id, term = currentTerm()) {
  const list = termSessions(term);
  if (!id) return [];
  switch (type) {
    case 'group': return list.filter((s) => (s.groupIds || []).includes(id));
    case 'dept': return list.filter((s) => s.deptId === id);
    case 'college': return list.filter((s) => s.deptId && collegeOfDept(s.deptId) === id);
    case 'teacher': return list.filter((s) => s.teacherId === id);
    case 'room': return list.filter((s) => s.roomId === id);
    case 'loose': {
      const [deptId, level = ''] = String(id).split('|');
      return list.filter((s) => s.deptId === deptId && isLoose(s) && looseLevel(s) === level);
    }
    default: return [];
  }
}

/** عنوان ومعلومات ترويسة الجدول (للعرض والتصدير). collegeId يحدد اسم الكلية في رأس الصفحة المطبوعة. */
export function viewHeader(type, id) {
  const s = settings();
  const info = { title: '', lines: [], collegeId: '' };
  const deptLine = (deptId) => {
    const d = byId('departments', deptId);
    return d && !d.general ? [['القسم', d.name]] : [];
  };
  if (type === 'group') {
    const g = byId('groups', id);
    const st = stageOf(g);
    const d = byId('departments', g?.deptId);
    info.collegeId = d?.collegeId || '';
    info.title = `جدول ${stageName(st)} — ${d?.name || ''}`;
    info.lines = [
      ...deptLine(g?.deptId), ['المرحلة', stageName(st)],
      ['نوع الدراسة', SHIFTS[g?.shift] || ''], ['الشعبة', g?.name && g.name !== SHIFTS[g?.shift] ? g.name : ''],
      ['عدد الطلبة', g?.students || '—'],
    ];
  } else if (type === 'dept') {
    info.collegeId = collegeOfDept(id) || '';
    info.title = `الجدول العام — ${deptName(id)}`;
    info.lines = deptLine(id);
  } else if (type === 'loose') {
    const [deptId, level = ''] = String(id).split('|');
    const d = byId('departments', deptId);
    info.collegeId = d?.collegeId || '';
    info.title = level ? `جدول ${stageName(looseStage(deptId, level))} — ${d?.name || ''}` : `محاضرات غير مرتبطة بشعبة — ${d?.name || ''}`;
    info.lines = [...deptLine(deptId), ...(level ? [['المرحلة', stageName(looseStage(deptId, level))]] : [])];
  } else if (type === 'college') {
    info.collegeId = id;
    info.title = `الجدول العام — ${collegeName(id)}`;
  } else if (type === 'teacher') {
    const t = byId('teachers', id);
    info.title = `جدول الأستاذ: ${t?.name || ''}`;
    info.lines = [['الأستاذ', t?.name || ''], ...(t?.title ? [['اللقب العلمي', t.title]] : [])];
  } else if (type === 'room') {
    const r = byId('rooms', id);
    info.collegeId = r?.collegeId || '';
    info.title = `جدول ${r?.name || ''}`;
    info.lines = [['القاعة/المختبر', r?.name || ''], ['السعة', r?.capacity || '—'], ['المبنى', r?.building || '—']];
  }
  info.lines.push(['الفصل الدراسي', SEMESTERS[s.semester] || ''], ['العام الدراسي', ltr(s.academicYear)]);
  return info;
}

/** وصف مختصر لمحاضرة يظهر داخل الخانة */
export function sessionLines(s, viewType, { withSub = true } = {}) {
  const lines = [];
  const kind = s.kind === 'practical' ? 'عملي' : s.kind === 'external' ? 'حجز' : 'نظري';
  const sub = withSub ? subgroupLabel(s) : '';
  lines.push(`${subjectName(s)} (${kind})${sub ? ` — ${sub}` : ''}`);
  if (viewType !== 'teacher' && s.teacherId) lines.push(teacherName(s.teacherId));
  if (viewType !== 'room' && s.roomId) lines.push(roomName(s.roomId));
  if (viewType !== 'group' && s.groupIds?.length) {
    lines.push(s.groupIds.map((gid) => groupLabel(byId('groups', gid), { withDept: viewType !== 'dept' })).join(' + '));
  }
  if (s.kind === 'external' && s.bookedBy) lines.push(s.bookedBy);
  return lines;
}
