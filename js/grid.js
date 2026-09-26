/**
 * رسم الجدول الأسبوعي (الأيام صفوف، والوقت محور أفقي من اليمين إلى اليسار)
 * مع دعم السحب والإفلات لتغيير اليوم والوقت، وسحب الحافة لتغيير مدة المحاضرة.
 * يعمل بالفأرة واللمس (Pointer Events).
 */
import { DAY_NAMES, formatTime, formatRange, assignLanes, snap } from './timeutil.js';
import { esc, el, colorFor, colorBorderFor } from './ui.js';
import { sessionLines } from './model.js';

const LANE_H = 66;

/**
 * @param {Object} o
 * @param {Object[]} o.sessions
 * @param {string} o.viewType
 * @param {number[]} o.days
 * @param {number} o.dayStart
 * @param {number} o.dayEnd
 * @param {number} [o.step]
 * @param {Map<string,Object[]>} [o.conflicts]
 * @param {(s:Object)=>boolean} [o.canDrag]
 * @param {(s:Object)=>void} [o.onOpen]
 * @param {(s:Object, pos:{day:number,start:number,end:number})=>void} [o.onMove]
 * @param {(s:Object, pos:{day:number,start:number,end:number})=>Object[]} [o.validate]
 * @param {(pos:{day:number,start:number})=>void} [o.onCreate]
 */
export function renderGrid(o) {
  const span = o.dayEnd - o.dayStart;
  const step = o.step || 30;
  const pct = (m) => ((m - o.dayStart) / span) * 100;

  const root = el('<div class="tt" dir="rtl"></div>');
  // ترويسة الساعات
  const head = el('<div class="tt-row tt-head"><div class="tt-day"></div><div class="tt-track tt-hours"></div></div>');
  const hours = head.querySelector('.tt-hours');
  for (let m = Math.ceil(o.dayStart / 60) * 60; m < o.dayEnd; m += 60) {
    hours.appendChild(el(`<div class="tt-hour" style="right:${pct(m)}%">${formatTime(m).replace(' ', '&nbsp;')}</div>`));
  }
  root.appendChild(head);

  for (const day of o.days) {
    const items = o.sessions.filter((s) => s.day === day);
    const { lanes, count } = assignLanes(items);
    const row = el(`<div class="tt-row" data-day="${day}">
      <div class="tt-day">${DAY_NAMES[day]}</div>
      <div class="tt-track" data-day="${day}" style="height:${count * LANE_H + 6}px"></div>
    </div>`);
    const track = row.querySelector('.tt-track');
    for (let m = Math.ceil(o.dayStart / 60) * 60; m < o.dayEnd; m += 60) {
      track.appendChild(el(`<div class="tt-line" style="right:${pct(m)}%"></div>`));
    }
    for (const s of items) track.appendChild(block(s, lanes.get(s.id)));
    if (o.onCreate) {
      track.addEventListener('dblclick', (e) => {
        if (e.target !== track && !e.target.classList.contains('tt-line')) return;
        const r = track.getBoundingClientRect();
        const start = snap(o.dayStart + ((r.right - e.clientX) / r.width) * span, step);
        o.onCreate({ day, start: Math.max(o.dayStart, Math.min(start, o.dayEnd - step)) });
      });
    }
    root.appendChild(row);
  }

  function block(s, lane) {
    const issues = o.conflicts?.get(s.id) || [];
    const err = issues.some((i) => i.level === 'error');
    const warn = !err && issues.length > 0;
    const key = s.subjectId || s.title || s.id;
    const lines = sessionLines(s, o.viewType);
    const b = el(`<div class="tt-block ${s.kind} ${err ? 'has-error' : ''} ${warn ? 'has-warning' : ''} ${s.locked ? 'locked' : ''}"
      tabindex="0" data-id="${esc(s.id)}"
      style="right:${pct(s.start)}%;width:${pct(s.end) - pct(s.start)}%;top:${lane * LANE_H + 3}px;height:${LANE_H - 4}px;
             background:${colorFor(key)};border-color:${colorBorderFor(key)}"
      title="${esc([...lines, formatRange(s.start, s.end), ...issues.map((i) => '⚠ ' + i.message)].join('\n'))}">
      <div class="tt-b-time">${formatRange(s.start, s.end)}${s.locked ? ' 🔒' : ''}${err ? ' ⛔' : warn ? ' ⚠️' : ''}</div>
      <div class="tt-b-title">${esc(lines[0])}</div>
      ${lines.slice(1).map((l) => `<div class="tt-b-sub">${esc(l)}</div>`).join('')}
      ${o.onMove && (!o.canDrag || o.canDrag(s)) ? '<div class="tt-resize" title="اسحب لتغيير المدة"></div>' : ''}
    </div>`);
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter') o.onOpen?.(s); });
    attachDrag(b, s);
    return b;
  }

  function attachDrag(b, s) {
    const draggable = o.onMove && (!o.canDrag || o.canDrag(s));
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const resizing = e.target.classList.contains('tt-resize');
      const startX = e.clientX, startY = e.clientY;
      const trackEl = b.parentElement;
      const tr = trackEl.getBoundingClientRect();
      const grabMin = ((tr.right - e.clientX) / tr.width) * span - (s.start - o.dayStart);
      let moved = false, ghost = null, pos = null;

      const onMove = (ev) => {
        if (!draggable) return;
        if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        if (!moved) {
          moved = true;
          b.classList.add('dragging');
          ghost = el('<div class="tt-ghost"><span></span></div>');
        }
        ev.preventDefault();
        let target = trackEl;
        let day = s.day;
        if (!resizing) {
          const under = document.elementsFromPoint(ev.clientX, ev.clientY).find((x) => x.classList?.contains('tt-track') && x.dataset.day);
          if (under && root.contains(under)) { target = under; day = Number(under.dataset.day); }
        }
        const r = target.getBoundingClientRect();
        const atMin = o.dayStart + ((r.right - ev.clientX) / r.width) * span;
        let start = s.start, end = s.end;
        if (resizing) {
          end = Math.max(s.start + step, Math.min(o.dayEnd, snap(atMin, step)));
        } else {
          const dur = s.end - s.start;
          start = Math.max(o.dayStart, Math.min(o.dayEnd - dur, snap(atMin - grabMin, step)));
          end = start + dur;
        }
        pos = { day, start, end };
        const issues = o.validate ? o.validate(s, pos) : [];
        const bad = issues.some((i) => i.level === 'error');
        ghost.className = `tt-ghost ${bad ? 'bad' : issues.length ? 'warn' : 'ok'}`;
        ghost.style.cssText = `right:${pct(start)}%;width:${pct(end) - pct(start)}%;top:2px;bottom:2px`;
        ghost.firstChild.textContent = `${DAY_NAMES[day]} ${formatRange(start, end)}${bad ? ' — تعارض' : ''}`;
        if (ghost.parentElement !== target) target.appendChild(ghost);
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        b.classList.remove('dragging');
        ghost?.remove();
        if (!moved) { o.onOpen?.(s); return; }
        if (pos && (pos.day !== s.day || pos.start !== s.start || pos.end !== s.end)) o.onMove(s, pos);
      };
      document.addEventListener('pointermove', onMove, { passive: false });
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    });
  }
  return root;
}

/** عرض القائمة (مناسب للهاتف): المحاضرات مرتبة حسب اليوم والوقت */
export function renderList({ sessions, viewType, days, conflicts, onOpen }) {
  const root = el('<div class="tt-list"></div>');
  for (const day of days) {
    const items = sessions.filter((s) => s.day === day).sort((a, b) => a.start - b.start);
    const sec = el(`<section class="tt-list-day"><h4>${DAY_NAMES[day]}</h4></section>`);
    if (!items.length) sec.appendChild(el('<p class="muted">لا توجد محاضرات</p>'));
    for (const s of items) {
      const issues = conflicts?.get(s.id) || [];
      const lines = sessionLines(s, viewType);
      const key = s.subjectId || s.title || s.id;
      const it = el(`<button class="tt-list-item ${issues.some((i) => i.level === 'error') ? 'has-error' : issues.length ? 'has-warning' : ''}"
          style="border-inline-start-color:${colorBorderFor(key)}">
        <span class="t">${formatRange(s.start, s.end)}</span>
        <span class="n">${esc(lines[0])}</span>
        <span class="d">${esc(lines.slice(1).join(' • '))}</span>
      </button>`);
      it.onclick = () => onOpen?.(s);
      sec.appendChild(it);
    }
    root.appendChild(sec);
  }
  return root;
}
