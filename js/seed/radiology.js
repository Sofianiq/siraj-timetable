/**
 * البيانات الأولية التي تُدرج تلقائياً عند أول تشغيل (قاعدة بيانات فارغة).
 *
 * مصدر مواد قسم تقنيات الأشعة والسونار: ملفات درجات القسم للعام 2025-2026 (الفصل الثاني، المرحلتان الأولى والثانية).
 * عدد الساعات النظرية/العملية المدرج هنا قيم افتراضية بحسب نوع المادة (المواد التي لها درجة عملي في كشوف الدرجات
 * أُعطيت ساعات عملية)، ويجب مراجعتها من صفحة «المواد الدراسية» أو استبدالها باستيراد ملف المناهج الرسمي (Excel).
 *
 * القاعات والمختبرات أمثلة يجب تعديلها لتطابق الواقع.
 */
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
export const SCHEMA_VERSION = 3;

export const DEPARTMENTS = [
  { key: 'rad', name: 'قسم تقنيات الأشعة والسونار', short: 'الأشعة' },
  { key: 'ch', name: 'قسم تقنيات صحة المجتمع', short: 'صحة المجتمع' },
  { key: 'an', name: 'قسم تقنيات التخدير', short: 'التخدير' },
  { key: 'dt', name: 'قسم تقنيات صناعة الأسنان', short: 'صناعة الأسنان' },
  { key: 'cos', name: 'قسم تقنيات التجميل', short: 'التجميل' },
];

export const RAD_TEACHERS = [
  { key: 'abdulrahman', name: 'د. عبد الرحمن عبد الاله' },
  { key: 'younis', name: 'د. يونس عبد الستار' },
];

/** [المرحلة، الفصل، اسم المادة، نظري، عملي، نوع المختبر، مفتاح أستاذ النظري] */
export const RAD_SUBJECTS = [
  [1, 2, 'علم الفسلجة', 2, 2, 'مختبر فسلجة', 'abdulrahman'],
  [1, 2, 'تشريح أجهزة الجسم', 2, 2, 'مختبر تشريح', null],
  [1, 2, 'فيزياء الذرة', 2, 2, 'مختبر فيزياء', null],
  [1, 2, 'البايولوجي الإشعاعي', 2, 2, 'مختبر أشعة', null],
  [1, 2, 'أسس التمريض', 2, 2, 'مختبر تمريض', null],
  [1, 2, 'اللغة العربية', 2, 0, '', null],
  [1, 2, 'المصطلحات الطبية', 2, 0, '', null],
  [2, 2, 'التشريح الشعاعي للرأس والأطراف العليا', 2, 2, 'مختبر أشعة', 'younis'],
  [2, 2, 'تقنيات التصوير الشعاعي للأطراف العليا', 2, 3, 'مختبر أشعة', null],
  [2, 2, 'فحوصات شعاعية للجهاز الصفراوي والتناسلي', 2, 2, 'مختبر أشعة', null],
  [2, 2, 'تقنيات الأجهزة الشعاعية التقليدية', 2, 2, 'مختبر أشعة', null],
  [2, 2, 'فيزياء التصوير المحوسب', 2, 2, 'مختبر حاسوب', null],
  [2, 2, 'اللغة العربية', 2, 0, '', null],
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

export const DEFAULT_SETTINGS = {
  academicYear: '2025-2026',
  semester: 2,
  days: [1, 2, 3, 4, 5],          // الأحد → الخميس
  dayStart: 480,                  // 8:00
  dayEnd: 1200,                   // 20:00
  slotMinutes: 30,
  schemaVersion: SCHEMA_VERSION,
  shifts: { morning: { start: 480, end: 840 }, evening: { start: 840, end: 1200 } },
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

  const teacherIds = {};
  for (const t of RAD_TEACHERS) teacherIds[t.key] = put('teachers', { name: t.name, deptId: deptIds.rad, availability: {} });

  for (const [level, semester, name, th, pr, labType, tKey] of RAD_SUBJECTS) {
    put('subjects', {
      deptId: deptIds.rad, stageLevel: level, semester, name,
      theoryHours: th, practicalHours: pr, labType,
      theoryTeacherId: tKey ? teacherIds[tKey] : null, practicalTeacherId: null,
      combineTheory: true, needsReview: true,
    });
  }

  for (const r of SAMPLE_ROOMS) put('rooms', { ...r, collegeId, building: 'بناية الكلية', sample: true });
  return ops;
}

/** توحيد كتابة الأسماء للمقارنة: «كلية طب الاسنان» = «كلية طب الأسنان» */
export const normName = (v) => String(v || '').trim()
  .replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ');

/**
 * ترقية البيانات الموجودة إلى الإصدار الحالي. تُنفَّذ مرة واحدة فقط عند دخول مدير النظام.
 * - الإصدار 2 (عدة كليات): تُضاف كليتا الصيدلة وطب الأسنان، ويُرتّب ظهور الكليات.
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
    if (!target && same.length) {
      target = same[0];
      ops.push({ op: 'update', col: 'colleges', id: target.id, data: { own: true, order: extra.order, short: target.short || extra.short } });
      notes.push(`تحويل «${target.name}» إلى كلية مُدارة`);
      if (!depts.some((d) => d.collegeId === target.id)) {
        const deptId = put('departments', { name: extra.short, short: extra.short, collegeId: target.id, general: true });
        depts.push({ id: deptId, collegeId: target.id });
        for (let level = 1; level <= extra.stages; level++) {
          const stageId = put('stages', { deptId, level, name: `المرحلة ${ORDINAL[level] || level}` });
          stages.push({ id: stageId, deptId, level });
          const gid = put('groups', { deptId, stageId, shift: 'morning', name: 'صباحي', students: 0 });
          groups.push({ id: gid, deptId, stageId });
        }
      }
    } else if (!target) {
      ops.push(...collegeStructureOps(uid, extra).ops);
      continue;
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

  ops.push({ op: 'update', col: 'settings', id: 'app', data: { schemaVersion: SCHEMA_VERSION } });
  return { ops, notes };
}

export const migrationOps = (data, uid) => migrationPlan(data, uid).ops;
