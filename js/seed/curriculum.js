/**
 * استيراد المناهج الرسمية والكادر التدريسي لكلية التقنيات الصحية والطبية — دوال نقية تعيد عمليات كتابة.
 *
 * - المواد: لكل مادة في الخطة يُبحث عن مادة موجودة في القسم والمرحلة والفصل نفسه باسم مطابق أو قريب
 *   («وبائيات 1» = «علم الوبائيات 1»، «جرائم حزب البعث» = «جرائم نظام البعث في العراق»).
 *   الموجودة تُحدَّث (الاسم الرسمي والساعات النظرية والعملية والوحدات) فتبقى محاضراتها مرتبطة بها، وغير الموجودة تُضاف.
 * - الأساتذة: يُضاف الأستاذ فقط إن لم يكن موجوداً، والمقارنة تتجاهل اللقب وتعدّ الاسم المختصر والكامل شخصاً واحداً
 *   («د. طلال عبد» = «د. طلال عبد اللطيف»).
 */
import { normName, normPerson, stripTitle } from '../text.js';
import { CURRICULUM, ESTIMATED, TEACHERS } from './curriculum-data.js';

export const HMT_COLLEGE = 'كلية التقنيات الصحية والطبية';

/** كلمات تعرّف كل قسم من اسمه */
export const DEPT_KEYS = {
  ANS: 'التخدير', RAD: 'الاشعه', DEN: 'صناعه الاسنان', CHT: 'صحه المجتمع', COS: 'التجميل',
};

/** أقسام كلية التقنيات حسب الرمز */
export function hmtDepts(data) {
  const college = (data.colleges || []).find((c) => c.own !== false && normName(c.name) === normName(HMT_COLLEGE));
  if (!college) return { college: null, depts: {} };
  const list = (data.departments || []).filter((d) => d.collegeId === college.id);
  const depts = {};
  for (const [code, key] of Object.entries(DEPT_KEYS)) {
    const d = list.find((x) => normName(x.name).includes(key));
    if (d) depts[code] = d;
  }
  return { college, depts };
}

/* ------------------------------ مطابقة أسماء المواد ------------------------------ */
const DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
/** الرقم في اسم المادة (1، 2، I، II) */
function subjectNumber(name) {
  const s = String(name).replace(/[٠-٩]/g, (c) => DIGITS[c]);
  const m = s.match(/(\d+)|\b(I{1,3})\b/);
  return m ? (m[1] || String(m[2].length)) : '';
}
/** كلمات الاسم بدون أرقام وأقواس و«ال» و«علم» */
function subjectWords(name) {
  return normName(name).replace(/[٠-٩0-9()[\]{}.\-–_/\\،,:]/g, ' ').replace(/\bI{1,3}\b/g, ' ')
    .split(/\s+/).filter(Boolean)
    .map((w) => w.replace(/^(و?ال)/, ''))
    .filter((w) => w && !['علم', 'في', 'و', 'من'].includes(w));
}
function lev(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return dp[b.length];
}
/** مواد عامة تُعرف بكلمة واحدة مهما اختلفت صياغتها */
const TOPIC = ['بعث', 'عربيه', 'انكليزيه', 'حاسوب', 'حاسبات', 'مصطلحات', 'حقوق', 'احصاء'];

/** تشابه كلمتين (يتسامح مع اختلاف حرف: «بيئية» = «بيئة») */
const wordMatch = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && 1 - lev(a, b) / Math.max(a.length, b.length) >= 0.75);

/**
 * درجة التشابه بين اسمي مادتين (0 – 1). المقارنة بالكلمات: كل كلمة في الاسم الأقصر يجب أن تقابلها كلمة في الأطول،
 * فلا تتطابق «الأطراف العليا» مع «الأطراف السفلى»، ولا «التشريح 1» مع «التشريح 2».
 */
export function subjectSimilarity(a, b) {
  const na = subjectNumber(a), nb = subjectNumber(b);
  if (na && nb && na !== nb) return 0;
  const wa = subjectWords(a), wb = subjectWords(b);
  if (!wa.length || !wb.length) return 0;
  if (wa.join(' ') === wb.join(' ')) return 1;
  for (const t of TOPIC) if (wa.some((w) => w.includes(t)) && wb.some((w) => w.includes(t))) return 0.9;
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  if (!short.every((w) => long.some((x) => wordMatch(w, x)))) return 0;
  if (short.length === long.length) return 0.95;
  // اسم مختصر داخل الاسم الكامل: «فيزياء الرنين» ⊂ «فيزياء الرنين المغناطيسي»
  return short.length >= 2 ? 0.8 + 0.15 * (short.length / long.length) : (short[0].length >= 5 ? 0.78 : 0);
}

/* ------------------------------ مطابقة أسماء الأساتذة ------------------------------ */
/** هل الاسمان لشخص واحد؟ (بعد حذف اللقب: متطابقان، أو أحدهما بداية الآخر) */
export function samePerson(a, b) {
  const x = normPerson(a), y = normPerson(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [a, b] : [b, a];
  // الاسم المختصر يجب أن يكون كلمتين على الأقل (حتى لا يطابق «عمر» كل من اسمه عمر)
  return normPerson(long).startsWith(normPerson(short)) && stripTitle(short).split(' ').length >= 2;
}

/* ------------------------------ عمليات الاستيراد ------------------------------ */
/**
 * @param {Object} data بيانات النظام
 * @param {() => string} uid مولد المعرّفات
 * @returns {{ops: Object[], stats: {added:number, updated:number, teachers:number, depts:string[]}}}
 */
export function curriculumImportPlan(data, uid) {
  const ops = [];
  const stats = { added: 0, updated: 0, teachers: 0, depts: [] };
  const { depts } = hmtDepts(data);
  const subjects = data.subjects || [];

  for (const [code, rows] of Object.entries(CURRICULUM)) {
    const dept = depts[code];
    if (!dept) continue;
    stats.depts.push(dept.name);
    const estimated = ESTIMATED.has(code);
    const existing = subjects.filter((s) => s.deptId === dept.id);
    // المطابقة لكل (مرحلة، فصل): الأعلى تشابهاً أولاً، وكل مادة تُطابَق مرة واحدة
    const groups = new Map();
    rows.forEach((r) => {
      const k = `${r[0]}|${r[1]}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    });
    for (const [k, list] of groups) {
      const [level, sem] = k.split('|').map(Number);
      const pool = existing.filter((s) => Number(s.stageLevel) === level && Number(s.semester || 1) === sem);
      const pairs = [];
      list.forEach((r, i) => pool.forEach((s) => {
        const score = subjectSimilarity(r[2], s.name);
        if (score >= 0.75) pairs.push({ i, s, score });
      }));
      pairs.sort((a, b) => b.score - a.score);
      const usedRow = new Set(), usedSub = new Set(), match = new Map();
      for (const p of pairs) {
        if (usedRow.has(p.i) || usedSub.has(p.s.id)) continue;
        usedRow.add(p.i); usedSub.add(p.s.id); match.set(p.i, p.s);
      }
      list.forEach(([stageLevel, semester, name, nameEn, category, th, pr, units], i) => {
        const official = { name, nameEn, category, units, theoryHours: th, practicalHours: pr, needsReview: estimated, official: !estimated };
        const s = match.get(i);
        if (s) {
          const changed = Object.entries(official).some(([key, v]) => (s[key] ?? '') !== v);
          if (changed) { ops.push({ op: 'update', col: 'subjects', id: s.id, data: official }); stats.updated++; }
        } else {
          ops.push({ op: 'set', col: 'subjects', id: uid(), data: {
            ...official, deptId: dept.id, stageLevel, semester, labType: '',
            theoryTeacherId: null, practicalTeacherId: null, combineTheory: true,
          } });
          stats.added++;
        }
      });
    }
  }

  // الأساتذة: بدون تكرار مع الموجودين ومع بعضهم
  const known = (data.teachers || []).map((t) => t.name);
  for (const [name, code, title] of TEACHERS) {
    if (known.some((n) => samePerson(n, name))) continue;
    const dept = depts[code] || Object.values(depts)[0];
    if (!dept) continue;
    ops.push({ op: 'set', col: 'teachers', id: uid(), data: { name, title: title || null, deptId: dept.id, availability: {}, sharedColleges: [] } });
    known.push(name);
    stats.teachers++;
  }
  return { ops, stats };
}
