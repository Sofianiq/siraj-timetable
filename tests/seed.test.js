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

test('v3 migration: external Pharmacy becomes managed, duplicate Dentistry merges, group-less stages and sessions are fixed', () => {
  const v2 = {
    settings: [{ id: 'app', schemaVersion: 2 }],
    colleges: [
      { id: 'hmt', name: COLLEGE_NAME, own: true },
      { id: 'phx', name: 'كلية الصيدلة', own: false, order: 99 },
      { id: 'dnx', name: 'كلية طب الاسنان', own: false, order: 99 },
      { id: 'dn', name: 'كلية طب الأسنان', own: true, order: 3 },
    ],
    departments: [{ id: 'an', name: 'قسم تقنيات التخدير', collegeId: 'hmt' }, { id: 'dg', name: 'طب الأسنان', collegeId: 'dn', general: true }],
    stages: [{ id: 'an1', deptId: 'an', level: 1 }, { id: 'an2', deptId: 'an', level: 2 }, { id: 'dg1', deptId: 'dg', level: 1 }],
    groups: [{ id: 'dg1g', deptId: 'dg', stageId: 'dg1' }],
    subjects: [{ id: 'sub2', deptId: 'an', stageLevel: 2 }],
    rooms: [{ id: 'r1', name: 'قاعة الفلوجة', collegeId: 'dnx' }, { id: 'r2', name: 'قاعة السراج', collegeId: 'phx' }],
    sessions: [
      { id: 's1', deptId: 'an', subjectId: 'sub2', kind: 'theory', groupIds: [] },
      { id: 's2', deptId: 'an', subjectId: 'missing', kind: 'theory', groupIds: [] },
      { id: 's3', kind: 'external', groupIds: [] },
    ],
  };
  const ops = migrationOps(v2, ids());
  const find = (col, id) => ops.filter((o) => o.col === col && o.id === id);
  // الصيدلة تتحول إلى كلية مُدارة بقسم عام ومراحل وشعب، وتبقى قاعتها مرتبطة بها
  assert.equal(find('colleges', 'phx')[0].data.own, true);
  const phDept = ops.find((o) => o.col === 'departments' && o.data.collegeId === 'phx');
  assert.ok(phDept?.data.general);
  assert.equal(ops.filter((o) => o.col === 'stages' && o.data.deptId === phDept.id).length, 5);
  // نسخة طب الأسنان المكررة تُدمج: قاعتها تنتقل إلى الكلية المُدارة ثم تُحذف
  assert.deepEqual(find('rooms', 'r1')[0].data, { collegeId: 'dn' });
  assert.deepEqual(find('colleges', 'dnx').map((o) => o.op), ['delete']);
  assert.ok(!find('rooms', 'r2').length);
  assert.ok(!ops.some((o) => o.op === 'delete' && o.col !== 'colleges'));
  // شعبة «صباحي» لكل مرحلة بلا شعب فقط
  const newGroups = ops.filter((o) => o.col === 'groups' && o.data.deptId === 'an');
  assert.deepEqual(newGroups.map((o) => o.data.stageId).sort(), ['an1', 'an2']);
  assert.ok(!ops.some((o) => o.col === 'groups' && o.data.stageId === 'dg1'));
  // المحاضرة تُربط بشعبة مرحلة مادتها، وما لا يمكن تحديده يبقى كما هو
  const g2 = newGroups.find((o) => o.data.stageId === 'an2').id;
  assert.deepEqual(find('sessions', 's1')[0].data, { groupIds: [g2] });
  assert.ok(!find('sessions', 's2').length && !find('sessions', 's3').length);
  assert.ok(ops.some((o) => o.col === 'settings' && o.data.schemaVersion === SCHEMA_VERSION));
});

test('fresh seed gives every stage at least one group', () => {
  const data = toData(seedOps(ids()));
  const without = data.stages.filter((st) => !data.groups.some((g) => g.stageId === st.id));
  assert.equal(without.length, 0);
});

test('v4 migration: managed Pharmacy/Dentistry without departments get a general department, stages and groups', () => {
  const v3 = {
    settings: [{ id: 'app', schemaVersion: 3 }],
    colleges: [
      { id: 'hmt', name: COLLEGE_NAME, own: true, order: 1 },
      { id: 'ph', name: 'كلية الصيدلة', own: true, order: 99 },
      { id: 'dn', name: 'كلية طب الاسنان', own: true, order: 99 },
    ],
    departments: [{ id: 'an', name: 'قسم تقنيات التخدير', collegeId: 'hmt' }],
    stages: [{ id: 'an1', deptId: 'an', level: 1 }], groups: [{ id: 'g1', deptId: 'an', stageId: 'an1' }],
  };
  const ops = migrationOps(v3, ids());
  for (const cid of ['ph', 'dn']) {
    const dept = ops.find((o) => o.col === 'departments' && o.data.collegeId === cid);
    assert.ok(dept?.data.general, cid);
    const stageIds = ops.filter((o) => o.col === 'stages' && o.data.deptId === dept.id).map((o) => o.id);
    assert.equal(stageIds.length, 5);
    assert.equal(ops.filter((o) => o.col === 'groups' && stageIds.includes(o.data.stageId)).length, 5);
    assert.ok(ops.find((o) => o.col === 'colleges' && o.id === cid).data.order < 99);
  }
  assert.ok(!ops.some((o) => o.op === 'delete'));
  assert.ok(!ops.some((o) => o.col === 'departments' && o.data.collegeId === 'hmt'));
  // لا تتكرر بعد الترقية
  assert.equal(migrationOps({ ...v3, settings: [{ id: 'app', schemaVersion: SCHEMA_VERSION }] }, ids()).length, 0);
});
