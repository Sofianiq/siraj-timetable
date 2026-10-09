import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedOps, migrationOps, collegeStructureOps, COLLEGE_NAME, SCHEMA_VERSION } from '../js/seed/radiology.js';

const ids = () => { let n = 0; return () => `id${n++}`; };
const toData = (ops) => {
  const data = { settings: [], colleges: [], departments: [], stages: [], groups: [], subjects: [], teachers: [], rooms: [] };
  for (const o of ops) (data[o.col] ||= []).push({ ...o.data, id: o.id });
  return data;
};

test('fresh seed creates three managed colleges and needs no migration', () => {
  const data = toData(seedOps(ids()));
  const managed = data.colleges.filter((c) => c.own !== false).map((c) => c.name);
  assert.deepEqual(managed, [COLLEGE_NAME, 'كلية الصيدلة', 'كلية طب الأسنان']);
  assert.equal(migrationOps(data, ids()).length, 0);
});

test('migration adds Pharmacy and Dentistry once and keeps existing data', () => {
  const v1 = {
    settings: [{ id: 'app', semester: 2 }],
    colleges: [{ id: 'c1', name: COLLEGE_NAME, own: true }, { id: 'c2', name: 'كليات أخرى في الجامعة', own: false }],
  };
  const ops = migrationOps(v1, ids());
  const added = ops.filter((o) => o.op === 'set' && o.col === 'colleges').map((o) => o.data.name);
  assert.deepEqual(added, ['كلية الصيدلة', 'كلية طب الأسنان']);
  assert.ok(!ops.some((o) => o.op === 'delete'));
  assert.ok(ops.some((o) => o.col === 'settings' && o.data.schemaVersion === SCHEMA_VERSION));
  // بعد الترقية لا تتكرر
  assert.equal(migrationOps({ ...v1, settings: [{ id: 'app', schemaVersion: SCHEMA_VERSION }] }, ids()).length, 0);
});

test('college structure creates a general department with stages and groups', () => {
  const { ops } = collegeStructureOps(ids(), { name: 'كلية التمريض', stages: 4 });
  const data = toData(ops);
  assert.equal(data.departments.length, 1);
  assert.ok(data.departments[0].general);
  assert.equal(data.stages.length, 4);
  assert.equal(data.groups.length, 4);
});
