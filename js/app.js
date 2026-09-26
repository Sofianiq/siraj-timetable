/**
 * نقطة البداية: تهيئة البيانات، الهيكل العام للصفحة، التنقل بين الصفحات، وإعادة الرسم عند أي تغيير (مزامنة فورية).
 */
import { store, initStore, onChange, onAuth, role, isAdmin, canEdit, batchWrite, uid, signOut } from './store.js';
import { APP_TITLE, DEVELOPER, UNIVERSITY, COLLEGE } from './config.js';
import { esc, el, $, $$, toast } from './ui.js';
import { renderSchedule } from './views/schedule.js';
import { renderEntity, renderStages } from './views/crud.js';
import { renderGenerate } from './views/generate.js';
import { renderDashboard, renderConflicts, renderUsers, renderSettings, renderLogin, ROLE_NAMES } from './views/pages.js';
import { seedOps } from './seed/radiology.js';
import { deptName } from './model.js';

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
        <span class="brand-text"><b>نظام إدارة الجداول الدراسية</b><small>${esc(UNIVERSITY)} - ${esc(COLLEGE)}</small></span>
      </a>
      <span class="spacer"></span>
      <span id="sync" class="sync" title="حالة المزامنة"></span>
      <div id="userBox" class="user-box"></div>
    </header>
    <div class="layout">
      <nav id="sidebar" class="sidebar no-print" aria-label="القائمة الرئيسية"></nav>
      <main id="main" tabindex="-1"></main>
    </div>
    <div id="scrim" class="scrim no-print"></div>
    <footer class="footer no-print">إعداد وتطوير: ${esc(DEVELOPER)}</footer>
  </div>`));
  $('#menuBtn').onclick = () => document.body.classList.toggle('nav-open');
  $('#scrim').onclick = () => document.body.classList.remove('nav-open');
  window.addEventListener('online', updateSync);
  window.addEventListener('offline', updateSync);
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

  const ub = $('#userBox');
  if (store.mode === 'local') ub.innerHTML = '<span class="role-badge">مشرف (محلي)</span>';
  else if (store.user) {
    ub.innerHTML = `<span class="user-name">${esc(store.user.name || store.user.email)}</span>
      <span class="role-badge">${esc(ROLE_NAMES[r] || r)}${r === 'dept' && store.profile?.deptId ? ` — ${esc(deptName(store.profile.deptId))}` : ''}</span>
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
    toast('تم إدراج البيانات الأولية: الأقسام الخمسة والمراحل ومواد قسم تقنيات الأشعة والسونار. راجع الساعات والقاعات.', 'success', 8000);
  } catch (e) { console.error(e); toast('تعذر إدراج البيانات الأولية: ' + e.message, 'error'); }
}

/* ------------------------------ البدء ------------------------------ */
async function main() {
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

  onChange((col, info) => {
    // إشعار عند وصول تعديل من مستخدم آخر
    if (col === 'sessions' && info.remote && info.changes?.length && store.mode === 'firebase') {
      const others = info.changes.filter((c) => c.data?.updatedBy && c.data.updatedBy !== (store.user?.name || store.user?.email));
      if (others.length) toast(`🔄 ${others.length === 1 ? 'تعديل جديد' : `${others.length} تعديلات جديدة`} من ${others[0].data.updatedBy}`, 'info', 2500);
    }
    scheduleRedraw();
  });
  onAuth(() => { autoSeed(); route(); });
  window.addEventListener('hashchange', route);
  route();
}

main();
