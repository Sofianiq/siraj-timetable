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
  'الدوام الرسمي الموحّد 8:30 – 3:00: المحاضرات التي تتجاوزه في الجداول الأصلية (الصيدلة حتى 3:30، وطب الأسنان حتى 4:30، والمرحلة الثانية الصباحية للذكاء الاصطناعي حتى 3:30) تُستورد كما هي ويظهر لها تنبيه «خارج وقت الدوام» لإعادة جدولتها.',
  'لكل كلية قاعاتها حسب الترميز المحدَّث: القاعات المرمّزة تُسجَّل باسم كليتها المالكة، والتوليد التلقائي يستخدم قاعات الكلية والمشتركة فقط، ويظهر تنبيه عند حجز قاعة كلية أخرى.',
  'توزيع القاعات حسب «جدول توزيع القاعات الدراسية»: SE003 وSE204 وSE216 صارت قاعات دراسية للإدارة والاقتصاد والهندسية والقانون. الإدارة والاقتصاد: لكل شعبة من المرحلتين الثانية والثالثة قاعة ثابتة من قاعات الكلية السبع، وشعب المرحلة الأولى تأخذ القاعة الشاغرة وقت المحاضرة؛ 23 محاضرة للمرحلة الأولى بقيت بلا قاعة لأن قاعات الكلية السبع كلها مشغولة في وقتها (الكلية تحتاج 11 قاعة صباح الاثنين).',
  'قسم القانون (المرحلة الأولى): حصص 45 دقيقة كما في الجدول الأصلي، في القاعة SE217 لأن الجدول ترك «مكان القاعة التدريسية» فارغاً.',
  'قسم الأدلة الجنائية (المرحلة الثانية): المحاضرات النظرية في SE107 (قاعة الأدلة الجنائية)، ومنها محاضرة الثلاثاء المكتوب لها «قاعة صناعة الأسنان» لأنها ليست من قاعات الكلية؛ والعملي في مختبرات الكلية الثلاثة.',
  'تعارض أساتذة في الجداول الأصلية نفسها: م.د. باسم ناصر يوم الاثنين («الإحصاء» في الأدلة الجنائية 12:30–2:30 مع الإحصاء في الإدارة والاقتصاد وBiostatistics في الصيدلة 11:30–1:30)، وم.د عمر فلاح ابراهيم يوم الثلاثاء (الأدلة الجنائية 8:30–12:30 مع Analytical chemistry في الصيدلة 8:30–11:30). يظهر في صفحة «التعارضات» ليُعدَّل أحد الجدولين.',
  'البناء والإنشاءات – المرحلة الأولى: جدول جديد لمجموعتين A وB فقط (أُلغي الجدول القديم والدراسة المسائية). شبكة وقت واحدة من 8:30 إلى 3:00 باستراحة 12:30–1:00، والأساتذة مشتركون: في كل حصة تأخذ المجموعتان مادتين بأستاذين مختلفين ثم تتبادلانهما، فلا يتضارب أستاذ. المجموعة A في القاعة SE202 والمجموعة B في SE203، والرسم الهندسي في مختبره، وعملي المساحة والجيولوجيا في قاعة المجموعة.',
  'هندسة تقنيات النفط والغاز: المرحلة الأولى في القاعة SE213 والثانية في SE214، والحاسوب في مختبر البرمجة، والاثنين عطلة كما في جدول القسم. صُحِّح تضارب في الأصل: م.م ياسين محمود يوم الثلاثاء 12:30–2:30 في المرحلتين، فبُدّلت حصتا المرحلة الثانية في ذلك اليوم (Fluid Mechanic I 10:30–12:30 وEnglish Language 12:30–2:30). «م.م عبدالله» مدرّس جرائم البعث هو م.م. عبدالله عبدالرحمن الذي يدرّسها في أقسام الكلية الأخرى.',
  'القاعات الجديدة أُضيفت بلا سعة لأن الملفات لا تذكرها؛ أدخل سعة كل قاعة من صفحة «القاعات والمختبرات» ليُفعَّل تنبيه تجاوز السعة.',
];

/** هل الاستيراد متاح ولم يُنفَّذ بعد بالإصدار الحالي من البيانات؟ */
export const universityImportPending = () => isAdmin() && (settings().universityImport?.version || 0) < DATA_VERSION;
/** استُوردت الجداول سابقاً بإصدار أقدم من البيانات (التحديث الحالي: جدول النفط والغاز، ومجموعتا البناء والإنشاءات حتى 3:00) */
export const universityImportIsUpdate = () => (settings().universityImport?.version || 0) > 0;

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
    ${r.removed.length ? `<div class="banner info">🔁 جدول جديد يحل محل القديم: تُحذف ${r.removed.length} محاضرة من الجدول القديم (${[...new Set(r.removed)].map(esc).join('، ')})${r.renamedGroups.length ? `، وتصبح الشعبة ${r.renamedGroups.map((x) => `«${esc(x.from)}» «${esc(x.to)}»`).join(' و')}` : ''}.</div>` : ''}
    ${r.removedGroups.length ? `<div class="banner info">🗑 تُحذف الشعبة الملغاة: ${r.removedGroups.map(esc).join('، ')}.</div>` : ''}
    ${r.keptEdited.length ? `<div class="banner warn">✋ ${r.keptEdited.length} محاضرة من الجدول القديم عدّلتها يدوياً فلن تُحذف (${[...new Set(r.keptEdited)].map(esc).join('، ')}) — احذفها بنفسك إن لم تعد لازمة.</div>` : ''}
    ${r.existingOther ? `<label class="chk uimp-opt"><input type="checkbox" id="replace" ${universityImportIsUpdate() ? '' : 'checked'}> توجد <b>${r.existingOther}</b> محاضرة مسجّلة مسبقاً لشعب هذه الجداول في الفصل نفسه — تُحذف وتُعتمد الجداول الرسمية المستوردة، حتى لا تتكرر المحاضرات. ${universityImportIsUpdate() ? 'غير محدَّد في التحديث حتى تبقى المحاضرات التي أضفتها بنفسك.' : 'ألغِ التحديد للإبقاء عليها.'}</label>` : ''}
    <label class="chk uimp-opt"><input type="checkbox" id="backupFirst" checked> تنزيل نسخة احتياطية من البيانات الحالية قبل الاستيراد (للرجوع إليها من «الإعدادات ← استعادة من نسخة»)</label>
    ${r.similarTeachers.length ? `<details class="uimp-det"><summary>👨‍🏫 ${r.similarTeachers.length} اسم أستاذ يطابق اسماً في كادر كلية أخرى (لم يُدمج تلقائياً)</summary>
      <ul>${r.similarTeachers.map((t) => `<li>«${esc(t.name)}» في ${esc(t.college)} — يشبه: ${t.other.map(esc).join('، ')}</li>`).join('')}</ul>
      <p class="muted">إن كان الاسمان لشخص واحد فادمجهما من صفحة «الأساتذة» (زر «دمج») ليكشف النظام تعارض أوقاته بين الكليتين، وإلا اضغط «أشخاص مختلفون».</p></details>` : ''}
    ${r.retiredRooms.length ? `<div class="banner warn">🚪 الترميز المحدَّث حوّل ${r.retiredRooms.length === 1 ? 'رمزاً' : `${r.retiredRooms.length} رموز`} إلى مكاتب: ${r.retiredRooms.map((x) => `<b>${esc(x.code)}</b> (${esc(x.label)}) — ${x.action === 'deleted' ? 'تُحذف من القاعات' : 'تُعطَّل لأنها مستخدمة في محاضرات'}`).join('، ')}</div>` : ''}
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
    toast(`تم الاستيراد بنجاح. ${s2.created ? `أُضيف: ${s2.created}.` : ''} ${s2.updated ? `حُدِّث: ${s2.updated}.` : ''}${plan.report.replaced + plan.report.removed.length ? ` حُذفت ${plan.report.replaced + plan.report.removed.length} محاضرة سابقة.` : ''} راجع صفحة «التعارضات».`, 'success', 12000);
    return true;
  } catch (e) {
    console.error(e);
    toast('تعذر الاستيراد: ' + (e.message || e), 'error', 10000);
    return false;
  }
}
