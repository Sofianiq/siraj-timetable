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
