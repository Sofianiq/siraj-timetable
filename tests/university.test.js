import { test } from 'node:test';
import assert from 'node:assert/strict';
import { universityImportPlan, matchName, TERM } from '../js/seed/university.js';
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
    settings: [{ id: 'app', academicYear: '2026-2027', semester: 1, shifts: { morning: { start: 510, end: 870 }, evening: { start: 870, end: 1200 } } }],
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
  assert.equal(after.rooms.length, ROOMS.length);
  // إعادة الاستيراد لا تكتب شيئاً
  const again = universityImportPlan(after, ids());
  assert.equal(again.ops.length, 0, JSON.stringify(again.ops.slice(0, 3)));
});

test('imported timetables: no double-booked group, co-teachers and college hours used by the conflict engine', () => {
  const data = base();
  const after = apply(data, universityImportPlan(data, ids()).ops);
  const ctx = buildCtx(after);
  const issues = checkAll(after.sessions, ctx);
  const byType = {};
  for (const list of issues.values()) for (const i of list) byType[`${i.level}:${i.type}`] = (byType[`${i.level}:${i.type}`] || 0) + 1;
  // جداول الطلبة نفسها سليمة: لا شعبة لها محاضرتان في الوقت نفسه
  assert.equal(byType['error:group'] || 0, 0, JSON.stringify(byType));
  // دوام الكلية: المسائي للهندسية حتى 8:30، وطب الأسنان حتى 4:30 فلا تنبيهات «خارج الدوام»
  assert.equal(byType['warning:shift'] || 0, 0, JSON.stringify(byType));
  const eng = after.groups.find((g) => g.deptId === 'ai' && g.shift === 'evening');
  assert.deepEqual(shiftWindow(ctx, eng), { start: 750, end: 1230 });
  // الأستاذ المشارك يُحسب في التعارض
  const co = after.sessions.find((s) => (s.coTeacherIds || []).length);
  assert.equal(teachersOf(co).length, 2);
  const clash = { ...co, id: 'x', groupIds: [], roomId: null, teacherId: co.coTeacherIds[0], coTeacherIds: [] };
  assert.ok(checkAll([co, clash], ctx).get('x').some((i) => i.type === 'teacher'));
});
