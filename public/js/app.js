import { api, session, setSession, onSessionChange, tryRestoreSession, logout, getToken, can } from './api.js';
import { $, $$, esc, toast, roleBadge, fmtDateTime } from './ui.js';
import { applyI18n, initLang, setLang, t } from './i18n.js';
import * as pub from './pages/public.js';
import * as portal from './pages/portal.js';

// ---------- Live event bus (Socket.IO -> current page) ----------
const handlers = new Map();
export function onLive(event, fn) {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event).add(fn);
}
function clearLive() { handlers.clear(); }
function dispatch(event, data) { handlers.get(event)?.forEach((fn) => { try { fn(data); } catch (e) { console.error(`live handler ${event}: ${e.stack || e}`); } }); }

let socket = null;
export const liveState = { connected: false };
function connectSocket() {
  if (socket || typeof io === 'undefined') return;
  // eslint-disable-next-line no-undef
  socket = io({ auth: (cb) => cb({ token: getToken() }), transports: ['websocket', 'polling'] });
  socket.on('connect', () => { liveState.connected = true; dispatch('live:status', true); });
  socket.on('disconnect', () => { liveState.connected = false; dispatch('live:status', false); });
  socket.on('connect_error', async (err) => {
    if (err.message === 'unauthorized' && session.user) {
      if (await tryRestoreSession()) setTimeout(() => socket?.connect(), 500);
    }
  });
  for (const ev of ['machine:update', 'alert:new', 'alert:update', 'ticket:update']) socket.on(ev, (d) => dispatch(ev, d));
  socket.on('alert:new', (a) => {
    if (a.severity === 'CRITICAL') toast(`Critical alert · ${a.machine_code}`, a.message, 'critical');
    else if (a.severity === 'WARNING') toast(`Warning · ${a.machine_code}`, a.message, 'warning');
  });
}
function disconnectSocket() { socket?.disconnect(); socket = null; liveState.connected = false; }

// ---------- Routes ----------
const routes = [
  ['/', pub.home], ['/about', pub.about], ['/project', pub.project], ['/architecture', pub.architecture],
  ['/technology', pub.technology], ['/access', pub.access], ['/sitemap', pub.sitemap], ['/help', pub.help],
  ['/policies', pub.policies], ['/feedback', pub.feedback], ['/login', pub.login],
  ['/portal', portal.dashboard, 'dashboard:view'],
  ['/portal/machines', portal.machines, 'machines:view'],
  ['/portal/machines/:id', portal.machineDetail, 'machines:view'],
  ['/portal/alerts', portal.alerts, 'alerts:view'],
  ['/portal/tickets', portal.tickets, 'tickets:view'],
  ['/portal/rules', portal.rules, 'rules:view'],
  ['/portal/reports', portal.reports, 'reports:view'],
  ['/portal/users', portal.users, 'users:manage'],
  ['/portal/audit', portal.audit, 'audit:view'],
  ['/portal/notices', portal.notices, 'notices:manage'],
  ['/portal/feedback', portal.feedbackInbox, 'feedback:view'],
  ['/portal/system', portal.system, 'audit:view'],
  ['/portal/profile', portal.profile, null],
];

function match(path) {
  for (const [pattern, view, perm] of routes) {
    const names = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; })}/?$`);
    const m = re.exec(path);
    if (m) return { view, perm, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])), portal: pattern.startsWith('/portal') };
  }
  return null;
}

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [pathAndQuery, anchor] = raw.split('#');
  const [path, qs] = pathAndQuery.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs || '')), anchor };
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  clearLive();
  portal.teardown();
  const { path, query, anchor } = parseHash();
  const main = $('#main');
  const r = match(path);
  $('#navList').classList.remove('open');
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === path || (a.dataset.nav !== '/' && path.startsWith(a.dataset.nav))));

  if (!r) { main.innerHTML = pub.notFound(); applyI18n(main); return; }
  if (r.portal) {
    if (!session.user) { location.replace(`#/login?next=${encodeURIComponent(path)}`); return; }
    if (r.perm && !can(r.perm)) { main.innerHTML = portal.shell(path, portal.denied()); applyI18n(main); return; }
    main.innerHTML = portal.shell(path, '<div class="empty"><span class="loader"></span> Loading…</div>');
    const content = $('#portalContent');
    try {
      // Ignore handler registrations from a view that finished loading after the user navigated away.
      const scopedOnLive = (ev, fn) => { if (seq === renderSeq) onLive(ev, fn); };
      await r.view(content, { params: r.params, query, onLive: scopedOnLive, liveState });
    } catch (e) {
      if (seq === renderSeq) content.innerHTML = `<div class="form-error">${esc(e.message)}</div>`;
    }
  } else {
    if (path === '/login' && session.user) { location.replace(`#${query.next || '/portal'}`); return; }
    try {
      await r.view(main, { params: r.params, query });
    } catch (e) {
      main.innerHTML = `<div class="container section"><div class="form-error">${esc(e.message)}</div></div>`;
    }
  }
  if (seq !== renderSeq) return;
  applyI18n(main);
  document.title = `${(main.querySelector('h1')?.textContent || 'Home').trim()} | SM Engineers Telemetry Portal`;
  if (anchor) document.getElementById(anchor)?.scrollIntoView();
  else window.scrollTo(0, 0);
}

// ---------- Chrome: header, nav CTA, ticker, footer ----------
function renderChrome() {
  const u = session.user;
  const right = $('#headerRight');
  const cta = $('#navCta');
  if (u) {
    right.innerHTML = `<div class="user-chip">
      <div class="avatar" aria-hidden="true">${esc(u.name.split(' ').map((p) => p[0]).slice(0, 2).join(''))}</div>
      <div class="meta"><b>${esc(u.name)}</b> ${roleBadge(u.role)}<small>Last login: ${u.last_login_at ? esc(fmtDateTime(u.last_login_at)) : 'First login'}</small></div>
      <button class="btn btn-light btn-sm" id="logoutBtn" data-i18n="logout">Logout</button></div>`;
    cta.innerHTML = `<a href="#/portal" data-i18n="portal">My Dashboard</a>`;
    $('#logoutBtn').onclick = async () => { await logout(); toast('Logged out', 'You have been signed out securely.', 'ok'); location.hash = '#/login'; };
  } else {
    const now = new Date();
    right.innerHTML = `<div class="header-badge"><div><strong>${esc(now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</strong>Shop-floor monitoring · 24 × 7</div></div>`;
    cta.innerHTML = `<a href="#/login" data-i18n="login">Staff Login</a>`;
  }
  applyI18n($('.site-header'));
  applyI18n(cta);
}

async function loadTicker() {
  try {
    const { data } = await api('/public/notices');
    $('#tickerInner').innerHTML = data.map((n) => `<span>${esc(n.title)}</span>`).join('') || '<span>Welcome to the SM Engineers telemetry portal.</span>';
  } catch { $('#tickerInner').innerHTML = '<span>Welcome to the SM Engineers telemetry portal.</span>'; }
}
export { loadTicker };

async function countVisit() {
  try {
    let counted = false;
    try { counted = sessionStorage.getItem('sm_visited') === '1'; } catch { /* ignore */ }
    const r = counted ? (await api('/public/stats')).data : await api('/public/visit', { method: 'POST' });
    try { sessionStorage.setItem('sm_visited', '1'); } catch { /* ignore */ }
    $('#visitors').innerHTML = String(r.visitors).padStart(6, '0').split('').map((d) => `<b>${d}</b>`).join('');
  } catch { /* non-critical */ }
}

function initA11y() {
  const root = document.documentElement;
  const saved = (() => { try { return JSON.parse(localStorage.getItem('sm_a11y') || '{}'); } catch { return {}; } })();
  const save = () => { try { localStorage.setItem('sm_a11y', JSON.stringify(saved)); } catch { /* ignore */ } };
  const applyFs = () => { root.classList.remove('fs-sm', 'fs-lg'); if (saved.fs && saved.fs !== 'md') root.classList.add(`fs-${saved.fs}`); };
  const applyHc = () => { root.classList.toggle('hc', !!saved.hc); $('#contrastBtn').setAttribute('aria-pressed', String(!!saved.hc)); };
  applyFs(); applyHc();
  $$('[data-fs]').forEach((b) => { b.onclick = () => { saved.fs = b.dataset.fs; applyFs(); save(); }; });
  $('#contrastBtn').onclick = () => { saved.hc = !saved.hc; applyHc(); save(); };

  const sel = $('#langSelect');
  sel.value = initLang();
  sel.onchange = () => { setLang(sel.value); render(); };

  $('#navToggle').onclick = () => {
    const open = $('#navList').classList.toggle('open');
    $('#navToggle').setAttribute('aria-expanded', String(open));
  };
  $$('.nav-list .dd').forEach((b) => {
    b.onclick = () => { const li = b.parentElement; const open = li.classList.toggle('open'); b.setAttribute('aria-expanded', String(open)); };
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.nav-list li')) $$('.nav-list li.open').forEach((li) => li.classList.remove('open'));
  });
  $('#tickerPause').onclick = () => {
    const p = $('#ticker').classList.toggle('paused');
    $('#tickerPause').setAttribute('aria-pressed', String(p));
    $('#tickerPause').innerHTML = `${p ? '▶' : '❚❚'} <span class="sr-only">${p ? 'Play' : 'Pause'} ticker</span>`;
  };
  $('#year').textContent = new Date().getFullYear();
  $('#lastUpdated').textContent = new Date(document.lastModified).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Automatic sign-out after inactivity (session security).
function initIdleTimer() {
  const LIMIT = 20 * 60 * 1000;
  let last = Date.now();
  ['click', 'keydown', 'mousemove', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => { last = Date.now(); }, { passive: true }));
  setInterval(async () => {
    if (session.user && Date.now() - last > LIMIT) {
      await logout();
      toast('Session timed out', 'You were signed out after 20 minutes of inactivity.', 'warning');
      location.hash = '#/login';
    }
  }, 30000);
}

onSessionChange((u) => {
  renderChrome();
  if (u) connectSocket(); else disconnectSocket();
});

window.addEventListener('hashchange', render);
window.addEventListener('notices:changed', loadTicker);

(async function boot() {
  initA11y();
  applyI18n();
  renderChrome();
  loadTicker();
  countVisit();
  initIdleTimer();
  await tryRestoreSession();
  await render();
}());

export { render, setSession, t };
