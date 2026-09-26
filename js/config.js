/**
 * ملف الإعدادات — هذا هو الملف الوحيد الذي تحتاج لتعديله عند النشر.
 *
 * 1) الصق هنا بيانات ربط مشروع Firebase (من: Firebase Console → Project settings → Your apps → SDK setup).
 *    إذا تُرك apiKey فارغاً يعمل النظام في «الوضع التجريبي المحلي» (البيانات على هذا الجهاز فقط).
 *
 * 2) اكتب البريد الإلكتروني لمعاون العميد (المشرف العام). يجب أن يكون نفس البريد المكتوب في ملف firestore.rules.
 *
 * ملاحظة: بيانات firebaseConfig ليست سرية، وحماية البيانات تتم عبر قواعد الأمان (firestore.rules).
 */
export const firebaseConfig = {
  apiKey: "AIzaSyCnVD7D3JwfEil9RvNI2FLrCVkmjxZrtE4",
  authDomain: "siraj-timetable.firebaseapp.com",
  projectId: "siraj-timetable",
  storageBucket: "siraj-timetable.firebasestorage.app",
  messagingSenderId: "342414829881",
  appId: "1:342414829881:web:16f7a45029761015e660e8"
};

export const SUPER_ADMIN_EMAILS = [
  'sofian.7.4.96@gmail.com',
];

export const APP_TITLE = 'نظام إدارة الجداول الدراسية – جامعة السراج - كلية التقنيات الصحية والطبية';
export const UNIVERSITY = 'جامعة السراج';
export const COLLEGE = 'كلية التقنيات الصحية والطبية';
export const DEVELOPER = 'سفيان محمد';
