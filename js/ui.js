/**
 * أدوات الواجهة المشتركة: النوافذ المنبثقة، الإشعارات، النماذج.
 */

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/* ------------------------------ الإشعارات ------------------------------ */
export function toast(msg, type = 'info', ms = 3500) {
  let box = $('#toasts');
  if (!box) { box = el('<div id="toasts" aria-live="polite"></div>'); document.body.appendChild(box); }
  const t = el(`<div class="toast toast-${type}">${esc(msg)}</div>`);
  box.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

/* ------------------------------ النوافذ ------------------------------ */
/**
 * @param {Object} o
 * @param {string} o.title
 * @param {string|HTMLElement} o.body
 * @param {{label:string, value:any, cls?:string}[]} [o.buttons]
 * @param {(value:any, root:HTMLElement)=>boolean|Promise<boolean>} [o.onButton] يعيد false لإبقاء النافذة مفتوحة
 * @param {string} [o.size] 'lg' | 'sm'
 */
export function modal({ title, body, buttons = [{ label: 'إغلاق', value: null }], onButton, size = '' }) {
  return new Promise((resolve) => {
    const root = el(`
      <div class="modal-backdrop" role="dialog" aria-modal="true">
        <div class="modal ${size}">
          <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="إغلاق">✕</button></div>
          <div class="modal-body"></div>
          <div class="modal-foot"></div>
        </div>
      </div>`);
    const bodyBox = $('.modal-body', root);
    if (typeof body === 'string') bodyBox.innerHTML = body; else bodyBox.appendChild(body);
    const foot = $('.modal-foot', root);
    const close = (v) => { root.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    for (const b of buttons) {
      const btn = el(`<button class="btn ${b.cls || ''}">${esc(b.label)}</button>`);
      btn.onclick = async () => {
        if (onButton) {
          btn.disabled = true;
          try {
            const ok = await onButton(b.value, root);
            if (ok === false) { btn.disabled = false; return; }
          } catch (e) { btn.disabled = false; toast(e.message || String(e), 'error'); return; }
        }
        close(b.value);
      };
      foot.appendChild(btn);
    }
    $('[data-close]', root).onclick = () => close(null);
    root.addEventListener('mousedown', (e) => { if (e.target === root) close(null); });
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(root);
    const first = $('input,select,textarea', bodyBox);
    if (first) setTimeout(() => first.focus(), 30);
  });
}

export async function confirmDialog(message, { okLabel = 'تأكيد', danger = false } = {}) {
  const v = await modal({
    title: 'تأكيد', body: `<p>${esc(message)}</p>`, size: 'sm',
    buttons: [{ label: okLabel, value: true, cls: danger ? 'btn-danger' : 'btn-primary' }, { label: 'إلغاء', value: false }],
  });
  return v === true;
}

/* ------------------------------ النماذج ------------------------------ */
/**
 * بناء نموذج من وصف للحقول.
 * field: {key,label,type:'text'|'number'|'select'|'multiselect'|'textarea'|'checkbox'|'time'|'color', options:[{value,label}], required, min, max, step, help, full}
 */
export function buildForm(fields, values = {}) {
  const form = el('<form class="form-grid" novalidate></form>');
  for (const f of fields) {
    const v = values[f.key] ?? f.default ?? '';
    const id = `f_${f.key}_${Math.random().toString(36).slice(2, 6)}`;
    let input;
    if (f.type === 'select') {
      input = `<select id="${id}" name="${f.key}" ${f.required ? 'required' : ''}>
        ${f.placeholder !== false ? `<option value="">${esc(f.placeholder || '— اختر —')}</option>` : ''}
        ${(f.options || []).map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
      </select>`;
    } else if (f.type === 'multiselect') {
      const set = new Set(Array.isArray(v) ? v : []);
      input = `<div class="checklist" id="${id}" data-multi="${f.key}">
        ${(f.options || []).map((o) => `<label class="chk"><input type="checkbox" value="${esc(o.value)}" ${set.has(o.value) ? 'checked' : ''}> ${esc(o.label)}</label>`).join('') || '<span class="muted">لا توجد خيارات</span>'}
      </div>`;
    } else if (f.type === 'textarea') {
      input = `<textarea id="${id}" name="${f.key}" rows="3">${esc(v)}</textarea>`;
    } else if (f.type === 'checkbox') {
      input = `<label class="chk"><input id="${id}" type="checkbox" name="${f.key}" ${v ? 'checked' : ''}> ${esc(f.checkLabel || '')}</label>`;
    } else {
      input = `<input id="${id}" name="${f.key}" type="${f.type || 'text'}" value="${esc(v)}"
        ${f.required ? 'required' : ''} ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''}
        ${f.step != null ? `step="${f.step}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}>`;
    }
    form.appendChild(el(`<div class="field ${f.full ? 'full' : ''}">
      <label for="${id}">${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ''}</label>
      ${input}
      ${f.help ? `<small class="muted">${esc(f.help)}</small>` : ''}
    </div>`));
  }
  form.addEventListener('submit', (e) => e.preventDefault());
  return form;
}

/** قراءة قيم النموذج مع التحقق من الحقول الإلزامية */
export function readForm(form, fields) {
  const out = {};
  for (const f of fields) {
    if (f.type === 'multiselect') {
      out[f.key] = $$(`[data-multi="${f.key}"] input:checked`, form).map((i) => i.value);
      continue;
    }
    const inp = form.elements[f.key];
    if (!inp) continue;
    if (f.type === 'checkbox') { out[f.key] = inp.checked; continue; }
    let v = inp.value.trim();
    if (f.required && v === '') {
      inp.focus();
      throw new Error(`الحقل «${f.label}» مطلوب`);
    }
    if (f.type === 'number') v = v === '' ? null : Number(v);
    out[f.key] = v === '' ? null : v;
  }
  return out;
}

/** تنزيل ملف */
export function download(filename, content, type = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** تحميل سكربت خارجي عند الحاجة فقط (لتسريع فتح النظام) */
const loaded = new Map();
export function loadScript(src) {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('تعذر تحميل مكتبة خارجية، تحقق من الاتصال بالإنترنت'));
      document.head.appendChild(s);
    }));
  }
  return loaded.get(src);
}

/** لون ثابت لكل مادة (لتمييز المواد في الجدول) */
export function colorFor(key) {
  let h = 0;
  for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 70% 88%)`;
}
export function colorBorderFor(key) {
  let h = 0;
  for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 55% 42%)`;
}
