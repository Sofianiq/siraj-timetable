import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, splitHours } from '../js/generator.js';
import { buildCtx, checkAll } from '../js/conflicts.js';

test('splitHours balances blocks', () => {
  assert.deepEqual(splitHours(3, 2), [2, 1]);
  assert.deepEqual(splitHours(4, 3), [2, 2]);
  assert.deepEqual(splitHours(2, 2), [2]);
  assert.deepEqual(splitHours(0, 2), []);
});

function fixture() {
  const settings = { days: [1, 2, 3, 4, 5], slotMinutes: 30,
    shifts: { morning: { start: 480, end: 840 }, evening: { start: 840, end: 1200 } } };
  const stages = [1, 2, 3, 4].map((l) => ({ id: `st${l}`, deptId: 'd1', level: l }));
  const groups = [];
  for (const st of stages) {
    groups.push({ id: `${st.id}a`, stageId: st.id, deptId: 'd1', name: 'أ', shift: 'morning', students: 30 });
    groups.push({ id: `${st.id}b`, stageId: st.id, deptId: 'd1', name: 'ب', shift: 'morning', students: 30 });
    groups.push({ id: `${st.id}e`, stageId: st.id, deptId: 'd1', name: 'م', shift: 'evening', students: 30 });
  }
  const teachers = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, name: `T${i}` }));
  teachers[0].availability = { 1: [[480, 1200]], 2: [[480, 1200]] };
  const rooms = [
    ...[1, 2, 3].map((i) => ({ id: `h${i}`, name: `H${i}`, type: 'hall', capacity: 70 })),
    ...[1, 2].map((i) => ({ id: `l${i}`, name: `L${i}`, type: 'lab', capacity: 35 })),
  ];
  const subjects = [];
  let k = 0;
  for (let l = 1; l <= 4; l++) for (let j = 0; j < 5; j++) {
    subjects.push({ id: `s${l}${j}`, deptId: 'd1', stageLevel: l, name: `S${l}${j}`,
      theoryHours: 2, practicalHours: j % 2 ? 2 : 0, theoryTeacherId: `t${k++ % 10}`, practicalTeacherId: `t${k++ % 10}` });
  }
  // حجز خارجي لكلية أخرى يجب احترامه
  const external = [{ id: 'x1', term: '', kind: 'external', roomId: 'h1', groupIds: [], day: 1, start: 480, end: 840 }];
  return { settings, stages, groups, teachers, rooms, subjects, external };
}

test('generates a conflict-free timetable respecting fixed bookings and availability', () => {
  const f = fixture();
  const res = generate({ subjects: f.subjects, stages: f.stages, groups: f.groups, teachers: f.teachers,
    rooms: f.rooms, fixedSessions: f.external, keptInScope: [], settings: f.settings, options: { seed: 42 } });
  assert.equal(res.unplaced.length, 0, JSON.stringify(res.unplaced.map((u) => u.subjectName)));
  const all = [...f.external, ...res.sessions.map((s, i) => ({ ...s, id: `n${i}`, term: '' }))];
  const ctx = buildCtx({ ...f });
  const errors = [...checkAll(all, ctx).values()].flat().filter((i) => i.level === 'error');
  assert.equal(errors.length, 0, errors.map((e) => e.message).join('\n'));
  for (const s of res.sessions) {
    if (s.teacherId === 't0') assert.ok([1, 2].includes(s.day));
    if (s.kind === 'practical') assert.ok(s.roomId.startsWith('l'));
    const g = f.groups.find((x) => x.id === s.groupIds[0]);
    const win = f.settings.shifts[g.shift];
    assert.ok(s.start >= win.start && s.end <= win.end);
  }
  // النظري يجمع شعب الصباحي معاً
  const th = res.sessions.find((s) => s.kind === 'theory' && s.subjectId === 's10' && s.groupIds.length === 2);
  assert.ok(th);
});

test('kept sessions reduce the demanded hours', () => {
  const f = fixture();
  const kept = [{ id: 'k', term: '', subjectId: 's10', kind: 'theory', groupIds: ['st1a', 'st1b'], teacherId: 't0', roomId: 'h2', day: 2, start: 480, end: 600 }];
  const res = generate({ subjects: [f.subjects[0]], stages: f.stages, groups: f.groups, teachers: f.teachers,
    rooms: f.rooms, fixedSessions: kept, keptInScope: kept, settings: f.settings, options: { seed: 1 } });
  // بقي النظري لشعبة المسائي فقط
  assert.equal(res.sessions.length, 1);
  assert.deepEqual(res.sessions[0].groupIds, ['st1e']);
});

test('practical lab groups (A–D) run in parallel in different labs while theory takes the whole section', async () => {
  const { generate } = await import('../js/generator.js');
  const { checkAll, buildCtx } = await import('../js/conflicts.js');
  const settings = { days: [1, 2, 3], slotMinutes: 30, shifts: { morning: { start: 510, end: 930 }, evening: { start: 930, end: 1200 } } };
  const stages = [{ id: 'st2', deptId: 'ph', level: 2 }];
  const groups = [{ id: 'g', deptId: 'ph', stageId: 'st2', shift: 'morning', students: 80, subgroups: ['A', 'B', 'C', 'D'] }];
  const names = ['Microbiology', 'Physical Pharmacy', 'Physiology', 'Organic Chemistry'];
  const teachers = names.map((_, i) => ({ id: `t${i}`, name: `T${i}` })).concat([{ id: 'tt', name: 'Theory' }]);
  const subjects = names.map((n, i) => ({ id: `s${i}`, deptId: 'ph', stageLevel: 2, semester: 1, name: n, theoryHours: 0, practicalHours: 2, practicalTeacherId: `t${i}` }))
    .concat([{ id: 'th', deptId: 'ph', stageLevel: 2, semester: 1, name: 'Pharmacology', theoryHours: 2, practicalHours: 0, theoryTeacherId: 'tt' }]);
  const rooms = [{ id: 'hall', type: 'hall', capacity: 100 }, ...[1, 2, 3, 4].map((i) => ({ id: `lab${i}`, type: 'lab', capacity: 25 }))];
  const res = generate({ subjects, stages, groups, teachers, rooms, fixedSessions: [], keptInScope: [], settings, options: { restarts: 10, seed: 3 } });
  assert.equal(res.unplaced.length, 0);
  const practical = res.sessions.filter((x) => x.kind === 'practical');
  assert.equal(practical.length, 16); // 4 مجاميع × 4 مواد
  for (const sub of ['A', 'B', 'C', 'D']) assert.equal(new Set(practical.filter((x) => x.subgroups[0] === sub).map((x) => x.subjectId)).size, 4);
  // 32 ساعة عملي في 21 ساعة دوام: لا بد أن تعمل المجاميع بالتوازي في مختبرات مختلفة
  assert.ok(practical.some((a) => practical.some((b) => a !== b && a.day === b.day && a.start < b.end && b.start < a.end && a.roomId !== b.roomId)));
  const all = res.sessions.map((x, i) => ({ ...x, id: `x${i}`, term: '' }));
  const issues = checkAll(all, buildCtx({ rooms, groups, teachers, subjects, settings }));
  const errors = [...issues.values()].flat().filter((i) => i.level === 'error');
  assert.equal(errors.length, 0);
  // النظري للشعبة كاملة لا يتداخل مع أي عملي
  const th = all.find((x) => x.kind === 'theory');
  assert.ok(!all.some((x) => x.kind === 'practical' && x.start < th.end && th.start < x.end));
});
