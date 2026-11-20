/**
 * استيراد جداول كليات الجامعة (دالة نقية تعيد عمليات كتابة وتقريراً للمعاينة قبل الحفظ).
 *
 * - الكليات والأقسام تُطابَق بالاسم مع ما أضافه المستخدم («الكلية التقنية الهندسية» = «كلية التقنية الهندسية»)،
 *   وتُنشأ فقط إن لم توجد. المراحل والشعب (صباحي/مسائي) ومجاميع العملي تُكمَّل حسب الجداول.
 * - القاعات تُطابَق بالرمز أو الاسم على مستوى الجامعة، وتُسجَّل الكلية المالكة لكل قاعة.
 * - الأساتذة يُطابَقون داخل كادر الكلية نفسها فقط (تجاهل اللقب، والاسم المختصر = الكامل)، فلا يُخلط بين شخصين
 *   بالاسم نفسه في كليتين. المشتركون بين الكليات مُعرَّفون في البيانات فيُضافون مرة واحدة مع كلياتهم الأخرى.
 * - المواد تُطابَق في القسم والمرحلة والفصل، وتُحدَّث ساعاتها وأساتذتها، وتُضاف غير الموجودة.
 * - المحاضرات لها معرّفات ثابتة مشتقة من محتواها، فإعادة الاستيراد تحدّثها ولا تكررها، وتُثبَّت 🔒 حتى لا يحرّكها التوليد التلقائي.
 */
import { normName, normPerson, stripTitle } from '../text.js';
import { STAGE_NAMES, SHIFTS } from '../timeutil.js';
import { subjectSimilarity, samePerson } from './curriculum.js';
import { DATA_VERSION, TERM, COLLEGES, ROOMS, TEACHERS, SUBJECTS, GROUPS, SESSIONS, SKIPPED_ROOMS, REMOVED_GROUPS, REPLACED_GROUPS } from './university-data.js';

export { DATA_VERSION, TERM, SKIPPED_ROOMS };

const N = (v) => normName(v).toLowerCase().replace(/^(ال)/, '');
/** هل يطابق الاسم إحدى مجموعات الكلمات (كل كلمات المجموعة موجودة) دون كلمات الاستثناء؟ */
export function matchName(name, match = [], exclude = []) {
  const n = normName(name);
  return match.some((words) => words.every((w) => n.includes(normName(w)))) && !exclude.some((w) => n.includes(normName(w)));
}
const codeKey = (v) => String(v || '').toUpperCase().replace(/\s+/g, '');
const SIG_FIELDS = ['term', 'deptId', 'subjectId', 'kind', 'groupIds', 'subgroups', 'teacherId', 'coTeacherIds', 'roomId', 'day', 'start', 'end', 'note'];
/** معرّف ثابت من نص (FNV-1a) */
function hashId(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `tt${(h >>> 0).toString(36)}${text.length.toString(36)}`;
}
/** معرّف المحاضرة المستوردة من صفّها في البيانات */
const sessionKey = ([path, level, shift, subj, kind, day, start, end, , , subs, , group]) =>
  hashId(`${path}|${level}|${shift}${group ? `#${group}` : ''}|${day}|${start}|${end}|${subj}|${kind}|${subs.join('')}`);
/** بصمة الحقول المستوردة في المحاضرة: تكشف إن عدّلها المستخدم يدوياً بعد الاستيراد */
export const importSignature = (o) => hashId(JSON.stringify(SIG_FIELDS.map((k) => o[k] ?? null)));
/** اللقب العلمي من بداية الاسم */
function titleOf(name) {
  const n = normName(name);
  if (/^ا\s*\.\s*م\s*\.\s*د/.test(n)) return 'أستاذ مساعد';
  if (/^ا\s*\.\s*د/.test(n)) return 'أستاذ';
  if (/^ا\s*\.\s*م/.test(n)) return 'أستاذ مساعد';
  if (/^م\s*\.\s*د/.test(n)) return 'مدرس';
  if (/^م\s*\.\s*م/.test(n)) return 'مدرس مساعد';
  if (/^م\s*\./.test(n)) return 'مدرس';
  return null;
}

/**
 * @param {Object} data بيانات النظام الحالية (store.data)
 * @param {() => string} uid مولد المعرّفات
 * @param {{replace?: boolean}} options replace: حذف المحاضرات الأخرى لشعب الجداول المستوردة في الفصل نفسه
 */
export function universityImportPlan(data, uid, { replace = false } = {}) {
  const ops = [];
  const count = () => ({ colleges: 0, departments: 0, stages: 0, groups: 0, rooms: 0, teachers: 0, subjects: 0, sessions: 0 });
  const report = { created: count(), updated: count(), colleges: [], departments: [], warnings: [], similarTeachers: [], retiredRooms: [], replaced: 0, existingOther: 0, removed: [], keptEdited: [], renamedGroups: [], removedGroups: [], replacedTimetables: 0, sharedRooms: [], noRoom: [] };
  const colleges = [...(data.colleges || [])];
  const departments = [...(data.departments || [])];
  const stages = [...(data.stages || [])];
  const groups = [...(data.groups || [])];

  /* ---------------- الكليات ---------------- */
  const collegeId = {};
  let order = Math.max(0, ...colleges.map((c) => Number(c.order) || 0));
  for (const C of COLLEGES) {
    const c = colleges.find((x) => x.own !== false && matchName(x.name, C.match, C.exclude));
    const hours = {};
    for (const [shift, [a, b]] of Object.entries(C.hours || {})) { hours[`${shift}Start`] = a; hours[`${shift}End`] = b; }
    if (c) {
      collegeId[C.key] = c.id;
      // تُكمَّل الحقول الفارغة فقط، ولا يُغيَّر ما أدخله المستخدم
      const patch = {};
      if (C.logo && !c.logo) patch.logo = C.logo;
      if (C.dean && !c.dean) patch.dean = C.dean;
      for (const [k, v] of Object.entries(hours)) if (!c[k]) patch[k] = v;
      if (Object.keys(patch).length) { ops.push({ op: 'update', col: 'colleges', id: c.id, data: patch }); report.updated.colleges++; }
      report.colleges.push({ key: C.key, name: c.name, status: 'matched', rooms: C.roomsOnly });
    } else if (C.existing) {
      report.warnings.push(`لم يُعثر على «${C.name}» في النظام، فلن تُربط بها قاعاتها في الترميز.`);
    } else {
      const id = uid();
      const doc = { name: C.name, short: C.short, order: ++order, own: true, ...(C.logo ? { logo: C.logo } : {}), ...(C.dean ? { dean: C.dean } : {}), ...hours };
      ops.push({ op: 'set', col: 'colleges', id, data: doc });
      colleges.push({ id, ...doc });
      collegeId[C.key] = id;
      report.created.colleges++;
      report.colleges.push({ key: C.key, name: C.name, status: 'created', rooms: C.roomsOnly });
    }
  }

  /* ---------------- الأقسام ---------------- */
  const deptId = {};
  for (const C of COLLEGES) {
    const cid = collegeId[C.key];
    if (!cid) continue;
    const used = new Set();
    for (const D of C.departments || []) {
      const path = `${C.key}/${D.key}`;
      const own = departments.filter((d) => d.collegeId === cid && !used.has(d.id));
      let d = D.general
        ? own.find((x) => x.general) || (own.length === 1 ? own[0] : null)
        : own.find((x) => !x.general && matchName(x.name, D.match));
      if (d) {
        const patch = {};
        if (D.head && !d.head) patch.head = D.head;
        if (D.short && !d.short && !d.general) patch.short = D.short;
        if (Object.keys(patch).length) ops.push({ op: 'update', col: 'departments', id: d.id, data: patch });
        report.departments.push({ path, name: d.name, college: C.name, status: 'matched' });
      } else {
        const id = uid();
        const doc = { name: D.name, collegeId: cid, ...(D.short ? { short: D.short } : {}), ...(D.general ? { general: true } : {}), ...(D.head ? { head: D.head } : {}) };
        ops.push({ op: 'set', col: 'departments', id, data: doc });
        d = { id, ...doc };
        departments.push(d);
        report.created.departments++;
        report.departments.push({ path, name: D.name, college: C.name, status: 'created' });
      }
      used.add(d.id);
      deptId[path] = d.id;
    }
  }

  /* ---------------- المراحل والشعب ومجاميع العملي ---------------- */
  const groupId = {};
  const term = `${TERM.year}/${TERM.semester}`;
  // محاضرات مستوردة سابقاً لم تعد في البيانات الرسمية (جدول استُبدل): تُحذف ما لم يعدّلها المستخدم
  const datasetIds = new Set(SESSIONS.map(sessionKey));
  const staleOf = (list) => list.filter((s) => s.source === 'university' && (s.term || '') === term && !datasetIds.has(s.id));
  const unedited = (s) => !!s.importSig && importSignature(s) === s.importSig;
  const stale = staleOf(data.sessions || []);
  const removable = new Set(stale.filter(unedited).map((s) => s.id));
  const claimed = new Set();
  for (const [path, level, shift, subs, name] of GROUPS) {
    const did = deptId[path];
    if (!did) continue;
    let st = stages.find((x) => x.deptId === did && Number(x.level) === level);
    if (!st) {
      st = { id: uid(), deptId: did, level, name: `المرحلة ${STAGE_NAMES[level]}` };
      ops.push({ op: 'set', col: 'stages', id: st.id, data: { deptId: did, level, name: st.name } });
      stages.push(st);
      report.created.stages++;
    }
    const cands = groups.filter((g) => g.stageId === st.id && (g.shift || 'morning') === shift && !claimed.has(g.id));
    const generic = cands.find((x) => normName(x.name) === normName(SHIFTS[shift]));
    let g;
    if (name) {
      g = cands.find((x) => normName(x.name) === normName(name));
      // الشعبة العامة («صباحي») التي لم يبقَ فيها إلا محاضرات الجدول القديم تصبح أولى الشعب المسمّاة (يبقى معرّفها وعدد طلبتها)
      const onlyOld = generic && (data.sessions || []).every((s) => !(s.groupIds || []).includes(generic.id) || removable.has(s.id));
      if (!g && onlyOld) {
        g = generic;
        ops.push({ op: 'update', col: 'groups', id: g.id, data: { name, subgroups: subs } });
        report.updated.groups++;
        report.renamedGroups.push({ from: g.name, to: name });
        g = { ...g, name, subgroups: subs };
      }
    } else g = generic || cands[0];
    if (!g) {
      g = { id: uid(), deptId: did, stageId: st.id, shift, name: name || SHIFTS[shift], students: 0, subgroups: subs };
      ops.push({ op: 'set', col: 'groups', id: g.id, data: { deptId: did, stageId: st.id, shift, name: g.name, students: 0, subgroups: subs } });
      groups.push(g);
      report.created.groups++;
    } else if (subs.length) {
      const merged = [...new Set([...(g.subgroups || []), ...subs])];
      if (merged.length !== (g.subgroups || []).length) {
        ops.push({ op: 'update', col: 'groups', id: g.id, data: { subgroups: merged } });
        report.updated.groups++;
      }
    }
    claimed.add(g.id);
    groupId[`${path}|${level}|${shift}|${name || ''}`] = g.id;
  }

  // جداول تُستبدل بالكامل (مثل طب الأسنان): كل محاضرات شعبها في الفصل غير الواردة في البيانات تُحذف، ولو عُدّلت أو أُضيفت يدوياً
  const replacedGids = new Set(REPLACED_GROUPS.map(([p, l, sh]) => groupId[`${p}|${l}|${sh}|`]).filter(Boolean));
  const replacedOld = (data.sessions || []).filter((s) => (s.term || '') === term && !datasetIds.has(s.id) && (s.groupIds || []).some((g) => replacedGids.has(g)));
  for (const s of replacedOld) removable.add(s.id);

  /* ---------------- القاعات (على مستوى الجامعة) ---------------- */
  const roomId = {};
  const rooms = [...(data.rooms || [])];
  for (const [key, name, code, type, college, dept, building] of ROOMS) {
    const r = rooms.find((x) => (code && (codeKey(x.code) === codeKey(code) || codeKey(x.name) === codeKey(code)))
      || normName(x.name) === normName(name));
    if (r) {
      const patch = {};
      if (code && !r.code) patch.code = code;
      if (building && !r.building) patch.building = building;
      // القاعات المرمّزة: الكلية المالكة حسب الترميز الرسمي (لكل كلية قاعاتها). غير المرمّزة: تُكمَّل الكلية إن كانت فارغة فقط
      const owner = (college && collegeId[college]) || null;
      if (code && owner && r.collegeId !== owner) patch.collegeId = owner;
      else if (!r.collegeId && owner) patch.collegeId = owner;
      if (code && r.active === false) patch.active = true;
      if (Object.keys(patch).length) { ops.push({ op: 'update', col: 'rooms', id: r.id, data: patch }); report.updated.rooms++; }
      roomId[key] = r.id;
    } else {
      const id = uid();
      const doc = { name, code: code || '', type, labKind: '', capacity: null, collegeId: collegeId[college] || null,
        deptId: dept ? deptId[`${college}/${dept}`] || null : null, building: building || '', active: true, source: 'university' };
      ops.push({ op: 'set', col: 'rooms', id, data: doc });
      rooms.push({ id, ...doc });
      roomId[key] = id;
      report.created.rooms++;
    }
  }
  // رموز أصبحت مكاتب في الترميز المحدَّث (مثل SE011 قسم التسجيل): تُحذف القاعة إن لم تُستخدم، وإلا تُعطَّل حتى لا تُحجز
  for (const [code, label] of SKIPPED_ROOMS) {
    for (const r of rooms.filter((x) => codeKey(x.code) === codeKey(code) || codeKey(x.name) === codeKey(code))) {
      if ((data.sessions || []).some((s) => s.roomId === r.id)) {
        if (r.active === false) continue;
        ops.push({ op: 'update', col: 'rooms', id: r.id, data: { active: false } });
        report.retiredRooms.push({ code, label, action: 'disabled' });
      } else {
        ops.push({ op: 'delete', col: 'rooms', id: r.id });
        report.retiredRooms.push({ code, label, action: 'deleted' });
      }
    }
  }

  /* ---------------- الأساتذة ---------------- */
  const homeCollege = (t) => departments.find((d) => d.id === t.deptId)?.collegeId;
  const collegesOf = (t) => [homeCollege(t), ...(t.sharedColleges || [])].filter(Boolean);
  const existingTeachers = data.teachers || [];
  const generalDept = (ck) => {
    const cid = collegeId[ck];
    return departments.find((d) => d.collegeId === cid && d.general)?.id || departments.find((d) => d.collegeId === cid)?.id;
  };
  const teacherId = {};
  for (const [key, name, college, dept, shared, cross] of TEACHERS) {
    const cid = collegeId[college];
    if (!cid) continue;
    const sharedIds = shared.map((k) => collegeId[k]).filter(Boolean);
    const pool = existingTeachers.filter((t) => collegesOf(t).includes(cid));
    let t = pool.find((x) => normPerson(x.name) === normPerson(name));
    if (!t) { const sim = pool.filter((x) => samePerson(x.name, name)); if (sim.length === 1) [t] = sim; }
    if (!t && cross) { const sim = existingTeachers.filter((x) => samePerson(x.name, name)); if (sim.length === 1) [t] = sim; }
    if (t) {
      const home = homeCollege(t);
      const want = [...new Set([...(t.sharedColleges || []), cid, ...sharedIds])].filter((c) => c && c !== home);
      if (want.length !== (t.sharedColleges || []).filter((c) => c !== home).length) {
        ops.push({ op: 'update', col: 'teachers', id: t.id, data: { sharedColleges: want } });
        report.updated.teachers++;
      }
      teacherId[key] = t.id;
    } else {
      const id = uid();
      const home = (dept && deptId[`${college}/${dept}`]) || generalDept(college);
      ops.push({ op: 'set', col: 'teachers', id, data: { name, title: titleOf(name), deptId: home, availability: {}, sharedColleges: sharedIds.filter((c) => c !== cid) } });
      teacherId[key] = id;
      report.created.teachers++;
      // تشابه أسماء مع كادر كلية أخرى: يُعرض للمراجعة ولا يُدمج تلقائياً
      const other = existingTeachers.filter((x) => !collegesOf(x).includes(cid) && normPerson(x.name) === normPerson(name));
      if (other.length) report.similarTeachers.push({ name, college: COLLEGES.find((c) => c.key === college).name, other: other.map((x) => x.name) });
    }
  }

  /* ---------------- المواد ---------------- */
  const subjectId = {};
  const existingSubjects = data.subjects || [];
  const usedSubj = new Set();
  for (const [path, level, name, th, pr, online, tt, pt, opts = {}] of SUBJECTS) {
    const did = deptId[path];
    if (!did) continue;
    const pool = existingSubjects.filter((s) => s.deptId === did && Number(s.stageLevel) === level && Number(s.semester || 1) === TERM.semester && !usedSubj.has(s.id));
    let s = pool.find((x) => N(x.name) === N(name));
    if (!s) {
      const best = pool.map((x) => [x, subjectSimilarity(x.name.toLowerCase(), name.toLowerCase())]).filter(([, sc]) => sc >= 0.8).sort((a, b) => b[1] - a[1])[0];
      if (best) [s] = best;
    }
    const official = { theoryHours: th, practicalHours: pr, onlineHours: online || 0 };
    const tids = { theoryTeacherId: teacherId[tt] || null, practicalTeacherId: teacherId[pt] || null };
    if (s) {
      usedSubj.add(s.id);
      const patch = {};
      for (const [k, v] of Object.entries(official)) if ((s[k] ?? 0) !== v) patch[k] = v;
      for (const [k, v] of Object.entries(tids)) if (v && !s[k]) patch[k] = v;
      if (s.needsReview) patch.needsReview = false;
      // hall: العملي في قاعة دراسية؛ separate: نظري كل شعبة وحده (المجموعتان A وB)
      if (opts.hall && !s.practicalInHall) patch.practicalInHall = true;
      if (opts.separate && s.combineTheory !== false) patch.combineTheory = false;
      if (Object.keys(patch).length) { ops.push({ op: 'update', col: 'subjects', id: s.id, data: patch }); report.updated.subjects++; }
      subjectId[`${path}|${level}|${name}`] = s.id;
    } else {
      const id = uid();
      ops.push({ op: 'set', col: 'subjects', id, data: {
        deptId: did, stageLevel: level, semester: TERM.semester, name, ...official, ...tids, labType: '', combineTheory: !opts.separate, fromTimetable: true,
        ...(opts.hall ? { practicalInHall: true } : {}),
      } });
      subjectId[`${path}|${level}|${name}`] = id;
      report.created.subjects++;
    }
  }

  /* ---------------- المحاضرات ---------------- */
  const sessions = data.sessions || [];
  const existingIds = new Set(sessions.map((s) => s.id));
  const keep = new Set();
  const touchedGroups = new Set();
  // القاعة: رمز من البيانات، أو «~اسم» لقاعة موجودة في النظام (مثل قاعات التقنيات الصحية)، أو قائمة بدائل
  const resolveRoom = (k) => (String(k).startsWith('~')
    ? rooms.find((r) => r.active !== false && normName(r.name) === normName(String(k).slice(1)))?.id
    : roomId[k]) || null;
  const planned = [];
  for (const row of SESSIONS) {
    const [path, level, shift, subj, kind, day, start, end, tkeys, rkey, subs, note, group] = row;
    const gid = groupId[`${path}|${level}|${shift}|${group || ''}`];
    const sid = subjectId[`${path}|${level}|${subj}`];
    if (!gid || !sid) continue;
    touchedGroups.add(gid);
    const id = sessionKey(row);
    const tids = tkeys.map((k) => teacherId[k]).filter(Boolean);
    keep.add(id);
    const doc = {
      term, deptId: deptId[path], subjectId: sid, kind: kind === 'p' ? 'practical' : 'theory', groupIds: [gid], subgroups: subs,
      teacherId: tids[0] || null, coTeacherIds: tids.slice(1), roomId: Array.isArray(rkey) ? null : (rkey && resolveRoom(rkey)) || null,
      day, start, end, locked: true, auto: false, note: note || '', source: 'university',
    };
    const old = existingIds.has(id) ? sessions.find((x) => x.id === id) : null;
    const edited = !!(old?.importSig && importSignature(old) !== old.importSig);
    planned.push({ id, doc, old, edited, candidates: Array.isArray(rkey) ? rkey : null });
  }
  // قاعات البدائل: الأولى الشاغرة في بيانات النظام الحالية (مع تفضيل قاعتها الحالية)، فلا تتعارض مع جداول الكليات الأخرى المحدّثة
  const occ = sessions.filter((s) => (s.term || '') === term && !datasetIds.has(s.id) && !removable.has(s.id) && s.roomId);
  for (const p of planned) {
    if (p.edited) { if (p.old.roomId) occ.push(p.old); } else if (!p.candidates && p.doc.roomId) occ.push(p.doc);
  }
  const roomName = (rid) => rooms.find((r) => r.id === rid)?.name || '';
  const collegeOfDept = (did) => departments.find((d) => d.id === did)?.collegeId;
  for (const p of planned.filter((x) => x.candidates && !x.edited)) {
    const ids = [...new Set(p.candidates.map(resolveRoom).filter(Boolean))];
    const cur = p.old?.roomId;
    const order = cur && ids.includes(cur) ? [cur, ...ids.filter((x) => x !== cur)] : ids;
    const { day, start, end } = p.doc;
    const rid = order.find((r) => !occ.some((o) => o.roomId === r && o.day === day && o.start < end && start < o.end)) || null;
    p.doc.roomId = rid;
    const owner = rooms.find((r) => r.id === rid)?.collegeId;
    if (rid && owner && owner !== collegeOfDept(p.doc.deptId)) {
      p.doc.sharedRoom = true;   // قاعة كلية أخرى بالاتفاق: لا يظهر لها تنبيه «قاعة مملوكة لكلية أخرى»
      report.sharedRooms.push({ room: roomName(rid), day, start, end });
    }
    if (rid) occ.push(p.doc);
    else report.noRoom.push({ day, start, end });
  }
  for (const { id, doc, old, edited } of planned) {
    doc.importSig = importSignature(doc);
    if (old) {
      // لم تتغير البيانات، أو عدّلها المستخدم (وقت/قاعة/أستاذ) فتبقى تعديلاته
      if (old.importSig === doc.importSig || edited) continue;
      report.updated.sessions++;
    } else report.created.sessions++;
    ops.push({ op: 'set', col: 'sessions', id, data: doc });
  }
  // الجدول القديم المستبدل: حذف محاضراته المستوردة، وإبقاء ما عدّله المستخدم منها مع ذكره في التقرير
  const label = (s) => {
    const d = departments.find((x) => x.id === s.deptId);
    const g = groups.find((x) => (s.groupIds || []).includes(x.id));
    const st = stages.find((x) => x.id === g?.stageId);
    return [d?.name, st?.name, g?.name].filter(Boolean).join(' — ');
  };
  for (const s of stale) {
    if (removable.has(s.id)) { ops.push({ op: 'delete', col: 'sessions', id: s.id }); report.removed.push(label(s)); }
    else report.keptEdited.push(label(s));
  }
  for (const s of replacedOld) {
    if (stale.includes(s)) continue;
    ops.push({ op: 'delete', col: 'sessions', id: s.id });
    report.replacedTimetables++;
  }
  // شعب أُلغيت (مثل الدراسة المسائية للمرحلة الأولى في البناء والإنشاءات): تُحذف إن لم يبقَ فيها إلا محاضرات الجدول القديم
  for (const [path, level, shift] of REMOVED_GROUPS) {
    const st = stages.find((x) => x.deptId === deptId[path] && Number(x.level) === level);
    for (const g of groups.filter((x) => st && x.stageId === st.id && (x.shift || 'morning') === shift && !claimed.has(x.id))) {
      const left = sessions.filter((s) => (s.groupIds || []).includes(g.id) && !removable.has(s.id));
      if (left.length) { report.warnings.push(`لم تُحذف شعبة «${g.name}» (${label({ deptId: g.deptId, groupIds: [g.id] })}) لأن فيها ${left.length} محاضرة أخرى.`); continue; }
      ops.push({ op: 'delete', col: 'groups', id: g.id });
      report.removedGroups.push(label({ deptId: g.deptId, groupIds: [g.id] }));
    }
  }
  // محاضرات أخرى مسجّلة مسبقاً لشعب الجداول المستوردة في الفصل نفسه
  const others = sessions.filter((s) => (s.term || '') === term && !keep.has(s.id) && !stale.includes(s) && !removable.has(s.id) && (s.groupIds || []).some((g) => touchedGroups.has(g)));
  report.existingOther = others.length;
  if (replace) {
    for (const s of others) ops.push({ op: 'delete', col: 'sessions', id: s.id });
    report.replaced = others.length;
  }
  report.term = term;
  return { ops, report };
}

/** ملخص نصي قصير لأعداد ما سيُضاف ويُحدَّث */
export function importSummary(report) {
  const L = { colleges: 'كلية', departments: 'قسم', stages: 'مرحلة', groups: 'شعبة', rooms: 'قاعة/مختبر', teachers: 'أستاذ', subjects: 'مادة', sessions: 'محاضرة' };
  const part = (obj) => Object.entries(obj).filter(([, n]) => n).map(([k, n]) => `${n} ${L[k]}`).join('، ');
  return { created: part(report.created), updated: part(report.updated) };
}

/** اسم الأستاذ بدون لقب (للعرض في التقرير) */
export const bareName = (v) => stripTitle(v);
