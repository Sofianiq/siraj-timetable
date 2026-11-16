/**
 * واجهة استيراد جداول كليات الجامعة: معاينة ما سيُطابَق ويُنشأ قبل الحفظ، ثم الاستيراد دفعة واحدة.
 */
import { store, settings, batchWrite, uid, isAdmin, exportAll } from '../store.js';
import { esc, el, $, modal, toast, download } from '../ui.js';
import { SEMESTERS } from '../timeutil.js';
import { ltr } from '../model.js';
import { universityImportPlan, importSummary, DATA_VERSION, TERM, SKIPPED_ROOMS } from '../seed/university.js';

/** ملاحظات من الجداول الأصلية تحتاج قرار الكلية (تظهر في المعاينة والتقرير) */
const SOURCE_NOTES = [
  'طب الأسنان: الجداول تضع كل المحاضرات النظرية للمراحل الثلاث في «قاعة الفلوجة»، فتتعارض المرحلة الأولى مع الثانية والثالثة في القاعة (كما ورد في ملاحظة الكلية: الحاجة إلى قاعة للمرحلة الأولى سعة 40–50 طالباً). ستظهر هذه التعارضات في صفحة «التعارضات» لتُحل بتخصيص قاعة.',
  'الذكاء الاصطناعي: جدول المرحلة الثانية المسائي نسخة من الصباحي مزاحة 4 ساعات بالأساتذة والقاعات أنفسهم، فيتداخل الأساتذة بين الدراستين بعد الظهر.',
  'البناء والإنشاءات: «الجيولوجيا الهندسية» يوم الثلاثاء نظري في الجدول الصباحي و«مختبر» في المسائي؛ استُورد كما ورد في كل جدول.',
  'القاعات الجديدة أُضيفت بلا سعة لأن الملفات لا تذكرها؛ أدخل سعة كل قاعة من صفحة «القاعات والمختبرات» ليُفعَّل تنبيه تجاوز السعة.',
];

/** هل الاستيراد متاح ولم يُنفَّذ بعد بالإصدار الحالي من البيانات؟ */
export const universityImportPending = () => isAdmin() && (settings().universityImport?.version || 0) < DATA_VERSION;

export async function openUniversityImport() {
  const st = settings();
  const termNow = `${st.academicYear || ''}/${st.semester || 1}`;
  const termData = `${TERM.year}/${TERM.semester}`;
  let replace = false;
  let plan = universityImportPlan(store.data, uid, { replace });
  const sum = importSummary(plan.report);
  const r = plan.report;
  const statusChip = (s) => (s === 'created' ? '<span class="chip chip-warn">➕ ستُنشأ</span>' : '<span class="chip chip-ok">✓ موجودة في النظام</span>');
  const body = el(`<div class="uimp">
    <p>تُستورد جداول <b>${esc(SEMESTERS[TERM.semester])} ${ltr(TERM.year)}</b> كما وردت في الملفات الرسمية: المواد بساعاتها النظرية والعملية والإلكترونية، والكادر التدريسي لكل كلية دون تكرار، والقاعات والمختبرات بترميزها، ومحاضرات كل قسم ومرحلة (صباحي ومسائي ومجاميع العملي).</p>
    <div class="uimp-sum">
      ${sum.created ? `<div><b>سيُضاف:</b> ${esc(sum.created)}</div>` : ''}
      ${sum.updated ? `<div><b>سيُحدَّث:</b> ${esc(sum.updated)}</div>` : ''}
      ${!sum.created && !sum.updated ? '<div>✓ كل البيانات مستوردة ومحدّثة مسبقاً.</div>' : ''}
    </div>
    <h4>الكليات والأقسام</h4>
    <table class="data-table uimp-table"><tbody>
      ${r.colleges.map((c) => `<tr><td><b>🏛 ${esc(c.name)}</b>${c.rooms ? ' <small class="muted">(قاعاتها في الترميز)</small>' : ''}</td><td>${statusChip(c.status)}</td></tr>
        ${r.departments.filter((d) => d.college && d.path.startsWith(`${c.key}/`)).map((d) => `<tr class="sub"><td>— ${esc(d.name)}</td><td>${statusChip(d.status)}</td></tr>`).join('')}`).join('')}
    </tbody></table>
    ${r.warnings.map((w) => `<div class="banner warn">⚠️ ${esc(w)}</div>`).join('')}
    ${termNow !== termData ? `<label class="chk uimp-opt"><input type="checkbox" id="setTerm" checked> اجعل الفصل الحالي في الإعدادات <b>${esc(SEMESTERS[TERM.semester])} ${ltr(TERM.year)}</b> (الحالي: ${esc(SEMESTERS[st.semester] || '')} ${ltr(st.academicYear || '')}) حتى تظهر الجداول المستوردة</label>` : ''}
    ${r.existingOther ? `<label class="chk uimp-opt"><input type="checkbox" id="replace" checked> توجد <b>${r.existingOther}</b> محاضرة مسجّلة مسبقاً لشعب هذه الجداول في الفصل نفسه — تُحذف وتُعتمد الجداول الرسمية المستوردة، حتى لا تتكرر المحاضرات. ألغِ التحديد للإبقاء عليها.</label>` : ''}
    <label class="chk uimp-opt"><input type="checkbox" id="backupFirst" checked> تنزيل نسخة احتياطية من البيانات الحالية قبل الاستيراد (للرجوع إليها من «الإعدادات ← استعادة من نسخة»)</label>
    ${r.similarTeachers.length ? `<details class="uimp-det"><summary>👨‍🏫 ${r.similarTeachers.length} اسم أستاذ يطابق اسماً في كادر كلية أخرى (لم يُدمج تلقائياً)</summary>
      <ul>${r.similarTeachers.map((t) => `<li>«${esc(t.name)}» في ${esc(t.college)} — يشبه: ${t.other.map(esc).join('، ')}</li>`).join('')}</ul>
      <p class="muted">إن كان الاسمان لشخص واحد فادمجهما من صفحة «الأساتذة» (زر «دمج») ليكشف النظام تعارض أوقاته بين الكليتين، وإلا اضغط «أشخاص مختلفون».</p></details>` : ''}
    <details class="uimp-det"><summary>🚪 ${SKIPPED_ROOMS.length} غرفة في ملف الترميز ليست قاعات دراسية فلم تُضف</summary>
      <p class="muted">${SKIPPED_ROOMS.map(([c, l]) => `${esc(c)} (${esc(l)})`).join('، ')}</p></details>
    <details class="uimp-det" open><summary>📝 ملاحظات من الجداول الأصلية</summary><ul>${SOURCE_NOTES.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></details>
  </div>`);
  const ok = await modal({ title: '🏛 استيراد جداول كليات الجامعة', body, size: 'lg',
    buttons: [{ label: 'استيراد', value: true, cls: 'btn-primary' }, { label: 'إلغاء', value: false }] });
  if (!ok) return false;
  replace = !!$('#replace', body)?.checked;
  if (replace) plan = universityImportPlan(store.data, uid, { replace });
  if ($('#backupFirst', body)?.checked) {
    download(`نسخة_قبل_استيراد_الجداول_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(exportAll(), null, 1), 'application/json');
  }
  const ops = [...plan.ops];
  const patch = { universityImport: { version: DATA_VERSION, at: Date.now(), created: plan.report.created } };
  if ($('#setTerm', body)?.checked) Object.assign(patch, { academicYear: TERM.year, semester: TERM.semester });
  ops.push({ op: 'update', col: 'settings', id: 'app', data: patch });
  try {
    toast('جارٍ الاستيراد…', 'info', 3000);
    await batchWrite(ops);
    const s2 = importSummary(plan.report);
    toast(`تم الاستيراد بنجاح. ${s2.created ? `أُضيف: ${s2.created}.` : ''} ${s2.updated ? `حُدِّث: ${s2.updated}.` : ''}${plan.report.replaced ? ` حُذفت ${plan.report.replaced} محاضرة سابقة.` : ''} راجع صفحة «التعارضات».`, 'success', 12000);
    return true;
  } catch (e) {
    console.error(e);
    toast('تعذر الاستيراد: ' + (e.message || e), 'error', 10000);
    return false;
  }
}
