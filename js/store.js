/**
 * طبقة البيانات الموحّدة.
 *
 * تعمل بإحدى طريقتين:
 *  - Firebase (Firestore + Authentication): عند تعبئة بيانات الربط في js/config.js.
 *    المزامنة فورية عبر onSnapshot، والبيانات تُخزَّن مؤقتاً على الجهاز للعمل عند انقطاع الإنترنت.
 *  - الوضع التجريبي المحلي: عند عدم وجود إعدادات Firebase، تُحفظ البيانات في متصفح الجهاز
 *    (localStorage) وتتزامن بين نوافذ المتصفح نفسه فقط. مفيد للتجربة قبل الربط.
 *
 * كل الواجهات تتعامل مع هذا الملف فقط، ولا تستدعي Firebase مباشرة.
 */
import { firebaseConfig, SUPER_ADMIN_EMAILS } from './config.js';

export const COLLECTIONS = ['colleges', 'departments', 'stages', 'groups', 'teachers', 'rooms', 'subjects', 'sessions', 'settings', 'users'];

const FB_VER = '10.12.2';
const LOCAL_KEY = 'siraj-timetable-db-v1';
const listeners = new Set();
const authListeners = new Set();

export const store = {
  mode: 'local',          // 'firebase' | 'local'
  ready: false,
  data: Object.fromEntries(COLLECTIONS.map((c) => [c, []])),
  user: null,             // {uid, email, name}
  profile: null,          // {role:'admin'|'dept'|'viewer', deptId}
  _fb: null,
};

/* ------------------------------ أحداث ------------------------------ */
export function onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }
export function onAuth(cb) { authListeners.add(cb); return () => authListeners.delete(cb); }
function emit(col, info = {}) { for (const cb of listeners) try { cb(col, info); } catch (e) { console.error(e); } }
function emitAuth() { for (const cb of authListeners) try { cb(store.user, store.profile); } catch (e) { console.error(e); } }

export const byId = (col, id) => store.data[col].find((x) => x.id === id);
export const settings = () => store.data.settings.find((s) => s.id === 'app') || {};
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/* ------------------------------ الصلاحيات ------------------------------ */
export function role() {
  if (store.mode === 'local') return 'admin';
  if (!store.user) return 'guest';
  if (SUPER_ADMIN_EMAILS.map((e) => e.toLowerCase()).includes((store.user.email || '').toLowerCase())) return 'admin';
  return store.profile?.role || 'viewer';
}
export const isAdmin = () => role() === 'admin';
export const canEdit = () => ['admin', 'dept'].includes(role());
/** هل يحق للمستخدم تعديل عنصر تابع لقسم معيّن؟ */
export function canEditDept(deptId) {
  const r = role();
  if (r === 'admin') return true;
  return r === 'dept' && !!deptId && deptId === store.profile?.deptId;
}
export const myDeptId = () => (role() === 'dept' ? store.profile?.deptId : null);

/* ------------------------------ التهيئة ------------------------------ */
export async function initStore() {
  if (firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId) {
    await initFirebase();
  } else {
    initLocal();
  }
}

function initLocal() {
  store.mode = 'local';
  const load = () => {
    let db = {};
    try { db = JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch { db = {}; }
    for (const c of COLLECTIONS) store.data[c] = Object.values(db[c] || {});
  };
  load();
  store.user = { uid: 'local', email: 'local@device', name: 'مستخدم محلي' };
  store.profile = { role: 'admin' };
  store.ready = true;
  // مزامنة بين نوافذ المتصفح نفسه
  window.addEventListener('storage', (e) => {
    if (e.key !== LOCAL_KEY) return;
    load();
    for (const c of COLLECTIONS) emit(c, { remote: true });
  });
  emitAuth();
}

function saveLocal() {
  const db = {};
  for (const c of COLLECTIONS) db[c] = Object.fromEntries(store.data[c].map((d) => [d.id, d]));
  localStorage.setItem(LOCAL_KEY, JSON.stringify(db));
}

async function initFirebase() {
  store.mode = 'firebase';
  const base = `https://www.gstatic.com/firebasejs/${FB_VER}`;
  const [appMod, fsMod, authMod] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-firestore.js`),
    import(`${base}/firebase-auth.js`),
  ]);
  const app = appMod.initializeApp(firebaseConfig);
  let db;
  try {
    db = fsMod.initializeFirestore(app, {
      localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }),
    });
  } catch {
    db = fsMod.getFirestore(app);
  }
  const auth = authMod.getAuth(app);
  store._fb = { fs: fsMod, authMod, db, auth };

  // الاشتراك الفوري بكل المجموعات العامة (القراءة متاحة للجميع حتى يرى الطلبة الجداول)
  let pending = COLLECTIONS.filter((c) => c !== 'users').length;
  await new Promise((resolve) => {
    for (const c of COLLECTIONS) {
      if (c === 'users') continue;
      let first = true;
      fsMod.onSnapshot(fsMod.collection(db, c), { includeMetadataChanges: false }, (snap) => {
        store.data[c] = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
        const remote = !snap.metadata.hasPendingWrites;
        const changes = first ? [] : snap.docChanges().map((ch) => ({ type: ch.type, id: ch.doc.id, data: ch.doc.data() }));
        emit(c, { remote, changes });
        if (first) { first = false; if (--pending === 0) resolve(); }
      }, (err) => {
        console.error('snapshot error', c, err);
        if (first) { first = false; if (--pending === 0) resolve(); }
      });
    }
  });

  let usersUnsub = null;
  await new Promise((resolve) => {
    let firstAuth = true;
    authMod.onAuthStateChanged(auth, async (u) => {
      if (usersUnsub) { usersUnsub(); usersUnsub = null; }
      store.data.users = [];
      if (u) {
        store.user = { uid: u.uid, email: u.email, name: u.displayName || u.email };
        const ref = fsMod.doc(db, 'users', u.uid);
        try {
          const snap = await fsMod.getDoc(ref);
          if (!snap.exists()) {
            const p = { email: u.email, name: u.displayName || '', role: 'viewer', deptId: null, createdAt: Date.now() };
            await fsMod.setDoc(ref, p);
            store.profile = p;
          } else store.profile = snap.data();
        } catch (e) { console.error(e); store.profile = { role: 'viewer' }; }
        // المشرف يتابع قائمة المستخدمين، وغيره يتابع ملفه فقط
        const q = role() === 'admin' ? fsMod.collection(db, 'users') : ref;
        usersUnsub = fsMod.onSnapshot(q, (snap) => {
          if (snap.docs) store.data.users = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
          else if (snap.exists()) { store.profile = snap.data(); store.data.users = [{ ...snap.data(), id: snap.id }]; emitAuth(); }
          emit('users', {});
        }, () => {});
      } else {
        store.user = null;
        store.profile = null;
      }
      emitAuth();
      if (firstAuth) { firstAuth = false; resolve(); }
    });
  });
  store.ready = true;
}

/* ------------------------------ المصادقة ------------------------------ */
export async function signIn(email, password) {
  if (store.mode !== 'firebase') return;
  const { authMod, auth } = store._fb;
  await authMod.signInWithEmailAndPassword(auth, email, password);
}
export async function signUp(email, password, name) {
  if (store.mode !== 'firebase') return;
  const { authMod, auth } = store._fb;
  const cred = await authMod.createUserWithEmailAndPassword(auth, email, password);
  if (name) await authMod.updateProfile(cred.user, { displayName: name });
}
export async function resetPassword(email) {
  const { authMod, auth } = store._fb;
  await authMod.sendPasswordResetEmail(auth, email);
}
export async function signOut() {
  if (store.mode !== 'firebase') return;
  await store._fb.authMod.signOut(store._fb.auth);
}

/* ------------------------------ الكتابة ------------------------------ */
function stamp(obj) {
  return { ...obj, updatedAt: Date.now(), updatedBy: store.user?.name || store.user?.email || '' };
}
function clean(obj) {
  const o = { ...obj };
  delete o.id;
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

export async function add(col, obj) {
  const id = obj.id || uid();
  await batchWrite([{ op: 'set', col, id, data: obj }]);
  return id;
}
export async function update(col, id, patch) {
  await batchWrite([{ op: 'update', col, id, data: patch }]);
}
export async function set(col, id, data) {
  await batchWrite([{ op: 'set', col, id, data }]);
}
export async function remove(col, id) {
  await batchWrite([{ op: 'delete', col, id }]);
}

/**
 * تنفيذ مجموعة عمليات دفعة واحدة.
 * @param {{op:'set'|'update'|'delete', col:string, id?:string, data?:Object}[]} ops
 */
export async function batchWrite(ops) {
  if (!ops.length) return;
  for (const o of ops) if (!o.id) o.id = uid();
  if (store.mode === 'local') {
    const touched = new Set();
    for (const o of ops) {
      const arr = store.data[o.col];
      const i = arr.findIndex((x) => x.id === o.id);
      if (o.op === 'delete') { if (i >= 0) arr.splice(i, 1); }
      else if (o.op === 'update' && i >= 0) arr[i] = { ...arr[i], ...stamp(clean(o.data)), id: o.id };
      else arr[i >= 0 ? i : arr.length] = { ...stamp(clean(o.data)), id: o.id };
      touched.add(o.col);
    }
    saveLocal();
    for (const c of touched) emit(c, { remote: false });
    return;
  }
  const { fs, db } = store._fb;
  for (let i = 0; i < ops.length; i += 450) {
    const b = fs.writeBatch(db);
    for (const o of ops.slice(i, i + 450)) {
      const ref = fs.doc(db, o.col, o.id);
      if (o.op === 'delete') b.delete(ref);
      else if (o.op === 'update') b.update(ref, stamp(clean(o.data)));
      else b.set(ref, stamp(clean(o.data)));
    }
    await b.commit();
  }
}

/* ------------------------------ النسخ الاحتياطي ------------------------------ */
export function exportAll() {
  const out = { app: 'siraj-timetable', version: 1, exportedAt: new Date().toISOString(), data: {} };
  for (const c of COLLECTIONS) if (c !== 'users') out.data[c] = store.data[c];
  return out;
}

/** استعادة نسخة احتياطية: تستبدل كل البيانات الحالية (عدا المستخدمين) */
export async function importAll(json) {
  if (!json || json.app !== 'siraj-timetable' || !json.data) throw new Error('الملف ليس نسخة احتياطية صالحة لهذا النظام');
  const ops = [];
  for (const c of COLLECTIONS) {
    if (c === 'users' || !json.data[c]) continue;
    const keep = new Set(json.data[c].map((d) => d.id));
    for (const d of store.data[c]) if (!keep.has(d.id)) ops.push({ op: 'delete', col: c, id: d.id });
    for (const d of json.data[c]) ops.push({ op: 'set', col: c, id: d.id, data: d });
  }
  await batchWrite(ops);
}
