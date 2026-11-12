/**
 * طبقة البيانات الموحّدة.
 *
 * تعمل بإحدى ثلاث طرق (حسب js/config.js):
 *  - Supabase (PostgreSQL + Auth + Realtime): عند تعبئة supabaseConfig. الأولوية لها إن وُجدت.
 *    الجداول والصلاحيات في supabase/schema.sql، والكتابة دفعة واحدة عبر الدالة tt_apply.
 *  - Firebase (Firestore + Authentication): عند تعبئة firebaseConfig.
 *  - الوضع التجريبي المحلي: بدون أي ربط، تُحفظ البيانات في متصفح الجهاز فقط.
 *
 * كل الواجهات تتعامل مع هذا الملف فقط، ولا تستدعي Firebase أو Supabase مباشرة.
 */
// استيراد كامل الوحدة: ملف config.js القديم (بدون supabaseConfig) يبقى صالحاً
import * as cfg from './config.js';

const firebaseConfig = cfg.firebaseConfig || {};
const supabaseConfig = cfg.supabaseConfig || {};
const SUPER_ADMIN_EMAILS = cfg.SUPER_ADMIN_EMAILS || [];
export const hasFirebase = () => !!(firebaseConfig.apiKey && firebaseConfig.projectId);
export const hasSupabase = () => !!(supabaseConfig.url && supabaseConfig.anonKey);

export const COLLECTIONS = ['colleges', 'departments', 'stages', 'groups', 'teachers', 'rooms', 'subjects', 'sessions', 'settings', 'users'];

const FB_VER = '10.12.2';
export const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const LOCAL_KEY = 'siraj-timetable-db-v1';
const listeners = new Set();
const authListeners = new Set();

export const store = {
  mode: 'local',          // 'supabase' | 'firebase' | 'local'
  ready: false,
  data: Object.fromEntries(COLLECTIONS.map((c) => [c, []])),
  user: null,             // {uid, email, name}
  profile: null,          // {role:'admin'|'college'|'dept'|'viewer', collegeId, deptId}
  _fb: null,
  _sb: null,
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
export const canEdit = () => ['admin', 'college', 'dept'].includes(role());
export const isSuperAdmin = () => store.mode === 'local' ||
  SUPER_ADMIN_EMAILS.map((e) => e.toLowerCase()).includes((store.user?.email || '').toLowerCase());
export const collegeOfDept = (deptId) => byId('departments', deptId)?.collegeId || null;
/** هل يحق للمستخدم تعديل عنصر تابع لقسم معيّن؟ */
export function canEditDept(deptId) {
  const r = role();
  if (r === 'admin') return true;
  if (!deptId) return false;
  if (r === 'college') return collegeOfDept(deptId) === store.profile?.collegeId;
  return r === 'dept' && deptId === store.profile?.deptId;
}
/** هل يحق للمستخدم إدارة بيانات كلية كاملة (أقسامها وقاعاتها)؟ */
export function canEditCollege(collegeId) {
  const r = role();
  return r === 'admin' || (r === 'college' && !!collegeId && collegeId === store.profile?.collegeId);
}
export const myDeptId = () => (role() === 'dept' ? store.profile?.deptId : null);
/** كلية المستخدم (لمعاون العميد أو مسؤول القسم) — تُستخدم كاختيار افتراضي في الواجهة */
export function myCollegeId() {
  const r = role();
  if (r === 'college') return store.profile?.collegeId || null;
  if (r === 'dept') return collegeOfDept(store.profile?.deptId);
  return null;
}

/* ------------------------------ التهيئة ------------------------------ */
export async function initStore() {
  if (hasSupabase()) {
    try {
      await initSupabase();
      return;
    } catch (e) {
      // جداول Supabase لم تُنشأ بعد (لم يُشغَّل schema.sql): يستمر الموقع على Firebase بدل التوقف.
      // أخطاء الاتصال لا تُحوِّل إلى Firebase حتى لا تتوزع التعديلات بين قاعدتين.
      if (!(sbMissingSchema(e) && hasFirebase())) throw e;
      console.warn('Supabase: الجداول غير موجودة بعد (شغّل supabase/schema.sql). يعمل النظام على Firebase مؤقتاً.', e);
      store._sb = null;
      store.sbPending = true;
    }
  }
  if (hasFirebase()) await initFirebase();
  else initLocal();
}

/** هل الخطأ يعني أن جداول النظام غير موجودة في Supabase؟ */
const sbMissingSchema = (e) => ['PGRST205', '42P01'].includes(e?.code) ||
  (/tt_docs/.test(e?.message || '') && /(could not find|does not exist)/i.test(e?.message || ''));

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

/* ------------------------------ Supabase ------------------------------ */
const profileToUser = (row) => ({ ...(row.data || {}), email: row.email || row.data?.email || '', id: row.id });

/** قراءة كل صفوف جدول على دفعات (Supabase يعيد 1000 صف كحد أقصى في الطلب الواحد) */
async function sbSelectAll(query) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query().range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

/** تطبيق تغيير وصل من Supabase Realtime على البيانات المحلية */
function sbApplyRemote(payload) {
  const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
  const col = row?.col;
  if (!col || !store.data[col] || col === 'users') return;
  const arr = store.data[col];
  const i = arr.findIndex((x) => x.id === row.id);
  if (payload.eventType === 'DELETE') { if (i >= 0) arr.splice(i, 1); } else arr[i >= 0 ? i : arr.length] = { ...row.data, id: row.id };
  emit(col, { remote: true, changes: [{ type: payload.eventType === 'DELETE' ? 'removed' : 'modified', id: row.id, data: row.data || {} }] });
}

async function initSupabase() {
  store.mode = 'supabase';
  const { createClient } = await import(SUPABASE_JS);
  const sb = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  store._sb = { sb, profileChannel: null };

  const rows = await sbSelectAll(() => sb.from('tt_docs').select('col,id,data').order('col').order('id'));
  for (const c of COLLECTIONS) if (c !== 'users') store.data[c] = [];
  for (const r of rows) if (store.data[r.col] && r.col !== 'users') store.data[r.col].push({ ...r.data, id: r.id });
  for (const c of COLLECTIONS) emit(c, { remote: true });
  sb.channel('tt-docs').on('postgres_changes', { event: '*', schema: 'public', table: 'tt_docs' }, sbApplyRemote).subscribe();

  await new Promise((resolve) => {
    let first = true;
    sb.auth.onAuthStateChange((event, session) => {
      // لا تُستدعى دوال Supabase داخل هذا المستمع مباشرة (توصية المكتبة)؛ تؤجَّل خطوة واحدة
      setTimeout(async () => {
        try {
          if (event === 'PASSWORD_RECOVERY') await sbRecoverPassword();
          await sbAuthChanged(session);
        } catch (e) { console.error(e); }
        if (first) { first = false; resolve(); }
      }, 0);
    });
  });
  store.ready = true;
}

async function sbAuthChanged(session) {
  const { sb } = store._sb;
  if (store._sb.profileChannel) { sb.removeChannel(store._sb.profileChannel); store._sb.profileChannel = null; }
  store.data.users = [];
  const u = session?.user;
  if (!u) {
    store.user = null;
    store.profile = null;
    emitAuth();
    return;
  }
  store.user = { uid: u.id, email: u.email, name: u.user_metadata?.name || u.email };
  const { data: mine, error } = await sb.from('tt_profiles').select('id,email,data').eq('id', u.id).maybeSingle();
  if (error) console.error(error);
  if (mine) store.profile = mine.data || { role: 'viewer' };
  else {
    const p = { email: u.email, name: u.user_metadata?.name || '', role: 'viewer', deptId: null, collegeId: null, createdAt: Date.now() };
    const ins = await sb.from('tt_profiles').insert({ id: u.id, email: u.email, data: p });
    if (ins.error) console.error(ins.error);
    store.profile = p;
  }
  // المدير يتابع قائمة المستخدمين، وغيره يتابع ملفه فقط (لتصله الصلاحية فور منحها)
  const loadUsers = async () => {
    const q = role() === 'admin'
      ? await sbSelectAll(() => sb.from('tt_profiles').select('id,email,data').order('email'))
      : (await sb.from('tt_profiles').select('id,email,data').eq('id', u.id)).data || [];
    store.data.users = q.map(profileToUser);
    const me = q.find((x) => x.id === u.id);
    if (me) store.profile = me.data || store.profile;
    emit('users', {});
  };
  await loadUsers();
  store._sb.profileChannel = sb.channel(`tt-profiles-${u.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tt_profiles' }, async () => { await loadUsers(); emitAuth(); })
    .subscribe();
  emitAuth();
}

/** بعد الضغط على رابط «نسيت كلمة المرور» في البريد: طلب كلمة مرور جديدة */
async function sbRecoverPassword() {
  const pw = window.prompt('اكتب كلمة المرور الجديدة (6 أحرف على الأقل):');
  if (!pw) return;
  const { error } = await store._sb.sb.auth.updateUser({ password: pw });
  if (error) window.alert('تعذر تغيير كلمة المرور: ' + error.message);
  else window.alert('تم تغيير كلمة المرور بنجاح');
}

/** تحويل خطأ Supabase إلى Error مع رمز يفهمه authError في الواجهة */
function sbError(error) {
  const e = new Error(error.message || String(error));
  const m = (error.message || '').toLowerCase();
  e.code = m.includes('invalid login') ? 'auth/invalid-credential'
    : m.includes('already registered') ? 'auth/email-already-in-use'
      : m.includes('password should be') || m.includes('weak') ? 'auth/weak-password'
        : m.includes('not confirmed') ? 'auth/email-not-confirmed'
          : m.includes('signups not allowed') ? 'auth/signup-disabled'
            : m.includes('invalid') && m.includes('email') ? 'auth/invalid-email'
              : m.includes('fetch') ? 'network' : error.code || '';
  return e;
}

/* ------------------------------ المصادقة ------------------------------ */
export async function signIn(email, password) {
  if (store.mode === 'supabase') {
    const { error } = await store._sb.sb.auth.signInWithPassword({ email, password });
    if (error) throw sbError(error);
    return;
  }
  if (store.mode !== 'firebase') return;
  const { authMod, auth } = store._fb;
  await authMod.signInWithEmailAndPassword(auth, email, password);
}
/** @returns {Promise<{needsConfirm?: boolean}>} needsConfirm: Supabase يطلب تأكيد البريد قبل الدخول */
export async function signUp(email, password, name) {
  if (store.mode === 'supabase') {
    const { data, error } = await store._sb.sb.auth.signUp({ email, password, options: { data: { name } } });
    if (error) throw sbError(error);
    return { needsConfirm: !data.session };
  }
  if (store.mode !== 'firebase') return {};
  const { authMod, auth } = store._fb;
  const cred = await authMod.createUserWithEmailAndPassword(auth, email, password);
  if (name) await authMod.updateProfile(cred.user, { displayName: name });
  return {};
}
export async function resetPassword(email) {
  if (store.mode === 'supabase') {
    const { error } = await store._sb.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) throw sbError(error);
    return;
  }
  const { authMod, auth } = store._fb;
  await authMod.sendPasswordResetEmail(auth, email);
}
export async function signOut() {
  if (store.mode === 'supabase') { await store._sb.sb.auth.signOut(); return; }
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
/** تطبيق العمليات على البيانات المحلية في الذاكرة (upsertOnUpdate: التعديل يُنشئ الوثيقة إن لم توجد، كالوضع المحلي سابقاً) */
function applyLocal(ops, upsertOnUpdate = false) {
  const touched = new Set();
  for (const o of ops) {
    const arr = store.data[o.col];
    if (!arr) continue;
    const i = arr.findIndex((x) => x.id === o.id);
    if (o.op === 'delete') { if (i >= 0) arr.splice(i, 1); }
    else if (o.op === 'update' && i >= 0) arr[i] = { ...arr[i], ...o.data, id: o.id };
    else if (o.op !== 'update' || upsertOnUpdate) arr[i >= 0 ? i : arr.length] = { ...o.data, id: o.id };
    touched.add(o.col);
  }
  return touched;
}

export async function batchWrite(ops) {
  if (!ops.length) return;
  for (const o of ops) if (!o.id) o.id = uid();
  if (store.mode === 'local') {
    const touched = applyLocal(ops.map((o) => (o.op === 'delete' ? o : { ...o, data: stamp(clean(o.data)) })), true);
    saveLocal();
    for (const c of touched) emit(c, { remote: false });
    return;
  }
  if (store.mode === 'supabase') {
    // ملفات المستخدمين لا تحمل ختم التعديل؛ بقية البيانات تحمل وقت ومنفّذ التعديل كما في Firebase
    const prepared = ops.map((o) => (o.op === 'delete' ? { op: 'delete', col: o.col, id: o.id }
      : { op: o.op, col: o.col, id: o.id, data: o.col === 'users' ? clean(o.data) : stamp(clean(o.data)) }));
    for (let i = 0; i < prepared.length; i += 400) {
      const { error } = await store._sb.sb.rpc('tt_apply', { ops: prepared.slice(i, i + 400) });
      if (error) {
        const e = new Error(error.message?.includes('row-level security') ? 'لا تملك صلاحية الحفظ في هذا القسم أو الكلية' : error.message);
        e.code = error.code;
        throw e;
      }
    }
    // التحديث الفوري للواجهة (ستصل التغييرات نفسها عبر Realtime ولا تتكرر)
    const users = prepared.filter((o) => o.col === 'users');
    const touched = applyLocal(prepared.filter((o) => o.col !== 'users'));
    if (users.length) {
      for (const o of users) {
        const i = store.data.users.findIndex((x) => x.id === o.id);
        if (i >= 0 && o.op !== 'delete') store.data.users[i] = { ...store.data.users[i], ...o.data };
        else if (i >= 0) store.data.users.splice(i, 1);
      }
      touched.add('users');
    }
    for (const c of touched) emit(c, { remote: false });
    return;
  }
  const { fs, db } = store._fb;
  // قواعد الأمان لغير المشرف العام تقرأ ملف المستخدم والقسم عند كل كتابة، ولـ Firestore حد أقصى
  // لعدد هذه القراءات في الدفعة الواحدة؛ لذلك نقسّم كتاباتهم إلى دفعات صغيرة.
  const size = isSuperAdmin() ? 450 : 6;
  for (let i = 0; i < ops.length; i += size) {
    const b = fs.writeBatch(db);
    for (const o of ops.slice(i, i + size)) {
      const ref = fs.doc(db, o.col, o.id);
      if (o.op === 'delete') b.delete(ref);
      else if (o.op === 'update') b.update(ref, stamp(clean(o.data)));
      else b.set(ref, stamp(clean(o.data)));
    }
    await b.commit();
  }
}

/* ------------------------------ النقل من Firebase ------------------------------ */
function fsValue(v) {
  const [k, x] = Object.entries(v)[0] || [];
  if (k === 'mapValue') return Object.fromEntries(Object.entries(x.fields || {}).map(([kk, vv]) => [kk, fsValue(vv)]));
  if (k === 'arrayValue') return (x.values || []).map(fsValue);
  if (k === 'integerValue' || k === 'doubleValue') return Number(x);
  if (k === 'nullValue') return null;
  return x;
}

/**
 * قراءة كل بيانات Firebase (القراءة متاحة للجميع حسب قواعد الأمان) بصيغة النسخة الاحتياطية،
 * لنقلها إلى Supabase بخطوة واحدة من صفحة الإعدادات.
 */
export async function fetchFirebaseBackup(onProgress = () => {}) {
  if (!hasFirebase()) throw new Error('لا توجد إعدادات Firebase في js/config.js');
  const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseConfig.projectId)}/databases/(default)/documents`;
  const data = {};
  for (const c of COLLECTIONS) {
    if (c === 'users') continue;
    data[c] = [];
    let token = '';
    do {
      const url = `${base}/${c}?pageSize=300&key=${encodeURIComponent(firebaseConfig.apiKey)}${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`تعذرت قراءة ${c} من Firebase (${r.status})`);
      const j = await r.json();
      for (const d of j.documents || []) {
        data[c].push({ ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, fsValue(v)])), id: d.name.split('/').pop() });
      }
      token = j.nextPageToken || '';
    } while (token);
    onProgress(c, data[c].length);
  }
  return { app: 'siraj-timetable', version: 1, exportedAt: new Date().toISOString(), source: 'firebase', data };
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
