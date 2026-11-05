const BN = '০১২৩৪৫৬৭৮৯';
export const toBn = s => String(s).replace(/\d/g, d => BN[d]);
export const fromBn = s => String(s ?? '').replace(/[০-৯]/g, d => BN.indexOf(d)).replace(/[,،\s৳]/g, '');
export const num = v => { const n = parseFloat(fromBn(v)); return isFinite(n) ? n : NaN; };
const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
export const fmt = n => toBn(nf.format(Math.round((+n || 0) * 100) / 100));
export const tk = n => (n < 0 ? '−' : '') + '৳' + fmt(Math.abs(n));
export const MONTHS = ['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'];
export const monthLabel = m => { const [y, mo] = m.split('-'); return MONTHS[+mo - 1] + ' ' + toBn(y); };
export const pad = n => String(n).padStart(2, '0');
export const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const shiftMonth = (m, d) => { let [y, mo] = m.split('-').map(Number); mo += d; while (mo > 12) { mo -= 12; y++; } while (mo < 1) { mo += 12; y--; } return `${y}-${pad(mo)}`; };
export const dayLabel = (t) => t.dateUnknown ? 'তারিখ নেই' : toBn(+t.date.slice(8)) + ' ' + MONTHS[+t.date.slice(5, 7) - 1];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
// আট কোণা তারা (ইসলামি জ্যামিতির মোটিফ)
export function starPoints(cx, cy, R, r, n = 8) {
  const p = []; for (let i = 0; i < n * 2; i++) { const a = Math.PI * i / n - Math.PI / 2, rr = i % 2 ? r : R; p.push((cx + rr * Math.cos(a)).toFixed(2) + ',' + (cy + rr * Math.sin(a)).toFixed(2)); } return p.join(' ');
}
export const starSvg = (size, fill = 'currentColor') => `<svg width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true"><polygon points="${starPoints(50, 50, 48, 31)}" fill="${fill}"/></svg>`;
export function download(name, text, mime) {
  try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); return true; } catch (e) { return false; }
}
