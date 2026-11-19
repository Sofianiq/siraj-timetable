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
  assert.equal(deptNames.length, 3);
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
  assert.deepEqual(hind[0].sharedColleges, ['dn']);
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
  const sciS = after.sessions.filter((x) => x.deptId === forDept.id);
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
  const imported = after.sessions.filter((x) => x.source === 'university' && [lawDept.id, forDept.id, 'acc'].includes(x.deptId) && x.id !== edited.id);
  for (const [, list] of checkAll(imported, ctx)) for (const i of list) assert.ok(!['room', 'group', 'roomOwner'].includes(i.type), i.message);
  // إعادة الاستيراد لا تكتب شيئاً
  assert.equal(universityImportPlan(after, ids()).ops.length, 0);
});
