import { loadData, cloud, validId } from './data.js';
import { toBn, fmt, tk, monthLabel, shiftMonth, todayStr, dayLabel, esc, starSvg, starPoints, download, MONTHS } from './util.js';
import { toast, openSheet, closeSheet, formSheet, confirmSheet, menuSheet } from './ui.js';
import { SEED } from './seed.js';

let D;
const $app = document.getElementById('app');
const S = { me: null, target: null, month: todayStr().slice(0, 7), book: 'expense', q: '', fq: '', fperiod: 'all', pgroup: '', authMode: null, authErr: '', busy: false, av: { name: '', id: '' }, loaded: {}, appCfg: { signup: true } };
const DB = { tx: [], settings: null, funds: [], ftx: {}, fpeople: {}, users: [] };
const subs = { main: [], fund: {} };
const TYPE_L = { income: 'আয়', expense: 'ব্যয়', loan: 'ঋণ পরিশোধ', saving: 'সঞ্চয়' };
const isSuper = () => S.me && S.me.role === 'super';
const txPath = () => `users/${S.target}/tx`;
const settings = () => ({ start: 0, inc: SEED.personal.inc, exp: SEED.personal.exp, ...(DB.settings || {}) });

// ---------- সাবস্ক্রিপশন ----------
function unbind() { subs.main.forEach(u => u()); subs.main = []; Object.values(subs.fund).forEach(a => a.forEach(u => u())); subs.fund = {}; DB.tx = []; DB.settings = null; DB.funds = []; DB.ftx = {}; DB.fpeople = {}; DB.users = []; S.loaded = {}; }
function bind() {
  unbind(); if (!S.me) return;
  const me = S.me.uid;
  subs.main.push(D.watch(txPath(), l => { DB.tx = l.filter(t => t.date); S.loaded.tx = 1; paint(); }));
  subs.main.push(D.watch(`users/${S.target}/meta`, l => { DB.settings = l.find(x => x.id === 'settings') || null; paint(); }));
  subs.main.push(D.watch('funds', l => { DB.funds = l.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); S.loaded.funds = 1; syncFundSubs(); paint(); }, isSuper() ? {} : { where: ['memberIds', 'array-contains', me] }));
  if (isSuper()) subs.main.push(D.watch('users', l => { DB.users = l.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); paint(); }));
}
function syncFundSubs() {
  const ids = new Set(DB.funds.map(f => f.id));
  for (const id of Object.keys(subs.fund)) if (!ids.has(id)) { subs.fund[id].forEach(u => u()); delete subs.fund[id]; delete DB.ftx[id]; delete DB.fpeople[id]; }
  for (const id of ids) if (!subs.fund[id]) subs.fund[id] = [
    D.watch(`funds/${id}/tx`, l => { DB.ftx[id] = l; paint(); }),
    D.watch(`funds/${id}/people`, l => { DB.fpeople[id] = l; paint(); })];
}
let raf = 0; function paint() { if (!S.me || raf) return; raf = requestAnimationFrame(() => { raf = 0; render(); }); }

// ---------- হিসাবের গণনা ----------
const monthTx = m => DB.tx.filter(t => t.date.slice(0, 7) === m);
function sums(m) { const r = { income: 0, expense: 0, loan: 0, saving: 0 }; monthTx(m).forEach(t => { if (r[t.type] !== undefined) r[t.type] += +t.amt || 0; }); return r; }
function opening(m) { let o = +settings().start || 0; DB.tx.forEach(t => { if (t.date.slice(0, 7) < m) o += (t.type === 'income' ? 1 : -1) * (+t.amt || 0); }); return o; }
const closing = m => { const s = sums(m); return opening(m) + s.income - s.expense - s.loan - s.saving; };
function fundStats(f, period = 'all') {
  const tx = (DB.ftx[f.id] || []).filter(t => period === 'all' || (t.date || '').slice(0, 7) === period);
  const heads = [...(f.heads || [])]; const known = new Set(heads);
  tx.forEach(t => { const h = t.head || ''; if (!known.has(h) && (+t.amt || 0) > 0) { known.add(h); heads.push(h); } });
  const per = heads.map(h => { const i = tx.filter(t => t.type === 'in' && (t.head || '') === h).reduce((s, t) => s + (+t.amt || 0), 0), o = tx.filter(t => t.type === 'out' && (t.head || '') === h).reduce((s, t) => s + (+t.amt || 0), 0); return { h: h || 'অনির্দিষ্ট', i, o, b: i - o }; });
  const i = per.reduce((s, x) => s + x.i, 0), o = per.reduce((s, x) => s + x.o, 0);
  return { per, i, o, b: i - o, n: tx.filter(t => (+t.amt || 0) > 0).length, tx };
}
const fundBalance = f => fundStats(f).b;
const canEditFund = f => isSuper() || (f.members && f.members[S.me.uid] && f.members[S.me.uid].r === 'editor');
const canManageFund = f => isSuper() || f.createdBy === S.me.uid || canEditFund(f);

// ---------- রুট ----------
function route() { const h = (location.hash || '#/home').replace(/^#\/?/, '').split('/'); return { name: h[0] || 'home', a: h[1], b: h[2] }; }
const go = h => { if (location.hash === h) paint(); else location.hash = h; };
window.addEventListener('hashchange', () => { S.q = ''; S.fq = ''; scrollTo(0, 0); paint(); });

// ---------- রেন্ডার ----------
function render() {
  if (!S.me) return renderAuth();
  const sy = scrollY, r = route(); let body = '';
  try { body = r.name === 'book' ? viewBook(r) : r.name === 'funds' ? viewFunds() : r.name === 'fund' ? viewFund(r) : r.name === 'me' ? viewMe() : r.name === 'admin' && isSuper() ? viewAdmin() : viewHome(); }
  catch (e) { console.error(e); body = `<div class="empty"><b>কিছু একটা ভুল হয়েছে</b><p>${esc(e.message)}</p></div>`; }
  $app.innerHTML = shell(r, body);
  scrollTo(0, sy);
}
function shell(r, body) {
  const viewing = S.target !== S.me.uid; const tn = viewing ? (DB.users.find(u => u.id === S.target) || {}).name || 'অন্য ব্যবহারকারী' : '';
  const nav = (h, ic, l, on) => `<a class="tab${on ? ' on' : ''}" href="${h}" aria-label="${l}"><span class="ic">${ic}</span><span>${l}</span></a>`;
  const ic = { home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>', book: '<svg viewBox="0 0 24 24"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11M9 8h6"/></svg>', funds: '<svg viewBox="0 0 24 24"><path d="M3 9l9-5 9 5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/></svg>', me: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg>' };
  const fab = fabOK(r) ? `<button class="fab" data-act="fab" aria-label="নতুন এন্ট্রি">${starSvg(64, 'var(--gold)')}<b>＋</b></button>` : '<span class="fab-gap"></span>';
  return `<header class="top"><a class="brand" href="#/home">${starSvg(26, 'var(--gold)')}<span>আমার হিসাব</span></a><a class="avatar" href="#/me" aria-label="আমার প্রোফাইল">${esc((S.me.name || '?').trim()[0] || '?')}</a></header>
  ${viewing ? `<div class="banner"><span><b>${esc(tn)}</b>-এর খাতা দেখছেন — আপনি সুপার এডমিন</span><button data-act="back-self">নিজের খাতায় ফিরুন</button></div>` : ''}
  ${cloud ? '' : `<div class="banner soft"><span>লোকাল মোড — তথ্য শুধু এই ফোনে আছে। অনলাইন ব্যাকআপের জন্য Firebase যুক্ত করুন।</span></div>`}
  <main>${body}</main>
  <nav class="dock" aria-label="প্রধান মেনু">${nav('#/home', ic.home, 'হোম', r.name === 'home')}${nav('#/book/expense', ic.book, 'খাতা', r.name === 'book')}${fab}${nav('#/funds', ic.funds, 'ফান্ড', r.name === 'funds' || r.name === 'fund')}${nav('#/me', ic.me, 'আমি', r.name === 'me' || r.name === 'admin')}</nav>`;
}
function fabOK(r) {
  if (r.name === 'me' || r.name === 'admin') return false;
  if (r.name === 'fund') { const f = DB.funds.find(x => x.id === r.a); return !!f && canEditFund(f) && r.b !== 'set'; }
  return true;
}
const monthbar = (m, act) => `<div class="monthbar"><button data-act="${act}" data-d="-1" aria-label="আগের মাস">‹</button><label class="mlabel"><span>${monthLabel(m)}</span></label><button data-act="${act}" data-d="1" aria-label="পরের মাস">›</button></div>`;
const amtCls = t => t === 'income' ? 'inc' : t === 'loan' ? 'loan' : t === 'saving' ? 'sav' : 'exp';

// ---------- হোম ----------
function viewHome() {
  const m = S.month, s = sums(m), o = opening(m), c = o + s.income - s.expense - s.loan - s.saving, pool = Math.max(o + s.income, 1);
  const seg = [['exp', s.expense], ['loan', s.loan], ['sav', s.saving], ['left', Math.max(c, 0)]].map(([k, v]) => v > 0 ? `<i class="${k}" style="flex:${v / pool}"></i>` : '').join('');
  const cats = {}; monthTx(m).filter(t => t.type === 'expense').forEach(t => { const k = t.cat || 'অন্যান্য'; cats[k] = (cats[k] || 0) + (+t.amt || 0); });
  const arr = Object.entries(cats).sort((a, b) => b[1] - a[1]); const mx = arr.length ? arr[0][1] : 1;
  const line = (l, v, cls = '') => `<div class="lead"><span>${l}</span><i></i><b class="${cls}">${tk(v)}</b></div>`;
  const funds = DB.funds.map(f => { const b = fundBalance(f); return `<a class="ftile" href="#/fund/${f.id}/dash"><span class="fi">${esc(f.icon || '🗂')}</span><span class="fn">${esc(f.name)}</span><b class="${b < 0 ? 'exp' : 'inc'}">${tk(b)}</b></a>`; }).join('');
  return `${monthbar(m, 'month')}
  <section class="slip"><p class="cap">${monthLabel(m)} শেষে হাতে</p><p class="big ${c < 0 ? 'neg' : ''}">${tk(c)}</p>
  <div class="usage" role="img" aria-label="আয়ের ব্যবহার">${seg || '<i class="left" style="flex:1"></i>'}</div>
  <div class="legend"><span class="exp">ব্যয়</span><span class="loan">ঋণ</span><span class="sav">সঞ্চয়</span><span class="left">বাকি</span></div>
  <div class="ledger">${line('শুরুর ব্যালেন্স', o)}${line('মোট আয়', s.income, 'inc')}${line('মোট ব্যয়', s.expense, 'exp')}${s.loan ? line('ঋণ পরিশোধ', s.loan, 'loan') : ''}${s.saving ? line('সঞ্চয়', s.saving, 'sav') : ''}</div></section>
  <section class="card"><h2>খাতভিত্তিক ব্যয়</h2>${arr.length ? arr.map(([k, v]) => `<div class="cat"><div class="lead"><span>${esc(k)}</span><i></i><b>${tk(v)}</b></div><div class="bar"><i style="width:${(v / mx * 100).toFixed(1)}%"></i></div></div>`).join('') : `<div class="empty small"><p>এই মাসে কোনো ব্যয় নেই।</p><button class="btn pri" data-act="add-tx" data-t="expense">ব্যয় যোগ করুন</button></div>`}</section>
  <section class="card"><div class="h-row"><h2>ফান্ড ও ম্যানেজমেন্ট</h2><a href="#/funds" class="lnk">সব দেখুন</a></div>${funds ? `<div class="ftiles">${funds}</div>` : `<div class="empty small"><p>${S.loaded.funds ? 'এখনও কোনো ফান্ড নেই।' : 'লোড হচ্ছে…'}</p></div>`}</section>`;
}

// ---------- খাতা ----------
function bookItems() {
  const tab = S.book; let l = monthTx(S.month).filter(t => tab === 'income' ? t.type === 'income' : t.type !== 'income');
  const total = l.reduce((s, t) => s + (+t.amt || 0), 0);
  if (S.q) { const q = S.q.trim(); l = l.filter(t => ((t.item || '') + (t.cat || '') + (t.note || '')).includes(q)); }
  return { l, total };
}
function bookList() {
  const { l } = bookItems(); if (!l.length) return `<div class="empty"><p>${S.q ? 'কিছু পাওয়া যায়নি।' : S.book === 'income' ? 'এই মাসে কোনো আয় নেই।' : 'এই মাসে কোনো ব্যয় নেই।'}</p>${S.q ? '' : `<button class="btn pri" data-act="add-tx" data-t="${S.book}">${S.book === 'income' ? 'আয় যোগ করুন' : 'ব্যয় যোগ করুন'}</button>`}</div>`;
  const g = {}; l.forEach(t => { const k = t.dateUnknown ? '—' : t.date; (g[k] ||= []).push(t); });
  return Object.keys(g).sort((a, b) => b.localeCompare(a)).map(k => `<div class="day">${k === '—' ? 'তারিখ নেই' : dayLabel(g[k][0])}</div><div class="rows">${g[k].sort((a, b) => (b.ts || 0) - (a.ts || 0)).map(t => `<button class="row" data-act="edit-tx" data-id="${esc(t.id)}"><span class="rm"><b>${esc(t.item) || '—'}</b><small>${[t.type === 'loan' || t.type === 'saving' ? `<em class="tag ${amtCls(t.type)}">${TYPE_L[t.type]}</em>` : esc(t.cat), esc(t.note)].filter(Boolean).join(' · ')}</small></span><span class="amt ${amtCls(t.type)}">${tk(t.amt)}</span></button>`).join('')}</div>`).join('');
}
function viewBook(r) {
  S.book = r.a === 'income' ? 'income' : 'expense'; const { total } = bookItems();
  return `${monthbar(S.month, 'month')}
  <div class="seg2"><a href="#/book/expense" class="${S.book === 'expense' ? 'on' : ''}">ব্যয়</a><a href="#/book/income" class="${S.book === 'income' ? 'on' : ''}">আয়</a></div>
  <div class="total"><span>${S.book === 'income' ? 'মোট আয়' : 'মোট ব্যয়, ঋণ ও সঞ্চয়'}</span><b class="${S.book === 'income' ? 'inc' : 'exp'}">${tk(total)}</b></div>
  <input class="search" id="q" type="search" placeholder="আইটেম, খাত বা নোট খুঁজুন" value="${esc(S.q)}" autocomplete="off">
  <div id="list">${bookList()}</div>`;
}

// ---------- ফান্ড তালিকা ----------
function viewFunds() {
  const cards = DB.funds.map(f => { const st = fundStats(f); const n = Object.keys(f.members || {}).length; return `<a class="fcard" href="#/fund/${f.id}/dash"><span class="fi big">${esc(f.icon || '🗂')}</span><span class="fm"><b>${esc(f.name)}</b><small>${toBn(st.n)}টি লেনদেন · ${toBn(n)} জন সদস্য</small></span><span class="fb"><b class="${st.b < 0 ? 'exp' : 'inc'}">${tk(st.b)}</b><small>${st.b < 0 ? 'ঘাটতি' : 'হাতে আছে'}</small></span></a>`; }).join('');
  return `<h1 class="pg">ফান্ড ও ম্যানেজমেন্ট</h1><p class="sub">মক্তব, মসজিদ, সমিতি — যার টাকা আপনার কাছে জমা থাকে, তার আলাদা হিসাব এখানে।</p>
  ${cards || `<div class="empty"><p>${S.loaded.funds ? 'এখনও কোনো ফান্ড নেই।' : 'লোড হচ্ছে…'}</p></div>`}
  <button class="btn pri wide" data-act="new-fund">নতুন ম্যানেজমেন্ট যোগ করুন</button>`;
}
// ---------- ফান্ডের বিস্তারিত ----------
const FTABS = [['dash', 'সারাংশ'], ['in', 'কালেকশন'], ['out', 'খরচ'], ['people', 'পরিচিতি'], ['set', 'সেটিংস']];
function fundMonths(f) { const s = new Set((DB.ftx[f.id] || []).map(t => (t.date || '').slice(0, 7)).filter(Boolean)); return [...s].sort().reverse(); }
function fundList(f) {
  const tab = route().b; const can = canEditFund(f);
  if (tab === 'people') {
    const all = DB.fpeople[f.id] || []; let l = all; if (S.pgroup) l = l.filter(p => p.group === S.pgroup); if (S.fq) l = l.filter(p => ((p.name || '') + (p.guardian || '') + (p.phone || '')).includes(S.fq.trim()));
    return l.length ? `<div class="rows">${l.map((p, i) => `<div class="row static"><span class="no">${toBn(all.indexOf(p) + 1)}</span><span class="rm"><b>${esc(p.name)}</b><small>${[p.guardian && 'অভি: ' + esc(p.guardian), p.address && esc(p.address)].filter(Boolean).join(' · ')}</small></span>${p.phone ? `<a class="call" href="tel:${esc(p.phone)}" aria-label="ফোন করুন">☎</a>` : ''}${p.group ? `<span class="grp">${esc(p.group)}</span>` : ''}${can ? `<button class="mini" data-act="edit-person" data-f="${f.id}" data-id="${esc(p.id)}" aria-label="সম্পাদনা">✎</button>` : ''}</div>`).join('')}</div>` : `<div class="empty"><p>${S.fq || S.pgroup ? 'কিছু পাওয়া যায়নি।' : 'এখনও কেউ যোগ করা হয়নি।'}</p></div>`;
  }
  const type = tab; let l = (DB.ftx[f.id] || []).filter(t => t.type === type && (S.fperiod === 'all' || (t.date || '').slice(0, 7) === S.fperiod));
  if (S.fq) l = l.filter(t => ((t.name || '') + (t.head || '') + (t.note || '') + (t.phone || '')).includes(S.fq.trim()));
  l.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.ts || 0) - (a.ts || 0));
  return l.length ? `<div class="rows">${l.map(t => `<${can ? 'button' : 'div'} class="row${can ? '' : ' static'}" ${can ? `data-act="edit-ftx" data-f="${f.id}" data-id="${esc(t.id)}"` : ''}><span class="rm"><b>${esc(t.name) || '—'}</b><small>${[t.date && dayLabel({ date: t.date }) + ' ' + toBn(t.date.slice(0, 4)), t.head && `<em class="tag">${esc(t.head)}</em>`, t.qty && esc(t.qty), t.note && esc(t.note)].filter(Boolean).join(' · ')}</small></span><span class="amt ${type === 'in' ? 'inc' : 'exp'}">${(+t.amt) ? tk(t.amt) : '—'}</span></${can ? 'button' : 'div'}>`).join('')}</div>` : `<div class="empty"><p>${S.fq ? 'কিছু পাওয়া যায়নি।' : 'কোনো এন্ট্রি নেই।'}</p></div>`;
}
function viewFund(r) {
  const f = DB.funds.find(x => x.id === r.a);
  if (!f) return `<a class="lnk back" href="#/funds">‹ সব ফান্ড</a><div class="empty"><p>${S.loaded.funds ? 'এই ফান্ড পাওয়া যায়নি বা আপনার অনুমতি নেই।' : 'লোড হচ্ছে…'}</p></div>`;
  const tab = FTABS.some(t => t[0] === r.b) ? r.b : 'dash'; const can = canEditFund(f);
  const head = `<a class="lnk back" href="#/funds">‹ সব ফান্ড</a><h1 class="pg"><span class="fi">${esc(f.icon || '🗂')}</span>${esc(f.name)}</h1>
  <div class="ftabs" role="tablist">${FTABS.map(([k, l]) => `<a role="tab" href="#/fund/${f.id}/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>${can ? '' : '<p class="note">আপনি শুধু দেখতে পারবেন।</p>'}`;
  if (tab === 'dash') {
    const months = fundMonths(f); const st = fundStats(f, S.fperiod);
    const alerts = st.per.filter(x => x.i || x.o).map(x => x.b < 0 ? `<li class="exp"><b>${esc(x.h)}</b> ফান্ডে ${tk(-x.b)} ঘাটতি</li>` : `<li class="inc"><b>${esc(x.h)}</b> ফান্ডে ${tk(x.b)} আছে</li>`).join('');
    return head + `<label class="period"><span>সময়কাল</span><select id="fperiod"><option value="all">সব সময়</option>${months.map(m => `<option value="${m}"${S.fperiod === m ? ' selected' : ''}>${monthLabel(m)}</option>`).join('')}</select></label>
    <section class="slip"><p class="cap">বর্তমান ক্যাশ</p><p class="big ${st.b < 0 ? 'neg' : ''}">${tk(st.b)}</p><div class="ledger"><div class="lead"><span>মোট কালেকশন</span><i></i><b class="inc">${tk(st.i)}</b></div><div class="lead"><span>মোট খরচ</span><i></i><b class="exp">${tk(st.o)}</b></div><div class="lead"><span>লেনদেন</span><i></i><b>${toBn(st.n)}টি</b></div></div></section>
    <section class="card"><h2>বাবদ অনুযায়ী</h2>${st.per.map(x => `<div class="head"><b>${esc(x.h)}</b><span class="chip ${x.b < 0 ? 'bad' : 'ok'}">${x.b < 0 ? 'ঘাটতি' : 'আছে'}</span><div class="hn"><span>কালেকশন<b class="inc">${tk(x.i)}</b></span><span>খরচ<b class="exp">${tk(x.o)}</b></span><span>ব্যালেন্স<b class="${x.b < 0 ? 'exp' : 'inc'}">${tk(x.b)}</b></span></div></div>`).join('')}</section>
    ${alerts ? `<section class="card"><h2>নজর দিন</h2><ul class="alerts">${alerts}</ul></section>` : ''}`;
  }
  if (tab === 'set') return head + fundSettings(f);
  const months = fundMonths(f);
  const filter = tab === 'people' ? `<div class="chips"><button data-act="pgroup" data-g="" class="${!S.pgroup ? 'on' : ''}">সবাই ${toBn((DB.fpeople[f.id] || []).length)}</button>${(f.groups || []).map(g => `<button data-act="pgroup" data-g="${esc(g)}" class="${S.pgroup === g ? 'on' : ''}">${esc(g)} গ্রুপ ${toBn((DB.fpeople[f.id] || []).filter(p => p.group === g).length)}</button>`).join('')}</div>`
    : `<label class="period"><span>সময়কাল</span><select id="fperiod"><option value="all">সব সময়</option>${months.map(m => `<option value="${m}"${S.fperiod === m ? ' selected' : ''}>${monthLabel(m)}</option>`).join('')}</select></label><div class="total"><span>${tab === 'in' ? 'মোট কালেকশন' : 'মোট খরচ'}</span><b class="${tab === 'in' ? 'inc' : 'exp'}">${tk((DB.ftx[f.id] || []).filter(t => t.type === tab && (S.fperiod === 'all' || (t.date || '').slice(0, 7) === S.fperiod)).reduce((s, t) => s + (+t.amt || 0), 0))}</b></div>`;
  return head + filter + `<input class="search" id="fq" type="search" placeholder="খুঁজুন" value="${esc(S.fq)}" autocomplete="off"><div id="flist">${fundList(f)}</div>`;
}
function fundSettings(f) {
  const mem = Object.entries(f.members || {}); const mng = canManageFund(f);
  return `<section class="card"><h2>সদস্য ও অনুমতি</h2><p class="sub">যাকে যোগ করবেন, শুধু সে-ই এই ফান্ড দেখতে পারবে।</p>${mem.map(([id, m]) => `<div class="mem"><span class="rm"><b>${esc(m.n || id)}</b><small>@${esc(m.u || '')}${id === f.createdBy ? ' · মালিক' : ''}</small></span><span class="chip">${m.r === 'editor' ? 'সম্পাদক' : 'দর্শক'}</span>${mng && id !== f.createdBy ? `<button class="mini" data-act="rm-member" data-f="${f.id}" data-id="${esc(id)}" aria-label="সরান">✕</button>` : ''}</div>`).join('')}${mng ? `<button class="btn pri" data-act="add-member" data-f="${f.id}">সদস্য যোগ করুন</button>` : ''}</section>
  ${mng ? `<section class="card"><h2>ফান্ডের তথ্য</h2><button class="btn ghost" data-act="edit-fund" data-f="${f.id}">নাম, বাবদ ও গ্রুপ বদলান</button><button class="btn ghost" data-act="csv-fund" data-f="${f.id}">CSV ডাউনলোড</button>${isSuper() || f.createdBy === S.me.uid ? `<button class="btn ghost danger" data-act="del-fund" data-f="${f.id}">এই ফান্ড মুছে ফেলুন</button>` : ''}</section>` : ''}`;
}

// ---------- প্রোফাইল ----------
const THEMES = [['auto', 'ডিভাইস অনুযায়ী'], ['light', 'দিন'], ['dark', 'রাত']];
const curTheme = () => { try { return localStorage.getItem('ah_theme') || 'auto'; } catch (e) { return 'auto'; } };
function applyTheme(t) { if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches) ? '#08110f' : '#0b3d33'); }
function viewMe() {
  const u = S.me; const th = curTheme();
  return `<h1 class="pg">আমি</h1>
  <section class="card who"><span class="avatar big">${esc((u.name || '?').trim()[0])}</span><div><b>${esc(u.name)}</b><small>@${esc(u.username || '')}</small></div><span class="chip ${isSuper() ? 'gold' : ''}">${isSuper() ? 'সুপার এডমিন' : 'ব্যবহারকারী'}</span></section>
  ${isSuper() ? `<a class="btn pri wide" href="#/admin">অ্যাডমিন প্যানেল</a>` : ''}
  <section class="card"><h2>ব্যাকআপ</h2>${cloud ? `<p class="sub">আপনার তথ্য রিয়েল-টাইমে অনলাইনে জমা হয়। চাইলে আলাদা স্ন্যাপশটও রাখতে পারেন।</p><button class="btn pri" data-act="snap">এখন অনলাইন ব্যাকআপ নিন</button><button class="btn ghost" data-act="snaps">আগের ব্যাকআপ দেখুন ও ফেরান</button>` : `<p class="sub">এখন লোকাল মোডে আছেন। ফোন হারালে তথ্য হারাবে — নিয়মিত ফাইলে ব্যাকআপ নিন, আর Firebase যুক্ত করে অনলাইন ব্যাকআপ চালু করুন।</p>`}<button class="btn ghost" data-act="export">ফাইলে ব্যাকআপ (JSON)</button><button class="btn ghost" data-act="import">ফাইল থেকে ফেরান</button><button class="btn ghost" data-act="csv-me">আমার খাতা CSV</button><input type="file" id="file" accept=".json,application/json" hidden></section>
  <section class="card"><h2>পছন্দ</h2><div class="seg" data-theme>${THEMES.map(([k, l]) => `<button data-act="theme" data-v="${k}" class="${th === k ? 'on' : ''}">${l}</button>`).join('')}</div><button class="btn ghost" data-act="edit-cats">আয়ের ধরন, ব্যয়ের খাত ও শুরুর ব্যালেন্স</button><button class="btn ghost" data-act="chpw">পাসওয়ার্ড বদলান</button></section>
  <button class="btn ghost danger wide" data-act="logout">লগআউট</button><p class="ver">আমার হিসাব ${cloud ? '· অনলাইন' : '· লোকাল'}</p>`;
}
// ---------- অ্যাডমিন ----------
function viewAdmin() {
  const rows = DB.users.map(u => `<div class="mem"><span class="rm"><b>${esc(u.name)}</b><small>@${esc(u.username || '')}${u.active === false ? ' · বন্ধ' : ''}</small></span><span class="chip ${u.role === 'super' ? 'gold' : ''}">${u.role === 'super' ? 'সুপার' : 'সাধারণ'}</span><button class="mini" data-act="user-menu" data-id="${esc(u.id)}" aria-label="আরও">⋯</button></div>`).join('');
  return `<a class="lnk back" href="#/me">‹ আমি</a><h1 class="pg">অ্যাডমিন প্যানেল</h1>
  <section class="card"><div class="h-row"><h2>ব্যবহারকারী (${toBn(DB.users.length)})</h2></div>${rows || '<p class="sub">লোড হচ্ছে…</p>'}<button class="btn pri" data-act="new-user">নতুন ব্যবহারকারী তৈরি করুন</button></section>
  <section class="card"><h2>নিবন্ধন</h2><p class="sub">চালু থাকলে লগইন পাতা থেকে যে কেউ নিজের আইডি খুলতে পারবে।</p><div class="seg"><button data-act="signup" data-v="1" class="${S.appCfg.signup !== false ? 'on' : ''}">চালু</button><button data-act="signup" data-v="0" class="${S.appCfg.signup === false ? 'on' : ''}">বন্ধ</button></div></section>
  <section class="card"><h2>শিটের তথ্য</h2><p class="sub">Amar Hishab ও মক্তব ব্যবস্থাপনা সিস্টেম শিটের তথ্য আপনার অ্যাকাউন্টে হুবহু যোগ করা হয়। আবার ইমপোর্ট করলে ওই এন্ট্রির সম্পাদনা আগের অবস্থায় ফিরে যাবে।</p><button class="btn ghost" data-act="seed">শিটের তথ্য আবার ইমপোর্ট করুন</button></section>`;
}

// ---------- লগইন / সেটআপ / নিবন্ধন ----------
async function authMode() {
  try { if (await D.needsSetup()) return 'setup'; S.appCfg = await D.getAppConfig(); } catch (e) { S.authErr = cloud ? 'ডেটাবেসে সংযোগ হয়নি। ইন্টারনেট ও Firebase নিয়ম (rules) প্রকাশ করা আছে কিনা দেখুন। ' + (e.message || '') : e.message; return 'login'; }
  return 'login';
}
function renderAuth() {
  const m = S.authMode || 'login'; const setup = m === 'setup', su = m === 'signup';
  $app.innerHTML = `<div class="auth"><div class="aw"><div class="mark">${starSvg(84, 'var(--gold)')}</div><h1>আমার হিসাব</h1><p class="tag">${setup ? 'প্রথমবার — সুপার এডমিন অ্যাকাউন্ট খুলুন' : su ? 'নতুন অ্যাকাউন্ট খুলুন' : 'আপনার নিজের হিসাবে ঢুকুন'}</p>
  <form id="authf" novalidate>${setup || su ? `<label for="a_name">আপনার নাম</label><input id="a_name" autocomplete="name" value="${esc(S.av.name)}">` : ''}<label for="a_id">${setup || su ? 'আইডি (ইংরেজি অক্ষর/সংখ্যা, ৩+)' : 'আইডি বা ইমেইল'}</label><input id="a_id" autocapitalize="off" autocomplete="username" inputmode="email" value="${esc(S.av.id)}"><label for="a_pw">পাসওয়ার্ড</label><input id="a_pw" type="password" autocomplete="${setup || su ? 'new-password' : 'current-password'}">
  <p class="err" role="alert">${esc(S.authErr)}</p><button class="btn gold" type="submit" ${S.busy ? 'disabled' : ''}>${S.busy ? 'অপেক্ষা করুন…' : setup ? 'অ্যাকাউন্ট খুলুন ও শিটের তথ্য আনুন' : su ? 'অ্যাকাউন্ট খুলুন' : 'ঢুকুন'}</button></form>
  ${!setup && m === 'login' ? `${cloud ? '<button class="lnk2" data-act="forgot">পাসওয়ার্ড ভুলে গেছেন?</button>' : ''}${S.appCfg.signup !== false ? '<button class="lnk2" data-act="to-signup">নতুন অ্যাকাউন্ট খুলুন</button>' : ''}` : ''}${su ? '<button class="lnk2" data-act="to-login">আগের অ্যাকাউন্টে ঢুকুন</button>' : ''}</div></div>`;
  $app.querySelector('#authf').onsubmit = async ev => {
    ev.preventDefault(); if (S.busy) return; const id = $app.querySelector('#a_id').value.trim().toLowerCase(), pw = $app.querySelector('#a_pw').value, name = ($app.querySelector('#a_name') || {}).value?.trim();
    const bad = (setup || su) ? (!name ? 'নাম লিখুন' : !validId(id) ? 'আইডিতে শুধু ইংরেজি ছোট অক্ষর, সংখ্যা, . _ - ব্যবহার করুন (কমপক্ষে ৩টি), অথবা ইমেইল দিন' : pw.length < 6 ? 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের দিন' : '') : (!id || !pw ? 'আইডি ও পাসওয়ার্ড দিন' : '');
    S.av = { name: name || '', id };
    if (bad) { S.authErr = bad; return renderAuth(); }
    S.busy = true; S.authErr = ''; renderAuth();
    try {
      if (setup) { const uid = await D.setupSuper(id, pw, name); S.me = S.me || { uid }; await importSeed(uid, true); }
      else if (su) await D.signup(id, pw, name); else await D.login(id, pw);
    } catch (e) { S.authErr = e.message; }
    S.busy = false; if (!S.me) renderAuth();
  };
}

// ---------- ফর্ম ----------
const defDate = () => S.month === todayStr().slice(0, 7) ? todayStr() : S.month + '-01';
const strip = ({ id, ...d }) => d;
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const cellOpts = (list, cur, blank) => { const o = [...list]; if (cur && !o.includes(cur)) o.push(cur); return blank ? [{ v: '', l: blank }, ...o.map(x => ({ v: x, l: x }))] : o.map(x => ({ v: x, l: x })); };
function txForm(t, defType) {
  const st = settings();
  formSheet({
    title: t ? 'এন্ট্রি সম্পাদনা' : 'নতুন এন্ট্রি', values: t ? { ...t } : { type: defType || 'expense', date: defDate(), item: '', amt: '', cat: '', note: '' },
    fields: v => { const ty = v.type, cats = ty === 'income' ? st.inc : ty === 'expense' ? st.exp : null; const f = [{ k: 'type', type: 'seg', options: Object.entries(TYPE_L).map(([k, l]) => ({ v: k, l })) }, { k: 'date', label: 'তারিখ', type: 'date', req: true }, { k: 'item', label: 'আইটেম', type: 'text', ph: ty === 'income' ? 'যেমন: বেতন' : 'যেমন: বিস্কুট' }, { k: 'amt', label: 'পরিমাণ (টাকা)', type: 'money', req: true, ph: '০' }]; if (cats) f.push({ k: 'cat', label: ty === 'income' ? 'ধরন' : 'খাত', type: 'select', options: cellOpts(cats, v.cat, '— বাছাই করুন —') }); f.push({ k: 'note', label: 'নোট (ঐচ্ছিক)', type: 'text' }); return f; },
    onSave: async o => {
      const data = { type: o.type, date: o.date, item: o.item, amt: o.amt, cat: o.type === 'income' || o.type === 'expense' ? (o.cat || '') : '', note: o.note, ts: t?.ts || Date.now() };
      if (t?.dateUnknown && o.date === t.date) data.dateUnknown = true;
      await D.set(txPath(), t ? t.id : newId(), data); S.month = o.date.slice(0, 7);
      if (route().name === 'book') go(o.type === 'income' ? '#/book/income' : '#/book/expense'); toast(t ? 'বদলানো হয়েছে' : 'যোগ হয়েছে');
    },
    onDelete: t ? async () => { await D.del(txPath(), t.id); toast('মুছে ফেলা হয়েছে'); } : null,
  });
}
const ICONS = ['🕌', '📚', '🌱', '🏠', '🤝', '💰', '🎓', '🗂'];
function fundFields(v) { return [{ k: 'name', label: 'নাম', type: 'text', req: true, ph: 'যেমন: মসজিদ ব্যবস্থাপনা' }, { k: 'icon', label: 'চিহ্ন', type: 'select', options: cellOpts(ICONS, v.icon) }, { k: 'heads', label: 'বাবদ (প্রতি লাইনে একটি)', type: 'textarea', rows: 4, hint: 'যেমন: জেনারেল, পুরস্কার — কালেকশন ও খরচ এই বাবদ ধরে আলাদা হিসাব হবে।' }, { k: 'groups', label: 'পরিচিতির গ্রুপ (কমা দিয়ে, ঐচ্ছিক)', type: 'text', ph: 'ক, খ' }]; }
const lines = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);
function newFund() {
  formSheet({ title: 'নতুন ম্যানেজমেন্ট', values: { name: '', icon: '🕌', heads: 'জেনারেল', groups: '' }, fields: fundFields, saveLabel: 'তৈরি করুন', onSave: async o => {
    const me = S.me; const id = newId(); await D.set('funds', id, { name: o.name, icon: o.icon, heads: lines(o.heads), groups: o.groups.split(/[,،]/).map(x => x.trim()).filter(Boolean), createdBy: me.uid, createdAt: Date.now(), members: { [me.uid]: { r: 'editor', n: me.name, u: me.username } }, memberIds: [me.uid] }); go('#/fund/' + id + '/dash');
  } });
}
function editFund(f) {
  formSheet({ title: 'ফান্ডের তথ্য', values: { name: f.name, icon: f.icon, heads: (f.heads || []).join('\n'), groups: (f.groups || []).join(', '), id: f.id }, fields: fundFields, onSave: async o => { await D.set('funds', f.id, { ...strip(f), name: o.name, icon: o.icon, heads: lines(o.heads), groups: o.groups.split(/[,،]/).map(x => x.trim()).filter(Boolean) }); toast('বদলানো হয়েছে'); } });
}
function ftxForm(f, type, t) {
  const inn = type === 'in';
  formSheet({
    title: t ? (inn ? 'কালেকশন সম্পাদনা' : 'খরচ সম্পাদনা') : (inn ? 'নতুন কালেকশন' : 'নতুন খরচ'), values: t ? { ...t } : { date: defDate(), name: '', head: (f.heads || [])[0] || '', amt: '', phone: '', qty: '', note: '' }, zeroOk: !!(t && !t.amt),
    fields: v => [{ k: 'name', label: inn ? 'দাতার নাম' : 'সামান', type: 'text', req: true }, { k: 'date', label: 'তারিখ', type: 'date', req: true }, { k: 'head', label: 'বাবদ', type: 'select', options: cellOpts(f.heads || [], v.head, '— নেই —') }, { k: 'amt', label: 'টাকা', type: 'money', req: true, ph: '০' }, inn ? { k: 'phone', label: 'ফোন নাম্বার (ঐচ্ছিক)', type: 'tel' } : { k: 'qty', label: 'পরিমাণ (ঐচ্ছিক, লিখে)', type: 'text', ph: 'যেমন: ১ কার্টুন' }, { k: 'note', label: 'নোট (ঐচ্ছিক)', type: 'text' }],
    onSave: async o => { const d = { type, date: o.date, name: o.name, head: o.head, amt: o.amt, note: o.note, ts: t?.ts || Date.now() }; if (inn) d.phone = o.phone; else d.qty = o.qty; await D.set(`funds/${f.id}/tx`, t ? t.id : newId(), d); toast(t ? 'বদলানো হয়েছে' : 'যোগ হয়েছে'); },
    onDelete: t ? async () => { await D.del(`funds/${f.id}/tx`, t.id); toast('মুছে ফেলা হয়েছে'); } : null,
  });
}
function personForm(f, p) {
  formSheet({ title: p ? 'পরিচিতি সম্পাদনা' : 'নতুন পরিচিতি', values: p ? { ...p } : { name: '', guardian: '', phone: '', address: '', group: '' },
    fields: v => [{ k: 'name', label: 'নাম', type: 'text', req: true }, { k: 'guardian', label: 'অভিভাবকের নাম', type: 'text' }, { k: 'phone', label: 'ফোন নাম্বার', type: 'tel' }, { k: 'address', label: 'ঠিকানা', type: 'text' }, { k: 'group', label: 'গ্রুপ', type: 'select', options: cellOpts(f.groups || [], v.group, '— নেই —') }],
    onSave: async o => { await D.set(`funds/${f.id}/people`, p ? p.id : newId(), { name: o.name, guardian: o.guardian, phone: o.phone, address: o.address, group: o.group, ts: p?.ts || Date.now() }); toast('সংরক্ষিত'); },
    onDelete: p ? async () => { await D.del(`funds/${f.id}/people`, p.id); } : null });
}
function addMember(f) {
  formSheet({ title: 'সদস্য যোগ করুন', values: { u: '', r: 'viewer' }, saveLabel: 'যোগ করুন', fields: () => [{ k: 'u', label: 'তার আইডি', type: 'text', req: true, hint: 'তাকে আগে অ্যাপে অ্যাকাউন্ট খুলতে হবে।' }, { k: 'r', label: 'অনুমতি', type: 'select', options: [{ v: 'viewer', l: 'দর্শক — শুধু দেখতে পারবে' }, { v: 'editor', l: 'সম্পাদক — যোগ ও বদল করতে পারবে' }] }],
    onSave: async o => { const key = o.u.toLowerCase(); const hit = await D.get('usernames', key); if (!hit) throw new Error('এই আইডিতে কোনো অ্যাকাউন্ট পাওয়া যায়নি'); const members = { ...(f.members || {}), [hit.uid]: { r: o.r, n: hit.name, u: key } }; await D.set('funds', f.id, { ...strip(f), members, memberIds: Object.keys(members) }); toast(hit.name + ' যোগ হয়েছে'); } });
}
function editCats() {
  const st = settings();
  formSheet({ title: 'খাত ও শুরুর ব্যালেন্স', values: { start: st.start || '', inc: st.inc.join('\n'), exp: st.exp.join('\n') }, zeroOk: true,
    fields: () => [{ k: 'start', label: 'প্রথম মাসের শুরুর ব্যালেন্স (টাকা)', type: 'money' }, { k: 'inc', label: 'আয়ের ধরন (প্রতি লাইনে একটি)', type: 'textarea', rows: 3 }, { k: 'exp', label: 'ব্যয়ের খাত (প্রতি লাইনে একটি)', type: 'textarea', rows: 7 }],
    onSave: async o => { await D.set(`users/${S.target}/meta`, 'settings', { start: o.start || 0, inc: lines(o.inc), exp: lines(o.exp) }); toast('সংরক্ষিত'); } });
}
function changePw() {
  formSheet({ title: 'পাসওয়ার্ড বদলান', values: {}, saveLabel: 'বদলান', fields: () => [{ k: 'o', label: 'বর্তমান পাসওয়ার্ড', type: 'password', req: true }, { k: 'n', label: 'নতুন পাসওয়ার্ড (৬+ অক্ষর)', type: 'password', req: true }],
    onSave: async o => { if (o.n.length < 6) throw new Error('নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের দিন'); await D.changePassword(o.o, o.n); toast('পাসওয়ার্ড বদলেছে'); } });
}
function forgot() {
  formSheet({ title: 'পাসওয়ার্ড রিসেট', values: {}, saveLabel: 'রিসেট লিংক পাঠান', fields: () => [{ k: 'e', label: 'আপনার ইমেইল', type: 'text', req: true, hint: 'শুধু ইমেইল দিয়ে খোলা অ্যাকাউন্টে লিংক যাবে। সাধারণ আইডির পাসওয়ার্ড হারালে সুপার এডমিনকে জানান।' }],
    onSave: async o => { await D.resetEmail(o.e.toLowerCase()); toast('ইমেইলে লিংক পাঠানো হয়েছে'); } });
}
function newUser() {
  formSheet({ title: 'নতুন ব্যবহারকারী', values: { role: 'user' }, saveLabel: 'তৈরি করুন', fields: () => [{ k: 'n', label: 'নাম', type: 'text', req: true }, { k: 'u', label: 'আইডি (ইংরেজি অক্ষর/সংখ্যা)', type: 'text', req: true }, { k: 'p', label: 'পাসওয়ার্ড (৬+ অক্ষর)', type: 'password', req: true }, { k: 'role', label: 'ভূমিকা', type: 'select', options: [{ v: 'user', l: 'সাধারণ ব্যবহারকারী' }, { v: 'super', l: 'সুপার এডমিন' }] }],
    onSave: async o => { const id = o.u.toLowerCase(); if (!validId(id)) throw new Error('আইডিতে শুধু ইংরেজি ছোট অক্ষর, সংখ্যা, . _ - (৩+) অথবা ইমেইল দিন'); if (o.p.length < 6) throw new Error('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের দিন'); await D.createUser(id, o.p, o.n, o.role); toast(o.n + '-এর অ্যাকাউন্ট তৈরি হয়েছে'); } });
}

// ---------- ডেটা আমদানি/ব্যাকআপ ----------
async function importSeed(uid, auto) {
  const me = S.me || {}; const P = SEED.personal, F = SEED.fund, ops = [];
  P.tx.forEach(t => { const { id, ...d } = t; ops.push({ op: 'set', path: `users/${uid}/tx`, id, data: { ...d, ts: Date.parse(d.date) || 0 } }); });
  ops.push({ op: 'set', path: `users/${uid}/meta`, id: 'settings', data: { start: P.start, inc: P.inc, exp: P.exp } });
  const ex = await D.get('funds', F.id).catch(() => null);
  const members = ex?.members || { [uid]: { r: 'editor', n: me.name, u: me.username } }; if (!members[uid]) members[uid] = { r: 'editor', n: me.name, u: me.username };
  ops.push({ op: 'set', path: 'funds', id: F.id, data: { name: F.name, icon: F.icon, heads: F.heads, groups: F.groups, createdBy: ex?.createdBy || uid, createdAt: ex?.createdAt || Date.now(), members, memberIds: Object.keys(members) } });
  F.tx.forEach(t => { const { id, ...d } = t; ops.push({ op: 'set', path: `funds/${F.id}/tx`, id, data: { ...d, ts: Date.parse(d.date) || 0 } }); });
  F.people.forEach((p, i) => { const { id, ...d } = p; ops.push({ op: 'set', path: `funds/${F.id}/people`, id, data: { ...d, ts: i } }); });
  await D.batch(ops); toast('শিটের তথ্য যোগ হয়েছে');
}
async function buildBackup() {
  const tx = await D.list(txPath()); const st = await D.get(`users/${S.target}/meta`, 'settings'); const funds = [];
  for (const f of DB.funds) funds.push({ fund: f, tx: await D.list(`funds/${f.id}/tx`), people: await D.list(`funds/${f.id}/people`) });
  return { app: 'amar-hishab', v: 1, ts: Date.now(), user: { name: S.me.name, username: S.me.username }, personal: { settings: st && strip(st), tx }, funds };
}
async function restore(b) {
  if (!b || b.app !== 'amar-hishab') throw new Error('এটি আমার হিসাবের ব্যাকআপ ফাইল নয়');
  const ops = []; (b.personal?.tx || []).forEach(t => ops.push({ op: 'set', path: txPath(), id: t.id, data: strip(t) }));
  if (b.personal?.settings) ops.push({ op: 'set', path: `users/${S.target}/meta`, id: 'settings', data: b.personal.settings });
  for (const x of b.funds || []) { const f = strip(x.fund); const members = { ...(f.members || {}) }; if (!members[S.me.uid]) members[S.me.uid] = { r: 'editor', n: S.me.name, u: S.me.username }; ops.push({ op: 'set', path: 'funds', id: x.fund.id, data: { ...f, members, memberIds: Object.keys(members), createdBy: f.createdBy || S.me.uid } }); (x.tx || []).forEach(t => ops.push({ op: 'set', path: `funds/${x.fund.id}/tx`, id: t.id, data: strip(t) })); (x.people || []).forEach(t => ops.push({ op: 'set', path: `funds/${x.fund.id}/people`, id: t.id, data: strip(t) })); }
  await D.batch(ops); toast(`ফেরানো হয়েছে — ${toBn(ops.length)}টি রেকর্ড`);
}
async function saveFile(name, text, mime) {
  const C = window.Capacitor;
  if (C?.isNativePlatform?.() && C.Plugins?.Filesystem && C.Plugins?.Share) { try { const r = await C.Plugins.Filesystem.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' }); await C.Plugins.Share.share({ title: name, url: r.uri, dialogTitle: 'ফাইলটি কোথায় রাখবেন?' }); return true; } catch (e) { if (/cancel/i.test(e.message || '')) return true; } }
  if (download(name, text, mime)) return true;
  toast('ফাইল সংরক্ষণ করা যায়নি'); return false;
}
const csvOf = rows => '﻿' + rows.map(r => r.map(c => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
async function doBackupFile() { try { const b = await buildBackup(); if (await saveFile(`amar-hishab-backup-${todayStr()}.json`, JSON.stringify(b), 'application/json')) toast('ব্যাকআপ ফাইল তৈরি হয়েছে'); } catch (e) { toast(e.message); } }
async function doSnap() { try { const b = await buildBackup(); const json = JSON.stringify(b); if (json.length > 900000) throw new Error('ডেটা বড় হয়ে গেছে — ফাইলে ব্যাকআপ নিন'); await D.add(`users/${S.me.uid}/backups`, { ts: Date.now(), json, size: json.length, label: new Date().toLocaleString('bn-BD') }); toast('অনলাইন ব্যাকআপ নেওয়া হয়েছে'); } catch (e) { toast(e.message); } }
async function showSnaps() {
  const l = (await D.list(`users/${S.me.uid}/backups`)).sort((a, b) => b.ts - a.ts);
  if (!l.length) return toast('এখনও কোনো অনলাইন ব্যাকআপ নেই');
  menuSheet('অনলাইন ব্যাকআপ', l.slice(0, 12).map(s => ({ l: `${new Date(s.ts).toLocaleString('bn-BD')} · ${toBn(Math.round(s.size / 1024))} KB`, f: () => menuSheet('এই ব্যাকআপ দিয়ে কী করবেন?', [{ l: 'এখনকার তথ্যের জায়গায় ফেরান', f: async () => { if (await confirmSheet('এই ব্যাকআপের সব এন্ট্রি ফিরে আসবে। নতুন এন্ট্রি থাকলে তা থেকে যাবে।', 'ফেরান')) try { await restore(JSON.parse(s.json)); } catch (e) { toast(e.message); } } }, { l: 'এই ব্যাকআপ মুছুন', f: async () => { await D.del(`users/${S.me.uid}/backups`, s.id); toast('মুছে ফেলা হয়েছে'); } }]) })));
}

// ---------- ক্লিক ও ইনপুট ----------
function fab() {
  const r = route();
  if (r.name === 'fund') { const f = DB.funds.find(x => x.id === r.a); if (!f) return; if (r.b === 'in' || r.b === 'out') return ftxForm(f, r.b); if (r.b === 'people') return personForm(f); return menuSheet('কী যোগ করবেন?', [{ l: 'কালেকশন', f: () => ftxForm(f, 'in') }, { l: 'খরচ', f: () => ftxForm(f, 'out') }, { l: 'পরিচিতি', f: () => personForm(f) }]); }
  if (r.name === 'funds') return newFund();
  txForm(null, r.name === 'book' ? S.book : 'expense');
}
const fundOf = id => DB.funds.find(f => f.id === id);
$app.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return; const a = el.dataset.act, d = el.dataset;
  try {
    switch (a) {
      case 'fab': return fab();
      case 'month': S.month = shiftMonth(S.month, +d.d); return paint();
      case 'add-tx': return txForm(null, d.t);
      case 'edit-tx': return txForm(DB.tx.find(t => t.id === d.id));
      case 'new-fund': return newFund();
      case 'edit-fund': return editFund(fundOf(d.f));
      case 'del-fund': { const f = fundOf(d.f); if (await confirmSheet(`"${f.name}" ফান্ড ও এর সব লেনদেন চিরতরে মুছে যাবে।`, 'মুছে ফেলুন', true)) { await D.delTree('funds', f.id); go('#/funds'); toast('ফান্ড মুছে ফেলা হয়েছে'); } return; }
      case 'edit-ftx': { const f = fundOf(d.f); return ftxForm(f, route().b, (DB.ftx[f.id] || []).find(t => t.id === d.id)); }
      case 'edit-person': { const f = fundOf(d.f); return personForm(f, (DB.fpeople[f.id] || []).find(t => t.id === d.id)); }
      case 'pgroup': S.pgroup = d.g; return paint();
      case 'add-member': return addMember(fundOf(d.f));
      case 'rm-member': { const f = fundOf(d.f); if (!await confirmSheet('এই সদস্যকে সরাবেন?', 'সরান', true)) return; const members = { ...f.members }; delete members[d.id]; return D.set('funds', f.id, { ...strip(f), members, memberIds: Object.keys(members) }); }
      case 'csv-fund': { const f = fundOf(d.f); return saveFile(`${f.name}.csv`, csvOf([['তারিখ', 'ধরন', 'নাম/সামান', 'বাবদ', 'টাকা', 'পরিমাণ', 'ফোন', 'নোট'], ...(DB.ftx[f.id] || []).sort((x, y) => (x.date || '').localeCompare(y.date || '')).map(t => [t.date, t.type === 'in' ? 'কালেকশন' : 'খরচ', t.name, t.head, t.amt, t.qty, t.phone, t.note])]), 'text/csv'); }
      case 'csv-me': return saveFile('amar-hishab.csv', csvOf([['তারিখ', 'ধরন', 'আইটেম', 'খাত', 'টাকা', 'নোট'], ...DB.tx.slice().sort((x, y) => x.date.localeCompare(y.date)).map(t => [t.dateUnknown ? '' : t.date, TYPE_L[t.type], t.item, t.cat, t.amt, t.note])]), 'text/csv');
      case 'theme': try { localStorage.setItem('ah_theme', d.v); } catch (x) {} applyTheme(d.v); return paint();
      case 'edit-cats': return editCats();
      case 'chpw': return changePw();
      case 'logout': return D.logout();
      case 'export': return doBackupFile();
      case 'import': return document.getElementById('file').click();
      case 'snap': return doSnap();
      case 'snaps': return showSnaps();
      case 'back-self': S.target = S.me.uid; bind(); return go('#/home');
      case 'new-user': return newUser();
      case 'signup': await D.setAppConfig({ signup: d.v === '1' }); S.appCfg.signup = d.v === '1'; return paint();
      case 'seed': if (await confirmSheet('শিটের এন্ট্রিগুলো আবার যোগ হবে; আপনি যেসব এন্ট্রি বদলেছেন তা আগের অবস্থায় ফিরে যাবে।', 'ইমপোর্ট করুন')) await importSeed(S.me.uid); return;
      case 'user-menu': { const u = DB.users.find(x => x.id === d.id); const self = u.id === S.me.uid; const it = [{ l: 'এই ব্যবহারকারীর খাতা দেখুন', f: () => { S.target = u.id; bind(); go('#/home'); } }, { l: u.role === 'super' ? 'সাধারণ ব্যবহারকারী করুন' : 'সুপার এডমিন করুন', f: () => D.update('users', u.id, { role: u.role === 'super' ? 'user' : 'super' }) }, { l: u.active === false ? 'অ্যাকাউন্ট চালু করুন' : 'অ্যাকাউন্ট বন্ধ করুন', f: () => D.update('users', u.id, { active: u.active === false }) }]; return menuSheet(u.name, self ? [it[0]] : it); }
      case 'to-signup': S.authMode = 'signup'; S.authErr = ''; S.av = { name: '', id: '' }; return renderAuth();
      case 'to-login': S.authMode = 'login'; S.authErr = ''; return renderAuth();
      case 'forgot': return forgot();
    }
  } catch (err) { toast(err.message || 'কাজটি হয়নি'); }
});
$app.addEventListener('input', e => {
  if (e.target.id === 'q') { S.q = e.target.value; document.getElementById('list').innerHTML = bookList(); }
  if (e.target.id === 'fq') { S.fq = e.target.value; const f = fundOf(route().a); if (f) document.getElementById('flist').innerHTML = fundList(f); }
});
$app.addEventListener('change', e => {
  if (e.target.id === 'fperiod') { S.fperiod = e.target.value; paint(); }
  if (e.target.id === 'file' && e.target.files[0]) { const fr = new FileReader(); fr.onload = async () => { try { const b = JSON.parse(fr.result); if (await confirmSheet('ফাইলের সব এন্ট্রি এই অ্যাকাউন্টে যোগ হবে। একই এন্ট্রি থাকলে ফাইলের তথ্য দিয়ে বদলে যাবে।', 'ফেরান')) await restore(b); } catch (x) { toast(x.message || 'ফাইলটি পড়া যায়নি'); } }; fr.readAsText(e.target.files[0]); e.target.value = ''; }
});

// ---------- চালু ----------
async function onUser(u) {
  if (u) { const first = !S.me || S.me.uid !== u.uid; S.me = u; if (first) { S.target = u.uid; S.authErr = ''; bind(); D.getAppConfig().then(c => { S.appCfg = c; paint(); }).catch(() => {}); location.hash = '#/home'; } paint(); }
  else { S.me = null; S.target = null; unbind(); S.authMode = S.authMode === 'signup' ? 'signup' : await authMode(); renderAuth(); }
}
(async function boot() {
  applyTheme(curTheme());
  const lat = encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><polygon points='${starPoints(32, 32, 30, 19)}' fill='none' stroke='white' stroke-opacity='.07' stroke-width='1'/></svg>`);
  document.documentElement.style.setProperty('--lattice', `url("data:image/svg+xml,${lat}")`);
  try { D = await loadData(); await D.init(); D.onAuth(onUser); }
  catch (e) { console.error(e); $app.innerHTML = `<div class="auth"><div class="aw"><div class="mark">${starSvg(84, 'var(--gold)')}</div><h1>চালু করা যায়নি</h1><p class="tag">Firebase সংযোগ হয়নি। ইন্টারনেট ও config.js-এর মান দেখুন।</p><p class="err">${esc(e.message)}</p><button class="btn gold" onclick="location.reload()">আবার চেষ্টা করুন</button></div></div>`; }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
})();
