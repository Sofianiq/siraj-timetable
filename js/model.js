/**
 * دوال مساعدة على نموذج البيانات: الأسماء المعروضة، الفصل الحالي، تصفية المحاضرات حسب طريقة العرض.
 */
import { store, byId, settings } from './store.js';
import { buildCtx } from './conflicts.js';
import { STAGE_NAMES, SHIFTS, SEMESTERS } from './timeutil.js';

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
export function stageOf(group) { return group ? byId('stages', group.stageId) : null; }
export function stageName(stage) { return stage ? (stage.name || `المرحلة ${STAGE_NAMES[stage.level] || stage.level}`) : ''; }

/** اسم الشعبة الكامل: المرحلة الأولى / صباحي / أ */
export function groupLabel(g, { withDept = false } = {}) {
  if (!g) return '';
  const st = stageOf(g);
  const parts = [stageName(st), SHIFTS[g.shift] || '', g.name && g.name !== SHIFTS[g.shift] ? g.name : ''].filter(Boolean);
  if (withDept) parts.unshift(deptName(g.deptId));
  return parts.join(' / ');
}

const shiftOrder = (s) => (s === 'evening' ? 1 : 0);

export function groupsSorted(deptId) {
  return store.data.groups
    .filter((g) => !deptId || g.deptId === deptId)
    .map((g) => ({ g, st: stageOf(g) }))
    .sort((a, b) => deptName(a.g.deptId).localeCompare(deptName(b.g.deptId), 'ar') ||
      (a.st?.level || 0) - (b.st?.level || 0) || shiftOrder(a.g.shift) - shiftOrder(b.g.shift) ||
      String(a.g.name).localeCompare(String(b.g.name), 'ar'))
    .map((x) => x.g);
}

export function teacherName(id) { return byId('teachers', id)?.name || ''; }
export function roomName(id) { return byId('rooms', id)?.name || ''; }
export function subjectName(s) {
  if (s.kind === 'external') return s.title || 'حجز خارجي';
  return byId('subjects', s.subjectId)?.name || s.title || 'محاضرة';
}

/** أنواع العرض */
export const VIEW_TYPES = {
  group: 'المرحلة والشعبة',
  dept: 'القسم',
  teacher: 'الأستاذ',
  room: 'القاعة / المختبر',
};

/** المحاضرات المطلوب عرضها لطريقة عرض ومعرّف */
export function sessionsForView(type, id, term = currentTerm()) {
  const list = termSessions(term);
  if (!id) return [];
  switch (type) {
    case 'group': return list.filter((s) => (s.groupIds || []).includes(id));
    case 'dept': return list.filter((s) => s.deptId === id);
    case 'teacher': return list.filter((s) => s.teacherId === id);
    case 'room': return list.filter((s) => s.roomId === id);
    default: return [];
  }
}

/** عنوان ومعلومات ترويسة الجدول (للعرض والتصدير) */
export function viewHeader(type, id) {
  const s = settings();
  const info = { title: '', lines: [] };
  if (type === 'group') {
    const g = byId('groups', id);
    const st = stageOf(g);
    info.title = `جدول ${stageName(st)} — ${deptName(g?.deptId)}`;
    info.lines = [
      ['القسم', deptName(g?.deptId)], ['المرحلة', stageName(st)],
      ['نوع الدراسة', SHIFTS[g?.shift] || ''], ['الشعبة', g?.name && g.name !== SHIFTS[g?.shift] ? g.name : ''],
      ['عدد الطلبة', g?.students || '—'],
    ];
  } else if (type === 'dept') {
    info.title = `الجدول العام — ${deptName(id)}`;
    info.lines = [['القسم', deptName(id)]];
  } else if (type === 'teacher') {
    const t = byId('teachers', id);
    info.title = `جدول الأستاذ: ${t?.name || ''}`;
    info.lines = [['الأستاذ', t?.name || ''], ['القسم', deptName(t?.deptId)]];
  } else if (type === 'room') {
    const r = byId('rooms', id);
    info.title = `جدول ${r?.name || ''}`;
    info.lines = [['القاعة/المختبر', r?.name || ''], ['السعة', r?.capacity || '—'], ['المبنى', r?.building || '—']];
  }
  info.lines.push(['الفصل الدراسي', SEMESTERS[s.semester] || ''], ['العام الدراسي', ltr(s.academicYear)]);
  return info;
}

/** وصف مختصر لمحاضرة يظهر داخل الخانة */
export function sessionLines(s, viewType) {
  const lines = [];
  const kind = s.kind === 'practical' ? 'عملي' : s.kind === 'external' ? 'حجز' : 'نظري';
  lines.push(`${subjectName(s)} (${kind})`);
  if (viewType !== 'teacher' && s.teacherId) lines.push(teacherName(s.teacherId));
  if (viewType !== 'room' && s.roomId) lines.push(roomName(s.roomId));
  if (viewType !== 'group' && s.groupIds?.length) {
    lines.push(s.groupIds.map((gid) => groupLabel(byId('groups', gid), { withDept: viewType !== 'dept' })).join(' + '));
  }
  if (s.kind === 'external' && s.bookedBy) lines.push(s.bookedBy);
  return lines;
}
