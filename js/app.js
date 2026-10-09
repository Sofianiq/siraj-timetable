/**
 * نقطة البداية: تهيئة البيانات، الهيكل العام للصفحة، التنقل بين الصفحات، وإعادة الرسم عند أي تغيير (مزامنة فورية).
 */
import { store, initStore, onChange, onAuth, role, isAdmin, canEdit, batchWrite, uid, signOut } from './store.js';
import { APP_TITLE, APP_NAME, DEVELOPER, UNIVERSITY } from './branding.js';
import { esc, el, $, $$, toast } from './ui.js';
import { renderSchedule } from './views/schedule.js';
import { renderEntity, renderStages } from './views/crud.js';
import { renderGenerate } from './views/generate.js';
import { renderDashboard, renderConflicts, renderUsers, renderSettings, renderLogin, ROLE_NAMES } from './views/pages.js';
import { seedOps, migrationOps } from './seed/radiology.js';
import { deptName, collegeShort, managedColleges, currentCollegeId, setCurrentCollege } from './model.js';
import { setPrintProvider } from './export.js';

const NAV = [
  { path: 'dashboard', label: 'لوحة التحكم', icon: '🏠' },
  { path: 'schedule', label: 'الجداول الدراسية', icon: '🗓' },
  { path: 'generate', label: 'التوليد التلقائي', icon: '⚙️', edit: true },
  { path: 'conflicts', label: 'التعارضات', icon: '⚠️' },
  { sep: 'البيانات الأساسية' },
  { path: 'colleges', label: 'الكليات', icon: '🏛' },
  { path: 'departments', label: 'الأقسام', icon: '🏢' },
  { path: 'stages', label: 'المراحل والشعب', icon: '🎓' },
  { path: 'teachers', label: 'الأساتذة', icon: '👨‍🏫' },
  { path: 'rooms', label: 'القاعات والمختبرات', icon: '🚪' },
  { path: 'subjects', label: 'المواد الدراسية', icon: '📘' },
  { sep: 'الإدارة', admin: true },
  { path: 'users', label: 'المستخدمون والصلاحيات', icon: '👥', admin: true },
  { path: 'settings', label: 'الإعدادات والنسخ الاحتياطي', icon: '🔧', admin: true },
];

const ROUTES = {
  dashboard: (c) => renderDashboard(c),
  schedule: (c, p) => renderSchedule(c, p),
  generate: (c) => renderGenerate(c),
  conflicts: (c) => renderConflicts(c),
  colleges: (c) => renderEntity(c, 'colleges'),
  departments: (c) => renderEntity(c, 'departments'),
  teachers: (c) => renderEntity(c, 'teachers'),
  rooms: (c) => renderEntity(c, 'rooms'),
  subjects: (c) => renderEntity(c, 'subjects'),
  stages: (c) => renderStages(c),
  users: (c) => renderUsers(c),
  settings: (c) => renderSettings(c),
  login: (c) => renderLogin(c),
  public: (c, p) => renderSchedule(c, p, { publicMode: true }),
};

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  return { path: path || '', params: Object.fromEntries(new URLSearchParams(qs || '')) };
}

/* ------------------------------ الهيكل العام ------------------------------ */
function shell() {
  document.title = APP_TITLE;
  document.body.innerHTML = '';
  document.body.appendChild(el(`<div id="app">
    <header class="topbar no-print">
      <button class="icon-btn menu-btn" id="menuBtn" aria-label="القائمة">☰</button>
      <a class="brand" href="#/">
        <span class="logo" aria-hidden="true">🗓</span>
        <span class="brand-text"><b>${esc(APP_NAME)}</b><small>${esc(UNIVERSITY)}</small></span>
      </a>
      <label class="college-switch" title="اختر الكلية التي تعمل عليها">
        <span aria-hidden="true">🏛</span>
        <select id="collegeSel" aria-label="الكلية"></select>
      </label>
      <span class="spacer"></span>
      <span id="sync" class="sync" title="حالة المزامنة"></span>
      <button class="icon-btn theme-btn" id="themeBtn" title="الوضع الفاتح / الداكن" aria-label="تبديل المظهر"></button>
      <div id="userBox" class="user-box"></div>
    </header>
    <div class="layout">
      <nav id="sidebar" class="sidebar no-print" aria-label="القائمة الرئيسية"></nav>
      <main id="main" tabindex="-1"></main>
    </div>
    <div id="scrim" class="scrim no-print"></div>
    <footer class="footer no-print">إعداد وتطوير: ${esc(DEVELOPER)}</footer>
  </div>`));
  applyTheme();
  $('#menuBtn').onclick = () => document.body.classList.toggle('nav-open');
  $('#scrim').onclick = () => document.body.classList.remove('nav-open');
  $('#collegeSel').onchange = (e) => { setCurrentCollege(e.target.value); draw(true); };
  $('#themeBtn').onclick = () => {
    const order = ['auto', 'light', 'dark'];
    const next = order[(order.indexOf(getTheme()) + 1) % order.length];
    try { localStorage.setItem(THEME_KEY, next); } catch { /* تجاهل */ }
    applyTheme();
    toast(next === 'auto' ? 'المظهر: تلقائي حسب الجهاز' : next === 'dark' ? 'المظهر: داكن' : 'المظهر: فاتح', 'info', 1500);
  };
  window.addEventListener('online', updateSync);
  window.addEventListener('offline', updateSync);
  window.addEventListener('siraj:college', () => renderCollegeSwitch());
}

/* ------------------------------ المظهر (فاتح / داكن) ------------------------------ */
const THEME_KEY = 'siraj-theme';
function getTheme() { try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch { return 'auto'; } }
function applyTheme() {
  const t = getTheme();
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  const b = document.getElementById('themeBtn');
  if (b) b.textContent = t === 'dark' ? '🌙' : t === 'light' ? '☀️' : '🌓';
}

/** قائمة اختيار الكلية في الشريط العلوي */
function renderCollegeSwitch() {
  const sel = $('#collegeSel');
  if (!sel) return;
  const list = managedColleges();
  const cur = currentCollegeId();
  sel.innerHTML = `<option value="">كل الكليات</option>` +
    list.map((c) => `<option value="${esc(c.id)}" ${c.id === cur ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  sel.parentElement.hidden = list.length < 2;
}

function updateSync() {
  const s = $('#sync');
  if (!s) return;
  if (store.mode === 'local') { s.className = 'sync local'; s.textContent = 'وضع تجريبي محلي'; s.title = 'البيانات محفوظة على هذا الجهاز فقط. اربط Firebase للعمل التشاركي.'; return; }
  const on = navigator.onLine;
  s.className = `sync ${on ? 'on' : 'off'}`;
  s.textContent = on ? 'متزامن' : 'غير متصل — ستُرفع التعديلات عند عودة الاتصال';
}

function renderNav(active) {
  const r = role();
  const publicMode = r === 'guest';
  const nav = $('#sidebar');
  if (publicMode) {
    nav.innerHTML = `<a href="#/public" class="${active === 'public' ? 'active' : ''}">🗓 <span>الجداول</span></a><a href="#/login">🔑 <span>تسجيل الدخول</span></a>`;
  } else {
    nav.innerHTML = NAV.filter((n) => (!n.admin || isAdmin()) && (!n.edit || canEdit())).map((n) => n.sep
      ? `<div class="nav-sep">${esc(n.sep)}</div>`
      : `<a href="#/${n.path}" class="${active === n.path ? 'active' : ''}"><span class="ni">${n.icon}</span> <span>${esc(n.label)}</span></a>`).join('');
  }
  nav.onclick = (e) => { if (e.target.closest('a')) document.body.classList.remove('nav-open'); };

  renderCollegeSwitch();
  const ub = $('#userBox');
  if (store.mode === 'local') ub.innerHTML = '<span class="role-badge">مدير النظام (محلي)</span>';
  else if (store.user) {
    ub.innerHTML = `<span class="user-name">${esc(store.user.name || store.user.email)}</span>
      <span class="role-badge">${esc(ROLE_NAMES[r] || r)}${r === 'dept' && store.profile?.deptId ? ` — ${esc(deptName(store.profile.deptId))}` : ''}${r === 'college' && store.profile?.collegeId ? ` — ${esc(collegeShort(store.profile.collegeId))}` : ''}</span>
      <button class="btn btn-sm" id="logout">خروج</button>`;
    $('#logout').onclick = async () => { await signOut(); location.hash = '#/public'; };
  } else ub.innerHTML = '<a class="btn btn-sm btn-primary" href="#/login">دخول</a>';
}

/* ------------------------------ التنقل والرسم ------------------------------ */
let current = { path: '', params: {} };
function route() {
  const { path, params } = parseHash();
  const r = role();
  let target = path;
  if (r === 'guest') {
    if (!['public', 'login'].includes(target)) target = 'public';
  } else {
    if (!target || target === 'login') target = 'dashboard';
    if (['users', 'settings'].includes(target) && !isAdmin()) target = 'dashboard';
    if (target === 'generate' && !canEdit()) target = 'dashboard';
    if (target === 'public' && r !== 'guest' && !params.type) target = 'schedule';
  }
  current = { path: target, params };
  setPrintProvider(null); // صفحة الجداول تعيد تسجيل ما يُطبع
  document.body.classList.toggle('public-mode', target === 'public' || target === 'login');
  renderNav(target);
  draw(true);
}

function draw(scrollTop = false) {
  const main = $('#main');
  const fn = ROUTES[current.path] || ROUTES.dashboard;
  // الحفاظ على موضع التمرير عند إعادة الرسم بسبب تحديث بيانات من مستخدم آخر
  const y = window.scrollY;
  const gridScroll = $('.grid-box', main)?.scrollLeft;
  try { fn(main, current.params); } catch (e) { console.error(e); main.innerHTML = `<div class="banner error">حدث خطأ: ${esc(e.message)}</div>`; }
  current.params = {}; // المعاملات تُطبق مرة واحدة ثم تُحفظ الحالة داخل الصفحة
  if (scrollTop) window.scrollTo(0, 0);
  else {
    window.scrollTo(0, y);
    const gb = $('.grid-box', main);
    if (gb && gridScroll != null) gb.scrollLeft = gridScroll;
  }
}

let redrawTimer = null;
function scheduleRedraw() {
  // لا نعيد الرسم أثناء فتح نافذة تحرير أو أثناء السحب حتى لا تضيع مدخلات المستخدم
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(() => {
    if (document.querySelector('.modal-backdrop') || document.querySelector('.tt-block.dragging')) { scheduleRedraw(); return; }
    renderCollegeSwitch();
    draw(false);
  }, 120);
}

/* ------------------------------ الإدراج التلقائي للبيانات الأولية ------------------------------ */
let seeded = false;
async function autoSeed() {
  if (seeded) return;
  const empty = !store.data.departments.length && !store.data.subjects.length && !store.data.settings.length;
  if (!empty || !isAdmin()) return;
  seeded = true;
  try {
    await batchWrite(seedOps(uid));
    toast('تم إدراج البيانات الأولية: ثلاث كليات وأقسامها ومراحلها ومواد قسم تقنيات الأشعة والسونار. راجع الساعات والقاعات.', 'success', 8000);
  } catch (e) { console.error(e); toast('تعذر إدراج البيانات الأولية: ' + e.message, 'error'); }
}

/** ترقية البيانات الموجودة إلى نظام الكليات المتعددة (مرة واحدة، بواسطة مدير النظام) */
let migrating = false;
async function autoMigrate() {
  if (migrating || !isAdmin()) return;
  const ops = migrationOps(store.data, uid);
  if (!ops.length) return;
  migrating = true;
  try {
    await batchWrite(ops);
    toast('تم تحديث النظام لدعم عدة كليات، وأُضيفت كليتا الصيدلة وطب الأسنان.', 'success', 8000);
  } catch (e) { console.error(e); migrating = false; toast('تعذر تحديث بيانات الكليات: ' + e.message, 'error'); }
}

/* ------------------------------ البدء ------------------------------ */
async function main() {
  window.__appStarted = true;
  shell();
  $('#main').innerHTML = '<div class="loading"><div class="spinner"></div><p>جارٍ تحميل البيانات…</p></div>';
  try {
    await initStore();
  } catch (e) {
    console.error(e);
    $('#main').innerHTML = `<div class="banner error">تعذر الاتصال بقاعدة البيانات: ${esc(e.message)}<br>تحقق من الإنترنت ومن إعدادات js/config.js</div>`;
    return;
  }
  updateSync();
  await autoSeed();
  await autoMigrate();

  onChange((col, info) => {
    // إشعار عند وصول تعديل من مستخدم آخر
    if (col === 'sessions' && info.remote && info.changes?.length && store.mode === 'firebase') {
      const others = info.changes.filter((c) => c.data?.updatedBy && c.data.updatedBy !== (store.user?.name || store.user?.email));
      if (others.length) toast(`🔄 ${others.length === 1 ? 'تعديل جديد' : `${others.length} تعديلات جديدة`} من ${others[0].data.updatedBy}`, 'info', 2500);
    }
    scheduleRedraw();
  });
  onAuth(async () => { await autoSeed(); await autoMigrate(); route(); });
  window.addEventListener('hashchange', route);
  route();
}

main();
