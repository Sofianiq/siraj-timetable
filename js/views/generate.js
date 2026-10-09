/**
 * صفحة التوليد التلقائي للجداول.
 */
import { store, byId, settings, batchWrite, uid, canEditDept, myDeptId, collegeOfDept } from '../store.js';
import { generate } from '../generator.js';
import { checkSession, hasErrors } from '../conflicts.js';
import { esc, el, $, $$, toast, confirmDialog } from '../ui.js';
import { STAGE_NAMES, SHIFTS } from '../timeutil.js';
import { currentTerm, termSessions, groupLabel, termLabel, ctx, currentCollegeId, managedColleges, deptsOfCollege } from '../model.js';

/** القيمة ALL في اختيار القسم تعني: كل أقسام الكلية التي يحق للمستخدم تعديلها */
const ALL = '__all__';
const form = { collegeId: '', deptId: '', levels: [1, 2, 3, 4, 5, 6], shifts: ['morning', 'evening'], keepManual: true };

/** الأقسام المشمولة بالتوليد */
function scopeDepts() {
  const editable = deptsOfCollege(form.collegeId).filter((d) => canEditDept(d.id));
  return form.deptId === ALL ? editable : editable.filter((d) => d.id === form.deptId);
}
let lastResult = null;

export function renderGenerate(container) {
  const st = settings();
  const colleges = managedColleges().filter((c) => deptsOfCollege(c.id).some((d) => canEditDept(d.id)));
  if (!colleges.some((c) => c.id === form.collegeId)) {
    const cur = currentCollegeId();
    form.collegeId = (colleges.some((c) => c.id === cur) && cur) || collegeOfDept(myDeptId()) || colleges[0]?.id || '';
  }
  const depts = deptsOfCollege(form.collegeId).filter((d) => canEditDept(d.id));
  if (form.deptId !== ALL && !depts.some((d) => d.id === form.deptId)) {
    form.deptId = depts.some((d) => d.id === myDeptId()) ? myDeptId() : depts.length > 1 ? ALL : depts[0]?.id || '';
  }
  const deptIds = new Set(scopeDepts().map((d) => d.id));
  const levelsAvail = [1, 2, 3, 4, 5, 6].filter((l) => store.data.stages.some((s) => deptIds.has(s.deptId) && Number(s.level) === l));
  container.innerHTML = '';
  const page = el(`<div class="page">
    <div class="page-head"><h2>⚙️ التوليد التلقائي للجداول</h2><span class="term-badge">${esc(termLabel())}</span></div>
    <div class="card">
      <p>يوزّع النظام محاضرات المواد (النظرية والعملية) على الأيام والقاعات تلقائياً مع مراعاة: تفرغ الأستاذ وأوقات توفره،
      شغور القاعات والمختبرات على مستوى الجامعة كلها (بما فيها حجوزات الأقسام والكليات الأخرى)، عدم تداخل محاضرات الشعبة،
      سعة القاعة، نوع المختبر، وقت الدوام الصباحي/المسائي، وتوزيع المادة على أيام مختلفة وتقليل الفراغات.</p>
      <div class="form-grid">
        <div class="field"><label>الكلية</label><select id="college">${colleges.map((c) => `<option value="${c.id}" ${c.id === form.collegeId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label>القسم</label><select id="dept">
          ${depts.length > 1 ? `<option value="${ALL}" ${form.deptId === ALL ? 'selected' : ''}>كل أقسام الكلية (${depts.length})</option>` : ''}
          ${depts.map((d) => `<option value="${d.id}" ${d.id === form.deptId ? 'selected' : ''}>${esc(d.general ? `${d.name} (الكلية كاملة)` : d.name)}</option>`).join('')}</select>
          <small class="muted">تُستخدم مواد القسم/الكلية المختار فقط.</small></div>
        <div class="field"><label>المراحل</label><div class="checklist inline">${levelsAvail.map((l) =>
          `<label class="chk"><input type="checkbox" name="lvl" value="${l}" ${form.levels.includes(l) ? 'checked' : ''}> ${STAGE_NAMES[l]}</label>`).join('')}</div></div>
        <div class="field"><label>نوع الدراسة</label><div class="checklist inline">${Object.entries(SHIFTS).map(([k, v]) =>
          `<label class="chk"><input type="checkbox" name="shift" value="${k}" ${form.shifts.includes(k) ? 'checked' : ''}> ${v}</label>`).join('')}</div></div>
        <div class="field"><label>أقصى مدة للمحاضرة النظرية (ساعة)</label><input type="number" id="maxT" min="1" max="4" step="0.5" value="${st.maxTheoryBlock || 2}"></div>
        <div class="field"><label>أقصى مدة للمحاضرة العملية (ساعة)</label><input type="number" id="maxP" min="1" max="6" step="0.5" value="${st.maxPracticalBlock || 3}"></div>
        <div class="field"><label>أقصى ساعات يومياً للشعبة</label><input type="number" id="maxD" min="2" max="12" value="${st.maxDailyHours || 6}"></div>
        <div class="field full"><label class="chk"><input type="checkbox" id="keep" ${form.keepManual ? 'checked' : ''}> الإبقاء على المحاضرات المضافة أو المعدلة يدوياً (والمثبتة 🔒 تبقى دائماً)</label></div>
      </div>
      <div class="toolbar"><button class="btn btn-primary btn-lg" id="run">🚀 توليد الجدول</button></div>
    </div>
    <div id="result"></div>
  </div>`);
  container.appendChild(page);

  $('#college', page).onchange = (e) => { form.collegeId = e.target.value; form.deptId = ''; lastResult = null; renderGenerate(container); };
  $('#dept', page).onchange = (e) => { form.deptId = e.target.value; lastResult = null; renderGenerate(container); };
  $('#run', page).onclick = () => run(page);
  if (lastResult && lastResult.scopeKey === `${form.collegeId}|${form.deptId}`) showResult(page, lastResult);
}

function scope(page) {
  form.levels = $$('[name=lvl]:checked', page).map((i) => Number(i.value));
  form.shifts = $$('[name=shift]:checked', page).map((i) => i.value);
  form.keepManual = $('#keep', page).checked;
  const deptIds = new Set(scopeDepts().map((d) => d.id));
  const stages = store.data.stages.filter((s) => deptIds.has(s.deptId) && form.levels.includes(Number(s.level)));
  const stageIds = new Set(stages.map((s) => s.id));
  const groups = store.data.groups.filter((g) => stageIds.has(g.stageId) && form.shifts.includes(g.shift || 'morning'));
  return { deptIds, stages, groups, groupIds: new Set(groups.map((g) => g.id)) };
}

function run(page) {
  const st = settings();
  const { deptIds, stages, groups, groupIds } = scope(page);
  if (!groups.length) { toast('لا توجد شعب ضمن النطاق المحدد', 'warn'); return; }
  const term = currentTerm();
  const sem = Number(st.semester || 1);
  const all = termSessions(term);
  const inScope = (s) => deptIds.has(s.deptId) && s.kind !== 'external' && (s.groupIds || []).length && s.groupIds.every((g) => groupIds.has(g));
  const toRemove = all.filter((s) => inScope(s) && !s.locked && (s.auto || !form.keepManual));
  const removeIds = new Set(toRemove.map((s) => s.id));
  const fixed = all.filter((s) => !removeIds.has(s.id));
  const keptInScope = fixed.filter(inScope);
  // مواد أقسام النطاق فقط (لا تدخل مواد كلية أو قسم آخر)
  const subjects = store.data.subjects.filter((s) => deptIds.has(s.deptId) && Number(s.semester || 1) === sem && form.levels.includes(Number(s.stageLevel)));
  if (!subjects.length) { toast(`لا توجد مواد للفصل ${sem} في المراحل المحددة`, 'warn'); return; }

  const btn = $('#run', page);
  btn.disabled = true; btn.textContent = '⏳ جارٍ التوليد…';
  setTimeout(() => {
    try {
      const res = generate({
        subjects, stages, groups, teachers: store.data.teachers, rooms: store.data.rooms,
        fixedSessions: fixed, keptInScope, settings: st,
        deptCollege: form.collegeId,
        options: {
          maxTheoryBlock: Number($('#maxT', page).value) || 2,
          maxPracticalBlock: Number($('#maxP', page).value) || 3,
          maxDailyHours: Number($('#maxD', page).value) || 6,
        },
      });
      lastResult = { ...res, deptId: form.deptId, collegeId: form.collegeId, scopeKey: `${form.collegeId}|${form.deptId}`, toRemove, term };
      showResult(page, lastResult);
    } catch (e) {
      console.error(e);
      toast('خطأ أثناء التوليد: ' + e.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = '🚀 توليد الجدول';
    }
  }, 30);
}

function showResult(page, res) {
  const box = $('#result', page);
  const perGroup = new Map();
  for (const s of res.sessions) for (const g of s.groupIds) perGroup.set(g, (perGroup.get(g) || 0) + (s.end - s.start) / 60);
  box.innerHTML = '';
  const card = el(`<div class="card">
    <h3>نتيجة التوليد</h3>
    <div class="summary">
      <span class="chip chip-ok">✓ ${res.sessions.length} محاضرة جديدة</span>
      ${res.unplaced.length ? `<span class="chip chip-error">✗ ${res.unplaced.length} لم تُجدول</span>` : '<span class="chip chip-ok">كل المحاضرات جُدولت</span>'}
      <span class="chip">سيتم استبدال ${res.toRemove.length} محاضرة سابقة</span>
      <span class="chip">⏱ ${res.stats.ms} ملّي ثانية</span>
    </div>
    ${res.warnings.length ? `<div class="issues">${res.warnings.map((w) => `<div class="issue warning">⚠️ ${esc(w)}</div>`).join('')}</div>` : ''}
    ${res.unplaced.length ? `<h4>محاضرات لم يُعثر لها على مكان</h4><div class="table-wrap"><table class="mini-table">
      <thead><tr><th>المادة</th><th>النوع</th><th>الشعب</th><th>المدة</th><th>السبب المحتمل</th></tr></thead><tbody>
      ${res.unplaced.map((u) => `<tr><td>${esc(u.subjectName)}</td><td>${u.kind === 'practical' ? 'عملي' : 'نظري'}</td>
        <td>${esc(u.groupIds.map((g) => groupLabel(byId('groups', g), { withDept: res.deptId === ALL })).join(' + '))}</td><td>${u.duration / 60} س</td><td>${esc(u.reason)}</td></tr>`).join('')}
      </tbody></table></div><p class="muted">اقتراحات: أضف قاعة/مختبراً، وسّع أوقات توفر الأستاذ، أو قلل مدة الكتلة، ثم أعد التوليد. ويمكنك أيضاً إضافة هذه المحاضرات يدوياً.</p>` : ''}
    <h4>الساعات المجدولة لكل شعبة</h4>
    <div class="summary">${[...perGroup].map(([g, h]) => `<span class="chip">${esc(groupLabel(byId('groups', g), { withDept: res.deptId === ALL }))}: ${h} س</span>`).join('') || '<span class="muted">—</span>'}</div>
    <div class="toolbar"><button class="btn btn-primary" id="commit">💾 اعتماد وحفظ الجدول</button><button class="btn" id="discard">تجاهل</button></div>
  </div>`);
  box.appendChild(card);
  $('#discard', card).onclick = () => { lastResult = null; box.innerHTML = ''; };
  $('#commit', card).onclick = async () => {
    if (res.toRemove.length && !(await confirmDialog(`سيتم حذف ${res.toRemove.length} محاضرة سابقة (غير مثبتة) وحفظ ${res.sessions.length} محاضرة جديدة. متابعة؟`))) return;
    // التحقق من عدم تغيّر البيانات من مستخدم آخر أثناء المراجعة
    const stillThere = new Set(store.data.sessions.map((s) => s.id));
    const removeIds = new Set(res.toRemove.map((s) => s.id));
    const base = termSessions(res.term).filter((s) => !removeIds.has(s.id));
    const c = ctx();
    const staged = res.sessions.map((s, i) => ({ ...s, id: `__gen${i}`, term: res.term }));
    if (staged.some((s) => hasErrors(checkSession(s, [...base, ...staged], c)))) {
      toast('تغيّرت البيانات من مستخدم آخر أثناء المراجعة وظهرت تعارضات. أعد التوليد.', 'error', 6000);
      return;
    }
    const ops = [
      ...res.toRemove.filter((s) => stillThere.has(s.id)).map((s) => ({ op: 'delete', col: 'sessions', id: s.id })),
      ...res.sessions.map((s) => ({ op: 'set', col: 'sessions', id: uid(), data: { ...s, term: res.term } })),
    ];
    try {
      await batchWrite(ops);
      toast('تم حفظ الجدول. يمكنك الآن تعديله يدوياً من صفحة الجداول.', 'success', 5000);
      lastResult = null;
      location.hash = res.deptId === ALL ? `#/schedule?type=college&id=${res.collegeId}` : `#/schedule?type=dept&id=${res.deptId}`;
    } catch (e) { toast('تعذر الحفظ: ' + e.message, 'error'); }
  };
}

