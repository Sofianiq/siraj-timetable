/**
 * محرك كشف التعارضات — دوال نقية تُستدعى عند كل إضافة أو سحب أو تعديل لمحاضرة،
 * ويستخدمها كذلك مولّد الجداول التلقائي.
 *
 * أنواع التعارض:
 *   error   (يمنع الحفظ): الأستاذ مشغول، القاعة محجوزة (على مستوى الجامعة)، الشعبة لديها محاضرة أخرى.
 *   warning (تنبيه فقط):  تجاوز سعة القاعة، خارج أوقات توفر الأستاذ، خارج وقت الدوام، نوع القاعة غير مناسب.
 */
import { overlaps, DAY_NAMES, formatRange, collegeHours } from './timeutil.js';
import { subsOf, subsOverlap, subgroupShare } from './subgroups.js';

/**
 * @typedef {Object} Ctx
 * @property {Map<string,Object>} rooms
 * @property {Map<string,Object>} groups
 * @property {Map<string,Object>} teachers
 * @property {Map<string,Object>} subjects
 * @property {Object} settings
 */

/** بناء سياق البحث من مصفوفات البيانات */
export function buildCtx({ rooms = [], groups = [], teachers = [], subjects = [], departments = [], colleges = [], settings = {} }) {
  const toMap = (arr) => new Map(arr.map((x) => [x.id, x]));
  return { rooms: toMap(rooms), groups: toMap(groups), teachers: toMap(teachers), subjects: toMap(subjects),
    departments: toMap(departments), colleges: toMap(colleges), settings };
}

/** أساتذة المحاضرة: الأستاذ الأساسي ثم المشاركون (مختبر يشرف عليه أستاذان مثلاً) */
export const teachersOf = (s) => [...new Set([s?.teacherId, ...(s?.coTeacherIds || [])].filter(Boolean))];

/** وقت دوام الشعبة: دوام كليتها إن حُدِّد في صفحة الكليات، وإلا دوام الجامعة من الإعدادات */
export function shiftWindow(ctx, group) {
  if (!group) return null;
  const dept = ctx.departments?.get(group.deptId);
  return collegeHours(dept && ctx.colleges?.get(dept.collegeId), group.shift) || ctx.settings?.shifts?.[group.shift] || null;
}

/** هل تنتمي المحاضرتان للفترة الدراسية نفسها؟ */
export function sameTerm(a, b) {
  return (a.term || '') === (b.term || '');
}

/** هل تتداخل محاضرتان زمنياً (اليوم نفسه والوقت متداخل والفصل نفسه)؟ */
export function timeClash(a, b) {
  return a.id !== b.id && sameTerm(a, b) && a.day === b.day && overlaps(a.start, a.end, b.start, b.end);
}

function describe(o, ctx) {
  const subj = ctx.subjects.get(o.subjectId);
  const name = subj ? subj.name : o.title || 'محاضرة';
  return `«${name}» (${DAY_NAMES[o.day]} ${formatRange(o.start, o.end)})`;
}

/** مجموع طلبة الشعب المرتبطة بالمحاضرة (أو حصة المجاميع المختارة من الشعبة) */
export function studentCount(session, ctx) {
  return (session.groupIds || []).reduce((sum, gid) => sum + subgroupShare(ctx.groups.get(gid), session), 0);
}

/** هل المجال [start,end) ضمن أوقات توفر الأستاذ في ذلك اليوم؟ (عدم تحديد التوفر = متاح دائماً) */
export function teacherAvailable(teacher, day, start, end) {
  const av = teacher?.availability;
  if (!av || Object.keys(av).length === 0) return true;
  const ranges = av[day] || [];
  // دمج المجالات المتلاصقة ثم التحقق من الاحتواء
  const merged = [...ranges].sort((a, b) => a[0] - b[0]).reduce((acc, r) => {
    const last = acc[acc.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else acc.push([r[0], r[1]]);
    return acc;
  }, []);
  return merged.some(([s, e]) => s <= start && end <= e);
}

/**
 * فحص محاضرة مقترحة مقابل بقية المحاضرات.
 * @param {Object} s المحاضرة (قد تكون جديدة بلا id)
 * @param {Object[]} all كل المحاضرات المخزّنة
 * @param {Ctx} ctx
 * @returns {{level:'error'|'warning', type:string, message:string, otherId?:string}[]}
 */
export function checkSession(s, all, ctx) {
  const issues = [];
  if (!(s.end > s.start)) {
    issues.push({ level: 'error', type: 'time', message: 'وقت نهاية المحاضرة يجب أن يكون بعد وقت بدايتها' });
    return issues;
  }
  const sGroups = new Set(s.groupIds || []);
  const sTeachers = teachersOf(s);

  for (const o of all) {
    if (!timeClash(s, o)) continue;
    const oTeachers = teachersOf(o);
    for (const tid of sTeachers.filter((x) => oTeachers.includes(x))) {
      const t = ctx.teachers.get(tid);
      issues.push({ level: 'error', type: 'teacher', otherId: o.id,
        message: `الأستاذ ${t?.name || ''} مرتبط بمحاضرة أخرى في الوقت نفسه: ${describe(o, ctx)}` });
    }
    if (s.roomId && o.roomId === s.roomId) {
      const r = ctx.rooms.get(s.roomId);
      issues.push({ level: 'error', type: 'room', otherId: o.id,
        message: `${r?.name || 'القاعة'} محجوزة في الوقت نفسه: ${describe(o, ctx)}${o.kind === 'external' ? ' — حجز لجهة أخرى' : ''}` });
    }
    // مجاميع العملي المختلفة من الشعبة نفسها (A و B مثلاً) لا تتعارض
    const shared = (o.groupIds || []).filter((g) => sGroups.has(g) && subsOverlap(s, o));
    if (shared.length) {
      const subs = subsOf(s).filter((x) => !subsOf(o).length || subsOf(o).includes(x));
      const names = shared.map((g) => ctx.groups.get(g)?.name || '').join('، ') + (subs.length ? ` — المجموعة ${subs.join(' + ')}` : '');
      issues.push({ level: 'error', type: 'group', otherId: o.id,
        message: `الشعبة (${names}) لديها محاضرة أخرى في الوقت نفسه: ${describe(o, ctx)}` });
    }
  }

  const room = ctx.rooms.get(s.roomId);
  if (room) {
    const n = studentCount(s, ctx);
    if (room.capacity && n > Number(room.capacity)) {
      issues.push({ level: 'warning', type: 'capacity',
        message: `عدد الطلبة (${n}) يتجاوز سعة ${room.name} (${room.capacity})` });
    }
    // لكل كلية قاعاتها: محاضرة في قاعة مملوكة لكلية أخرى (الحجوزات الخارجية مستثناة)
    const sCollege = ctx.departments?.get(s.deptId)?.collegeId;
    if (s.kind !== 'external' && room.collegeId && sCollege && room.collegeId !== sCollege) {
      const owner = ctx.colleges?.get(room.collegeId);
      issues.push({ level: 'warning', type: 'roomOwner', message: `${room.name} من قاعات ${owner?.name || 'كلية أخرى'}` });
    }
    const subj = ctx.subjects.get(s.subjectId);
    if (s.kind === 'practical' && room.type !== 'lab' && !subj?.practicalInHall) {
      issues.push({ level: 'warning', type: 'roomType', message: `المحاضرة عملية لكن ${room.name} ليست مختبراً` });
    } else if (s.kind === 'practical' && subj?.labType && room.labKind && subj.labType !== room.labKind) {
      issues.push({ level: 'warning', type: 'roomType', message: `المادة تحتاج مختبر «${subj.labType}» و${room.name} مختبر «${room.labKind}»` });
    }
  }

  for (const tid of sTeachers) {
    const teacher = ctx.teachers.get(tid);
    if (teacher && !teacherAvailable(teacher, s.day, s.start, s.end)) {
      issues.push({ level: 'warning', type: 'availability', message: `الوقت خارج أوقات توفر الأستاذ ${teacher.name}` });
    }
  }

  for (const gid of s.groupIds || []) {
    const g = ctx.groups.get(gid);
    const win = shiftWindow(ctx, g);
    if (win && (s.start < win.start || s.end > win.end)) {
      issues.push({ level: 'warning', type: 'shift',
        message: `المحاضرة خارج وقت الدوام ${g.shift === 'evening' ? 'المسائي' : 'الصباحي'} للشعبة ${g.name}` });
      break;
    }
  }
  return issues;
}

/** فحص الجدول كاملاً: يعيد خريطة id → قائمة التعارضات (بدون تكرار الأزواج) */
export function checkAll(sessions, ctx) {
  const result = new Map();
  // تجميع حسب (الفصل، اليوم) لتقليل المقارنات
  const buckets = new Map();
  for (const s of sessions) {
    const k = `${s.term || ''}|${s.day}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(s);
  }
  for (const s of sessions) {
    const issues = checkSession(s, buckets.get(`${s.term || ''}|${s.day}`), ctx);
    if (issues.length) result.set(s.id, issues);
  }
  return result;
}

export function hasErrors(issues) {
  return issues.some((i) => i.level === 'error');
}
