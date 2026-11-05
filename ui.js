import { esc, num } from './util.js';
const root = () => document.getElementById('sheetRoot');
export function toast(msg, ms = 2800) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms); }
export function closeSheet() { const r = root(); r.classList.remove('open'); setTimeout(() => { if (!r.classList.contains('open')) r.innerHTML = ''; }, 220); }
export function openSheet(html, mount) {
  const r = root();
  r.innerHTML = `<div class="scrim" data-close></div><div class="sheet" role="dialog" aria-modal="true"><i class="grab"></i>${html}</div>`;
  requestAnimationFrame(() => r.classList.add('open'));
  r.querySelector('[data-close]').onclick = closeSheet;
  if (mount) mount(r.querySelector('.sheet'));
}
const opt = (o, val) => { const v = o && o.v !== undefined ? o.v : o, l = o && o.l !== undefined ? o.l : o; return `<option value="${esc(v)}"${String(v) === String(val) ? ' selected' : ''}>${esc(l)}</option>`; };
function fieldHtml(f, v) {
  const val = v[f.k] ?? ''; const id = 'f_' + f.k; const lab = f.label ? `<label for="${id}">${esc(f.label)}</label>` : '';
  if (f.type === 'seg') return `<div class="seg" data-seg="${f.k}">${f.options.map(o => `<button type="button" data-v="${esc(o.v)}" class="${o.v === val ? 'on' : ''}">${esc(o.l)}</button>`).join('')}</div>`;
  if (f.type === 'select') return `${lab}<select id="${id}">${f.options.map(o => opt(o, val)).join('')}</select>`;
  if (f.type === 'textarea') return `${lab}<textarea id="${id}" rows="${f.rows || 4}" placeholder="${esc(f.ph || '')}">${esc(val)}</textarea>${f.hint ? `<p class="hint">${esc(f.hint)}</p>` : ''}`;
  if (f.type === 'date') return `${lab}<input id="${id}" type="date" value="${esc(val)}">`;
  const mode = f.type === 'money' ? 'decimal' : f.type === 'tel' ? 'tel' : 'text';
  return `${lab}<input id="${id}" type="${f.type === 'password' ? 'password' : 'text'}" inputmode="${mode}" autocomplete="${f.type === 'password' ? 'new-password' : 'off'}" autocapitalize="off" placeholder="${esc(f.ph || '')}" value="${esc(val)}">${f.hint ? `<p class="hint">${esc(f.hint)}</p>` : ''}`;
}
// fields: (vals)=>[{k,label,type,options,req,ph,hint}]
export function formSheet({ title, fields, values = {}, onSave, onDelete, saveLabel = 'সংরক্ষণ করুন', zeroOk = false }) {
  let cur = { ...values };
  const collect = (sh, fs) => { const o = { ...cur }; fs.forEach(f => { if (f.type === 'seg') return; const el = sh.querySelector('#f_' + f.k); if (el) o[f.k] = el.value; }); return o; };
  const draw = sh => {
    const fs = fields(cur);
    sh.innerHTML = `<i class="grab"></i><h3>${esc(title)}</h3><form novalidate>${fs.map(f => fieldHtml(f, cur)).join('')}<p class="err" role="alert"></p><button class="btn pri" type="submit">${esc(saveLabel)}</button>${onDelete ? '<button class="btn ghost danger" type="button" data-del>মুছে ফেলুন</button>' : ''}<button class="btn ghost" type="button" data-close2>বাতিল</button></form>`;
    sh.querySelectorAll('[data-seg]').forEach(g => g.onclick = e => { const b = e.target.closest('button'); if (!b) return; cur = collect(sh, fs); cur[g.dataset.seg] = b.dataset.v; draw(sh); });
    sh.querySelector('[data-close2]').onclick = closeSheet;
    if (onDelete) sh.querySelector('[data-del]').onclick = async () => { if (await confirmSheet('এই এন্ট্রি মুছে ফেলবেন? এটি ফেরানো যাবে না।', 'মুছে ফেলুন', true)) { try { await onDelete(); closeSheet(); } catch (e) { toast(e.message); } } };
    sh.querySelector('form').onsubmit = async ev => {
      ev.preventDefault(); const err = sh.querySelector('.err'); const o = collect(sh, fs); err.textContent = '';
      for (const f of fs) {
        if (f.type === 'seg') continue;
        const raw = String(o[f.k] ?? '').trim();
        if (f.type === 'money') { const n = num(raw); if (raw === '' ? f.req : isNaN(n)) { err.textContent = `${f.label} সঠিকভাবে লিখুন`; return; } if (!isNaN(n) && (n < 0 || (n === 0 && !zeroOk && f.req))) { err.textContent = `${f.label} শূন্যের বেশি হতে হবে`; return; } o[f.k] = isNaN(n) ? 0 : n; }
        else { o[f.k] = raw; if (f.req && !raw) { err.textContent = `${f.label} দিন`; return; } }
      }
      const b = sh.querySelector('.btn.pri'); b.disabled = true; b.textContent = 'সংরক্ষণ হচ্ছে…';
      try { await onSave(o); closeSheet(); } catch (e) { err.textContent = e.message || 'সংরক্ষণ হয়নি'; b.disabled = false; b.textContent = saveLabel; }
    };
    const first = sh.querySelector('input:not([type=date]),textarea'); if (first && !cur._noFocus && !values.id) first.focus({ preventScroll: true });
  };
  openSheet('', sh => draw(sh));
}
export function confirmSheet(msg, ok = 'হ্যাঁ', danger = false) {
  return new Promise(res => {
    openSheet(`<h3>নিশ্চিত করুন</h3><p class="msg">${esc(msg)}</p><button class="btn ${danger ? 'danger-fill' : 'pri'}" data-ok>${esc(ok)}</button><button class="btn ghost" data-no>বাতিল</button>`, sh => {
      sh.querySelector('[data-ok]').onclick = () => { res(true); closeSheet(); };
      sh.querySelector('[data-no]').onclick = () => { res(false); closeSheet(); };
      document.getElementById('sheetRoot').querySelector('[data-close]').onclick = () => { res(false); closeSheet(); };
    });
  });
}
export function menuSheet(title, items) {
  openSheet(`<h3>${esc(title)}</h3>${items.map((it, i) => `<button class="btn ghost menu" data-i="${i}">${esc(it.l)}</button>`).join('')}`, sh => sh.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { closeSheet(); items[b.dataset.i].f(); }));
}
