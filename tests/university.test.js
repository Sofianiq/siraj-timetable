import { test } from 'node:test';
import assert from 'node:assert/strict';
import { universityImportPlan, matchName, TERM, importSignature } from '../js/seed/university.js';
import { SESSIONS, TEACHERS, ROOMS } from '../js/seed/university-data.js';
import { checkAll, buildCtx, teachersOf, shiftWindow } from '../js/conflicts.js';
import { normPerson } from '../js/text.js';

const ids = () => { let n = 0; return () => `n${n++}`; };
const apply = (data, ops) => {
  const out = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, [...v]]));
  for (const o of ops) {
    const arr = out[o.col] || (out[o.col] = []);
    const i = arr.findIndex((x) => x.id === o.id);
    if (o.op === 'delete') { if (i >= 0) arr.splice(i, 1); } else if (o.op === 'update') arr[i] = { ...arr[i], ...o.data };
    else if (i >= 0) arr[i] = { ...o.data, id: o.id }; else arr.push({ ...o.data, id: o.id });
  }
  return out;
};
/** بيانات تشبه ما أضافه المستخدم: كليات بأسماء مختلفة قليلاً وأقسام بمراحل وشعب «صباحي» */
const base = () => {
  const d = {
    settings: [{ id: 'app', academicYear: '2026-2027', semester: 1, days: [0, 1, 2, 3, 4], shifts: { morning: { start: 510, end: 900 }, evening: { start: 870, end: 1200 } } }],
    colleges: [
      { id: 'hmt', name: 'كلية التقنيات الصحية والطبية', own: true },
      { id: 'ph', name: 'كلية الصيدلة', own: true },
      { id: 'dn', name: 'كلية طب الاسنان', own: true },
      { id: 'en', name: 'كلية التقنية الهندسية', own: true },
      { id: 'ec', name: 'كلية الادارة والاقتصاد', own: true },
    ],
    departments: [
      { id: 'an', name: 'قسم تقنيات التخدير', collegeId: 'hmt' },
      { id: 'phd', name: 'الصيدلة', collegeId: 'ph', general: true },
      { id: 'dnd', name: 'طب الأسنان', collegeId: 'dn', general: true },
      { id: 'ai', name: 'قسم الذكاء الاصطناعي', collegeId: 'en' },
      { id: 'cy', name: 'قسم هندسة تقنيات الامن السيبراني', collegeId: 'en' },
      { id: 'ecg', name: 'كلية الادارة والاقتصاد', collegeId: 'ec', general: true },
      { id: 'acc', name: 'قسم المحاسبة', collegeId: 'ec' },
    ],
    stages: [], groups: [], subjects: [], sessions: [],
    teachers: [
      { id: 'h1', name: 'د. احمد سالم', deptId: 'an' },
      { id: 'h2', name: 'م.د عبد الرحمن احمد عيدان', deptId: 'an' },
      { id: 'e1', name: 'هدى علي', deptId: 'ai' },
    ],
    rooms: [{ id: 'r1', name: 'مختبر الحاسوب', type: 'lab', collegeId: 'hmt' }, { id: 'r2', name: 'SE201', type: 'hall' }],
  };
  for (const dep of ['ai', 'cy', 'acc', 'phd']) for (let l = 1; l <= 4; l++) {
    d.stages.push({ id: `${dep}s${l}`, deptId: dep, level: l, name: `م${l}` });
    d.groups.push({ id: `${dep}g${l}`, deptId: dep, stageId: `${dep}s${l}`, shift: 'morning', name: 'صباحي', students: 0 });
  }
  d.subjects.push({ id: 'old1', deptId: 'ai', stageLevel: 2, semester: 1, name: 'هياكل البيانات', theoryHours: 2, practicalHours: 0 });
  return d;
};

test('college and department names match despite spelling variants, without false matches', () => {
  assert.ok(matchName('كلية التقنية الهندسية', [['تقني', 'هندس']]));
  assert.ok(matchName('كلية الإدارة والإقتصاد', [['اداره', 'اقتصاد']]));
  assert.ok(matchName('قسم هندسة تقنيات الأمن السيبراني', [['سيبران']]));
  assert.ok(!matchName('كلية التقنيات الصحية والطبية', [['تقني', 'هندس']]));
  assert.ok(!matchName('كلية التربية الرياضية', [['تربيه']], ['رياضي', 'بدني']));
});

test('university import: matches existing colleges/departments, fills structure, links staff per college, and is idempotent', () => {
  const data = base();
  const { ops, report } = universityImportPlan(data, ids());
  const after = apply(data, ops);
  // لا تتكرر الكليات الموجودة؛ تُنشأ فقط كليات القاعات غير الموجودة
  const created = ops.filter((o) => o.col === 'colleges' && o.op === 'set').map((o) => o.data.name);
  assert.deepEqual(created.sort(), ['كلية التربية', 'كلية العلوم التطبيقية', 'كلية القانون والعلوم السياسية'].sort());
  assert.equal(after.colleges.find((c) => c.id === 'en').logo, 'assets/logo-eng.png');
  assert.equal(after.colleges.find((c) => c.id === 'en').eveningEnd, '20:30');
  // الأقسام: المطابقة بالاسم، وإنشاء الناقص (البناء والإنشاءات، إدارة الأعمال، المالية، النفط)
  const deptNames = after.departments.filter((d) => d.collegeId === 'en').map((d) => d.name);
  assert.equal(deptNames.length, 5);
  assert.ok(report.departments.find((d) => d.path === 'ENG/AI').status === 'matched');
  assert.ok(report.departments.find((d) => d.path === 'ECO/ACC').status === 'matched');
  assert.equal(after.departments.filter((d) => d.collegeId === 'ec' && !d.general).length, 4);
  assert.equal(after.departments.find((d) => d.id === 'acc').head, 'أ.م.د. عادل صالح مهدي');
  // كل المحاضرات استوردت ومرتبطة بشعبة ومادة
  const imported = after.sessions.filter((s) => s.source === 'university');
  assert.equal(imported.length, SESSIONS.length);
  assert.ok(imported.every((s) => s.groupIds.length === 1 && s.subjectId && s.term === `${TERM.year}/${TERM.semester}` && s.locked));
  // شعبة مسائية للذكاء الاصطناعي، ومجاميع العملي للصيدلة
  assert.ok(after.groups.some((g) => g.deptId === 'ai' && g.shift === 'evening'));
  assert.deepEqual(after.groups.find((g) => g.id === 'phdg1').subgroups, ['A', 'B', 'C', 'D']);
  // المختبر بأستاذين: الأستاذ المشارك محفوظ
  assert.ok(imported.some((s) => s.coTeacherIds.length === 1));
  // الأساتذة: «هدى علي» الموجود في الهندسية لا يتكرر، و«احمد سالم» الهندسي ليس «د. احمد سالم» في التقنيات الصحية
  assert.equal(after.teachers.filter((t) => normPerson(t.name) === normPerson('هدى علي')).length, 1);
  assert.equal(after.teachers.filter((t) => normPerson(t.name) === normPerson('احمد سالم')).length, 2);
  assert.ok(report.similarTeachers.some((t) => normPerson(t.name) === normPerson('احمد سالم')));
  // أستاذ مشترك بين كليتين يُسجَّل مرة واحدة ويُضاف إلى كلية أخرى
  const hind = after.teachers.filter((t) => normPerson(t.name) === normPerson('هند حامد'));
  assert.equal(hind.length, 1);
  // طب الأسنان، والعلوم (فيزياء الأدلة الجنائية)
  assert.ok(hind[0].sharedColleges.includes('dn'));
  assert.equal(hind[0].sharedColleges.length, 2);
  // مطابقة صريحة مع كادر كلية أخرى: أستاذ العربية في الصيدلة = م.د عبد الرحمن احمد عيدان
  assert.ok(after.teachers.find((t) => t.id === 'h2').sharedColleges.includes('ph'));
  // المادة الموجودة تُحدَّث ولا تتكرر
  assert.ok(after.subjects.find((s) => s.id === 'old1').practicalHours === 2);
  assert.equal(after.subjects.filter((s) => s.deptId === 'ai' && s.stageLevel === 2 && /هياكل/.test(s.name)).length, 1);
  // القاعات: تُطابَق بالرمز والاسم ولا تتكرر
  assert.equal(after.rooms.filter((r) => r.name === 'SE201').length, 1);
  assert.equal(after.rooms.filter((r) => r.name === 'مختبر الحاسوب').length, 1);
  // لكل كلية قاعاتها: مختبر حاسوب الصيدلة منفصل عن مختبر التقنيات الصحية
  assert.equal(after.rooms.find((r) => r.name === 'مختبر الحاسوب – الصيدلة').collegeId, 'ph');
  assert.equal(after.rooms.find((r) => r.name === 'SE201').collegeId, 'en');
  assert.equal(after.rooms.length, ROOMS.length + 1);
  // إعادة الاستيراد لا تكتب شيئاً
  const again = universityImportPlan(after, ids());
  assert.equal(again.ops.length, 0, JSON.stringify(again.ops.slice(0, 3)));
});

test('imported timetables: no double-booked group, co-teachers and college hours used by the conflict engine', () => {
  const data = base();
  const after = apply(data, universityImportPlan(data, ids()).ops);
  const ctx = buildCtx({ ...after, settings: after.settings[0] });
  const issues = checkAll(after.sessions, ctx);
  const byType = {};
  for (const list of issues.values()) for (const i of list) byType[`${i.level}:${i.type}`] = (byType[`${i.level}:${i.type}`] || 0) + 1;
  // جداول الطلبة نفسها سليمة: لا شعبة لها محاضرتان في الوقت نفسه
  assert.equal(byType['error:group'] || 0, 0, JSON.stringify(byType));
  // الدوام الموحّد 8:30–3:00: التنبيه فقط للمحاضرات الصباحية التي تتجاوز 3:00 في الجداول الأصلية، ولا تنبيه للدراسة المسائية (دوام الهندسية المسائي)
  const shiftWarned = after.sessions.filter((s) => (issues.get(s.id) || []).some((i) => i.type === 'shift'));
  assert.ok(shiftWarned.length > 0);
  assert.ok(shiftWarned.every((s) => s.end > 900 && after.groups.find((g) => g.id === s.groupIds[0]).shift === 'morning'), JSON.stringify(shiftWarned[0]));
  const eng = after.groups.find((g) => g.deptId === 'ai' && g.shift === 'evening');
  assert.deepEqual(shiftWindow(ctx, eng), { start: 750, end: 1230 });
  // الأستاذ المشارك يُحسب في التعارض
  const co = after.sessions.find((s) => (s.coTeacherIds || []).length);
  assert.equal(teachersOf(co).length, 2);
  const clash = { ...co, id: 'x', groupIds: [], roomId: null, teacherId: co.coTeacherIds[0], coTeacherIds: [] };
  assert.ok(checkAll([co, clash], ctx).get('x').some((i) => i.type === 'teacher'));
});

test('v6 migration clears college-specific morning hours so every college follows 8:30–3:00, Sat–Wed', async () => {
  const { migrationPlan, SCHEMA_VERSION, WORK_HOURS, WORK_DAYS } = await import('../js/seed/radiology.js');
  const data = {
    settings: [{ id: 'app', schemaVersion: 5, days: [0, 1, 2, 3, 4, 5], shifts: { morning: { start: 510, end: 870 }, evening: { start: 870, end: 1200 } } }],
    colleges: [
      { id: 'en', name: 'الكلية التقنية الهندسية', own: true, morningStart: '08:30', morningEnd: '15:30', eveningStart: '12:30', eveningEnd: '20:30' },
      { id: 'dn', name: 'كلية طب الأسنان', own: true, morningStart: '08:30', morningEnd: '16:30' },
      { id: 'ph', name: 'كلية الصيدلة', own: true },
    ],
    departments: [{ id: 'd1', name: 'طب الأسنان', collegeId: 'dn', general: true }, { id: 'd2', name: 'الصيدلة', collegeId: 'ph', general: true }],
    stages: [], groups: [], subjects: [], sessions: [], teachers: [], rooms: [],
  };
  const { ops } = migrationPlan(data, ids());
  const st = ops.filter((o) => o.col === 'settings');
  assert.equal(st.length, 1);
  assert.equal(st[0].data.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(st[0].data.days, WORK_DAYS);
  assert.deepEqual(st[0].data.shifts.morning, WORK_HOURS);
  assert.deepEqual(WORK_HOURS, { start: 510, end: 900 });
  const after = apply(data, ops);
  const ctx = buildCtx({ ...after, settings: after.settings[0] });
  assert.equal(after.colleges.find((c) => c.id === 'en').eveningEnd, '20:30');
  // كل الكليات على الدوام الصباحي الموحّد، والمسائي الخاص بالهندسية باقٍ
  for (const c of after.colleges) assert.ok(!c.morningStart && !c.morningEnd, c.name);
  assert.deepEqual(shiftWindow({ ...ctx, settings: after.settings[0] }, { deptId: 'd1', shift: 'morning' }), { start: 510, end: 900 });
});

test('updated room codes: offices are retired (deleted if unused, disabled if used) and rooms of another college raise a warning', () => {
  const data = base();
  data.rooms.push({ id: 'old11', name: 'SE011', code: 'SE011', type: 'hall' }, { id: 'old12', name: 'SE012', code: 'SE012', type: 'hall', collegeId: 'ec' });
  data.sessions.push({ id: 'keep12', term: '2026-2027/1', deptId: 'acc', roomId: 'old12', day: 0, start: 510, end: 570, groupIds: [] });
  const { ops, report } = universityImportPlan(data, ids());
  const after = apply(data, ops);
  assert.ok(!after.rooms.some((r) => r.id === 'old11'), 'unused office code deleted');
  assert.equal(after.rooms.find((r) => r.id === 'old12').active, false, 'used office code disabled');
  assert.deepEqual(report.retiredRooms.map((r) => [r.code, r.action]).sort(), [['SE011', 'deleted'], ['SE012', 'disabled']]);
  // محاضرة لقسم المحاسبة في قاعة الكلية التقنية الهندسية → تنبيه
  const ctx = buildCtx({ ...after, settings: after.settings[0] });
  const se201 = after.rooms.find((r) => r.name === 'SE201');
  const res = checkAll([{ id: 'x', term: 't', deptId: 'acc', kind: 'theory', roomId: se201.id, day: 0, start: 510, end: 570, groupIds: [] }], ctx);
  assert.ok(res.get('x').some((i) => i.type === 'roomOwner'));
  // إعادة الاستيراد بعد التحديث لا تكتب شيئاً
  assert.equal(universityImportPlan(after, ids()).ops.length, 0);
});

const ecoNoHall = (list) => list.filter((x) => x.roomId == null).length;
test('v3 update: Law and Forensic Evidence timetables are added and halls follow the official allocation, without touching earlier timetables', () => {
  const data = base();
  const first = apply(data, universityImportPlan(data, ids()).ops);
  // محاكاة بيانات الإصدار السابق: محاضرات الإدارة والاقتصاد بلا قاعة، ومحاضرة عدّلها المستخدم يدوياً، ومحاضرة أضافها بنفسه
  const eco = first.sessions.filter((x) => x.deptId === 'acc');
  const v2 = (x) => { const o = { ...x, roomId: null }; return { ...o, importSig: importSignature(o) }; };
  const prev = { ...first, sessions: first.sessions.map((x) => (x.deptId === 'acc' ? v2(x) : x)) };
  const edited = eco[0];
  prev.sessions = prev.sessions.map((x) => (x.id === edited.id ? { ...x, start: x.start + 30, end: x.end + 30 } : x));
  prev.sessions.push({ id: 'mine', term: '2026-2027/1', deptId: 'acc', groupIds: [eco[1].groupIds[0]], day: 4, start: 510, end: 570, source: 'manual' });
  const before = new Map(prev.sessions.map((x) => [x.id, x]));
  const { ops, report } = universityImportPlan(prev, ids());
  const after = apply(prev, ops);
  // لا تُحذف أي محاضرة سابقة (خيار الاستبدال غير مفعّل)، والمحاضرة المضافة يدوياً باقية
  assert.ok(!ops.some((o) => o.col === 'sessions' && o.op === 'delete'));
  assert.ok(after.sessions.some((x) => x.id === 'mine'));
  assert.ok(report.existingOther >= 1);
  // المحاضرة التي عدّلها المستخدم تبقى كما هي
  assert.deepEqual(after.sessions.find((x) => x.id === edited.id), before.get(edited.id));
  // المحاضرات السابقة: الوقت والمادة والأستاذ والشعبة لم تتغير؛ التغيير الوحيد قاعة للإدارة والاقتصاد
  const touched = ops.filter((o) => o.col === 'sessions' && before.has(o.id));
  assert.equal(touched.length, eco.length - 1 - ecoNoHall(eco));
  for (const o of touched) {
    const b = before.get(o.id);
    for (const k of ['day', 'start', 'end', 'subjectId', 'teacherId', 'groupIds', 'kind']) assert.deepEqual(o.data[k], b[k], k);
    assert.equal(b.deptId, 'acc');
    assert.ok(o.data.roomId);
  }
  // الكليتان الجديدتان: الأقسام والعميد والشعار
  const law = after.colleges.find((c) => c.name === 'كلية القانون والعلوم السياسية');
  assert.equal(law.dean, 'أ.م.د. قحطان عبدالستار طه');
  assert.equal(law.logo, 'assets/logo-law.png');
  const lawDept = after.departments.find((d) => d.collegeId === law.id);
  assert.equal(lawDept.name, 'قسم القانون');
  const sci = after.colleges.find((c) => c.name === 'كلية العلوم التطبيقية');
  const forDept = after.departments.find((d) => d.collegeId === sci.id);
  assert.equal(forDept.name, 'قسم الأدلة الجنائية');
  const room = (id) => after.rooms.find((r) => r.id === id);
  const lawS = after.sessions.filter((x) => x.deptId === lawDept.id);
  const stageOf = (x) => after.stages.find((st) => st.id === after.groups.find((g) => g.id === x.groupIds[0])?.stageId)?.level;
  const sciS = after.sessions.filter((x) => x.deptId === forDept.id && stageOf(x) === 2);
  assert.equal(lawS.length, 15);
  assert.equal(sciS.length, 10);
  // حصص القانون 45 دقيقة في SE217؛ نظري الأدلة الجنائية في SE107 والعملي في مختبرات الكلية
  assert.ok(lawS.every((x) => x.end - x.start === 45 && room(x.roomId).name === 'SE217'));
  assert.ok(sciS.filter((x) => x.kind === 'theory').every((x) => room(x.roomId).name === 'SE107'));
  assert.ok(sciS.filter((x) => x.kind === 'practical').every((x) => room(x.roomId).type === 'lab' && room(x.roomId).collegeId === sci.id));
  // المحاضرة المشتركة بين أستاذين (عملي التشريح والفسلجة)
  assert.ok(sciS.some((x) => x.coTeacherIds.length === 1));
  // الأساتذة المشتركون يُربطون بسجلهم ولا يتكررون
  for (const who of ['باسم ناصر', 'جمال ناصر', 'عمر فلاح']) {
    assert.equal(after.teachers.filter((t) => t.name.includes(who) && !t.name.includes('م.م')).length, 1, who);
  }
  assert.ok(after.teachers.find((t) => t.name.includes('باسم ناصر')).sharedColleges.includes(sci.id));
  // قاعات التوزيع: SE003 وSE204 وSE216 قاعات دراسية لكلياتها
  for (const [code, cid] of [['SE003', 'ec'], ['SE204', 'en'], ['SE216', law.id]]) {
    const r = after.rooms.find((x) => x.code === code);
    assert.equal(r.type, 'hall', code);
    assert.equal(r.collegeId, cid, code);
  }
  // قاعات الإدارة والاقتصاد من قاعاتها فقط، ولا تتعارض قاعة أو شعبة بين المحاضرات المستوردة
  const ecoS = after.sessions.filter((x) => x.source === 'university' && ['acc'].includes(x.deptId) && x.roomId);
  assert.ok(ecoS.length > 0);
  for (const x of ecoS) assert.equal(room(x.roomId).collegeId, 'ec', `${room(x.roomId).name} ${x.day} ${x.start}`);
  const ctx = buildCtx({ ...after, settings: after.settings[0] });
  // المرحلة الثانية للأدلة الجنائية (الأولى تستخدم LD 309 في كلية القانون كما في جدولها، ويغطيها اختبار v8)
  const imported = after.sessions.filter((x) => x.source === 'university' && x.id !== edited.id
    && ([lawDept.id, 'acc'].includes(x.deptId) || (x.deptId === forDept.id && stageOf(x) === 2)));
  for (const [, list] of checkAll(imported, ctx)) for (const i of list) assert.ok(!['room', 'group', 'roomOwner'].includes(i.type), i.message);
  // إعادة الاستيراد لا تكتب شيئاً
  assert.equal(universityImportPlan(after, ids()).ops.length, 0);
});

test('v4: Construction stage 1 morning becomes groups A and B with a hall each, a shared time grid and no teacher clash; the old timetable is retired unless edited', () => {
  const withOld = (edited) => {
    const d = base();
    d.departments.push({ id: 'cons', name: 'قسم هندسة تقنيات البناء والانشاءات', collegeId: 'en' });
    d.stages.push({ id: 'conss1', deptId: 'cons', level: 1, name: 'المرحلة الأولى' });
    d.groups.push({ id: 'consg', deptId: 'cons', stageId: 'conss1', shift: 'morning', name: 'صباحي', students: 40, subgroups: ['A', 'B', 'C', 'D'] });
    const old = (id, day, start, extra = {}) => {
      const s = { id, term: '2026-2027/1', deptId: 'cons', subjectId: 'x', kind: 'theory', groupIds: ['consg'], subgroups: [], teacherId: null, coTeacherIds: [], roomId: null, day, start, end: start + 120, note: '', source: 'university' };
      return { ...s, importSig: importSignature(s), ...extra };
    };
    d.sessions.push(old('old1', 0, 510), old('old2', 1, 630));
    if (edited) d.sessions.push(old('old3', 2, 510, { start: 540 }));  // عدّله المستخدم بعد الاستيراد
    return d;
  };
  // 1) الجدول القديم بلا تعديل: يُحذف، والشعبة «صباحي» تصبح «المجموعة A» بعدد طلبتها، وتُنشأ «المجموعة B»
  const data = withOld(false);
  const { ops, report } = universityImportPlan(data, ids());
  const after = apply(data, ops);
  assert.ok(!after.sessions.some((s) => /^old/.test(s.id)));
  assert.equal(report.removed.length, 2);
  const gA = after.groups.find((g) => g.id === 'consg');
  assert.deepEqual([gA.name, gA.students, gA.subgroups], ['المجموعة A', 40, []]);
  const gB = after.groups.find((g) => g.stageId === 'conss1' && g.name === 'المجموعة B');
  assert.ok(gB);
  const room = (id) => after.rooms.find((r) => r.id === id)?.name;
  const of = (g) => after.sessions.filter((s) => s.groupIds.includes(g.id));
  const A = of(gA), B = of(gB);
  assert.equal(A.length, 12);
  assert.equal(B.length, 12);
  const hours = (l) => l.reduce((n, s) => n + (s.end - s.start) / 60, 0);
  assert.equal(hours(A), 23);
  assert.equal(hours(B), 23);
  // لكل مجموعة قاعتها، والرسم الهندسي في مختبره
  assert.ok(A.every((s) => [ 'SE202', 'مختبر الرسم الهندسي' ].includes(room(s.roomId))));
  assert.ok(B.every((s) => [ 'SE209', 'مختبر الرسم الهندسي' ].includes(room(s.roomId))));
  // شبكة وقت واحدة: حصص المجموعتين (عدا حقوق الإنسان) في الأوقات نفسها، وكل يوم المواد نفسها
  const grid = (l) => l.filter((s) => s.teacherId).map((s) => `${s.day}-${s.start}`).sort().join();
  assert.equal(grid(A), grid(B));
  for (let d = 0; d < 5; d++) {
    const subj = (l) => l.filter((s) => s.day === d).map((s) => `${s.subjectId}${s.kind}`).sort().join();
    assert.equal(subj(A), subj(B));
  }
  // داخل وقت الدوام 8:30–3:00 ولا تضارب أستاذ أو قاعة أو شعبة مع أي محاضرة أخرى
  assert.ok([...A, ...B].every((s) => s.start >= 510 && s.end <= 900));
  const ctx = buildCtx({ ...after, settings: after.settings[0] });
  const term = after.sessions.filter((s) => s.term === '2026-2027/1');
  const res = checkAll(term, ctx);
  for (const s of [...A, ...B]) for (const i of res.get(s.id) || []) assert.ok(!['teacher', 'room', 'group', 'roomOwner'].includes(i.type), i.message);
  assert.equal(universityImportPlan(after, ids()).ops.length, 0);
  // 2) محاضرة قديمة عدّلها المستخدم: تبقى، ولا تُحوَّل شعبتها، فتُنشأ المجموعتان A وB جديدتين
  const d2 = withOld(true);
  const p2 = universityImportPlan(d2, ids());
  const a2 = apply(d2, p2.ops);
  assert.equal(p2.report.keptEdited.length, 1);
  assert.ok(a2.sessions.some((s) => s.id === 'old3'));
  assert.equal(a2.groups.find((g) => g.id === 'consg').name, 'صباحي');
  assert.deepEqual(a2.groups.filter((g) => g.stageId === 'conss1' && g.shift === 'morning').map((g) => g.name).sort(), ['المجموعة A', 'المجموعة B', 'صباحي']);
});

test('v5: Oil & Gas timetable with a hall per stage and no clash; Construction evening removed; hall practicals and separate theory', () => {
  const data = base();
  data.departments.push({ id: 'cons', name: 'قسم هندسة تقنيات البناء والانشاءات', collegeId: 'en' });
  data.stages.push({ id: 'conss1', deptId: 'cons', level: 1, name: 'المرحلة الأولى' });
  data.groups.push({ id: 'conse', deptId: 'cons', stageId: 'conss1', shift: 'evening', name: 'مسائي', students: 0 });
  const ev = { id: 'ev1', term: '2026-2027/1', deptId: 'cons', subjectId: 'x', kind: 'theory', groupIds: ['conse'], subgroups: [], teacherId: null, coTeacherIds: [], roomId: null, day: 0, start: 870, end: 990, note: '', source: 'university' };
  data.sessions.push({ ...ev, importSig: importSignature(ev) });
  const { ops, report } = universityImportPlan(data, ids());
  const after = apply(data, ops);
  // الدراسة المسائية للمرحلة الأولى أُلغيت: تُحذف محاضرتها وشعبتها
  assert.ok(!after.sessions.some((s) => s.id === 'ev1'));
  assert.ok(!after.groups.some((g) => g.id === 'conse'));
  assert.equal(report.removedGroups.length, 1);
  // قسم النفط والغاز في الكلية التقنية الهندسية برئيس قسمه
  const oil = after.departments.find((d) => d.collegeId === 'en' && /نفط/.test(d.name));
  assert.equal(oil.head, 'م.د. عامر ناجي أحمد النعيمي');
  const room = (id) => after.rooms.find((r) => r.id === id)?.name;
  const lvl = (s) => after.stages.find((x) => x.id === after.groups.find((g) => g.id === s.groupIds[0]).stageId).level;
  const oilS = after.sessions.filter((s) => s.deptId === oil.id);
  const st1 = oilS.filter((s) => lvl(s) === 1), st2 = oilS.filter((s) => lvl(s) === 2);
  assert.equal(st1.length, 11);
  assert.equal(st2.length, 12);
  // لكل مرحلة قاعتها، والحاسوب في مختبر البرمجة، ولا دوام يوم الاثنين
  assert.ok(st1.every((s) => ['SE213', 'مختبر البرمجة'].includes(room(s.roomId))));
  assert.ok(st2.every((s) => ['SE214', 'مختبر البرمجة'].includes(room(s.roomId))));
  assert.ok(!oilS.some((s) => s.day === 2));
  // البناء والإنشاءات: جدول القسم المعتمد 8:30–2:30، والعملي في قاعة المجموعة لمواد المساحة والجيولوجيا، ونظري كل مجموعة وحده
  const consSubj = after.subjects.filter((s) => s.deptId === 'cons' || after.departments.find((d) => d.id === s.deptId && /بناء/.test(d.name)));
  assert.ok(consSubj.length >= 6 && consSubj.every((s) => s.combineTheory === false));
  assert.ok(consSubj.find((s) => s.name === 'المساحة المستوية').practicalInHall);
  const consS = after.sessions.filter((s) => consSubj.some((x) => x.id === s.subjectId));
  assert.ok(consS.some((s) => s.end === 870) && consS.every((s) => s.start >= 510 && s.end <= 870));
  // قاعتا المجموعتين غير SE203 وSE207 (بطلب القسم)
  assert.ok(!consS.some((s) => ['SE203', 'SE207'].includes(room(s.roomId))));
  // لا تضارب أستاذ أو قاعة أو شعبة، ولا تنبيه «ليست مختبراً»، في جدولي النفط والبناء
  const ctx = buildCtx({ ...after, settings: after.settings[0] });
  const res = checkAll(after.sessions.filter((s) => s.term === '2026-2027/1'), ctx);
  for (const s of [...oilS, ...consS]) for (const i of res.get(s.id) || []) assert.ok(!['teacher', 'room', 'group', 'roomOwner', 'roomType'].includes(i.type), `${i.type}: ${i.message}`);
  assert.equal(universityImportPlan(after, ids()).ops.length, 0);
});

test('v6: Medical Devices timetable with its own two halls (not SE203/SE207) and no clash with other departments', () => {
  const data = base();
  const { ops } = universityImportPlan(data, ids());
  const after = apply(data, ops);
  const med = after.departments.find((d) => d.collegeId === 'en' && /الاجهزه الطبيه|الأجهزة الطبية/.test(d.name));
  assert.equal(med.head, 'د. زينب أياد وجيه');
  const room = (id) => after.rooms.find((r) => r.id === id)?.name;
  const lvl = (s) => after.stages.find((x) => x.id === after.groups.find((g) => g.id === s.groupIds[0]).stageId).level;
  const medS = after.sessions.filter((s) => s.deptId === med.id);
  const st1 = medS.filter((s) => lvl(s) === 1), st2 = medS.filter((s) => lvl(s) === 2);
  assert.equal(st1.length, 10);
  assert.equal(st2.length, 12);
  assert.ok(st1.every((s) => ['SE111', 'مختبر البرمجة'].includes(room(s.roomId))));
  assert.ok(st2.every((s) => room(s.roomId) === 'SE112'));
  assert.ok(!medS.some((s) => ['SE203', 'SE207'].includes(room(s.roomId)) || s.day === 2));
  // القاعتان للقسم وحده: لا يستخدمهما قسم آخر
  const halls = new Set(medS.map((s) => s.roomId));
  assert.ok(!after.sessions.some((s) => s.deptId !== med.id && halls.has(s.roomId) && room(s.roomId).startsWith('SE')));
  // د. أيمن جمعة (العلوم) مشارك في التشريح ومسجّل مرة واحدة مع الكلية التقنية الهندسية
  const ayman = after.teachers.filter((t) => t.name.includes('أيمن جمعة'));
  assert.equal(ayman.length, 1);
  assert.ok(ayman[0].sharedColleges.includes('en'));
  // لا تضارب أستاذ أو قاعة أو شعبة ولا تنبيه نوع قاعة
  const ctx = buildCtx({ ...after, settings: after.settings[0] });
  const res = checkAll(after.sessions.filter((s) => s.term === '2026-2027/1'), ctx);
  for (const s of medS) for (const i of res.get(s.id) || []) assert.ok(!['teacher', 'room', 'group', 'roomOwner', 'roomType'].includes(i.type), `${i.type}: ${i.message}`);
  assert.equal(universityImportPlan(after, ids()).ops.length, 0);
});

test('v8: Forensic Evidence stage 1 added as in its timetable, with its halls; shared teachers linked, not duplicated', () => {
  const data = base();
  const after = apply(data, universityImportPlan(data, ids()).ops);
  const sci = after.colleges.find((c) => c.name === 'كلية العلوم التطبيقية');
  const law = after.colleges.find((c) => c.name === 'كلية القانون والعلوم السياسية');
  const forDept = after.departments.find((d) => d.collegeId === sci.id);
  const room = (id) => after.rooms.find((r) => r.id === id);
  const lvl = (s) => after.stages.find((x) => x.id === after.groups.find((g) => g.id === s.groupIds[0]).stageId).level;
  const st1 = after.sessions.filter((s) => s.deptId === forDept.id && lvl(s) === 1);
  assert.equal(st1.length, 9);
  assert.ok(!st1.some((s) => s.day === 0), 'السبت عطلة');
  assert.deepEqual([...new Set(st1.map((s) => room(s.roomId).name))].sort(),
    ['بناية المختبرات – الطابق 1', 'بناية المختبرات – الطابق 3', 'قاعة Fs (214)', 'كلية القانون – LD 309'].sort());
  assert.equal(after.rooms.find((r) => r.code === 'LD309').collegeId, law.id);
  assert.equal(after.rooms.find((r) => r.code === 'FS214').collegeId, sci.id);
  // العملي في بناية المختبرات
  assert.ok(st1.filter((s) => s.kind === 'practical').every((s) => room(s.roomId).type === 'lab'));
  // أساتذة مشتركون مع الصيدلة يُربطون بسجلهم
  assert.equal(after.teachers.filter((t) => t.name.includes('هند حامد')).length, 1);
  assert.ok(after.teachers.find((t) => t.name.includes('هند حامد')).sharedColleges.includes(sci.id));
  // لا تضارب قاعة أو شعبة؛ وتعارض الأستاذ الوحيد هو الموجود في الأصل (الكيمياء العامة يوم الأحد)
  const ctx = buildCtx({ ...after, settings: after.settings[0] });
  const res = checkAll(after.sessions.filter((s) => s.term === '2026-2027/1'), ctx);
  const teacherClash = [];
  for (const s of st1) for (const i of res.get(s.id) || []) {
    assert.ok(!['room', 'group', 'roomType'].includes(i.type), `${i.type}: ${i.message}`);
    if (i.type === 'teacher') teacherClash.push(`${s.day}-${s.start}`);
  }
  assert.deepEqual([...new Set(teacherClash)], ['1-630']);
  assert.equal(universityImportPlan(after, ids()).ops.length, 0);
});

test('v10: Dentistry — stage 1 theory in SE008, stages 2–3 theory in Fallujah hall, practical groups rotate; no clash, no gaps, theory before practical', () => {
  const data = base();
  // جدول سابق لطب الأسنان: محاضرة أضافها المستخدم بنفسه تُستبدل مع الجدول كله
  data.stages.push({ id: 'dns2', deptId: 'dnd', level: 2, name: 'المرحلة الثانية' });
  data.groups.push({ id: 'dng2', deptId: 'dnd', stageId: 'dns2', shift: 'morning', name: 'صباحي', students: 0, subgroups: ['A', 'B', 'C'] });
  data.sessions.push({ id: 'oldManual', term: '2026-2027/1', deptId: 'dnd', kind: 'theory', groupIds: ['dng2'], day: 1, start: 510, end: 630, source: 'manual' });
  const { ops, report } = universityImportPlan(data, ids());
  const after = apply(data, ops);
  assert.ok(!after.sessions.some((s) => s.id === 'oldManual'));
  assert.ok(report.replacedTimetables >= 1);
  const room = (id) => after.rooms.find((r) => r.id === id);
  const den = after.sessions.filter((s) => s.deptId === 'dnd');
  const lvl = (s) => after.stages.find((x) => x.id === after.groups.find((g) => g.id === s.groupIds[0]).stageId).level;
  assert.deepEqual([1, 2, 3].map((l) => den.filter((s) => lvl(s) === l).length), [15, 29, 33]);
  assert.ok(den.every((s) => s.day >= 0 && s.day <= 4 && s.start >= 510 && s.end <= 870));
  // القاعات بطلب الكلية
  const subj = (s) => after.subjects.find((x) => x.id === s.subjectId).name;
  for (const s of den.filter((x) => x.kind === 'theory')) {
    assert.equal(room(s.roomId)?.name, lvl(s) === 1 ? 'SE008' : 'قاعة الفلوجة', `${subj(s)} م${lvl(s)}`);
  }
  // SE008 قاعة الهندسية: محجوزة بالاتفاق فلا يظهر تنبيه «قاعة كلية أخرى»
  assert.ok(den.filter((s) => lvl(s) === 1 && s.kind === 'theory').every((s) => s.sharedRoom));
  assert.equal(report.noRoom.length, 0);
  const ctx = buildCtx({ ...after, settings: after.settings[0] });
  const res = checkAll(after.sessions.filter((s) => s.term === '2026-2027/1'), ctx);
  for (const s of den) for (const i of res.get(s.id) || []) assert.ok(!['teacher', 'room', 'group', 'roomOwner', 'shift'].includes(i.type), `${subj(s)}: ${i.type} ${i.message}`);
  // بلا فراغات في يوم أي مجموعة، والنظري قبل العملي لكل مجموعة
  for (const l of [1, 2, 3]) for (const g of l === 1 ? [null] : ['A', 'B', 'C']) for (let d = 0; d < 5; d++) {
    const xs = den.filter((s) => lvl(s) === l && s.day === d && (!g || !s.subgroups.length || s.subgroups.includes(g))).sort((a, b) => a.start - b.start);
    for (let i = 1; i < xs.length; i++) assert.equal(xs[i].start, xs[i - 1].end, `فراغ: المرحلة ${l} ${g || ''} يوم ${d}`);
  }
  for (const p of den.filter((s) => s.kind === 'practical')) {
    const t = den.find((s) => s.kind === 'theory' && s.subjectId === p.subjectId);
    if (t) assert.ok(p.day * 10000 + p.start >= t.day * 10000 + t.end, `${subj(p)}: العملي قبل النظري`);
  }
  assert.equal(universityImportPlan(after, ids()).ops.length, 0);
  // إن كانت SE008 محجوزة في وقت محاضرة: لا تُحجز مرتين، وتُستورد المحاضرة بلا قاعة وتُذكر في المعاينة
  const d2 = base();
  const first = apply(d2, universityImportPlan(d2, ids()).ops);
  const se008 = first.rooms.find((r) => r.name === 'SE008').id;
  const t1 = first.sessions.find((s) => s.deptId === 'dnd' && s.roomId === se008);
  const busy = { ...first, sessions: first.sessions.filter((s) => s.id !== t1.id) };
  busy.sessions.push({ id: 'engBusy', term: '2026-2027/1', deptId: 'ai', kind: 'theory', roomId: se008, day: t1.day, start: t1.start, end: t1.end, groupIds: [] });
  const p2 = universityImportPlan(busy, ids());
  const a2 = apply(busy, p2.ops);
  assert.equal(p2.report.noRoom.length, 1);
  assert.equal(a2.sessions.find((s) => s.id === t1.id).roomId, null);
});
