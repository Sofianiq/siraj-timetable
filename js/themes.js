/**
 * ألوان الجداول المطبوعة: لكل قسم (أو كلية) لون مميز يسهّل التفريق بين الجداول.
 * dark: الأيام والإطار، main: رؤوس الساعات والنظري، accent: العملي والخطوط، theory/practical: خلفيات الخانات.
 * يُختار اللون من القسم، ثم من كليته، وإلا يُوزَّع تلقائياً بترتيب الأقسام حتى لا يتشابه قسمان.
 */
import { store, byId } from './store.js';

export const PRINT_THEMES = {
  teal: { name: 'فيروزي وبرتقالي', dark: '#0d4a57', main: '#146f7e', accent: '#c45f28', ink: '#103f4a', theory: '#e5f0f2', practical: '#fbebe0' },
  navy: { name: 'كحلي وذهبي', dark: '#172b55', main: '#28488a', accent: '#b5852a', ink: '#172b55', theory: '#e7ecf6', practical: '#f8f0dd' },
  burgundy: { name: 'عنابي وفيروزي', dark: '#561a2c', main: '#852a44', accent: '#2a7a76', ink: '#4d1727', theory: '#f6e8ec', practical: '#e2f1ef' },
  green: { name: 'أخضر وعسلي', dark: '#1c4a31', main: '#2b6c47', accent: '#bf8424', ink: '#1a4430', theory: '#e6f2ea', practical: '#faf0dc' },
  purple: { name: 'بنفسجي وبرتقالي', dark: '#382660', main: '#573d8c', accent: '#cc7329', ink: '#33245a', theory: '#eee9f7', practical: '#fcede1' },
  brown: { name: 'بني وأزرق', dark: '#46301f', main: '#6c4c35', accent: '#2c6a8a', ink: '#3f2c1d', theory: '#f3ece4', practical: '#e4eef4' },
  slate: { name: 'رمادي وأحمر', dark: '#26323f', main: '#45596d', accent: '#b7382c', ink: '#24303c', theory: '#eaeef2', practical: '#f9e6e3' },
  ocean: { name: 'أزرق ومرجاني', dark: '#0f3d63', main: '#1d6496', accent: '#d0573f', ink: '#0f3a5c', theory: '#e4eef7', practical: '#fbe8e3' },
};
const KEYS = Object.keys(PRINT_THEMES);

/** خيارات القائمة (الخيار الفارغ «تلقائي» يضيفه النموذج عبر placeholder) */
export const themeOptions = () => KEYS.map((k) => ({ value: k, label: PRINT_THEMES[k].name }));

/** ترتيب ثابت للأقسام: حسب ترتيب الكلية ثم الاسم */
function deptOrder() {
  const order = new Map([...store.data.colleges].sort((a, b) => (a.order ?? 50) - (b.order ?? 50)).map((c, i) => [c.id, i]));
  return [...store.data.departments].sort((a, b) => (order.get(a.collegeId) ?? 999) - (order.get(b.collegeId) ?? 999)
    || (b.general ? 1 : 0) - (a.general ? 1 : 0) || String(a.name).localeCompare(String(b.name), 'ar'));
}

/** مفتاح لون قسم */
export function themeKeyForDept(deptId) {
  const d = byId('departments', deptId);
  if (!d) return 'teal';
  if (PRINT_THEMES[d.theme]) return d.theme;
  const c = byId('colleges', d.collegeId);
  if (PRINT_THEMES[c?.theme]) return c.theme;
  const i = deptOrder().findIndex((x) => x.id === deptId);
  return KEYS[Math.max(0, i) % KEYS.length];
}

/** مفتاح لون كلية (للجداول غير المرتبطة بقسم، مثل جدول قاعة) */
export function themeKeyForCollege(collegeId) {
  const c = byId('colleges', collegeId);
  if (PRINT_THEMES[c?.theme]) return c.theme;
  const first = deptOrder().find((d) => d.collegeId === collegeId);
  return first ? themeKeyForDept(first.id) : 'teal';
}

export const themeOf = (key) => PRINT_THEMES[key] || PRINT_THEMES.teal;

/** مربع لون صغير لعرضه في الجداول */
export function themeSwatch(key) {
  const t = themeOf(key);
  return `<span class="theme-swatch" title="${t.name}"><i style="background:${t.dark}"></i><i style="background:${t.main}"></i><i style="background:${t.accent}"></i></span>`;
}
