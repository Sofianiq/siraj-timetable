/**
 * البيانات الأولية التي تُدرج تلقائياً عند أول تشغيل (قاعدة بيانات فارغة): الكليات وأقسامها ومراحلها وشعبها،
 * والمناهج الرسمية لأقسام كلية التقنيات الصحية والطبية مع الكادر التدريسي (js/seed/curriculum.js)،
 * وقاعات ومختبرات نموذجية يجب تعديلها لتطابق الواقع.
 */
import { normName } from '../text.js';
import { curriculumImportPlan } from './curriculum.js';

export { normName };
export const COLLEGE_NAME = 'كلية التقنيات الصحية والطبية';

/**
 * الكليات المُدارة في النظام. يمكن إضافة كليات أخرى لاحقاً من صفحة «الكليات».
 * للكليات التي لا تقسم طلبتها إلى أقسام (مثل الصيدلة وطب الأسنان) يُنشأ «قسم عام» يمثل الكلية كاملة.
 */
export const EXTRA_COLLEGES = [
  { name: 'كلية الصيدلة', short: 'الصيدلة', order: 2, stages: 5 },
  { name: 'كلية طب الأسنان', short: 'طب الأسنان', order: 3, stages: 5 },
];
export const OTHER_COLLEGES_NAME = 'جهات أخرى (خارج النظام)';
export const SCHEMA_VERSION = 5;

export const DEPARTMENTS = [
  { key: 'rad', name: 'قسم تقنيات الأشعة والسونار', short: 'الأشعة' },
  { key: 'ch', name: 'قسم تقنيات صحة المجتمع', short: 'صحة المجتمع' },
  { key: 'an', name: 'قسم تقنيات التخدير', short: 'التخدير' },
  { key: 'dt', name: 'قسم تقنيات صناعة الأسنان', short: 'صناعة الأسنان' },
  { key: 'cos', name: 'قسم تقنيات التجميل', short: 'التجميل' },
];

/** عدد الطلبة المعروف من كشوف الدرجات: مفتاح (مرحلة|دراسة) */
export const RAD_STUDENTS = { '1|morning': 54, '2|morning': 66 };

export const SAMPLE_ROOMS = [
  { name: 'القاعة 1', type: 'hall', capacity: 70 },
  { name: 'القاعة 2', type: 'hall', capacity: 70 },
  { name: 'القاعة 3', type: 'hall', capacity: 60 },
  { name: 'القاعة 4', type: 'hall', capacity: 60 },
  { name: 'مختبر الأشعة', type: 'lab', labKind: 'مختبر أشعة', capacity: 35 },
  { name: 'مختبر التشريح', type: 'lab', labKind: 'مختبر تشريح', capacity: 35 },
  { name: 'مختبر الفسلجة', type: 'lab', labKind: 'مختبر فسلجة', capacity: 35 },
  { name: 'مختبر الفيزياء', type: 'lab', labKind: 'مختبر فيزياء', capacity: 35 },
  { name: 'مختبر الحاسوب', type: 'lab', labKind: 'مختبر حاسوب', capacity: 35 },
  { name: 'مختبر التمريض', type: 'lab', labKind: 'مختبر تمريض', capacity: 35 },
];

/** الدوام الرسمي للكلية: من 8:30 صباحاً إلى 2:30 ظهراً */
export const WORK_HOURS = { start: 510, end: 870 };

export const DEFAULT_SETTINGS = {
  academicYear: '2026-2027',
  semester: 1,
  days: [0, 1, 2, 3, 4],          // السبت → الأربعاء
  dayStart: WORK_HOURS.start,     // 8:30
  dayEnd: WORK_HOURS.end,         // 2:30
  slotMinutes: 30,
  printStart: WORK_HOURS.start,   // الجدول المطبوع: من 8:30
  printEnd: WORK_HOURS.end,       // إلى 2:30
  schemaVersion: SCHEMA_VERSION,
  shifts: { morning: { ...WORK_HOURS }, evening: { start: 870, end: 1200 } },
  maxTheoryBlock: 2,
  maxPracticalBlock: 3,
  maxDailyHours: 6,
};

const ORDINAL = ['', 'الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة'];

/**
 * عمليات إنشاء كلية جديدة مع «قسم عام» ومراحلها وشعبة صباحية لكل مرحلة.
 * تُستخدم في البيانات الأولية وعند إضافة كلية من الواجهة.
 */
export function collegeStructureOps(uid, { name, short = '', order = 50, stages = 4, own = true, generalDept = true }) {
  const ops = [];
  const put = (col, data, id = uid()) => { ops.push({ op: 'set', col, id, data }); return id; };
  const collegeId = put('colleges', { name, short, order, own });
  if (generalDept) {
    const deptId = put('departments', { name, short: short || name, collegeId, general: true });
    for (let level = 1; level <= stages; level++) {
      const stageId = put('stages', { deptId, level, name: `المرحلة ${ORDINAL[level] || level}` });
      put('groups', { deptId, stageId, shift: 'morning', name: 'صباحي', students: 0 });
    }
  }
  return { ops, collegeId };
}

/**
 * بناء عمليات الكتابة للبيانات الأولية.
 * @param {()=>string} uid مولد المعرّفات
 */
export function seedOps(uid) {
  const ops = [];
  const put = (col, data, id = uid()) => { ops.push({ op: 'set', col, id, data }); return id; };

  put('settings', DEFAULT_SETTINGS, 'app');
  const collegeId = put('colleges', { name: COLLEGE_NAME, short: 'التقنيات الصحية', order: 1, own: true });
  for (const c of EXTRA_COLLEGES) ops.push(...collegeStructureOps(uid, c).ops);
  put('colleges', { name: OTHER_COLLEGES_NAME, order: 99, own: false });

  const deptIds = {};
  for (const d of DEPARTMENTS) deptIds[d.key] = put('departments', { name: d.name, short: d.short, collegeId });

  // المراحل الأربع لكل قسم مع شعبة صباحية لكل مرحلة، ولقسم الأشعة شعبتان (صباحي + مسائي)
  const stageIds = {};
  for (const d of DEPARTMENTS) {
    for (let level = 1; level <= 4; level++) {
      const sid = put('stages', { deptId: deptIds[d.key], level, name: `المرحلة ${['', 'الأولى', 'الثانية', 'الثالثة', 'الرابعة'][level]}` });
      stageIds[`${d.key}|${level}`] = sid;
      for (const shift of d.key === 'rad' ? ['morning', 'evening'] : ['morning']) {
        put('groups', {
          deptId: deptIds[d.key], stageId: sid, shift,
          name: shift === 'morning' ? 'صباحي' : 'مسائي',
          students: d.key === 'rad' ? RAD_STUDENTS[`${level}|${shift}`] || 0 : 0,
        });
      }
    }
  }

  // المناهج الرسمية لأقسام كلية التقنيات (بساعاتها النظرية والعملية) والكادر التدريسي
  const seeded = { colleges: [], departments: [], subjects: [], teachers: [] };
  for (const o of ops) if (seeded[o.col]) seeded[o.col].push({ ...o.data, id: o.id });
  ops.push(...curriculumImportPlan(seeded, uid).ops);

  for (const r of SAMPLE_ROOMS) put('rooms', { ...r, collegeId, building: 'بناية الكلية', sample: true });
  return ops;
}

/**
 * ترقية البيانات الموجودة إلى الإصدار الحالي. تُنفَّذ مرة واحدة فقط عند دخول مدير النظام.
 * - الإصدار 2 (عدة كليات): تُضاف كليتا الصيدلة وطب الأسنان، ويُرتّب ظهور الكليات.
 * - الإصدار 5: الدوام 8:30 – 2:30، وتصحيح المختبرات المسجّلة كقاعات، واستيراد المناهج الرسمية والكادر التدريسي لكلية التقنيات.
 * - الإصدار 4: كل كلية مُدارة من الكليتين بلا أقسام يُنشأ لها «قسم عام» بمراحله وشعبه (لإضافة الأساتذة والجداول).
 * - الإصدار 3: إذا كانت الصيدلة أو طب الأسنان مسجّلة سابقاً كـ«جهة خارجية» تُحوَّل إلى كلية مُدارة (وتُدمج النسخ المكررة)،
 *   وتُنشأ شعبة «صباحي» لكل مرحلة ليس لها شعب، وتُربط المحاضرات غير المرتبطة بشعبة بشعبة مرحلة مادتها.
 * @returns {{ops: object[], notes: string[]}}
 */
export function migrationPlan(data, uid) {
  const s = (data.settings || []).find((x) => x.id === 'app');
  const version = s?.schemaVersion || 1;
  if (!s || version >= SCHEMA_VERSION) return { ops: [], notes: [] };
  const ops = [];
  const notes = [];
  const settingsPatch = {};
  const colleges = data.colleges || [];

  const isExtra = (c) => EXTRA_COLLEGES.some((e) => normName(e.name) === normName(c.name));
  if (version < 2) {
    for (const c of colleges) {
      if (c.name === COLLEGE_NAME) {
        ops.push({ op: 'update', col: 'colleges', id: c.id, data: { own: true, order: c.order ?? 1, short: c.short || 'التقنيات الصحية' } });
      } else if (c.own === false && !isExtra(c)) {
        const rename = c.name === 'كليات أخرى في الجامعة' ? { name: OTHER_COLLEGES_NAME } : {};
        ops.push({ op: 'update', col: 'colleges', id: c.id, data: { ...rename, order: c.order ?? 99 } });
      }
    }
  }

  // الكليات الإضافية: إنشاء، أو تحويل «جهة خارجية» بالاسم نفسه إلى كلية مُدارة، ودمج النسخ المكررة
  const depts = [...(data.departments || [])];
  const stages = [...(data.stages || [])];
  const groups = [...(data.groups || [])];
  const put = (col, row, id = uid()) => { ops.push({ op: 'set', col, id, data: row }); return id; };
  for (const extra of EXTRA_COLLEGES) {
    const same = colleges.filter((c) => normName(c.name) === normName(extra.name));
    let target = same.find((c) => c.own !== false);
    if (!target && !same.length) {
      ops.push(...collegeStructureOps(uid, extra).ops);
      continue;
    }
    if (!target) {
      target = same[0];
      ops.push({ op: 'update', col: 'colleges', id: target.id, data: { own: true, order: extra.order, short: target.short || extra.short } });
      notes.push(`تحويل «${target.name}» إلى كلية مُدارة`);
    } else if ((target.order ?? 99) >= 99) {
      ops.push({ op: 'update', col: 'colleges', id: target.id, data: { order: extra.order, short: target.short || extra.short } });
    }
    // الإصدار 4: كلية مُدارة بلا أقسام لا يمكن إضافة أساتذة أو جداول لها، فيُنشأ «قسم عام» بمراحله وشعبه
    if (!depts.some((d) => d.collegeId === target.id)) {
      const deptId = put('departments', { name: extra.short, short: extra.short, collegeId: target.id, general: true });
      depts.push({ id: deptId, collegeId: target.id });
      for (let level = 1; level <= extra.stages; level++) {
        const stageId = put('stages', { deptId, level, name: `المرحلة ${ORDINAL[level] || level}` });
        stages.push({ id: stageId, deptId, level });
        const gid = put('groups', { deptId, stageId, shift: 'morning', name: 'صباحي', students: 0 });
        groups.push({ id: gid, deptId, stageId });
      }
      notes.push(`إنشاء المراحل والشعب لـ«${target.name}»`);
    }
    for (const dup of same.filter((c) => c !== target)) {
      for (const r of (data.rooms || []).filter((x) => x.collegeId === dup.id)) ops.push({ op: 'update', col: 'rooms', id: r.id, data: { collegeId: target.id } });
      for (const d of depts.filter((x) => x.collegeId === dup.id)) ops.push({ op: 'update', col: 'departments', id: d.id, data: { collegeId: target.id } });
      for (const u of (data.users || []).filter((x) => x.collegeId === dup.id)) ops.push({ op: 'update', col: 'users', id: u.id, data: { collegeId: target.id } });
      ops.push({ op: 'delete', col: 'colleges', id: dup.id });
      notes.push(`دمج «${dup.name}» المكررة مع «${target.name}»`);
    }
  }

  if (version < 3) {
    // شعبة افتراضية لكل مرحلة بلا شعب (المحاضرات والتوليد والطباعة تعتمد على الشعب)
    let added = 0;
    for (const st of stages) {
      if (groups.some((g) => g.stageId === st.id)) continue;
      const gid = put('groups', { deptId: st.deptId, stageId: st.id, shift: 'morning', name: 'صباحي', students: 0 }, `g${st.id}`);
      groups.push({ id: gid, deptId: st.deptId, stageId: st.id });
      added++;
    }
    if (added) notes.push(`إنشاء شعبة «صباحي» لـ${added} مرحلة لم تكن لها شعب`);

    // ربط المحاضرات غير المرتبطة بشعبة بشعبة مرحلة مادتها (عندما تكون للمرحلة شعبة واحدة فقط)
    const subjects = new Map((data.subjects || []).map((x) => [x.id, x]));
    let linked = 0;
    for (const ses of data.sessions || []) {
      if (ses.kind === 'external' || !ses.deptId || (ses.groupIds || []).length) continue;
      const sub = subjects.get(ses.subjectId);
      const st = sub && stages.find((x) => x.deptId === ses.deptId && Number(x.level) === Number(sub.stageLevel));
      const gs = st ? groups.filter((g) => g.stageId === st.id) : [];
      if (gs.length !== 1) continue;
      ops.push({ op: 'update', col: 'sessions', id: ses.id, data: { groupIds: [gs[0].id] } });
      linked++;
    }
    if (linked) notes.push(`ربط ${linked} محاضرة بشعبة مرحلتها`);
  }

  if (version < 5) {
    // الدوام الرسمي 8:30 – 2:30 (أعمدة الجدول على الشاشة وفي الطباعة، والدوام الصباحي)
    const shifts = { ...(s.shifts || {}), morning: { ...WORK_HOURS } };
    if (!shifts.evening) shifts.evening = { start: 870, end: 1200 };
    Object.assign(settingsPatch, { dayStart: WORK_HOURS.start, dayEnd: WORK_HOURS.end, printStart: WORK_HOURS.start, printEnd: WORK_HOURS.end, shifts });
    notes.push('الدوام من 8:30 إلى 2:30');
    // مختبر مسجّل كقاعة (يسبب تنبيه «ليست مختبراً» لكل محاضرة عملية فيه)
    const labs = (data.rooms || []).filter((r) => r.type !== 'lab' && /^مختبر/.test(normName(r.name)));
    for (const r of labs) ops.push({ op: 'update', col: 'rooms', id: r.id, data: { type: 'lab' } });
    if (labs.length) notes.push(`تصحيح نوع ${labs.map((r) => `«${r.name}»`).join('، ')} إلى مختبر`);
    // المناهج الرسمية والكادر التدريسي لكلية التقنيات الصحية والطبية
    const imp = curriculumImportPlan(data, uid);
    ops.push(...imp.ops);
    if (imp.stats.added || imp.stats.updated) notes.push(`استيراد المناهج الرسمية: ${imp.stats.added} مادة جديدة وتحديث ${imp.stats.updated} مادة بالساعات النظرية والعملية`);
    if (imp.stats.teachers) notes.push(`إضافة ${imp.stats.teachers} أستاذاً بدون تكرار`);
  }

  // تحديث واحد لوثيقة الإعدادات (لا تُكتب الوثيقة نفسها مرتين في الدفعة)
  ops.push({ op: 'update', col: 'settings', id: 'app', data: { ...settingsPatch, schemaVersion: SCHEMA_VERSION } });
  return { ops, notes };
}

export const migrationOps = (data, uid) => migrationPlan(data, uid).ops;
