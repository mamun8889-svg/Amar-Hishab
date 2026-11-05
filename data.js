// ডেটা স্তর: একই API-র নিচে দুই ব্যাকএন্ড — লোকাল (এই ফোনে) ও ক্লাউড (Firebase)
import { CONFIG } from './config.js';
import { uid } from './util.js';
export const cloud = !!(CONFIG && CONFIG.apiKey && CONFIG.projectId);
const FB = '10.14.1', DOMAIN = '@amar-hishab.invalid';
export const toEmail = u => { u = String(u || '').trim().toLowerCase(); return u.includes('@') ? u : u + DOMAIN; };
export const validId = u => /^[a-z0-9._-]{3,30}$/.test(u) || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u);
const split = p => p.split('/');
const match = (o, w) => !w || (w[1] === '==' ? o[w[0]] === w[2] : Array.isArray(o[w[0]]) && o[w[0]].includes(w[2]));

// ============ লোকাল ============
function localBackend() {
  const KEY = 'amar_hishab_local_v1';
  let L; try { L = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { L = {}; }
  L.docs ||= {}; L.acc ||= {}; L.session ||= null;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(L)); } catch (e) { alert('সংরক্ষণের জায়গা শেষ — ব্যাকআপ নিয়ে পুরোনো তথ্য মুছুন'); } };
  const watchers = new Set(); const authCbs = new Set();
  const col = p => (L.docs[p] ||= {});
  const list = (p, o = {}) => Object.entries(col(p)).map(([id, v]) => ({ id, ...v })).filter(x => match(x, o.where));
  const notify = p => watchers.forEach(w => { if (w.path === p) w.cb(list(p, w.opt)); });
  const sha = async (s) => { try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); } catch (e) { let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return 'x' + h; } };
  const emit = async () => { const u = L.session ? col('users')[L.session] : null; const cur = u && u.active !== false ? { uid: L.session, ...u } : null; authCbs.forEach(cb => cb(cur)); };
  const api = {
    mode: 'local',
    async init() { return; },
    onAuth(cb) { authCbs.add(cb); emit(); return () => authCbs.delete(cb); },
    async needsSetup() { return !Object.values(col('users')).some(u => u.role === 'super'); },
    async signupOpen() { return (col('config').app || { signup: true }).signup !== false; },
    async login(id, pw) {
      const a = L.acc[toEmail(id)]; if (!a || a.hash !== await sha(a.salt + pw)) throw new Error('আইডি বা পাসওয়ার্ড ভুল');
      if (col('users')[a.uid]?.active === false) throw new Error('এই অ্যাকাউন্ট বন্ধ আছে — সুপার এডমিনের সাথে কথা বলুন');
      L.session = a.uid; save(); emit();
    },
    async logout() { L.session = null; save(); emit(); },
    async register(id, pw, profile) {
      const em = toEmail(id); if (L.acc[em]) throw new Error('এই আইডি আগেই নেওয়া হয়েছে');
      const salt = uid(); const u = 'u_' + uid(); L.acc[em] = { uid: u, salt, hash: await sha(salt + pw) };
      col('users')[u] = { username: id.toLowerCase(), active: true, createdAt: Date.now(), ...profile }; col('usernames')[id.toLowerCase()] = { uid: u, name: profile.name }; save(); notify('users'); return u;
    },
    async setupSuper(id, pw, name) { const u = await api.register(id, pw, { name, role: 'super' }); col('config').app = { signup: true }; save(); L.session = u; save(); emit(); return u; },
    async createUser(id, pw, name, role = 'user') { return api.register(id, pw, { name, role }); },
    async signup(id, pw, name) { const u = await api.register(id, pw, { name, role: 'user' }); L.session = u; save(); emit(); return u; },
    async changePassword(old, nw) { const s = L.session; const e = Object.entries(L.acc).find(([, a]) => a.uid === s); if (!e || e[1].hash !== await sha(e[1].salt + old)) throw new Error('বর্তমান পাসওয়ার্ড ভুল'); e[1].salt = uid(); e[1].hash = await sha(e[1].salt + nw); save(); },
    async resetEmail() { throw new Error('লোকাল মোডে পাসওয়ার্ড রিসেট নেই'); },
    async setAppConfig(patch) { col('config').app = { ...(col('config').app || {}), ...patch }; save(); },
    async getAppConfig() { return col('config').app || { signup: true }; },
    watch(path, cb, opt = {}) { const w = { path, cb, opt }; watchers.add(w); setTimeout(() => cb(list(path, opt)), 0); return () => watchers.delete(w); },
    async list(path, opt) { return list(path, opt); },
    async get(path, id) { const v = col(path)[id]; return v ? { id, ...v } : null; },
    async set(path, id, data) { col(path)[id] = JSON.parse(JSON.stringify(data)); save(); notify(path); },
    async update(path, id, patch) { col(path)[id] = { ...(col(path)[id] || {}), ...JSON.parse(JSON.stringify(patch)) }; save(); notify(path); },
    async add(path, data) { const id = uid(); await api.set(path, id, { ts: Date.now(), ...data }); return id; },
    async del(path, id) { delete col(path)[id]; save(); notify(path); },
    async delTree(path, id) { await api.del(path, id); Object.keys(L.docs).filter(k => k.startsWith(path + '/' + id + '/')).forEach(k => { delete L.docs[k]; notify(k); }); save(); },
    async batch(ops) { const ps = new Set(); for (const o of ops) { if (o.op === 'del') delete col(o.path)[o.id]; else col(o.path)[o.id] = JSON.parse(JSON.stringify(o.data)); ps.add(o.path); } save(); ps.forEach(notify); },
  };
  return api;
}

// ============ ক্লাউড (Firebase) ============
async function cloudBackend() {
  const u = m => `https://www.gstatic.com/firebasejs/${FB}/firebase-${m}.js`;
  const [A, Au, F] = await Promise.all([import(u('app')), import(u('auth')), import(u('firestore'))]);
  const app = A.initializeApp(CONFIG);
  const auth = Au.getAuth(app);
  const db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  const cref = p => F.collection(db, ...split(p));
  const dref = (p, id) => F.doc(db, ...split(p), id);
  let creating = false; const authCbs = new Set(); let last = null;
  const emit = u => { last = u; authCbs.forEach(cb => cb(u)); };
  Au.onAuthStateChanged(auth, async user => {
    if (creating) return;
    if (!user) return emit(null);
    try {
      const s = await F.getDoc(dref('users', user.uid)); if (!s.exists()) return emit(null);
      const p = s.data(); if (p.active === false) { await Au.signOut(auth); return emit(null); }
      emit({ uid: user.uid, email: user.email, ...p });
    } catch (e) { console.error(e); emit(null); }
  });
  const norm = e => { const c = e.code || ''; const m = { 'auth/invalid-credential': 'আইডি বা পাসওয়ার্ড ভুল', 'auth/wrong-password': 'আইডি বা পাসওয়ার্ড ভুল', 'auth/user-not-found': 'আইডি বা পাসওয়ার্ড ভুল', 'auth/email-already-in-use': 'এই আইডি আগেই নেওয়া হয়েছে', 'auth/weak-password': 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের দিন', 'auth/network-request-failed': 'ইন্টারনেট নেই — সংযোগ দেখে আবার চেষ্টা করুন', 'auth/too-many-requests': 'অনেকবার ভুল হয়েছে — কিছুক্ষণ পরে চেষ্টা করুন', 'permission-denied': 'এই কাজের অনুমতি নেই' }; return new Error(m[c] || e.message || 'কিছু একটা ভুল হয়েছে'); };
  const wrap = f => async (...a) => { try { return await f(...a); } catch (e) { throw norm(e); } };
  const q = (p, o = {}) => o.where ? F.query(cref(p), F.where(...o.where)) : cref(p);
  const api = {
    mode: 'cloud',
    async init() {},
    onAuth(cb) { authCbs.add(cb); if (last !== null) cb(last); return () => authCbs.delete(cb); },
    needsSetup: wrap(async () => !(await F.getDoc(dref('config', 'super'))).exists()),
    signupOpen: wrap(async () => { const s = await F.getDoc(dref('config', 'app')); return s.exists() && s.data().signup !== false; }),
    login: wrap(async (id, pw) => { await Au.signInWithEmailAndPassword(auth, toEmail(id), pw); }),
    logout: wrap(async () => { await Au.signOut(auth); }),
    setupSuper: wrap(async (id, pw, name) => {
      creating = true;
      try {
        const c = await Au.createUserWithEmailAndPassword(auth, toEmail(id), pw); const b = F.writeBatch(db);
        b.set(dref('config', 'super'), { uid: c.user.uid });
        b.set(dref('config', 'app'), { signup: true });
        b.set(dref('users', c.user.uid), { name, username: id.toLowerCase(), role: 'super', active: true, createdAt: Date.now() });
        b.set(dref('usernames', id.toLowerCase()), { uid: c.user.uid, name });
        await b.commit(); creating = false; emit({ uid: c.user.uid, name, username: id, role: 'super', active: true }); return c.user.uid;
      } finally { creating = false; }
    }),
    signup: wrap(async (id, pw, name) => {
      creating = true;
      try {
        const c = await Au.createUserWithEmailAndPassword(auth, toEmail(id), pw);
        const prof = { name, username: id.toLowerCase(), role: 'user', active: true, createdAt: Date.now() };
        await F.setDoc(dref('users', c.user.uid), prof); await F.setDoc(dref('usernames', id.toLowerCase()), { uid: c.user.uid, name }); creating = false; emit({ uid: c.user.uid, ...prof }); return c.user.uid;
      } finally { creating = false; }
    }),
    createUser: wrap(async (id, pw, name, role = 'user') => {
      const sec = A.initializeApp(CONFIG, 'sec' + Date.now());
      try {
        const sa = Au.getAuth(sec); const c = await Au.createUserWithEmailAndPassword(sa, toEmail(id), pw);
        await F.setDoc(dref('users', c.user.uid), { name, username: id.toLowerCase(), role, active: true, createdAt: Date.now() });
        await F.setDoc(dref('usernames', id.toLowerCase()), { uid: c.user.uid, name });
        await Au.signOut(sa); return c.user.uid;
      } finally { try { await A.deleteApp(sec); } catch (e) {} }
    }),
    changePassword: wrap(async (old, nw) => { const u = auth.currentUser; await Au.reauthenticateWithCredential(u, Au.EmailAuthProvider.credential(u.email, old)); await Au.updatePassword(u, nw); }),
    resetEmail: wrap(async email => { await Au.sendPasswordResetEmail(auth, email); }),
    setAppConfig: wrap(async patch => { await F.setDoc(dref('config', 'app'), patch, { merge: true }); }),
    getAppConfig: wrap(async () => { const s = await F.getDoc(dref('config', 'app')); return s.exists() ? s.data() : { signup: true }; }),
    watch(path, cb, opt = {}) { return F.onSnapshot(q(path, opt), s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))), e => { console.error(path, e); cb([]); }); },
    list: wrap(async (path, opt) => (await F.getDocs(q(path, opt))).docs.map(d => ({ id: d.id, ...d.data() }))),
    get: wrap(async (path, id) => { const s = await F.getDoc(dref(path, id)); return s.exists() ? { id, ...s.data() } : null; }),
    set: wrap(async (path, id, data) => { await F.setDoc(dref(path, id), data); }),
    update: wrap(async (path, id, patch) => { await F.setDoc(dref(path, id), patch, { merge: true }); }),
    add: wrap(async (path, data) => (await F.addDoc(cref(path), { ts: Date.now(), ...data })).id),
    del: wrap(async (path, id) => { await F.deleteDoc(dref(path, id)); }),
    delTree: wrap(async (path, id) => { for (const sub of ['tx', 'people']) { const l = await F.getDocs(cref(`${path}/${id}/${sub}`)); for (let i = 0; i < l.docs.length; i += 400) { const b = F.writeBatch(db); l.docs.slice(i, i + 400).forEach(d => b.delete(d.ref)); await b.commit(); } } await F.deleteDoc(dref(path, id)); }),
    batch: wrap(async ops => { for (let i = 0; i < ops.length; i += 400) { const b = F.writeBatch(db); ops.slice(i, i + 400).forEach(o => o.op === 'del' ? b.delete(dref(o.path, o.id)) : b.set(dref(o.path, o.id), o.data)); await b.commit(); } }),
  };
  return api;
}
export const loadData = async () => cloud ? cloudBackend() : localBackend();
