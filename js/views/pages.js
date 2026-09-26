/**
 * صفحات: لوحة التحكم، التعارضات، المستخدمون والصلاحيات، الإعدادات والنسخ الاحتياطي، تسجيل الدخول.
 */
import {
  store, byId, settings, batchWrite, set, isAdmin, canEdit, myDeptId, role,
  signIn, signUp, signOut, resetPassword, exportAll, importAll, uid,
} from '../store.js';
import { checkAll } from '../conflicts.js';
import { esc, el, $, $$, toast, confirmDialog, download, modal } from '../ui.js';
import { DAY_NAMES, SEMESTERS, toHHMM, toMinutes, formatRange } from '../timeutil.js';
import { ctx, termSessions, sortByName, deptName, groupsSorted, subjectName, termLabel, currentTerm } from '../model.js';
import { openEditor } from './schedule.js';
import { seedOps } from '../seed/radiology.js';

export const ROLE_NAMES = { admin: 'معاون العميد (مشرف عام)', dept: 'مسؤول قسم', viewer: 'عرض فقط', guest: 'زائر' };

/* =============================== لوحة التحكم =============================== */
export function renderDashboard(container) {
  const sessions = termSessions();
  const conflicts = checkAll(sessions, ctx());
  const issues = [...conflicts.values()].flat();
  const errors = issues.filter((i) => i.level === 'error').length / 2; // كل تعارض يظهر للطرفين
  const warns = issues.filter((i) => i.level === 'warning').length;
  const s = settings();
  const daysSinceBackup = s.lastBackupAt ? Math.floor((Date.now() - s.lastBackupAt) / 864e5) : null;
  const mine = myDeptId();
  const depts = sortByName(store.data.departments).filter((d) => !mine || d.id === mine);

  const recent = [...store.data.sessions].filter((x) => x.updatedAt).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
  const stat = (icon, n, label, href) => `<a class="stat" href="${href}"><span class="stat-icon">${icon}</span><span class="stat-n">${n}</span><span class="stat-l">${label}</span></a>`;
  container.innerHTML = '';
  const page = el(`<div class="page">
    <div class="page-head"><h2>لوحة التحكم</h2><span class="term-badge">${esc(termLabel())}</span></div>
    ${isAdmin() && (daysSinceBackup === null || daysSinceBackup > 7) ? `<div class="banner warn">💾 ${daysSinceBackup === null ? 'لم تُؤخذ نسخة احتياطية بعد.' : `آخر نسخة احتياطية قبل ${daysSinceBackup} يوم.`} <a href="#/settings">خذ نسخة الآن</a></div>` : ''}
    <div class="stats">
      ${stat('🏢', store.data.departments.length, 'قسم', '#/departments')}
      ${stat('🎓', store.data.groups.length, 'شعبة / مجموعة', '#/stages')}
      ${stat('👨‍🏫', store.data.teachers.length, 'أستاذ', '#/teachers')}
      ${stat('🚪', store.data.rooms.length, 'قاعة ومختبر', '#/rooms')}
      ${stat('📘', store.data.subjects.length, 'مادة دراسية', '#/subjects')}
      ${stat('🗓', sessions.length, 'محاضرة هذا الفصل', '#/schedule')}
      ${stat(errors ? '⛔' : '✅', errors, 'تعارض', '#/conflicts')}
      ${stat('⚠️', warns, 'تنبيه', '#/conflicts')}
    </div>
    ${canEdit() ? `<div class="quick">
      <a class="btn btn-primary" href="#/schedule">🗓 فتح الجداول</a>
      <a class="btn" href="#/generate">⚙️ توليد تلقائي</a>
      <a class="btn" href="#/subjects">📘 المواد والمناهج</a>
      <a class="btn" href="#/teachers">👨‍🏫 الأساتذة</a>
    </div>` : ''}
    <div class="two-col">
      <div class="card"><h3>حالة الأقسام</h3>
        <div class="table-wrap"><table class="mini-table"><thead><tr><th>القسم</th><th>الشعب</th><th>المواد (هذا الفصل)</th><th>المحاضرات</th><th>التعارضات</th><th></th></tr></thead><tbody>
        ${depts.map((d) => {
          const ds = sessions.filter((x) => x.deptId === d.id);
          const de = ds.filter((x) => (conflicts.get(x.id) || []).some((i) => i.level === 'error')).length;
          const subs = store.data.subjects.filter((x) => x.deptId === d.id && Number(x.semester || 1) === Number(s.semester || 1)).length;
          return `<tr><td>${esc(d.name)}</td><td>${store.data.groups.filter((g) => g.deptId === d.id).length}</td><td>${subs}</td><td>${ds.length}</td>
            <td>${de ? `<span class="chip chip-error">${de}</span>` : '<span class="chip chip-ok">0</span>'}</td>
            <td><a class="btn btn-sm" href="#/schedule?type=dept&id=${d.id}">عرض</a></td></tr>`;
        }).join('')}
        </tbody></table></div></div>
      <div class="card"><h3>آخر التعديلات</h3>
        ${recent.length ? `<ul class="recent">${recent.map((x) => `<li><b>${esc(subjectName(x))}</b> — ${DAY_NAMES[x.day]} ${formatRange(x.start, x.end)}<br><small class="muted">${esc(x.updatedBy || '')} • ${new Date(x.updatedAt).toLocaleString('ar-IQ')}</small></li>`).join('')}</ul>` : '<p class="muted">لا توجد تعديلات بعد</p>'}
      </div>
    </div>
  </div>`);
  container.appendChild(page);
}

/* =============================== التعارضات =============================== */
const cf = { dept: '', level: 'all' };
export function renderConflicts(container) {
  if (!cf.dept) cf.dept = myDeptId() || '';
  const sessions = termSessions();
  const conflicts = checkAll(sessions, ctx());
  const rows = [];
  const seen = new Set();
  for (const [id, list] of conflicts) {
    const s = byId('sessions', id);
    if (!s || (cf.dept && s.deptId !== cf.dept)) continue;
    for (const i of list) {
      if (cf.level !== 'all' && i.level !== cf.level) continue;
      const key = i.otherId ? [id, i.otherId].sort().join('|') + i.type : id + i.type + i.message;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ s, i });
    }
  }
  rows.sort((a, b) => (a.i.level === b.i.level ? a.s.day - b.s.day || a.s.start - b.s.start : a.i.level === 'error' ? -1 : 1));
  container.innerHTML = '';
  const page = el(`<div class="page">
    <div class="page-head"><h2>⚠️ التعارضات والتنبيهات</h2><span class="muted">${rows.length}</span></div>
    <div class="toolbar">
      <select id="dept"><option value="">كل الأقسام</option>${sortByName(store.data.departments).map((d) => `<option value="${d.id}" ${d.id === cf.dept ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
      <div class="seg">${[['all', 'الكل'], ['error', 'تعارضات'], ['warning', 'تنبيهات']].map(([k, v]) => `<button data-l="${k}" class="${cf.level === k ? 'active' : ''}">${v}</button>`).join('')}</div>
    </div>
    ${rows.length ? `<div class="issues-list">${rows.map((r, n) => `<div class="issue-row ${r.i.level}">
        <span class="badge">${r.i.level === 'error' ? '⛔ تعارض' : '⚠️ تنبيه'}</span>
        <div><b>${esc(subjectName(r.s))}</b> — ${esc(deptName(r.s.deptId))} — ${DAY_NAMES[r.s.day]} ${formatRange(r.s.start, r.s.end)}<br>${esc(r.i.message)}</div>
        <button class="btn btn-sm" data-open="${n}">فتح</button></div>`).join('')}</div>`
      : '<div class="empty-state">✅ لا توجد تعارضات. الجداول سليمة.</div>'}
  </div>`);
  container.appendChild(page);
  $('#dept', page).onchange = (e) => { cf.dept = e.target.value; renderConflicts(container); };
  $$('[data-l]', page).forEach((b) => b.onclick = () => { cf.level = b.dataset.l; renderConflicts(container); });
  $$('[data-open]', page).forEach((b) => b.onclick = () => openEditor(rows[b.dataset.open].s));
}

/* =============================== المستخدمون =============================== */
export function renderUsers(container) {
  container.innerHTML = '';
  if (store.mode === 'local') {
    container.appendChild(el(`<div class="page"><div class="page-head"><h2>👥 المستخدمون والصلاحيات</h2></div>
      <div class="banner warn">النظام يعمل حالياً في الوضع التجريبي المحلي. لتفعيل الحسابات والصلاحيات والعمل التشاركي اربط النظام بـ Firebase (راجع دليل النشر).</div></div>`));
    return;
  }
  const users = [...store.data.users].sort((a, b) => (a.email || '').localeCompare(b.email || ''));
  const depts = sortByName(store.data.departments);
  const page = el(`<div class="page">
    <div class="page-head"><h2>👥 المستخدمون والصلاحيات</h2></div>
    <div class="card"><p><b>طريقة إضافة مستخدم:</b> يفتح الشخص النظام ويختار «إنشاء حساب»، ثم يظهر هنا بصلاحية «عرض فقط»، فتغيّر صلاحيته إلى «مسؤول قسم» وتحدد قسمه، أو «معاون العميد».</p>
    <ul class="muted"><li><b>معاون العميد:</b> كل الصلاحيات على كل الأقسام والقاعات والمستخدمين والإعدادات.</li>
    <li><b>مسؤول قسم:</b> يدير مواد وشعب وجداول قسمه فقط، ويرى جداول الجميع لتجنب التعارض.</li>
    <li><b>عرض فقط:</b> يشاهد الجداول دون تعديل (يمكن أيضاً للطلبة المشاهدة عبر رابط المشاركة دون حساب).</li></ul></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>البريد</th><th>الاسم</th><th>الصلاحية</th><th>القسم</th><th></th></tr></thead><tbody>
    ${users.map((u) => `<tr data-id="${u.id}"><td data-label="البريد">${esc(u.email)}</td><td data-label="الاسم">${esc(u.name || '')}</td>
      <td data-label="الصلاحية"><select data-role>${['viewer', 'dept', 'admin'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${ROLE_NAMES[r]}</option>`).join('')}</select></td>
      <td data-label="القسم"><select data-dept><option value="">—</option>${depts.map((d) => `<option value="${d.id}" ${d.id === u.deptId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></td>
      <td class="actions"><button class="btn btn-sm btn-primary" data-save>حفظ</button><button class="btn btn-sm btn-danger-ghost" data-del>حذف</button></td></tr>`).join('')}
    </tbody></table></div></div>`);
  container.appendChild(page);
  page.addEventListener('click', async (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const id = tr.dataset.id;
    if (e.target.matches('[data-save]')) {
      const r = $('[data-role]', tr).value, d = $('[data-dept]', tr).value || null;
      if (r === 'dept' && !d) { toast('حدد القسم لمسؤول القسم', 'warn'); return; }
      await batchWrite([{ op: 'update', col: 'users', id, data: { role: r, deptId: d } }]);
      toast('تم تحديث الصلاحية', 'success');
    }
    if (e.target.matches('[data-del]')) {
      if (!(await confirmDialog('حذف صلاحيات هذا المستخدم؟ (يبقى حسابه ولكن يعود للعرض فقط)', { danger: true }))) return;
      await batchWrite([{ op: 'delete', col: 'users', id }]);
    }
  });
}

/* =============================== الإعدادات والنسخ الاحتياطي =============================== */
export function renderSettings(container) {
  const s = { ...settings() };
  const sh = s.shifts || { morning: { start: 480, end: 840 }, evening: { start: 840, end: 1200 } };
  const days = new Set(s.days || [1, 2, 3, 4, 5]);
  container.innerHTML = '';
  const page = el(`<div class="page">
    <div class="page-head"><h2>🔧 الإعدادات</h2></div>
    <div class="card"><h3>الفصل الدراسي والدوام</h3>
      <div class="form-grid">
        <div class="field"><label>العام الدراسي</label><input id="year" value="${esc(s.academicYear || '')}" placeholder="2025-2026"></div>
        <div class="field"><label>الفصل الدراسي الحالي</label><select id="sem">${Object.entries(SEMESTERS).map(([k, v]) => `<option value="${k}" ${Number(k) === Number(s.semester) ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <small class="muted">لكل فصل جداول مستقلة. تغيير الفصل يعرض جداوله.</small></div>
        <div class="field full"><label>أيام الدوام</label><div class="checklist inline">${DAY_NAMES.map((d, i) => `<label class="chk"><input type="checkbox" name="day" value="${i}" ${days.has(i) ? 'checked' : ''}> ${d}</label>`).join('')}</div></div>
        <div class="field"><label>بداية اليوم في الجدول</label><input type="time" id="ds" value="${toHHMM(s.dayStart ?? 480)}"></div>
        <div class="field"><label>نهاية اليوم في الجدول</label><input type="time" id="de" value="${toHHMM(s.dayEnd ?? 1200)}"></div>
        <div class="field"><label>الدوام الصباحي: من</label><input type="time" id="ms" value="${toHHMM(sh.morning.start)}"></div>
        <div class="field"><label>الدوام الصباحي: إلى</label><input type="time" id="me" value="${toHHMM(sh.morning.end)}"></div>
        <div class="field"><label>الدوام المسائي: من</label><input type="time" id="es" value="${toHHMM(sh.evening.start)}"></div>
        <div class="field"><label>الدوام المسائي: إلى</label><input type="time" id="ee" value="${toHHMM(sh.evening.end)}"></div>
        <div class="field"><label>دقة تحريك الوقت (دقيقة)</label><select id="slot">${[5, 10, 15, 30, 60].map((m) => `<option ${m === (s.slotMinutes || 30) ? 'selected' : ''}>${m}</option>`).join('')}</select>
          <small class="muted">عند السحب والإفلات يُقرَّب الوقت لأقرب مضاعف لهذه القيمة.</small></div>
      </div>
      <div class="toolbar"><button class="btn btn-primary" id="save">حفظ الإعدادات</button></div>
    </div>
    <div class="card"><h3>💾 النسخ الاحتياطي</h3>
      <p class="muted">البيانات محفوظة سحابياً في Firebase، ومع ذلك يُنصح بتنزيل نسخة احتياطية أسبوعياً وحفظها في مكان آمن (Google Drive مثلاً).</p>
      <div class="toolbar">
        <button class="btn btn-primary" id="backup">⬇ تنزيل نسخة احتياطية (JSON)</button>
        <label class="btn">⬆ استعادة من نسخة<input type="file" id="restore" accept=".json" hidden></label>
      </div>
      ${s.lastBackupAt ? `<p class="muted">آخر نسخة: ${new Date(s.lastBackupAt).toLocaleString('ar-IQ')}</p>` : ''}
    </div>
    <div class="card"><h3>أدوات</h3>
      <div class="toolbar">
        <button class="btn" id="copyTerm">📋 نسخ جداول فصل سابق إلى الفصل الحالي</button>
        <button class="btn" id="seed">📥 إعادة إدراج البيانات الأولية (قسم الأشعة)</button>
        <button class="btn btn-danger-ghost" id="clearTerm">🗑 حذف كل محاضرات الفصل الحالي</button>
      </div>
    </div>
  </div>`);
  container.appendChild(page);

  $('#save', page).onclick = async () => {
    const data = {
      ...s,
      academicYear: $('#year', page).value.trim(),
      semester: Number($('#sem', page).value),
      days: $$('[name=day]:checked', page).map((i) => Number(i.value)).sort((a, b) => a - b),
      dayStart: toMinutes($('#ds', page).value), dayEnd: toMinutes($('#de', page).value),
      slotMinutes: Number($('#slot', page).value),
      shifts: {
        morning: { start: toMinutes($('#ms', page).value), end: toMinutes($('#me', page).value) },
        evening: { start: toMinutes($('#es', page).value), end: toMinutes($('#ee', page).value) },
      },
    };
    if (!data.days.length) { toast('اختر يوماً واحداً على الأقل', 'warn'); return; }
    if (data.dayEnd <= data.dayStart) { toast('نهاية اليوم يجب أن تكون بعد بدايته', 'warn'); return; }
    delete data.id;
    await set('settings', 'app', data);
    toast('تم حفظ الإعدادات', 'success');
  };
  $('#backup', page).onclick = async () => {
    const json = exportAll();
    download(`نسخة_احتياطية_الجداول_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(json, null, 1), 'application/json');
    await batchWrite([{ op: 'update', col: 'settings', id: 'app', data: { lastBackupAt: Date.now() } }]).catch(() => {});
  };
  $('#restore', page).onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      if (!(await confirmDialog(`استعادة النسخة المؤرخة ${json.exportedAt || ''}؟ سيتم استبدال كل البيانات الحالية.`, { danger: true, okLabel: 'استعادة' }))) return;
      await importAll(json);
      toast('تمت الاستعادة بنجاح', 'success');
    } catch (err) { toast(err.message, 'error'); }
  };
  $('#clearTerm', page).onclick = async () => {
    const list = termSessions();
    if (!(await confirmDialog(`حذف ${list.length} محاضرة من ${termLabel()}؟ لا يمكن التراجع (إلا من نسخة احتياطية).`, { danger: true, okLabel: 'حذف' }))) return;
    await batchWrite(list.map((x) => ({ op: 'delete', col: 'sessions', id: x.id })));
    toast('تم الحذف', 'success');
  };
  $('#seed', page).onclick = async () => {
    if (!(await confirmDialog('سيتم إضافة الأقسام والمراحل ومواد قسم الأشعة والقاعات النموذجية من جديد (قد تتكرر إن كانت موجودة). متابعة؟'))) return;
    const ops = seedOps(uid).filter((o) => !(o.col === 'settings' && store.data.settings.length));
    await batchWrite(ops);
    toast('تم الإدراج', 'success');
  };
  $('#copyTerm', page).onclick = async () => {
    const terms = [...new Set(store.data.sessions.map((x) => x.term || ''))].filter((t) => t !== currentTerm());
    if (!terms.length) { toast('لا توجد فصول أخرى لها جداول', 'warn'); return; }
    const body = el(`<div><label>انسخ من:</label> <select id="from">${terms.map((t) => `<option value="${esc(t)}">${esc(termLabel(t))}</option>`).join('')}</select></div>`);
    const ok = await modal({ title: 'نسخ جداول فصل سابق', body, buttons: [{ label: 'نسخ', value: true, cls: 'btn-primary' }, { label: 'إلغاء', value: false }],
      onButton: async (v) => {
        if (!v) return true;
        const from = $('#from', body).value;
        const src = store.data.sessions.filter((x) => (x.term || '') === from);
        await batchWrite(src.map((x) => ({ op: 'set', col: 'sessions', id: uid(), data: { ...x, id: undefined, term: currentTerm() } })));
        toast(`تم نسخ ${src.length} محاضرة`, 'success');
        return true;
      } });
    return ok;
  };
}

/* =============================== تسجيل الدخول =============================== */
export function renderLogin(container) {
  container.innerHTML = '';
  const page = el(`<div class="login-wrap"><div class="card login-card">
    <h2>تسجيل الدخول</h2>
    <div class="seg full"><button class="active" data-tab="in">دخول</button><button data-tab="up">إنشاء حساب</button></div>
    <form id="f" class="form-grid one">
      <div class="field" data-up hidden><label>الاسم الكامل</label><input name="name" autocomplete="name"></div>
      <div class="field"><label>البريد الإلكتروني</label><input name="email" type="email" required autocomplete="email" dir="ltr"></div>
      <div class="field"><label>كلمة المرور</label><input name="password" type="password" required minlength="6" autocomplete="current-password" dir="ltr"></div>
      <button class="btn btn-primary btn-lg" type="submit" id="go">دخول</button>
      <button class="btn btn-link" type="button" id="forgot">نسيت كلمة المرور؟</button>
    </form>
    <hr><a class="btn full" href="#/public">👁 عرض الجداول بدون تسجيل (للطلبة)</a>
  </div></div>`);
  container.appendChild(page);
  let mode = 'in';
  $$('[data-tab]', page).forEach((b) => b.onclick = () => {
    mode = b.dataset.tab;
    $$('[data-tab]', page).forEach((x) => x.classList.toggle('active', x === b));
    $('[data-up]', page).hidden = mode !== 'up';
    $('#go', page).textContent = mode === 'up' ? 'إنشاء الحساب' : 'دخول';
  });
  const f = $('#f', page);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const email = f.email.value.trim(), pw = f.password.value;
    try {
      if (mode === 'up') {
        await signUp(email, pw, f.name.value.trim());
        toast('تم إنشاء الحساب. اطلب من معاون العميد منحك الصلاحية المناسبة.', 'success', 6000);
      } else await signIn(email, pw);
      location.hash = '#/';
    } catch (err) { toast(authError(err), 'error', 5000); }
  };
  $('#forgot', page).onclick = async () => {
    const email = f.email.value.trim();
    if (!email) { toast('اكتب بريدك الإلكتروني أولاً', 'warn'); return; }
    try { await resetPassword(email); toast('أُرسل رابط إعادة التعيين إلى بريدك', 'success'); } catch (err) { toast(authError(err), 'error'); }
  };
}

function authError(e) {
  const c = e.code || '';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) return 'البريد أو كلمة المرور غير صحيحة';
  if (c.includes('email-already-in-use')) return 'هذا البريد مسجل مسبقاً';
  if (c.includes('weak-password')) return 'كلمة المرور ضعيفة (6 أحرف على الأقل)';
  if (c.includes('invalid-email')) return 'البريد الإلكتروني غير صالح';
  if (c.includes('network')) return 'تحقق من الاتصال بالإنترنت';
  return e.message || String(e);
}

export { signOut, role };
