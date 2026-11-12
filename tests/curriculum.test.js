import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curriculumImportPlan, subjectSimilarity, samePerson } from '../js/seed/curriculum.js';
import { CURRICULUM, TEACHERS } from '../js/seed/curriculum-data.js';
import { migrationPlan, SCHEMA_VERSION } from '../js/seed/radiology.js';

const ids = () => { let n = 0; return () => `n${n++}`; };
const base = () => ({
  settings: [{ id: 'app', schemaVersion: 4, shifts: { morning: { start: 480, end: 840 }, evening: { start: 870, end: 1200 } } }],
  colleges: [{ id: 'hmt', name: 'كلية التقنيات الصحية والطبية', own: true }, { id: 'ph', name: 'كلية الصيدلة', own: true }],
  departments: [
    { id: 'an', name: 'قسم تقنيات التخدير', collegeId: 'hmt' },
    { id: 'ch', name: 'قسم تقنيات صحة المجتمع', collegeId: 'hmt' },
    { id: 'phd', name: 'الصيدلة', collegeId: 'ph', general: true },
  ],
  subjects: [
    { id: 'x1', deptId: 'an', stageLevel: 2, semester: 1, name: 'اسس التخدير', theoryHours: 2, practicalHours: 2 },
    { id: 'x2', deptId: 'an', stageLevel: 2, semester: 1, name: 'اسس اجهزة التخدير', theoryHours: 2, practicalHours: 2 },
    { id: 'x3', deptId: 'ch', stageLevel: 2, semester: 1, name: 'وبائيات 1', theoryHours: 2, practicalHours: 1 },
    { id: 'x4', deptId: 'ch', stageLevel: 2, semester: 1, name: 'مادة خاصة بالقسم', theoryHours: 2, practicalHours: 0 },
    { id: 'x5', deptId: 'phd', stageLevel: 2, semester: 1, name: 'Microbiology', theoryHours: 3, practicalHours: 8 },
  ],
  teachers: [{ id: 't1', name: 'د. عبد الرحمن عبد الاله', deptId: 'an' }, { id: 't2', name: 'م.د عمر فلاح ابراهيم', deptId: 'an' }],
  rooms: [{ id: 'r1', name: 'مختبر الحاسوب', type: 'hall' }, { id: 'r2', name: 'قاعة 1', type: 'hall' }],
});

test('subject names match despite numbering, «علم/ال» prefixes and short forms, but not opposite meanings', () => {
  assert.ok(subjectSimilarity('وبائيات 1', 'علم الوبائيات 1') >= 0.75);
  assert.ok(subjectSimilarity('جرائم حزب البعث', 'جرائم نظام البعث في العراق') >= 0.75);
  assert.ok(subjectSimilarity('صحة بيئية ١', 'صحة بيئة 1') >= 0.75);
  assert.ok(subjectSimilarity('فيزياء الرنين', 'فيزياء الرنين المغناطيسي') >= 0.75);
  assert.equal(subjectSimilarity('التشريح 1', 'التشريح 2'), 0);
  assert.equal(subjectSimilarity('تقنيات التصوير الشعاعي للأطراف العليا', 'تقنيات التصوير الشعاعي للاطراف السفلى'), 0);
  assert.equal(subjectSimilarity('اسس الجراحة', 'اسس الطب الباطني (1)'), 0);
});

test('teacher names: titles ignored, short and full forms are one person, different people stay apart', () => {
  assert.ok(samePerson('د. طلال عبد', 'د. طلال عبد اللطيف'));
  assert.ok(samePerson('م.م عمر فلاح', 'م.د عمر فلاح ابراهيم'));
  assert.ok(samePerson('د. احمد شاكر', 'م.د أحمد شاكر حمدي'));
  assert.ok(!samePerson('د. احمد شاكر', 'د. احمد محمود شاكر'));
  assert.ok(!samePerson('م.م عمر علي', 'م.م عمر سليمان'));
  // قائمة الكادر نفسها بلا تكرار
  for (let i = 0; i < TEACHERS.length; i++) for (let j = i + 1; j < TEACHERS.length; j++) assert.ok(!samePerson(TEACHERS[i][0], TEACHERS[j][0]), `${TEACHERS[i][0]} / ${TEACHERS[j][0]}`);
});

test('curriculum import updates matching subjects in place, adds the rest, leaves other colleges, and is idempotent', () => {
  const data = base();
  const { ops, stats } = curriculumImportPlan(data, ids());
  const upd = Object.fromEntries(ops.filter((o) => o.op === 'update').map((o) => [o.id, o.data]));
  assert.equal(upd.x1.name, 'اسس التخدير 1');
  assert.equal(upd.x2.name, 'اسس اجهزة التخدير 1');
  assert.equal(upd.x3.name, 'علم الوبائيات 1');
  assert.deepEqual([upd.x3.theoryHours, upd.x3.practicalHours], [2, 4]);
  assert.ok(!upd.x4 && !upd.x5, 'unmatched and other-college subjects untouched');
  assert.ok(!ops.some((o) => o.op === 'delete'));
  const added = ops.filter((o) => o.op === 'set' && o.col === 'subjects');
  assert.equal(added.length, CURRICULUM.ANS.length + CURRICULUM.CHT.length - 3);
  assert.ok(added.every((o) => ['an', 'ch'].includes(o.data.deptId)));
  assert.ok(added.every((o) => o.data.theoryHours + o.data.practicalHours > 0));
  assert.equal(stats.updated, 3);
  // الأساتذة الموجودون لا يتكررون
  const newT = ops.filter((o) => o.col === 'teachers').map((o) => o.data.name);
  assert.ok(!newT.some((n) => samePerson(n, 'د. عبد الرحمن عبد الاله') || samePerson(n, 'م.د عمر فلاح ابراهيم')));
  // التطبيق ثم إعادة الاستيراد لا يضيف شيئاً
  const after = { ...data, subjects: [...data.subjects], teachers: [...data.teachers] };
  for (const o of ops) {
    const arr = after[o.col];
    if (o.op === 'update') { const i = arr.findIndex((x) => x.id === o.id); arr[i] = { ...arr[i], ...o.data }; } else arr.push({ ...o.data, id: o.id });
  }
  assert.equal(curriculumImportPlan(after, ids()).ops.length, 0);
});

test('v5 migration: working hours 8:30–2:30, labs recorded as halls fixed, curriculum imported, settings written once', () => {
  const { ops, notes } = migrationPlan(base(), ids());
  const st = ops.filter((o) => o.col === 'settings');
  assert.equal(st.length, 1);
  assert.equal(st[0].data.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual([st[0].data.dayStart, st[0].data.dayEnd, st[0].data.printStart, st[0].data.printEnd], [510, 870, 510, 870]);
  assert.deepEqual(st[0].data.shifts.morning, { start: 510, end: 870 });
  assert.deepEqual(st[0].data.shifts.evening, { start: 870, end: 1200 });
  assert.deepEqual(ops.filter((o) => o.col === 'rooms').map((o) => [o.id, o.data.type]), [['r1', 'lab']]);
  assert.ok(ops.some((o) => o.col === 'subjects' && o.op === 'set'));
  assert.ok(notes.length >= 3);
});
