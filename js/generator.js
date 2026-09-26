/**
 * مولّد الجداول التلقائي.
 *
 * الخوارزمية (Heuristic + Repair + Random Restarts):
 *  1. تحويل المواد إلى «طلبات» (Demands): كل طلب كتلة زمنية لمادة/نوع (نظري أو عملي)/مجموعة شعب/أستاذ.
 *     - النظري يُدرَّس افتراضياً لكل شعب المرحلة في نفس نوع الدراسة معاً (يمكن تعطيله لكل مادة).
 *     - العملي يُدرَّس لكل شعبة على حدة.
 *     - الساعات تُقسَّم إلى كتل لا تتجاوز الحد الأقصى (مثلاً 3 ساعات نظري → 2 + 1).
 *  2. ترتيب الطلبات من الأصعب للأسهل (الأقل خيارات متاحة أولاً، ثم الأطول، ثم الأكثر طلبة).
 *  3. لكل طلب: توليد كل الخيارات (يوم × وقت بداية × قاعة) التي تحقق القيود الصارمة:
 *     الأستاذ متفرغ ومتاح، القاعة شاغرة على مستوى الجامعة، الشعب غير مشغولة، ضمن وقت الدوام.
 *     ثم اختيار الخيار الأقل «كلفة» (توزيع المادة على أيام مختلفة، تقليل الفراغات، موازنة الحمل اليومي،
 *     ملاءمة سعة ونوع القاعة).
 *  4. الإصلاح: إن لم يوجد مكان لطلب، نحاول إزاحة طلب واحد يعيقه وإعادة وضعه في مكان آخر.
 *  5. تكرار العملية عدة مرات بترتيب عشوائي مختلف واختيار أفضل نتيجة.
 *
 * المحاضرات اليدوية أو المقفلة تبقى ثابتة وتُحتسب ساعاتها ضمن المطلوب.
 */
import { overlaps } from './timeutil.js';
import { teacherAvailable } from './conflicts.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** تقسيم عدد ساعات إلى كتل متوازنة لا تتجاوز max. مثال: (3,2) → [2,1] ، (4,3) → [2,2] */
export function splitHours(hours, max) {
  const h = Math.max(0, Math.round(Number(hours) * 2) / 2); // يدعم أنصاف الساعات
  if (!h) return [];
  const n = Math.ceil(h / max);
  const whole = Math.floor(h);
  const base = Math.floor(whole / n);
  const blocks = Array.from({ length: n }, (_, i) => base + (i < whole % n ? 1 : 0));
  blocks[n - 1] += h - whole; // نصف الساعة المتبقي (إن وُجد) يُضاف لأصغر كتلة
  return blocks.filter((b) => b > 0).sort((a, b) => b - a);
}

/** سجل الإشغال: لكل (نوع، معرّف، يوم) قائمة فترات مشغولة */
class Occupancy {
  constructor() { this.map = new Map(); }
  _k(type, id, day) { return `${type}|${id}|${day}`; }
  add(type, id, day, s, e, tag) {
    if (!id) return;
    const k = this._k(type, id, day);
    if (!this.map.has(k)) this.map.set(k, []);
    this.map.get(k).push({ s, e, tag });
  }
  removeTag(tag) {
    for (const list of this.map.values()) {
      for (let i = list.length - 1; i >= 0; i--) if (list[i].tag === tag) list.splice(i, 1);
    }
  }
  /** الوسوم المتعارضة مع الفترة */
  blockers(type, id, day, s, e) {
    if (!id) return [];
    const list = this.map.get(this._k(type, id, day));
    if (!list) return [];
    return list.filter((x) => overlaps(s, e, x.s, x.e)).map((x) => x.tag);
  }
  intervals(type, id, day) {
    return this.map.get(this._k(type, id, day)) || [];
  }
}

/**
 * بناء قائمة الطلبات.
 * @returns {{demands:Object[], warnings:string[]}}
 */
export function buildDemands({ subjects, stages, groups, settings, keptSessions, options }) {
  const warnings = [];
  const demands = [];
  const maxT = options.maxTheoryBlock || 2;
  const maxP = options.maxPracticalBlock || 3;
  const shifts = settings.shifts || { morning: { start: 480, end: 840 }, evening: { start: 840, end: 1200 } };

  // الساعات المغطاة مسبقاً بمحاضرات ثابتة: مفتاح (مادة|نوع|شعب)
  const covered = new Map();
  for (const s of keptSessions) {
    if (!s.subjectId) continue;
    const k = `${s.subjectId}|${s.kind}|${[...(s.groupIds || [])].sort().join(',')}`;
    covered.set(k, (covered.get(k) || 0) + (s.end - s.start) / 60);
  }
  const consume = (k, blocks) => {
    let have = covered.get(k) || 0;
    const out = [];
    for (const b of blocks) {
      if (have >= b - 1e-9) { have -= b; continue; }
      out.push(b);
    }
    covered.set(k, have);
    return out;
  };

  for (const subj of subjects) {
    const stage = stages.find((st) => st.deptId === subj.deptId && Number(st.level) === Number(subj.stageLevel));
    if (!stage) { warnings.push(`المادة «${subj.name}»: لا توجد مرحلة ${subj.stageLevel} في القسم`); continue; }
    const stageGroups = groups.filter((g) => g.stageId === stage.id);
    if (!stageGroups.length) { warnings.push(`المادة «${subj.name}»: لا توجد شعب في المرحلة`); continue; }

    const byShift = new Map();
    for (const g of stageGroups) {
      const sh = g.shift || 'morning';
      if (!byShift.has(sh)) byShift.set(sh, []);
      byShift.get(sh).push(g);
    }

    const theoryTeacher = subj.theoryTeacherId || subj.practicalTeacherId;
    const practicalTeacher = subj.practicalTeacherId || subj.theoryTeacherId;
    if (!theoryTeacher && (subj.theoryHours || subj.practicalHours)) warnings.push(`المادة «${subj.name}» (المرحلة ${subj.stageLevel}): لم يُحدَّد أستاذ، ستُجدول بدون أستاذ`);

    for (const [shift, gs] of byShift) {
      const win = shifts[shift] || shifts.morning;
      const mk = (kind, groupList, dur, teacherId) => ({
        subjectId: subj.id, deptId: subj.deptId, kind, shift, win,
        groupIds: groupList.map((g) => g.id),
        needed: groupList.reduce((n, g) => n + (Number(g.students) || 0), 0),
        duration: Math.round(dur * 60), teacherId: teacherId || null,
        labType: subj.labType || '', subjectName: subj.name,
      });


      if (Number(subj.theoryHours) > 0) {
        const units = subj.combineTheory === false ? gs.map((g) => [g]) : [gs];
        for (const unit of units) {
          const key = `${subj.id}|theory|${unit.map((g) => g.id).sort().join(',')}`;
          for (const b of consume(key, splitHours(subj.theoryHours, maxT))) demands.push(mk('theory', unit, b, theoryTeacher));
        }
      }
      if (Number(subj.practicalHours) > 0) {
        for (const g of gs) {
          const key = `${subj.id}|practical|${g.id}`;
          for (const b of consume(key, splitHours(subj.practicalHours, maxP))) demands.push(mk('practical', [g], b, practicalTeacher));
        }
      }
    }
  }
  demands.forEach((d, i) => { d.idx = i; });
  return { demands, warnings };
}

/** القاعات المرشحة مع عقوبة الملاءمة */
function roomOptions(d, rooms, deptCollege) {
  const anyLab = rooms.some((r) => r.type === 'lab');
  const opts = [];
  for (const r of rooms) {
    if (r.active === false) continue;
    let pen = 0;
    if (d.kind === 'practical') {
      if (r.type !== 'lab') { if (anyLab) continue; pen += 30; }
      if (d.labType && r.labKind && r.labKind !== d.labType) pen += 25;
      if (d.labType && !r.labKind) pen += 5;
    } else if (r.type === 'lab') pen += 15;
    const cap = Number(r.capacity) || 0;
    if (cap && d.needed > cap) pen += 200; // يُسمح بها فقط عند عدم وجود بديل
    else if (cap) pen += Math.max(0, cap - d.needed) / 20;
    if (r.deptId && r.deptId !== d.deptId) pen += 8;
    if (deptCollege && r.collegeId && r.collegeId !== deptCollege) pen += 12;
    opts.push({ room: r, pen });
  }
  return opts.sort((a, b) => a.pen - b.pen);
}

function runOnce(demands, ctx, rng, options) {
  const { days, step, fixedOcc, teachersMap, roomsByDemand } = ctx;
  const occ = new Occupancy();
  // نسخ الإشغال الثابت
  for (const [k, list] of fixedOcc.map) occ.map.set(k, list.map((x) => ({ ...x })));
  const placed = new Map(); // idx → {day,start,end,roomId}
  const subjDays = new Map(); // subject|groups → Set(day)

  const groupLoad = (gid, day) => occ.intervals('g', gid, day).reduce((n, x) => n + (x.e - x.s), 0);

  const candidates = (d, ignoreRunPlaced = false) => {
    const out = [];
    const teacher = teachersMap.get(d.teacherId);
    for (const day of days) {
      for (let s = d.win.start; s + d.duration <= d.win.end; s += step) {
        const e = s + d.duration;
        if (teacher && !teacherAvailable(teacher, day, s, e)) continue;
        const blockers = new Set();
        let hardFixed = false;
        const collect = (tags) => { for (const t of tags) { if (t === 'fixed') hardFixed = true; else blockers.add(t); } };
        collect(occ.blockers('t', d.teacherId, day, s, e));
        for (const g of d.groupIds) collect(occ.blockers('g', g, day, s, e));
        if (hardFixed) continue;
        if (!ignoreRunPlaced && blockers.size) continue;
        for (const ro of roomsByDemand.get(d.idx)) {
          const rb = occ.blockers('r', ro.room.id, day, s, e);
          if (rb.includes('fixed')) continue;
          if (!ignoreRunPlaced && rb.length) continue;
          const all = new Set([...blockers, ...rb]);
          out.push({ day, start: s, end: e, roomId: ro.room.id, roomPen: ro.pen, blockers: all });
        }
      }
    }
    return out;
  };

  const cost = (d, c) => {
    let k = c.roomPen;
    const sdKey = `${d.subjectId}|${d.groupIds.join(',')}`;
    if (subjDays.get(sdKey)?.has(c.day)) k += 50;
    for (const g of d.groupIds) {
      const load = groupLoad(g, c.day);
      const after = (load + d.duration) / 60;
      if (after > (options.maxDailyHours || 6)) k += 40 * (after - (options.maxDailyHours || 6));
      k += load / 30; // موازنة بين الأيام
      const iv = occ.intervals('g', g, c.day);
      if (iv.length) {
        const gap = Math.min(...iv.map((x) => (x.e <= c.start ? c.start - x.e : x.s >= c.end ? x.s - c.end : 0)));
        k += (gap / 30) * 3;
      }
    }
    if (d.teacherId) {
      const tl = occ.intervals('t', d.teacherId, c.day).reduce((n, x) => n + (x.e - x.s), 0) / 60;
      if (tl + d.duration / 60 > (options.maxTeacherDailyHours || 6)) k += 25;
    }
    k += (c.start - d.win.start) / 60; // تفضيل البدايات المبكرة قليلاً
    k += rng() * (options.noise ?? 4);
    return k;
  };

  const place = (d, c) => {
    placed.set(d.idx, c);
    occ.add('t', d.teacherId, c.day, c.start, c.end, d.idx);
    occ.add('r', c.roomId, c.day, c.start, c.end, d.idx);
    for (const g of d.groupIds) occ.add('g', g, c.day, c.start, c.end, d.idx);
    const sdKey = `${d.subjectId}|${d.groupIds.join(',')}`;
    if (!subjDays.has(sdKey)) subjDays.set(sdKey, new Set());
    subjDays.get(sdKey).add(c.day);
  };
  const unplace = (d) => {
    const c = placed.get(d.idx);
    placed.delete(d.idx);
    occ.removeTag(d.idx);
    const sdKey = `${d.subjectId}|${d.groupIds.join(',')}`;
    const stillOther = [...placed.entries()].some(([i, pc]) => {
      const od = demands[i];
      return od.subjectId === d.subjectId && od.groupIds.join(',') === d.groupIds.join(',') && pc.day === c.day;
    });
    if (!stillOther) subjDays.get(sdKey)?.delete(c.day);
  };
  const best = (d, list) => {
    let bc = null, bk = Infinity;
    for (const c of list) {
      const k = cost(d, c);
      if (k < bk) { bk = k; bc = c; }
    }
    return bc ? { c: bc, k: bk } : null;
  };

  // الترتيب: الأقل خيارات أولاً مع عشوائية للتنويع بين المحاولات
  const order = demands
    .map((d) => ({ d, dom: candidates(d).length, r: rng() }))
    .sort((a, b) => a.dom - b.dom || b.d.duration - a.d.duration || b.d.needed - a.d.needed || a.r - b.r)
    .map((x) => x.d);

  let totalCost = 0;
  const failed = [];
  for (const d of order) {
    const b = best(d, candidates(d));
    if (b) { place(d, b.c); totalCost += b.k; continue; }
    // الإصلاح: إزاحة طلب واحد معيق
    let repaired = false;
    const kicks = candidates(d, true).filter((c) => c.blockers.size === 1).sort((a, b) => a.roomPen - b.roomPen).slice(0, 30);
    for (const c of kicks) {
      const victimIdx = [...c.blockers][0];
      const victim = demands[victimIdx];
      const old = placed.get(victimIdx);
      unplace(victim);
      place(d, c);
      const alt = best(victim, candidates(victim));
      if (alt) { place(victim, alt.c); totalCost += alt.k + 5; repaired = true; break; }
      unplace(d);
      place(victim, old);
    }
    if (!repaired) failed.push(d);
  }
  return { placed, failed, totalCost };
}

/**
 * التوليد الكامل.
 * @param {Object} p
 * @param {Object[]} p.subjects المواد ضمن النطاق
 * @param {Object[]} p.stages
 * @param {Object[]} p.groups
 * @param {Object[]} p.teachers
 * @param {Object[]} p.rooms
 * @param {Object[]} p.fixedSessions كل المحاضرات التي ستبقى (من كل الأقسام والكليات + المقفلة/اليدوية في النطاق)
 * @param {Object[]} p.keptInScope المحاضرات الباقية داخل النطاق (لحساب الساعات المغطاة)
 * @param {Object} p.settings
 * @param {Object} [p.options]
 * @returns {{sessions:Object[], unplaced:Object[], warnings:string[], stats:Object}}
 */
export function generate(p) {
  const options = { restarts: 30, timeBudgetMs: 2500, seed: Date.now() & 0xffff, ...(p.options || {}) };
  const settings = p.settings || {};
  const days = settings.days?.length ? settings.days : [1, 2, 3, 4, 5];
  const step = settings.slotMinutes || 30;
  const { demands, warnings } = buildDemands({
    subjects: p.subjects, stages: p.stages, groups: p.groups, settings,
    keptSessions: p.keptInScope || [], options,
  });

  const fixedOcc = new Occupancy();
  for (const s of p.fixedSessions || []) {
    fixedOcc.add('t', s.teacherId, s.day, s.start, s.end, 'fixed');
    fixedOcc.add('r', s.roomId, s.day, s.start, s.end, 'fixed');
    for (const g of s.groupIds || []) fixedOcc.add('g', g, s.day, s.start, s.end, 'fixed');
  }
  const deptCollege = p.deptCollege || null;
  const roomsByDemand = new Map(demands.map((d) => [d.idx, roomOptions(d, p.rooms, deptCollege)]));
  const ctx = { days, step, fixedOcc, teachersMap: new Map(p.teachers.map((t) => [t.id, t])), roomsByDemand };

  const t0 = Date.now();
  let bestRun = null;
  for (let i = 0; i < options.restarts; i++) {
    const rng = mulberry32(options.seed + i * 7919);
    const run = runOnce(demands, ctx, rng, { ...options, noise: i === 0 ? 0 : options.noise ?? 4 });
    if (!bestRun || run.failed.length < bestRun.failed.length ||
        (run.failed.length === bestRun.failed.length && run.totalCost < bestRun.totalCost)) bestRun = run;
    if (bestRun.failed.length === 0 && i >= 4) break;
    if (Date.now() - t0 > options.timeBudgetMs) break;
  }

  const sessions = [];
  if (bestRun) {
    for (const [idx, c] of bestRun.placed) {
      const d = demands[idx];
      sessions.push({
        subjectId: d.subjectId, deptId: d.deptId, kind: d.kind, groupIds: d.groupIds,
        teacherId: d.teacherId, roomId: c.roomId, day: c.day, start: c.start, end: c.end,
        auto: true, locked: false,
      });
    }
  }
  const unplaced = (bestRun?.failed || []).map((d) => ({
    ...d,
    reason: !roomsByDemand.get(d.idx).length ? 'لا توجد قاعة/مختبر مناسب'
      : 'لم يُعثر على وقت يتفرغ فيه الأستاذ والقاعة والشعبة معاً ضمن وقت الدوام',
  }));
  return {
    sessions, unplaced, warnings,
    stats: { demands: demands.length, placed: sessions.length, ms: Date.now() - t0 },
  };
}
