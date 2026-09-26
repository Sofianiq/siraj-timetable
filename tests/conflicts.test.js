import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCtx, checkSession, checkAll, teacherAvailable } from '../js/conflicts.js';

const ctx = buildCtx({
  rooms: [{ id: 'r1', name: 'قاعة 1', type: 'hall', capacity: 40 }, { id: 'l1', name: 'مختبر 1', type: 'lab', capacity: 25 }],
  groups: [{ id: 'g1', name: 'أ', students: 30, shift: 'morning' }, { id: 'g2', name: 'ب', students: 30, shift: 'morning' }],
  teachers: [{ id: 't1', name: 'د. علي', availability: { 1: [[480, 720]] } }, { id: 't2', name: 'د. سارة' }],
  subjects: [{ id: 's1', name: 'فيزياء' }],
  settings: { shifts: { morning: { start: 480, end: 840 }, evening: { start: 840, end: 1200 } } },
});
const base = { term: 'T', day: 1, start: 480, end: 600, subjectId: 's1', kind: 'theory' };

test('teacher double-booking is an error', () => {
  const all = [{ ...base, id: 'a', teacherId: 't1', roomId: 'r1', groupIds: ['g1'] }];
  const s = { ...base, id: 'b', start: 540, end: 660, teacherId: 't1', roomId: 'l1', groupIds: ['g2'] };
  assert.ok(checkSession(s, all, ctx).some((i) => i.type === 'teacher' && i.level === 'error'));
});

test('room double-booking is an error (even external bookings)', () => {
  const all = [{ ...base, id: 'a', kind: 'external', roomId: 'r1', groupIds: [] }];
  const s = { ...base, id: 'b', teacherId: 't2', roomId: 'r1', groupIds: ['g1'] };
  assert.ok(checkSession(s, all, ctx).some((i) => i.type === 'room'));
});

test('group overlap is an error, adjacent sessions are fine', () => {
  const all = [{ ...base, id: 'a', teacherId: 't2', roomId: 'r1', groupIds: ['g1', 'g2'] }];
  assert.ok(checkSession({ ...base, id: 'b', roomId: 'l1', groupIds: ['g2'] }, all, ctx).some((i) => i.type === 'group'));
  assert.equal(checkSession({ ...base, id: 'c', start: 600, end: 660, roomId: 'r1', teacherId: 't2', groupIds: ['g1'] }, all, ctx).length, 0);
});

test('different term or day never clashes', () => {
  const all = [{ ...base, id: 'a', teacherId: 't2', roomId: 'r1', groupIds: ['g1'] }];
  assert.equal(checkSession({ ...all[0], id: 'b', term: 'X' }, all, ctx).length, 0);
  assert.equal(checkSession({ ...all[0], id: 'c', day: 2 }, all, ctx).length, 0);
});

test('capacity, availability and room type warnings', () => {
  const s = { ...base, id: 'x', kind: 'practical', teacherId: 't1', roomId: 'r1', groupIds: ['g1', 'g2'], start: 660, end: 780 };
  const types = checkSession(s, [], ctx).map((i) => i.type);
  assert.deepEqual(types.sort(), ['availability', 'capacity', 'roomType']);
});

test('teacherAvailable merges adjacent ranges', () => {
  assert.ok(teacherAvailable({ availability: { 1: [[480, 540], [540, 600]] } }, 1, 500, 590));
  assert.ok(!teacherAvailable({ availability: { 1: [[480, 540]] } }, 2, 480, 500));
  assert.ok(teacherAvailable({}, 3, 0, 100));
});

test('checkAll reports both sides of a clash', () => {
  const all = [
    { ...base, id: 'a', teacherId: 't2', roomId: 'r1', groupIds: ['g1'] },
    { ...base, id: 'b', teacherId: 't2', roomId: 'l1', groupIds: ['g2'] },
  ];
  const m = checkAll(all, ctx);
  assert.ok(m.has('a') && m.has('b'));
});
