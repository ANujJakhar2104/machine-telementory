// Small DOM helpers. Every dynamic value goes through esc() before it reaches innerHTML.
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const dtf = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const df = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
export const fmtDateTime = (ms) => (ms ? dtf.format(new Date(ms)) : '—');
export const fmtDate = (ms) => (ms ? df.format(new Date(ms)) : '—');
export function ago(ms) {
  if (!ms) return '—';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${Math.max(s, 0)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return fmtDate(ms);
}
export const num = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toFixed(d));

const SEV = { CRITICAL: ['b-critical', '⛔'], WARNING: ['b-warning', '⚠'], INFO: ['b-info', 'ℹ'] };
export function sevBadge(s) {
  const [cls, ico] = SEV[s] || ['b-neutral', ''];
  return `<span class="badge ${cls}"><span aria-hidden="true">${ico}</span>${esc(s)}</span>`;
}
const ST = {
  OPEN: 'b-critical', ACKNOWLEDGED: 'b-warning', RESOLVED: 'b-ok', IN_PROGRESS: 'b-info', CLOSED: 'b-neutral',
  RUNNING: 'b-ok', IDLE: 'b-info', MAINTENANCE: 'b-warning', OFFLINE: 'b-neutral', NEW: 'b-warning', REVIEWED: 'b-ok',
  HIGH: 'b-critical', MEDIUM: 'b-warning', LOW: 'b-neutral',
};
export const statusBadge = (s) => `<span class="badge ${ST[s] || 'b-neutral'}">${esc(String(s).replace('_', ' '))}</span>`;
export const roleBadge = (r) => `<span class="badge role-${esc(r)}">${esc(r)}</span>`;

export function healthBand(score, status) {
  if (status === 'OFFLINE' || status === 'MAINTENANCE') return 'off';
  if (score >= 80) return 'good';
  if (score >= 60) return 'fair';
  if (score >= 40) return 'poor';
  return 'critical';
}
const BAND_LABEL = { good: 'Good', fair: 'Fair', poor: 'Poor', critical: 'Critical', off: 'N/A' };
export function healthBar(score, status) {
  const band = healthBand(score, status);
  return `<div class="health h-${band}" title="Health score"><span>Health</span><div class="bar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(score)}" aria-label="Health score"><i style="width:${Math.max(0, Math.min(100, score))}%"></i></div><b>${Math.round(score)}</b><span class="muted">${BAND_LABEL[band]}</span></div>`;
}

export function toast(title, msg = '', kind = '') {
  const box = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.setAttribute('role', kind === 'critical' ? 'alert' : 'status');
  t.innerHTML = `<b>${esc(title)}</b>${esc(msg)}`;
  box.appendChild(t);
  setTimeout(() => t.remove(), kind === 'critical' ? 9000 : 5000);
  while (box.children.length > 4) box.firstChild.remove();
}

/** Opens the shared <dialog>. `onSubmit(form)` may return false (or throw) to keep it open. */
export function modal({ title, body, submitLabel = 'Save', onSubmit, danger = false }) {
  const dlg = document.getElementById('modal');
  document.getElementById('modalTitle').textContent = title;
  const bodyEl = document.getElementById('modalBody');
  bodyEl.innerHTML = `<form id="modalForm" novalidate>${body}<div class="form-error" id="modalErr" hidden></div></form>`;
  const foot = document.getElementById('modalFoot');
  foot.innerHTML = `<button type="button" class="btn btn-light" data-close>Cancel</button>${onSubmit ? `<button type="submit" form="modalForm" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(submitLabel)}</button>` : ''}`;
  const form = document.getElementById('modalForm');
  const close = () => dlg.close();
  dlg.querySelectorAll('[data-close]').forEach((b) => { b.onclick = close; });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = document.getElementById('modalErr');
    err.hidden = true;
    const btn = foot.querySelector('[type=submit]');
    if (btn) btn.disabled = true;
    try {
      const keep = await onSubmit(form);
      if (keep !== false) close();
    } catch (ex) {
      err.innerHTML = esc(ex.message) + (ex.details ? `<ul>${ex.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : '');
      err.hidden = false;
    } finally {
      if (btn) btn.disabled = false;
    }
  };
  dlg.showModal();
  form.querySelector('input, select, textarea')?.focus();
}

export function formData(form) {
  const out = {};
  new FormData(form).forEach((v, k) => { if (v !== '') out[k] = v; });
  return out;
}

export function errorBox(e) {
  return `<div class="form-error" role="alert">${esc(e.message)}${e.details ? `<ul>${e.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}</div>`;
}

export function pageHead(title, crumbs = []) {
  return `<div class="page-head"><div class="container">
    <ol class="breadcrumb"><li><a href="#/">Home</a></li>${crumbs.map(([t, h]) => `<li>${h ? `<a href="${h}">${esc(t)}</a>` : esc(t)}</li>`).join('')}<li aria-current="page">${esc(title)}</li></ol>
    <h1>${esc(title)}</h1></div></div>`;
}
