// API client: keeps the short-lived access token in memory and silently refreshes it using the httpOnly cookie.
let accessToken = null;
let refreshing = null;
const listeners = new Set();

export const session = { user: null };

export function onSessionChange(fn) { listeners.add(fn); }
function notify() { listeners.forEach((fn) => fn(session.user)); }

// A non-secret hint so first-time visitors don't fire a pointless refresh call (the real session is the httpOnly cookie).
const HINT = 'sm_has_session';
function hint(on) { try { if (on) localStorage.setItem(HINT, '1'); else localStorage.removeItem(HINT); } catch { /* ignore */ } }
function hasHint() { try { return localStorage.getItem(HINT) === '1'; } catch { return true; } }

export function setSession(token, user) {
  accessToken = token;
  session.user = user;
  hint(!!user);
  notify();
}

export function getToken() { return accessToken; }

export function can(perm) { return !!session.user?.permissions?.includes(perm); }

export class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

async function refresh() {
  if (!refreshing) {
    refreshing = fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'same-origin' })
      .then(async (r) => {
        if (!r.ok) { setSession(null, null); return false; }
        const j = await r.json();
        setSession(j.accessToken, j.user);
        return true;
      })
      .catch(() => false)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

export async function tryRestoreSession() { return hasHint() ? refresh() : false; }

export async function api(path, { method = 'GET', body, raw = false, retry = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(`/api/v1${path}`, { method, headers, credentials: 'same-origin', body: body !== undefined ? JSON.stringify(body) : undefined });
  if (res.status === 401 && retry && !path.startsWith('/auth/login')) {
    if (await refresh()) return api(path, { method, body, raw, retry: false });
  }
  if (raw) {
    if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).error || res.statusText);
    return res;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || res.statusText, data.details);
  return data;
}

export async function logout() {
  await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  setSession(null, null);
}

export async function download(path) {
  const res = await api(path, { raw: true });
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] || 'export.csv';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
