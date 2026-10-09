/**
 * مجاميع العملي: تقسيم الشعبة إلى مجاميع (مثلاً A, B, C, D). النظري للشعبة كاملة،
 * والعملي قد يكون لمجموعة أو أكثر، فتأخذ كل مجموعة مادة مختلفة في الوقت نفسه وفي مختبر مختلف.
 *
 * الشعبة: group.subgroups = ['A','B','C','D']
 * المحاضرة: session.subgroups = ['A'] (فارغة = الشعبة كاملة). تُعتمد فقط عندما ترتبط المحاضرة بشعبة واحدة.
 */

/** ألوان المجاميع (لون الخط، الخلفية الفاتحة) — مميزة وواضحة عند الطباعة */
export const SUBGROUP_COLORS = [
  ['#1f6fb2', '#e3effa'], ['#2e8b57', '#e2f3e9'], ['#c8642a', '#fbeadf'], ['#7b4bb3', '#efe7f8'],
  ['#b83a6e', '#f8e3ed'], ['#1d8a8a', '#dff2f2'], ['#977612', '#f6efd7'], ['#555f6d', '#eceef1'],
];

/** مجاميع المحاضرة (فارغة إذا كانت للشعبة كاملة أو مشتركة بين عدة شعب) */
export const subsOf = (s) => ((s?.groupIds || []).length === 1 ? (s.subgroups || []).filter(Boolean) : []);

/** هل تتداخل محاضرتان من الشعبة نفسها في الطلبة؟ (مجموعتان مختلفتان لا تتعارضان) */
export function subsOverlap(a, b) {
  const A = subsOf(a), B = subsOf(b);
  return !A.length || !B.length || A.some((x) => B.includes(x));
}

/** تحويل نص مثل «A, B, C, D» أو «أ، ب، ج» إلى قائمة */
export const parseSubgroups = (text) => [...new Set(String(text || '').split(/[,،;\s]+/).map((x) => x.trim()).filter(Boolean))].slice(0, 12);

export function subgroupColor(group, name) {
  let i = (group?.subgroups || []).indexOf(name);
  if (i < 0) i = [...String(name)].reduce((n, c) => n + c.charCodeAt(0), 0);
  return SUBGROUP_COLORS[i % SUBGROUP_COLORS.length];
}

/** «مجموعة A» أو «المجموعتان A + B» */
export function subgroupLabel(s) {
  const subs = subsOf(s);
  if (!subs.length) return '';
  return `${subs.length === 1 ? 'مجموعة' : 'مجاميع'} ${subs.join(' + ')}`;
}

/** عدد طلبة المحاضرة من الشعبة: نسبة المجاميع المختارة من عدد طلبة الشعبة */
export function subgroupShare(group, s) {
  const total = Number(group?.students) || 0;
  const subs = subsOf(s);
  const n = (group?.subgroups || []).length;
  if (!subs.length || !n) return total;
  return Math.ceil((total * Math.min(subs.length, n)) / n);
}
