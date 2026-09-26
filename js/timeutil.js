/**
 * أدوات الوقت والأيام — دوال نقية بلا اعتماديات، تُستخدم في المتصفح وفي الاختبارات.
 * الأوقات تُخزَّن بالدقائق منذ منتصف الليل (مثلاً 8:30 = 510).
 */

export const DAY_NAMES = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

export const SHIFTS = { morning: 'صباحي', evening: 'مسائي' };

export const SESSION_KINDS = { theory: 'نظري', practical: 'عملي', external: 'حجز خارجي' };

export const ROOM_TYPES = { hall: 'قاعة دراسية', lab: 'مختبر', other: 'أخرى' };

export const STAGE_NAMES = ['', 'الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة'];

export const SEMESTERS = { 1: 'الفصل الأول', 2: 'الفصل الثاني' };

/** "08:30" → 510 */
export function toMinutes(hhmm) {
  if (typeof hhmm === 'number') return hhmm;
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** 510 → "08:30" */
export function toHHMM(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 510 → "8:30" بصيغة 12 ساعة مع ص/م للعرض */
export function formatTime(min) {
  let h = Math.floor(min / 60);
  const m = min % 60;
  const suffix = h < 12 ? 'ص' : 'م';
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function formatRange(start, end) {
  return `${formatTime(start)} - ${formatTime(end)}`;
}

/** هل يتداخل مجالان زمنيان [a1,a2) و [b1,b2) ؟ */
export function overlaps(a1, a2, b1, b2) {
  return a1 < b2 && b1 < a2;
}

export function snap(min, step) {
  return Math.round(min / step) * step;
}

/**
 * توزيع الأحداث المتداخلة على مسارات (lanes) لعرضها دون تراكب.
 * يعيد خريطة id → رقم المسار، وعدد المسارات الكلي.
 */
export function assignLanes(items) {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const laneEnds = [];
  const lanes = new Map();
  for (const it of sorted) {
    let lane = laneEnds.findIndex((end) => end <= it.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(it.end);
    } else {
      laneEnds[lane] = it.end;
    }
    lanes.set(it.id, lane);
  }
  return { lanes, count: Math.max(1, laneEnds.length) };
}
