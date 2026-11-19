import { api, can, session, download, setSession } from '../api.js';
import {
  $, $$, esc, fmtDateTime, ago, num, sevBadge, statusBadge, roleBadge, healthBar, healthBand, toast, modal, formData, errorBox,
} from '../ui.js';

// ---------- Shell (sidebar menu driven by permissions) ----------
const MENU = [
  ['Monitoring', [
    ['/portal', '📊', 'Dashboard', 'dashboard:view'],
    ['/portal/machines', '⚙️', 'Machines', 'machines:view'],
    ['/portal/alerts', '🚨', 'Alerts', 'alerts:view'],
    ['/portal/tickets', '🛠️', 'Maintenance Tickets', 'tickets:view'],
    ['/portal/reports', '📄', 'Reports', 'reports:view'],
  ]],
  ['Configuration', [
    ['/portal/rules', '🎚️', 'Alert Rules', 'rules:view'],
  ]],
  ['Administration', [
    ['/portal/users', '👥', 'User Management', 'users:manage'],
    ['/portal/notices', '📢', 'Notices', 'notices:manage'],
    ['/portal/feedback', '✉️', 'Feedback Inbox', 'feedback:view'],
    ['/portal/audit', '🧾', 'Audit Trail', 'audit:view'],
    ['/portal/system', '🖥️', 'System Status', 'audit:view'],
  ]],
  ['Account', [
    ['/portal/profile', '👤', 'My Profile', null],
  ]],
];

export function shell(path, inner) {
  const nav = MENU.map(([group, items]) => {
    const visible = items.filter(([, , , p]) => !p || can(p));
    if (!visible.length) return '';
    return `<h4>${group}</h4>${visible.map(([href, ico, label]) => {
      const active = href === path || (href !== '/portal' && path.startsWith(`${href}/`));
      return `<a href="#${href}" class="${active ? 'active' : ''}" ${active ? 'aria-current="page"' : ''}><span class="s-ico" aria-hidden="true">${ico}</span>${label}${href === '/portal/alerts' ? '<span class="count" id="alertCount" hidden></span>' : ''}</a>`;
    }).join('')}`;
  }).join('');
  setTimeout(refreshAlertCount, 0);
  return `<div class="container"><div class="portal">
    <aside class="sidebar" id="sidebar" aria-label="Portal menu">${nav}</aside>
    <div class="portal-main"><button class="btn btn-light btn-sm sidebar-toggle" id="sidebarToggle" aria-controls="sidebar" aria-expanded="false" style="margin-bottom:10px">☰ Portal menu</button>
      <div id="portalContent">${inner}</div></div>
  </div></div>`;
}

document.addEventListener('click', (e) => {
  if (e.target.id === 'sidebarToggle') {
    const open = $('#sidebar').classList.toggle('open');
    e.target.setAttribute('aria-expanded', String(open));
  }
});

async function refreshAlertCount() {
  const el = $('#alertCount');
  if (!el || !can('alerts:view')) return;
  try {
    const r = await api('/alerts?status=OPEN&limit=1');
    el.textContent = r.total; el.hidden = !r.total;
  } catch { /* ignore */ }
}

const charts = [];
const timers = [];
export function teardown() {
  while (charts.length) charts.pop().destroy();
  while (timers.length) clearInterval(timers.pop());
}

const title = (t, actions = '', live = false) => `<div class="page-title"><div><ol class="breadcrumb"><li><a href="#/">Home</a></li><li><a href="#/portal">Portal</a></li><li aria-current="page">${esc(t)}</li></ol><h1>${esc(t)}</h1></div><div class="btn-row">${live ? '<span class="live-dot" id="liveDot">Live</span>' : ''}${actions}</div></div>`;

function bindLiveDot(ctx) {
  const set = (on) => { const d = $('#liveDot'); if (d) { d.classList.toggle('on', on); d.textContent = on ? 'Live' : 'Reconnecting…'; } };
  set(ctx.liveState.connected);
  ctx.onLive('live:status', set);
}

export function denied() {
  return `<div class="card" style="border-left:5px solid var(--crit)"><h1>403 — Access Denied</h1>
    <p>Your role <b>${esc(session.user?.role)}</b> does not have permission to open this page.</p>
    <p class="muted small">If you need access, contact the portal Administrator. See <a href="#/access">Roles &amp; Access Control</a>.</p>
    <a class="btn btn-primary" href="#/portal">Back to Dashboard</a></div>`;
}

const SENSOR_LABEL = { temperature: 'Temp', vibration: 'Vibration', load: 'Load' };
const UNITS = { temperature: '°C', vibration: 'mm/s', load: '%' };

function machineCard(m) {
  const band = healthBand(m.health_score, m.status);
  const v = (type, d) => {
    const l = m.latest?.[type];
    return `<div><b data-v="${type}">${l ? num(l.value, d) : '—'}</b><span>${SENSOR_LABEL[type]} ${UNITS[type]}</span></div>`;
  };
  return `<a class="machine-card h-${band}" href="#/portal/machines/${m.id}" data-mid="${m.id}">
    <div class="mc-head"><div><div class="mc-code">${esc(m.machine_code)}</div><div class="mc-sub">${esc(m.name)} · ${esc(m.location)}</div></div>
    <div data-status>${statusBadge(m.status)}</div></div>
    <div class="mc-vals">${v('temperature', 1)}${v('vibration', 2)}${v('load', 0)}</div>
    <div data-health>${healthBar(m.health_score, m.status)}</div>
    <div class="small muted" style="margin-top:6px"><span data-alerts>${m.open_alerts ? `<span class="badge b-critical">${m.open_alerts} open alert${m.open_alerts > 1 ? 's' : ''}</span>` : '<span class="badge b-ok">No open alerts</span>'}</span> <span data-ts style="float:right">${m.latest?.load ? ago(m.latest.load.ts) : 'No data'}</span></div>
  </a>`;
}

function applyMachineUpdate(u) {
  const card = $(`.machine-card[data-mid="${u.machine_id}"]`);
  if (!card) return;
  if (u.values) {
    for (const [type, val] of Object.entries(u.values)) {
      const el = card.querySelector(`[data-v="${type}"]`);
      if (el) el.textContent = num(val, type === 'load' ? 0 : type === 'vibration' ? 2 : 1);
    }
    card.querySelector('[data-ts]').textContent = 'just now';
  }
  if (u.health_score !== undefined) {
    card.querySelector('[data-health]').innerHTML = healthBar(u.health_score, u.status);
    card.className = `machine-card h-${healthBand(u.health_score, u.status)}`;
  }
}

// ---------- Dashboard ----------
export async function dashboard(el, ctx) {
  const [{ data: d }, { data: machines }, alerts] = await Promise.all([api('/dashboard'), api('/machines'), api('/alerts?limit=8')]);
  const open = Object.fromEntries(d.open_alerts.map((a) => [a.severity, a.n]));
  const running = d.by_status.find((s) => s.status === 'RUNNING')?.n || 0;
  el.innerHTML = `${title(`Dashboard`, can('simulator:control') ? '<a class="btn btn-light btn-sm" href="#/portal/machines">Simulate a fault →</a>' : '', true)}
    <p class="muted small" style="margin-top:-8px">Welcome, <b>${esc(session.user.name)}</b>. You are signed in as ${roleBadge(session.user.role)}.</p>
    <div class="grid g4" style="margin-bottom:18px">
      <div class="kpi"><div class="k-label">Machines</div><div class="k-value">${d.machines}</div><div class="k-sub">${running} running</div></div>
      <div class="kpi ${d.avg_health < 60 ? 'warn' : 'ok'}"><div class="k-label">Average health</div><div class="k-value" id="kpiHealth">${num(d.avg_health, 0)}</div><div class="k-sub">out of 100</div></div>
      <div class="kpi ${open.CRITICAL ? 'crit' : 'ok'}"><div class="k-label">Open alerts</div><div class="k-value" id="kpiAlerts">${(open.CRITICAL || 0) + (open.WARNING || 0) + (open.INFO || 0)}</div><div class="k-sub">${open.CRITICAL || 0} critical · ${open.WARNING || 0} warning · ${open.INFO || 0} info</div></div>
      <div class="kpi"><div class="k-label">Open tickets</div><div class="k-value">${d.open_tickets}</div><div class="k-sub">${d.readings_24h.toLocaleString('en-IN')} readings in 24 h</div></div>
    </div>
    <div class="card-head"><h2>Machine status</h2><span class="small muted">Values update live every 2 seconds</span></div>
    <div class="machine-grid" id="machineGrid">${machines.map(machineCard).join('')}</div>
    <div class="grid g2" style="margin-top:18px">
      <div class="card"><div class="card-head"><h3>Latest alerts</h3><a href="#/portal/alerts" class="small">View all →</a></div>
        <div class="table-wrap"><table><thead><tr><th>Time</th><th>Machine</th><th>Level</th><th>Message</th></tr></thead><tbody id="latestAlerts">
        ${alerts.data.map((a) => `<tr><td class="small">${ago(a.raised_at)}</td><td>${esc(a.machine_code)}</td><td>${sevBadge(a.severity)}</td><td class="small">${esc(a.message)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No alerts yet</td></tr>'}
        </tbody></table></div></div>
      <div class="card"><div class="card-head"><h3>Alerts raised per hour (last 24 h)</h3></div><div class="chart-box"><canvas id="alertsChart" aria-label="Alerts per hour by level" role="img"></canvas></div></div>
    </div>`;
  bindLiveDot(ctx);
  ctx.onLive('machine:update', applyMachineUpdate);
  ctx.onLive('alert:new', (a) => {
    const tb = $('#latestAlerts');
    if (!tb) return;
    if (tb.querySelector('.empty')) tb.innerHTML = '';
    tb.insertAdjacentHTML('afterbegin', `<tr class="flash"><td class="small">just now</td><td>${esc(a.machine_code)}</td><td>${sevBadge(a.severity)}</td><td class="small">${esc(a.message)}</td></tr>`);
    while (tb.children.length > 8) tb.lastElementChild.remove();
    const k = $('#kpiAlerts'); if (k) k.textContent = Number(k.textContent) + 1;
    refreshAlertCount();
  });
  timers.push(setInterval(async () => {
    try { const { data } = await api('/dashboard'); const k = $('#kpiHealth'); if (k) k.textContent = num(data.avg_health, 0); } catch { /* ignore */ }
  }, 15000));

  // Hourly bar chart, stacked by severity. One axis; status colours carry the same meaning as the badges and a legend names them.
  const hours = [];
  const now = Math.floor(Date.now() / 3600000) * 3600000;
  for (let h = now - 23 * 3600000; h <= now; h += 3600000) hours.push(h);
  const series = (sev) => hours.map((h) => d.alerts_by_hour.find((r) => r.hour === h && r.severity === sev)?.n || 0);
  drawBar('alertsChart', hours.map((h) => new Date(h).toLocaleTimeString('en-IN', { hour: '2-digit', hour12: false })), [
    { label: 'Critical', data: series('CRITICAL'), backgroundColor: '#b3261e' },
    { label: 'Warning', data: series('WARNING'), backgroundColor: '#d98e04' },
    { label: 'Info', data: series('INFO'), backgroundColor: '#5b8fd1' },
  ]);
}

function drawBar(id, labels, datasets) {
  const cv = document.getElementById(id);
  if (!cv || typeof Chart === 'undefined') return;
  // eslint-disable-next-line no-undef
  charts.push(new Chart(cv, {
    type: 'bar',
    data: { labels, datasets: datasets.map((ds) => ({ ...ds, borderRadius: 3, borderSkipped: 'start', borderWidth: 0, maxBarThickness: 18 })) },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, color: '#3a4656' } }, tooltip: { mode: 'index', intersect: false } },
      scales: { x: { stacked: true, grid: { display: false }, ticks: { color: '#586579', maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
        y: { stacked: true, beginAtZero: true, ticks: { precision: 0, color: '#586579' }, grid: { color: '#e9edf2' } } },
    },
  }));
}

// ---------- Machines ----------
const machineFields = (m = {}) => `<div class="form-grid">
  <div class="field"><label for="f_code">Machine code <span class="req">*</span></label><input id="f_code" name="machine_code" required value="${esc(m.machine_code || '')}" placeholder="CNC-07" pattern="[A-Z0-9-]{2,20}"><small>Capital letters, digits and “-”</small></div>
  <div class="field"><label for="f_name">Name <span class="req">*</span></label><input id="f_name" name="name" required value="${esc(m.name || '')}"></div>
  <div class="field"><label for="f_type">Type <span class="req">*</span></label><input id="f_type" name="type" required value="${esc(m.type || '')}" placeholder="CNC Lathe"></div>
  <div class="field"><label for="f_loc">Location <span class="req">*</span></label><input id="f_loc" name="location" required value="${esc(m.location || '')}" placeholder="Shop A · Bay 4"></div>
  <div class="field"><label for="f_status">Status</label><select id="f_status" name="status">${['RUNNING', 'IDLE', 'MAINTENANCE', 'OFFLINE'].map((s) => `<option ${m.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
</div>`;

export async function machines(el, ctx) {
  const { data } = await api('/machines');
  const manage = can('machines:manage');
  el.innerHTML = `${title('Machines', manage ? '<button class="btn btn-primary btn-sm" id="addMachine">+ Add machine</button>' : '', true)}
    <div class="table-wrap"><table><caption class="sr-only">Machines</caption><thead><tr><th>Code</th><th>Name / Type</th><th>Location</th><th>Status</th><th class="num">Temp °C</th><th class="num">Vib mm/s</th><th class="num">Load %</th><th>Health</th><th class="num">Open alerts</th><th>Actions</th></tr></thead>
    <tbody>${data.map((m) => `<tr data-mid="${m.id}">
      <td><a href="#/portal/machines/${m.id}"><b>${esc(m.machine_code)}</b></a></td><td>${esc(m.name)}<div class="small muted">${esc(m.type)}</div></td><td>${esc(m.location)}</td>
      <td>${statusBadge(m.status)}</td>
      <td class="num" data-v="temperature">${num(m.latest?.temperature?.value, 1)}</td><td class="num" data-v="vibration">${num(m.latest?.vibration?.value, 2)}</td><td class="num" data-v="load">${num(m.latest?.load?.value, 0)}</td>
      <td style="min-width:170px" data-health>${healthBar(m.health_score, m.status)}</td><td class="num">${m.open_alerts}</td>
      <td><div class="btn-row"><a class="btn btn-light btn-sm" href="#/portal/machines/${m.id}">View</a>
        ${can('simulator:control') && ['RUNNING', 'IDLE'].includes(m.status) ? `<button class="btn btn-light btn-sm" data-fault="${m.id}" title="Demo: start a gradual fault">⚡ Fault</button>` : ''}
        ${manage ? `<button class="btn btn-light btn-sm" data-edit="${m.id}">Edit</button><button class="btn btn-light btn-sm" data-del="${m.id}">Delete</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>
    ${can('simulator:control') ? '<p class="small muted" style="margin-top:10px">⚡ <b>Fault</b> starts a realistic degradation on the built-in simulator (vibration or temperature ramps up over ~45 s). Watch the z-score warning arrive before the hard limit is crossed.</p>' : ''}`;
  bindLiveDot(ctx);
  ctx.onLive('machine:update', (u) => {
    const tr = $(`tr[data-mid="${u.machine_id}"]`);
    if (!tr) return;
    if (u.values) for (const [k, v] of Object.entries(u.values)) { const c = tr.querySelector(`[data-v="${k}"]`); if (c) c.textContent = num(v, k === 'load' ? 0 : k === 'vibration' ? 2 : 1); }
    if (u.health_score !== undefined) tr.querySelector('[data-health]').innerHTML = healthBar(u.health_score, u.status);
  });
  const reload = () => machines(el, ctx);
  $('#addMachine')?.addEventListener('click', () => modal({ title: 'Add machine', body: machineFields(), submitLabel: 'Create',
    onSubmit: async (f) => { await api('/machines', { method: 'POST', body: formData(f) }); toast('Machine created', 'Sensors and default alert rules were added.', 'ok'); reload(); } }));
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    const m = data.find((x) => x.id === Number(b.dataset.edit));
    modal({ title: `Edit ${m.machine_code}`, body: machineFields(m), onSubmit: async (f) => { await api(`/machines/${m.id}`, { method: 'PATCH', body: formData(f) }); toast('Machine updated', '', 'ok'); reload(); } });
  }));
  $$('[data-del]').forEach((b) => b.addEventListener('click', () => {
    const m = data.find((x) => x.id === Number(b.dataset.del));
    modal({ title: 'Delete machine', danger: true, submitLabel: 'Delete permanently', body: `<p>Delete <b>${esc(m.machine_code)}</b> and all its sensors, readings, alerts and tickets? This cannot be undone.</p>`,
      onSubmit: async () => { await api(`/machines/${m.id}`, { method: 'DELETE' }); toast('Machine deleted', m.machine_code, 'ok'); reload(); } });
  }));
  $$('[data-fault]').forEach((b) => b.addEventListener('click', () => {
    const m = data.find((x) => x.id === Number(b.dataset.fault));
    modal({ title: `Simulate fault on ${m.machine_code}`, submitLabel: 'Start fault',
      body: '<div class="field"><label for="f_sensor">Sensor to degrade</label><select id="f_sensor" name="sensor"><option value="vibration">Vibration (bearing wear)</option><option value="temperature">Temperature (coolant failure)</option></select></div>',
      onSubmit: async (f) => { await api(`/machines/${m.id}/simulate-fault`, { method: 'POST', body: formData(f) }); toast('Fault started', `Open ${m.machine_code} to watch it live.`, 'ok'); location.hash = `#/portal/machines/${m.id}`; } });
  }));
}

// ---------- Machine detail with live charts (one chart per sensor: single series, single axis) ----------
export async function machineDetail(el, ctx) {
  const id = Number(ctx.params.id);
  const minutes = Number(ctx.query.minutes) || 15;
  const [{ data: m }, { data: hist }, alerts, health] = await Promise.all([
    api(`/machines/${id}`), api(`/machines/${id}/readings?minutes=${minutes}`), api(`/alerts?machineId=${id}&limit=10`), api(`/machines/${id}/health`),
  ]);
  const ranges = [[15, '15 min'], [60, '1 hour'], [360, '6 hours'], [1440, '24 hours'], [10080, '7 days']];
  el.innerHTML = `${title(`${m.machine_code} — ${m.name}`, `${can('simulator:control') && ['RUNNING', 'IDLE'].includes(m.status) ? '<button class="btn btn-light btn-sm" id="faultBtn">⚡ Simulate fault</button>' : ''}${can('tickets:create') ? '<button class="btn btn-primary btn-sm" id="newTicket">+ Raise ticket</button>' : ''}`, true)}
    <div class="grid g3" style="margin-bottom:16px">
      <div class="card"><dl class="kv"><dt>Type</dt><dd>${esc(m.type)}</dd><dt>Location</dt><dd>${esc(m.location)}</dd><dt>Status</dt><dd>${statusBadge(m.status)}</dd><dt>Registered</dt><dd>${fmtDateTime(m.created_at)}</dd></dl></div>
      <div class="card"><h3>Health score</h3><div id="detailHealth">${healthBar(health.data.health_score, m.status)}</div>
        <p class="small muted" style="margin-top:8px">Band: <b>${esc(health.data.band)}</b>. Open alerts lower the score (critical −30, warning −12, info −3; halved once acknowledged), and so do abnormal live readings.</p></div>
      <div class="card"><h3>Latest values</h3><div class="machine-card" style="border:0;box-shadow:none;padding:0"><div class="mc-vals">${['temperature', 'vibration', 'load'].map((t) => `<div><b data-v="${t}">${num(m.latest?.[t]?.value, t === 'load' ? 0 : t === 'vibration' ? 2 : 1)}</b><span>${SENSOR_LABEL[t]} ${UNITS[t]}</span></div>`).join('')}</div></div>
        <p class="small muted" style="margin-top:8px">z-score: <span id="zinfo">${['temperature', 'vibration', 'load'].map((t) => `${SENSOR_LABEL[t]} ${m.latest?.[t]?.z != null ? num(m.latest[t].z, 1) : '—'}`).join(' · ')}</span></p></div>
    </div>
    <div class="filters" role="group" aria-label="Time range"><span class="small muted">Time range:</span>${ranges.map(([v, l]) => `<a class="btn btn-sm ${v === minutes ? 'btn-primary' : 'btn-light'}" href="#/portal/machines/${id}?minutes=${v}">${l}</a>`).join('')}
      <span class="small muted">${hist.resolution === 'hourly' ? 'Hourly averages' : 'Raw readings'}${minutes <= 60 ? ' · live' : ''}</span></div>
    <div class="grid g3">${hist.series.map((s) => `<div class="card"><div class="card-head"><h3>${esc(s.type[0].toUpperCase() + s.type.slice(1))} (${esc(s.unit)})</h3><span class="small muted">limit ${s.max_val}</span></div><div class="chart-box"><canvas id="ch_${s.type}" role="img" aria-label="${esc(s.type)} over time"></canvas></div></div>`).join('')}</div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h3>Recent alerts for this machine</h3><a class="small" href="#/portal/alerts">All alerts →</a></div>
      <div class="table-wrap"><table><thead><tr><th>Raised</th><th>Level</th><th>Status</th><th>Message</th></tr></thead><tbody id="mAlerts">${alerts.data.map((a) => `<tr><td class="small">${fmtDateTime(a.raised_at)}</td><td>${sevBadge(a.severity)}</td><td>${statusBadge(a.status)}</td><td class="small">${esc(a.message)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No alerts</td></tr>'}</tbody></table></div></div>`;
  bindLiveDot(ctx);

  const live = minutes <= 60;
  const chartBy = {};
  for (const s of hist.series) {
    const cv = document.getElementById(`ch_${s.type}`);
    if (!cv || typeof Chart === 'undefined') continue;
    const fmt = minutes > 1440 ? { day: '2-digit', month: 'short', hour: '2-digit' } : { hour: '2-digit', minute: '2-digit' };
    const labels = s.points.map((p) => new Date(p.t).toLocaleString('en-IN', fmt));
    // eslint-disable-next-line no-undef
    const chart = new Chart(cv, {
      type: 'line',
      data: { labels, datasets: [
        { label: s.type, data: s.points.map((p) => p.v), borderColor: '#1d4580', backgroundColor: 'rgba(29,69,128,.08)', borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, fill: true, tension: 0.25 },
        { label: 'Hard limit', data: s.points.map(() => s.max_val), borderColor: '#b3261e', borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, fill: false },
      ] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${Number(c.parsed.y).toFixed(2)} ${s.unit}` } } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0, color: '#586579' } },
          y: { grid: { color: '#e9edf2' }, ticks: { color: '#586579' }, suggestedMin: s.min_val, suggestedMax: s.max_val * 1.1 } },
      },
    });
    charts.push(chart);
    chartBy[s.type] = { chart, max: s.max_val };
  }

  ctx.onLive('machine:update', (u) => {
    if (u.machine_id !== id) return;
    if (!$('#detailHealth')) return;
    if (u.health_score !== undefined) $('#detailHealth').innerHTML = healthBar(u.health_score, u.status);
    if (!u.values) return;
    for (const [type, v] of Object.entries(u.values)) {
      const b = el.querySelector(`[data-v="${type}"]`);
      if (b) b.textContent = num(v, type === 'load' ? 0 : type === 'vibration' ? 2 : 1);
      const c = chartBy[type];
      if (live && c) {
        const ch = c.chart;
        ch.data.labels.push(new Date(u.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
        ch.data.datasets[0].data.push(v);
        ch.data.datasets[1].data.push(c.max);
        const cutoff = (minutes * 60000) / 2000;
        while (ch.data.labels.length > cutoff) { ch.data.labels.shift(); ch.data.datasets.forEach((d) => d.data.shift()); }
        ch.update('none');
      }
    }
  });
  timers.push(setInterval(async () => {
    try {
      const { data } = await api(`/machines/${id}/latest`);
      const z = $('#zinfo');
      if (z) z.textContent = ['temperature', 'vibration', 'load'].map((t) => `${SENSOR_LABEL[t]} ${data[t]?.z != null ? num(data[t].z, 1) : '—'}`).join(' · ');
    } catch { /* ignore */ }
  }, 4000));
  ctx.onLive('alert:new', (a) => {
    if (a.machine_id !== id) return;
    const tb = $('#mAlerts');
    if (!tb) return;
    if (tb.querySelector('.empty')) tb.innerHTML = '';
    tb.insertAdjacentHTML('afterbegin', `<tr class="flash"><td class="small">${fmtDateTime(a.raised_at)}</td><td>${sevBadge(a.severity)}</td><td>${statusBadge(a.status)}</td><td class="small">${esc(a.message)}</td></tr>`);
  });

  $('#faultBtn')?.addEventListener('click', async () => {
    await api(`/machines/${id}/simulate-fault`, { method: 'POST', body: { sensor: 'vibration' } });
    toast('Fault started', 'Vibration will ramp up over ~45 seconds.', 'ok');
  });
  $('#newTicket')?.addEventListener('click', () => ticketModal({ machine_id: id }));
}

// ---------- Alerts ----------
export async function alerts(el, ctx) {
  const q = ctx.query;
  const page = Number(q.page) || 1;
  const params = new URLSearchParams({ page, limit: 25, ...(q.status ? { status: q.status } : {}), ...(q.severity ? { severity: q.severity } : {}) });
  const r = await api(`/alerts?${params}`);
  const ack = can('alerts:ack');
  const sel = (name, opts, cur) => `<div class="field"><label for="flt_${name}">${name[0].toUpperCase() + name.slice(1)}</label><select id="flt_${name}" data-filter="${name}"><option value="">All</option>${opts.map((o) => `<option ${o === cur ? 'selected' : ''}>${o}</option>`).join('')}</select></div>`;
  el.innerHTML = `${title('Alerts', '', true)}
    <div class="filters">${sel('status', ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'], q.status)}${sel('severity', ['CRITICAL', 'WARNING', 'INFO'], q.severity)}</div>
    <div class="table-wrap"><table><caption class="sr-only">Alerts</caption><thead><tr><th>#</th><th>Raised</th><th>Machine</th><th>Level</th><th>Message</th><th>Status</th><th>Handled by</th>${ack || can('tickets:create') ? '<th>Actions</th>' : ''}</tr></thead>
    <tbody id="alertRows">${r.data.map((a) => alertRow(a, ack)).join('') || '<tr><td colspan="8" class="empty">No alerts match the filter</td></tr>'}</tbody></table></div>
    <div class="pager"><span>Page ${r.page} of ${Math.max(1, Math.ceil(r.total / r.limit))} · ${r.total} alerts</span>
      <button class="btn btn-light btn-sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹ Prev</button><button class="btn btn-light btn-sm" data-page="${page + 1}" ${page * r.limit >= r.total ? 'disabled' : ''}>Next ›</button></div>`;
  bindLiveDot(ctx);
  const go = (patch) => { const p = { ...q, ...patch }; Object.keys(p).forEach((k) => !p[k] && delete p[k]); location.hash = `#/portal/alerts?${new URLSearchParams(p)}`; };
  $$('[data-filter]').forEach((s) => s.addEventListener('change', () => go({ [s.dataset.filter]: s.value, page: '' })));
  $$('[data-page]').forEach((b) => b.addEventListener('click', () => go({ page: b.dataset.page })));
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const [act, aid] = [b.dataset.act, Number(b.dataset.id)];
    try {
      if (act === 'ticket') {
        const a = r.data.find((x) => x.id === aid);
        ticketModal({ machine_id: a.machine_id, alert_id: a.id, title: `Investigate: ${a.message}`.slice(0, 120), priority: a.severity === 'CRITICAL' ? 'HIGH' : 'MEDIUM' });
        return;
      }
      const { data } = await api(`/alerts/${aid}/${act}`, { method: 'PATCH', body: {} });
      b.closest('tr').outerHTML = alertRow(data, ack);
      toast(act === 'ack' ? 'Alert acknowledged' : 'Alert resolved', data.message, 'ok');
      refreshAlertCount();
    } catch (ex) { toast('Action failed', ex.message, 'critical'); }
  });
  ctx.onLive('alert:new', (a) => {
    if (page !== 1 || (q.status && q.status !== 'OPEN') || (q.severity && q.severity !== a.severity)) return;
    const tb = $('#alertRows');
    if (!tb) return;
    if (tb.querySelector('.empty')) tb.innerHTML = '';
    tb.insertAdjacentHTML('afterbegin', alertRow(a, ack).replace('<tr', '<tr class="flash"'));
    r.data.unshift(a);
  });
}

function alertRow(a, ack) {
  const actions = [];
  if (ack && a.status === 'OPEN') actions.push(`<button class="btn btn-light btn-sm" data-act="ack" data-id="${a.id}">Acknowledge</button>`);
  if (ack && a.status !== 'RESOLVED') actions.push(`<button class="btn btn-light btn-sm" data-act="resolve" data-id="${a.id}">Resolve</button>`);
  if (can('tickets:create') && a.status !== 'RESOLVED') actions.push(`<button class="btn btn-light btn-sm" data-act="ticket" data-id="${a.id}">Ticket</button>`);
  return `<tr><td>${a.id}</td><td class="small">${fmtDateTime(a.raised_at)}</td><td><a href="#/portal/machines/${a.machine_id}">${esc(a.machine_code)}</a></td><td>${sevBadge(a.severity)}</td>
    <td class="small">${esc(a.message)}</td><td>${statusBadge(a.status)}</td><td class="small">${a.acknowledged_by_name ? `${esc(a.acknowledged_by_name)}<div class="muted">${ago(a.acknowledged_at)}</div>` : '—'}</td>
    ${ack || can('tickets:create') ? `<td><div class="btn-row">${actions.join('') || '<span class="muted small">—</span>'}</div></td>` : ''}</tr>`;
}

// ---------- Tickets ----------
async function ticketModal(prefill = {}) {
  const [{ data: ms }, assignees] = await Promise.all([api('/machines'), api('/users/assignees').catch(() => ({ data: [] }))]);
  const manager = can('tickets:assign');
  modal({
    title: 'Raise maintenance ticket', submitLabel: 'Create ticket',
    body: `<div class="form-grid">
      <div class="field"><label for="t_m">Machine <span class="req">*</span></label><select id="t_m" name="machine_id" required>${ms.map((m) => `<option value="${m.id}" ${m.id === prefill.machine_id ? 'selected' : ''}>${esc(m.machine_code)} — ${esc(m.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="t_p">Priority</label><select id="t_p" name="priority">${['LOW', 'MEDIUM', 'HIGH'].map((p) => `<option ${p === (prefill.priority || 'MEDIUM') ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
      ${manager ? `<div class="field"><label for="t_a">Assign to</label><select id="t_a" name="assigned_to"><option value="">Unassigned</option>${assignees.data.map((u) => `<option value="${u.id}">${esc(u.name)} (${u.role})</option>`).join('')}</select></div>` : ''}
      <div class="field"><label for="t_d">Due date</label><input id="t_d" type="date" name="due_date"></div></div>
      <div class="field" style="margin-top:12px"><label for="t_t">Title <span class="req">*</span></label><input id="t_t" name="title" required maxlength="120" value="${esc(prefill.title || '')}"></div>
      <div class="field" style="margin-top:12px"><label for="t_desc">Description</label><textarea id="t_desc" name="description" maxlength="2000"></textarea></div>
      ${prefill.alert_id ? `<input type="hidden" name="alert_id" value="${prefill.alert_id}">` : ''}
      ${manager ? '' : '<p class="small muted">The ticket will be assigned to you.</p>'}`,
    onSubmit: async (f) => {
      const { data } = await api('/tickets', { method: 'POST', body: formData(f) });
      toast(`Ticket #${data.id} created`, data.title, 'ok');
      if (location.hash.startsWith('#/portal/tickets')) window.dispatchEvent(new HashChangeEvent('hashchange'));
    },
  });
}

export async function tickets(el, ctx) {
  const q = ctx.query;
  const params = new URLSearchParams({ limit: 100, ...(q.status ? { status: q.status } : {}), ...(q.mine ? { mine: 'true' } : {}) });
  const [r, assignees] = await Promise.all([api(`/tickets?${params}`), can('tickets:assign') ? api('/users/assignees') : Promise.resolve({ data: [] })]);
  const manager = can('tickets:assign');
  const me = session.user.id;
  const canEdit = (t) => manager || (can('tickets:update') && t.assigned_to === me);
  el.innerHTML = `${title('Maintenance Tickets', can('tickets:create') ? '<button class="btn btn-primary btn-sm" id="newTicket">+ New ticket</button>' : '', true)}
    <div class="filters">
      <div class="field"><label for="tk_s">Status</label><select id="tk_s">${['', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].map((s) => `<option value="${s}" ${s === (q.status || '') ? 'selected' : ''}>${s || 'All'}</option>`).join('')}</select></div>
      ${can('tickets:update') || manager ? `<label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="tk_mine" style="width:auto" ${q.mine ? 'checked' : ''}> Only my tickets</label>` : ''}
    </div>
    <div class="table-wrap"><table><caption class="sr-only">Tickets</caption><thead><tr><th>#</th><th>Machine</th><th>Title</th><th>Priority</th><th>Status</th><th>Assigned to</th><th>Due</th><th>Updated</th><th>Actions</th></tr></thead>
    <tbody>${r.data.map((t) => `<tr data-tid="${t.id}"><td>${t.id}</td><td><a href="#/portal/machines/${t.machine_id}">${esc(t.machine_code)}</a></td>
      <td>${esc(t.title)}${t.alert_id ? `<div class="small muted">from alert #${t.alert_id}${t.created_by ? '' : ' · auto-created'}</div>` : (t.created_by ? '' : '<div class="small muted">auto-created</div>')}</td>
      <td>${statusBadge(t.priority)}</td><td>${statusBadge(t.status)}</td>
      <td>${manager ? `<select data-assign="${t.id}" aria-label="Assign ticket ${t.id}"><option value="">Unassigned</option>${assignees.data.map((u) => `<option value="${u.id}" ${u.id === t.assigned_to ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>` : esc(t.assignee_name || 'Unassigned')}</td>
      <td class="small">${esc(t.due_date || '—')}</td><td class="small">${ago(t.updated_at)}</td>
      <td>${canEdit(t) ? `<select data-status="${t.id}" aria-label="Change status of ticket ${t.id}">${['OPEN', 'IN_PROGRESS', 'RESOLVED', ...(manager ? ['CLOSED'] : [])].map((s) => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}</select>` : '<span class="muted small">View only</span>'}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">No tickets</td></tr>'}</tbody></table></div>
    <p class="small muted" style="margin-top:10px">${manager ? 'As Admin you can reassign, re-prioritise and close any ticket.' : can('tickets:update') ? 'Engineers can update the status of tickets assigned to them. Closing is done by an Admin.' : 'Viewers have read-only access.'}</p>`;
  bindLiveDot(ctx);
  const go = (p) => { const n = { ...q, ...p }; Object.keys(n).forEach((k) => !n[k] && delete n[k]); location.hash = `#/portal/tickets?${new URLSearchParams(n)}`; };
  $('#tk_s').onchange = (e) => go({ status: e.target.value });
  $('#tk_mine')?.addEventListener('change', (e) => go({ mine: e.target.checked ? '1' : '' }));
  $('#newTicket')?.addEventListener('click', () => ticketModal());
  const patch = async (id, body) => {
    try { await api(`/tickets/${id}/status`, { method: 'PATCH', body }); toast(`Ticket #${id} updated`, Object.values(body).join(' '), 'ok'); } catch (ex) { toast('Update failed', ex.message, 'critical'); tickets(el, ctx); }
  };
  $$('[data-status]').forEach((s) => s.addEventListener('change', () => patch(s.dataset.status, { status: s.value })));
  $$('[data-assign]').forEach((s) => s.addEventListener('change', () => s.value && patch(s.dataset.assign, { assigned_to: Number(s.value) })));
  ctx.onLive('ticket:update', (t) => { if (!$(`tr[data-tid="${t.id}"]`)) toast(`New ticket #${t.id}`, `${t.machine_code}: ${t.title}`); });
}

// ---------- Alert rules ----------
export async function rules(el, ctx) {
  const { data: ms } = await api('/machines');
  const mid = Number(ctx.query.machine) || ms[0]?.id;
  const { data } = await api(`/rules?machineId=${mid}`);
  const edit = can('rules:edit');
  el.innerHTML = `${title('Alert Rules')}
    <div class="filters"><div class="field"><label for="r_m">Machine</label><select id="r_m">${ms.map((m) => `<option value="${m.id}" ${m.id === mid ? 'selected' : ''}>${esc(m.machine_code)}</option>`).join('')}</select></div></div>
    <div class="table-wrap"><table><thead><tr><th>Sensor</th><th>Condition</th><th>Level</th><th class="num">Readings in a row</th><th class="num">Cooldown</th><th>Enabled</th>${edit ? '<th>Actions</th>' : ''}</tr></thead>
    <tbody>${data.map((r) => `<tr><td>${esc(r.sensor_type)}</td><td class="mono">${r.operator === 'ZSCORE' ? `|z-score| &gt; ${r.threshold}` : `value ${esc(r.operator)} ${r.threshold} ${esc(r.unit)}`}</td>
      <td>${sevBadge(r.severity)}</td><td class="num">${r.consecutive}</td><td class="num">${Math.round(r.cooldown_s / 60)} min</td><td>${r.enabled ? '<span class="badge b-ok">ON</span>' : '<span class="badge b-neutral">OFF</span>'}</td>
      ${edit ? `<td><button class="btn btn-light btn-sm" data-rule="${r.id}">Edit</button></td>` : ''}</tr>`).join('')}</tbody></table></div>
    <p class="small muted" style="margin-top:10px">An alert fires only when a rule changes from “normal” to “triggered”, and never twice within the cooldown — this is what stops alert storms.</p>`;
  $('#r_m').onchange = (e) => { location.hash = `#/portal/rules?machine=${e.target.value}`; };
  $$('[data-rule]').forEach((b) => b.addEventListener('click', () => {
    const r = data.find((x) => x.id === Number(b.dataset.rule));
    modal({ title: `Edit rule: ${r.machine_code} ${r.sensor_type}`, body: `<div class="form-grid">
      <div class="field"><label for="ru_t">Threshold ${r.operator === 'ZSCORE' ? '(z-score)' : `(${esc(r.unit)})`}</label><input id="ru_t" type="number" step="any" name="threshold" value="${r.threshold}" required></div>
      <div class="field"><label for="ru_s">Level</label><select id="ru_s" name="severity">${['INFO', 'WARNING', 'CRITICAL'].map((s) => `<option ${s === r.severity ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label for="ru_c">Readings in a row</label><input id="ru_c" type="number" min="1" max="20" name="consecutive" value="${r.consecutive}"></div>
      <div class="field"><label for="ru_cd">Cooldown (seconds)</label><input id="ru_cd" type="number" min="0" max="86400" name="cooldown_s" value="${r.cooldown_s}"></div>
      <div class="field"><label for="ru_e">Enabled</label><select id="ru_e" name="enabled"><option value="true" ${r.enabled ? 'selected' : ''}>Yes</option><option value="false" ${r.enabled ? '' : 'selected'}>No</option></select></div></div>`,
    onSubmit: async (f) => { await api(`/rules/${r.id}`, { method: 'PATCH', body: formData(f) }); toast('Rule updated', 'Change recorded in the audit trail.', 'ok'); rules(el, ctx); } });
  }));
}

// ---------- Reports ----------
export async function reports(el, ctx) {
  const period = ctx.query.period === 'weekly' ? 'weekly' : 'daily';
  const [up, sum] = await Promise.all([api(`/reports/uptime?period=${period}`), api(`/reports/summary?period=${period}`)]);
  const s = sum.data;
  const sev = Object.fromEntries(s.alerts.map((a) => [a.severity, a.n]));
  const exp = can('reports:export');
  el.innerHTML = `${title(`${period === 'weekly' ? 'Weekly' : 'Daily'} Report`, `<a class="btn btn-sm ${period === 'daily' ? 'btn-primary' : 'btn-light'}" href="#/portal/reports?period=daily">Daily</a><a class="btn btn-sm ${period === 'weekly' ? 'btn-primary' : 'btn-light'}" href="#/portal/reports?period=weekly">Weekly</a><button class="btn btn-light btn-sm" id="printBtn">🖨 Print</button>`)}
    <p class="small muted" style="margin-top:-8px">Period from ${fmtDateTime(s.from)} to now.</p>
    <div class="grid g4" style="margin-bottom:16px">
      <div class="kpi crit"><div class="k-label">Critical alerts</div><div class="k-value">${sev.CRITICAL || 0}</div></div>
      <div class="kpi warn"><div class="k-label">Warnings</div><div class="k-value">${sev.WARNING || 0}</div></div>
      <div class="kpi"><div class="k-label">Tickets opened / resolved</div><div class="k-value">${s.tickets.opened} / ${s.tickets.resolved}</div><div class="k-sub">${s.tickets.open_now} open now</div></div>
      <div class="kpi ok"><div class="k-label">Mean time to repair</div><div class="k-value">${s.tickets.mttr_minutes != null ? `${num(s.tickets.mttr_minutes, 0)}<small style="font-size:.5em"> min</small>` : '—'}</div></div>
    </div>
    ${exp ? `<div class="card" style="margin-bottom:16px"><div class="card-head"><h3>Export CSV</h3><span class="small muted">Opens in Excel / LibreOffice</span></div><div class="btn-row">
      <button class="btn btn-primary btn-sm" data-export="readings">⬇ Hourly sensor summary</button><button class="btn btn-primary btn-sm" data-export="alerts">⬇ Alerts</button><button class="btn btn-primary btn-sm" data-export="tickets">⬇ Tickets</button></div></div>` : '<p class="small muted">CSV export is available to Engineers and Admins.</p>'}
    <div class="card" style="margin-bottom:16px"><h3>Uptime by machine</h3><div class="table-wrap"><table><thead><tr><th>Machine</th><th>Status</th><th class="num">Data uptime</th><th class="num">Critical</th><th class="num">Warning</th><th class="num">Info</th><th>Health</th></tr></thead><tbody>
      ${up.data.map((m) => `<tr><td><b>${esc(m.machine_code)}</b> <span class="small muted">${esc(m.name)}</span></td><td>${statusBadge(m.status)}</td><td class="num">${num(m.uptime_pct, 1)}%</td><td class="num">${m.critical_alerts}</td><td class="num">${m.warning_alerts}</td><td class="num">${m.info_alerts}</td><td style="min-width:160px">${healthBar(m.health_score, m.status)}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted" style="margin-top:8px">Data uptime = share of minutes in the period in which the machine reported readings.</p></div>
    <div class="card"><h3>Sensor statistics</h3><div class="table-wrap"><table><thead><tr><th>Machine</th><th>Sensor</th><th class="num">Average</th><th class="num">Min</th><th class="num">Max</th><th class="num">Samples</th></tr></thead><tbody>
      ${s.sensors.map((r) => `<tr><td>${esc(r.machine_code)}</td><td>${esc(r.type)} (${esc(r.unit)})</td><td class="num">${r.avg}</td><td class="num">${r.min}</td><td class="num">${r.max}</td><td class="num">${r.samples.toLocaleString('en-IN')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No readings in this period</td></tr>'}</tbody></table></div></div>`;
  $('#printBtn').onclick = () => window.print();
  $$('[data-export]').forEach((b) => b.addEventListener('click', async () => {
    try { await download(`/reports/export?type=${b.dataset.export}&period=${period}`); } catch (ex) { toast('Export failed', ex.message, 'critical'); }
  }));
}

// ---------- Users (Admin) ----------
export async function users(el) {
  const { data } = await api('/users');
  el.innerHTML = `${title('User Management', '<button class="btn btn-primary btn-sm" id="addUser">+ Add user</button>')}
    <div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last login</th><th>Created</th><th>Actions</th></tr></thead><tbody>
    ${data.map((u) => `<tr><td>${esc(u.name)}${u.id === session.user.id ? ' <span class="small muted">(you)</span>' : ''}</td><td>${esc(u.email)}</td><td>${roleBadge(u.role)}</td>
      <td>${u.is_active ? '<span class="badge b-ok">Active</span>' : '<span class="badge b-neutral">Disabled</span>'}</td><td class="small">${fmtDateTime(u.last_login_at)}</td><td class="small">${fmtDateTime(u.created_at)}</td>
      <td><button class="btn btn-light btn-sm" data-uedit="${u.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>
    <p class="small muted" style="margin-top:10px">Changing a role, disabling an account or resetting a password signs that user out of all sessions.</p>`;
  const pw = '<small>8–64 chars with upper-case, lower-case, digit and symbol</small>';
  $('#addUser').onclick = () => modal({ title: 'Add user', submitLabel: 'Create user', body: `<div class="form-grid">
    <div class="field"><label for="u_n">Full name <span class="req">*</span></label><input id="u_n" name="name" required></div>
    <div class="field"><label for="u_e">Email <span class="req">*</span></label><input id="u_e" name="email" type="email" required></div>
    <div class="field"><label for="u_r">Role <span class="req">*</span></label><select id="u_r" name="role"><option>VIEWER</option><option>ENGINEER</option><option>ADMIN</option></select></div>
    <div class="field"><label for="u_p">Initial password <span class="req">*</span></label><input id="u_p" name="password" type="password" autocomplete="new-password" required>${pw}</div></div>`,
  onSubmit: async (f) => { await api('/users', { method: 'POST', body: formData(f) }); toast('User created', '', 'ok'); users(el); } });
  $$('[data-uedit]').forEach((b) => b.addEventListener('click', () => {
    const u = data.find((x) => x.id === Number(b.dataset.uedit));
    modal({ title: `Edit ${u.name}`, body: `<div class="form-grid">
      <div class="field"><label for="ue_n">Full name</label><input id="ue_n" name="name" value="${esc(u.name)}"></div>
      <div class="field"><label for="ue_r">Role</label><select id="ue_r" name="role">${['VIEWER', 'ENGINEER', 'ADMIN'].map((r) => `<option ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
      <div class="field"><label for="ue_a">Account</label><select id="ue_a" name="is_active"><option value="true" ${u.is_active ? 'selected' : ''}>Active</option><option value="false" ${u.is_active ? '' : 'selected'}>Disabled</option></select></div>
      <div class="field"><label for="ue_p">Reset password</label><input id="ue_p" name="password" type="password" autocomplete="new-password" placeholder="Leave blank to keep">${pw}</div></div>`,
    onSubmit: async (f) => { await api(`/users/${u.id}`, { method: 'PATCH', body: formData(f) }); toast('User updated', '', 'ok'); users(el); } });
  }));
}

// ---------- Audit (Admin) ----------
export async function audit(el, ctx) {
  const page = Number(ctx.query.page) || 1;
  const action = ctx.query.action || '';
  const r = await api(`/admin/audit-logs?page=${page}&limit=50${action ? `&action=${encodeURIComponent(action)}` : ''}`);
  const actions = ['LOGIN', 'LOGIN_FAILED', 'CREATE', 'UPDATE', 'DELETE', 'ALERT_ACK', 'ALERT_RESOLVE', 'EXPORT', 'SIMULATE_FAULT', 'PASSWORD_CHANGED'];
  el.innerHTML = `${title('Audit Trail')}
    <div class="filters"><div class="field"><label for="au_a">Action</label><select id="au_a"><option value="">All</option>${actions.map((a) => `<option ${a === action ? 'selected' : ''}>${a}</option>`).join('')}</select></div></div>
    <div class="table-wrap"><table><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Table</th><th class="num">Record</th><th>Details</th><th>IP</th></tr></thead><tbody>
    ${r.data.map((l) => `<tr><td class="small">${fmtDateTime(l.changed_at)}</td><td>${l.user_name ? `${esc(l.user_name)} ${roleBadge(l.user_role)}` : '<span class="muted">—</span>'}</td>
      <td><span class="badge ${l.action.includes('FAILED') || l.action === 'DELETE' ? 'b-critical' : 'b-neutral'}">${esc(l.action)}</span></td><td class="mono small">${esc(l.table_name || '')}</td><td class="num">${l.record_id ?? ''}</td>
      <td class="mono small" style="max-width:320px;word-break:break-word">${esc(l.details || '')}</td><td class="small">${esc(l.ip || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No entries</td></tr>'}</tbody></table></div>
    <div class="pager"><span>Page ${page} · ${r.total} entries</span><a class="btn btn-light btn-sm" href="#/portal/audit?page=${Math.max(1, page - 1)}${action ? `&action=${action}` : ''}">‹ Prev</a><a class="btn btn-light btn-sm" href="#/portal/audit?page=${page + 1}${action ? `&action=${action}` : ''}">Next ›</a></div>`;
  $('#au_a').onchange = (e) => { location.hash = `#/portal/audit${e.target.value ? `?action=${e.target.value}` : ''}`; };
}

// ---------- Notices (Admin) ----------
export async function notices(el) {
  const { data } = await api('/public/notices');
  el.innerHTML = `${title('Notices', '<button class="btn btn-primary btn-sm" id="addNotice">+ Publish notice</button>')}
    <p class="small muted" style="margin-top:-8px">Notices appear in the public “What's New” ticker and on the home-page notice board.</p>
    <div class="table-wrap"><table><thead><tr><th>Published</th><th>Title</th><th>Details</th><th>Actions</th></tr></thead><tbody>
    ${data.map((n) => `<tr><td class="small">${fmtDateTime(n.published_at)}</td><td>${esc(n.title)}</td><td class="small">${esc(n.body || '')}</td><td><button class="btn btn-light btn-sm" data-ndel="${n.id}">Remove</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">No notices</td></tr>'}</tbody></table></div>`;
  const changed = () => { window.dispatchEvent(new Event('notices:changed')); notices(el); };
  $('#addNotice').onclick = () => modal({ title: 'Publish notice', submitLabel: 'Publish', body: `
    <div class="field"><label for="n_t">Headline <span class="req">*</span></label><input id="n_t" name="title" required maxlength="200"></div>
    <div class="field" style="margin-top:12px"><label for="n_b">Details</label><textarea id="n_b" name="body" maxlength="2000"></textarea></div>`,
  onSubmit: async (f) => { await api('/admin/notices', { method: 'POST', body: formData(f) }); toast('Notice published', '', 'ok'); changed(); } });
  $$('[data-ndel]').forEach((b) => b.addEventListener('click', async () => { await api(`/admin/notices/${b.dataset.ndel}`, { method: 'DELETE' }); toast('Notice removed', '', 'ok'); changed(); }));
}

// ---------- Feedback inbox (Admin) ----------
export async function feedbackInbox(el) {
  const { data } = await api('/admin/feedback');
  el.innerHTML = `${title('Feedback Inbox')}
    <div class="table-wrap"><table><thead><tr><th>Ref.</th><th>Received</th><th>From</th><th>Category</th><th>Message</th><th>Status</th><th>Actions</th></tr></thead><tbody>
    ${data.map((f) => `<tr><td class="mono small">SMF-${String(f.id).padStart(5, '0')}</td><td class="small">${fmtDateTime(f.created_at)}</td><td>${esc(f.name)}<div class="small muted">${esc(f.email)}</div></td>
      <td>${esc(f.category)}</td><td class="small" style="max-width:380px;white-space:pre-wrap">${esc(f.message)}</td><td>${statusBadge(f.status)}</td>
      <td>${f.status === 'NEW' ? `<button class="btn btn-light btn-sm" data-fb="${f.id}">Mark reviewed</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No feedback yet</td></tr>'}</tbody></table></div>`;
  $$('[data-fb]').forEach((b) => b.addEventListener('click', async () => { await api(`/admin/feedback/${b.dataset.fb}`, { method: 'PATCH', body: {} }); feedbackInbox(el); }));
}

// ---------- System status (Admin) ----------
export async function system(el) {
  const [{ data: s }, mail] = await Promise.all([api('/admin/system'), api('/admin/notifications?limit=15')]);
  const i = s.ingestion;
  el.innerHTML = `${title('System Status', '<a class="btn btn-light btn-sm" href="/api-docs" target="_blank" rel="noopener">API docs ↗</a>')}
    <div class="grid g4" style="margin-bottom:16px">
      <div class="kpi ok"><div class="k-label">Readings accepted</div><div class="k-value">${i.accepted.toLocaleString('en-IN')}</div><div class="k-sub">since last restart</div></div>
      <div class="kpi ${i.rejected ? 'warn' : ''}"><div class="k-label">Rejected (invalid)</div><div class="k-value">${i.rejected}</div><div class="k-sub">${i.duplicates} duplicates ignored</div></div>
      <div class="kpi"><div class="k-label">Last batch write</div><div class="k-value">${i.lastFlushMs}<small style="font-size:.5em"> ms</small></div><div class="k-sub">${i.flushed.toLocaleString('en-IN')} rows written</div></div>
      <div class="kpi"><div class="k-label">Server</div><div class="k-value">${Math.round(s.uptime_s / 60)}<small style="font-size:.5em"> min</small></div><div class="k-sub">${s.memory_mb} MB · Node ${esc(s.node)}</div></div>
    </div>
    <div class="grid g2">
      <div class="card"><h3>Table sizes</h3><dl class="kv">${Object.entries(s.rows).map(([k, v]) => `<dt class="mono">${esc(k)}</dt><dd>${v.toLocaleString('en-IN')}</dd>`).join('')}</dl>
        <h3 style="margin-top:14px">Active simulated faults</h3>${s.active_faults.length ? s.active_faults.map((f) => `<div class="small">Machine #${f.machine_id}: ${esc(f.sensor)} since ${ago(f.since)}</div>`).join('') : '<p class="small muted">None</p>'}</div>
      <div class="card"><h3>Email outbox (latest)</h3><div class="table-wrap"><table><thead><tr><th>Time</th><th>To</th><th>Subject</th></tr></thead><tbody>
        ${mail.data.map((n) => `<tr><td class="small">${ago(n.created_at)}</td><td class="small">${esc(n.recipient)}</td><td class="small">${esc(n.subject)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No emails yet</td></tr>'}</tbody></table></div></div>
    </div>`;
}

// ---------- Profile ----------
export async function profile(el) {
  const { user } = await api('/auth/me');
  el.innerHTML = `${title('My Profile')}
    <div class="grid g2">
      <div class="card"><h3>Account details</h3><dl class="kv"><dt>Name</dt><dd>${esc(user.name)}</dd><dt>Email</dt><dd>${esc(user.email)}</dd><dt>Role</dt><dd>${roleBadge(user.role)}</dd><dt>Previous login</dt><dd>${fmtDateTime(user.last_login_at)}</dd></dl>
        <h3 style="margin-top:16px">My permissions</h3><div class="tag-list">${user.permissions.map((p) => `<span>${esc(p)}</span>`).join('')}</div></div>
      <form class="card" id="pwForm" novalidate><h3>Change password</h3>
        <div class="field"><label for="pw_c">Current password <span class="req">*</span></label><input id="pw_c" name="currentPassword" type="password" autocomplete="current-password" required></div>
        <div class="field" style="margin-top:12px"><label for="pw_n">New password <span class="req">*</span></label><input id="pw_n" name="newPassword" type="password" autocomplete="new-password" required><small>8–64 chars with upper-case, lower-case, digit and symbol</small></div>
        <div class="field" style="margin-top:12px"><label for="pw_r">Confirm new password <span class="req">*</span></label><input id="pw_r" name="confirm" type="password" autocomplete="new-password" required></div>
        <div id="pwMsg" style="margin-top:12px"></div>
        <button class="btn btn-primary" style="margin-top:12px" type="submit">Update password</button></form>
    </div>`;
  $('#pwForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const msg = $('#pwMsg');
    if (f.newPassword !== f.confirm) { msg.innerHTML = '<div class="form-error">New passwords do not match.</div>'; return; }
    try {
      const r = await api('/auth/change-password', { method: 'POST', body: { currentPassword: f.currentPassword, newPassword: f.newPassword } });
      setSession(r.accessToken, r.user);
      msg.innerHTML = '<div class="form-ok">Password changed. Other sessions have been signed out.</div>';
      e.target.reset();
    } catch (ex) { msg.innerHTML = errorBox(ex); }
  };
}
