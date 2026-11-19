import { api, setSession } from '../api.js';
import { $, $$, esc, pageHead, fmtDate, errorBox, toast } from '../ui.js';
import { t } from '../i18n.js';

const sec = (title, body, id = '') => `<section class="section"${id ? ` id="${id}"` : ''}><div class="container"><div class="section-title"><h2>${title}</h2></div>${body}</div></section>`;

const MODULES = [
  ['a', 'Telemetry Ingestion', 'Receives sensor data, checks it and saves it quickly in batches.'],
  ['b', 'Alert Engine', 'Spots problems using rules and z-scores, avoids repeat alerts and sends emails.'],
  ['c', 'Health Score', 'A score from 0 to 100 for each machine, so weak machines stand out.'],
  ['d', 'Live Data API', 'Gives history on request and pushes live values instantly over WebSockets.'],
  ['e', 'Maintenance Tickets', 'Turns an alert into a to-do with an owner, a due date and a status.'],
  ['f', 'Reports', 'Daily and weekly summaries that can be downloaded as CSV files.'],
];

const ALERT_LEVELS = `<div class="table-wrap"><table>
  <caption class="sr-only">Alert levels</caption>
  <thead><tr><th>Level</th><th>Trigger</th><th>Action</th></tr></thead>
  <tbody>
    <tr><td><span class="badge b-info">ℹ INFO</span></td><td>Reading close to its limit (80% of range)</td><td>Only recorded</td></tr>
    <tr><td><span class="badge b-warning">⚠ WARNING</span></td><td>Slightly abnormal, or soft limit (90%) crossed</td><td>Highlighted on dashboard</td></tr>
    <tr><td><span class="badge b-critical">⛔ CRITICAL</span></td><td>3 abnormal readings in a row (z-score &gt; 3), or hard limit crossed</td><td>Email, maintenance ticket and live alert</td></tr>
  </tbody></table></div>`;

// ---------------- Home ----------------
export async function home(main) {
  main.innerHTML = `
  <section class="hero">
    <div class="container">
      <div>
        <div class="kicker" data-i18n="heroKicker">Industry 4.0 · Shop-floor digitalisation</div>
        <h1 data-i18n="heroTitle">Know about a machine failure before it happens</h1>
        <p data-i18n="heroText">Live monitoring of temperature, vibration and spindle load on CNC and VMC machines, with smart alerts, a health score for every machine and maintenance tickets — in one secure portal.</p>
        <div class="hero-actions">
          <a class="btn btn-accent" href="#/login" data-i18n="login">Staff Login</a>
          <a class="btn btn-ghost" href="#/project" data-i18n="learnMore">Explore the Project</a>
        </div>
      </div>
      <div class="hero-panel" aria-live="polite">
        <h3 data-i18n="liveFigures">Live plant figures</h3>
        <div class="hero-stats" id="heroStats">
          <div><b>—</b><span data-i18n="stMachines">Machines monitored</span></div>
          <div><b>—</b><span data-i18n="stRunning">Running now</span></div>
          <div><b>—</b><span data-i18n="stReadings">Readings (24 h)</span></div>
          <div><b>—</b><span data-i18n="stAlerts">Alerts raised (24 h)</span></div>
        </div>
      </div>
    </div>
  </section>

  <section class="section"><div class="container">
    <div class="section-title"><h2 data-i18n="services">Services &amp; Quick Links</h2></div>
    <nav class="quick-links" aria-label="Quick links">
      <a href="#/portal"><span class="ql-ico" aria-hidden="true">📊</span>Live Dashboard</a>
      <a href="#/portal/alerts"><span class="ql-ico" aria-hidden="true">🚨</span>Alerts</a>
      <a href="#/portal/tickets"><span class="ql-ico" aria-hidden="true">🛠️</span>Maintenance Tickets</a>
      <a href="#/portal/reports"><span class="ql-ico" aria-hidden="true">📄</span>Reports &amp; CSV</a>
      <a href="#/access"><span class="ql-ico" aria-hidden="true">🔐</span>Roles &amp; Access</a>
      <a href="/api-docs" target="_blank" rel="noopener"><span class="ql-ico" aria-hidden="true">🧩</span>API Docs</a>
    </nav>
  </div></section>

  <section class="section" style="padding-top:0"><div class="container grid g2">
    <div class="card accent-top">
      <h2>About the Portal</h2>
      <p>CNC machines can break without warning and stop the whole shop floor. Maintenance used to happen on a fixed calendar or after a breakdown — both waste money — and nobody could see live temperature or vibration.</p>
      <p>This portal connects every machine's sensors to a secure backend. Each reading is checked, stored and compared with the machine's normal behaviour. When something drifts, the right people are warned <strong>before</strong> a failure, and a maintenance ticket is raised automatically.</p>
      <a class="btn btn-primary" href="#/project">Read more</a>
    </div>
    <div class="card accent-top">
      <div class="card-head"><h2 data-i18n="notices">Notice Board</h2></div>
      <ul class="clean notice-board" id="noticeBoard"><li class="muted">Loading…</li></ul>
    </div>
  </div></section>

  ${sec(`<span data-i18n="keyFeatures">Key Features</span>`, `<div class="grid g3">${MODULES.map(([k, h, p]) => `<div class="card"><h3><span class="icon-circle">${k}</span>${h}</h3><p class="muted small">${p}</p></div>`).join('')}</div>`)}

  ${sec('How a Machine Is Judged', `<div class="grid g2">
    <div class="grid steps-num">
      <div class="card"><h3>Learn what is normal</h3><p class="small muted">Each sensor's recent average and spread are tracked. A reading far from it (z-score above 3) looks abnormal.</p></div>
      <div class="card"><h3>Avoid false alarms</h3><p class="small muted">A critical alert needs 3 abnormal readings in a row, so one random spike is ignored. A cooldown stops repeats.</p></div>
      <div class="card"><h3>Health score</h3><p class="small muted">Every machine starts at 100. Open alerts reduce it, and a low score (&lt; 40) creates a ticket automatically.</p></div>
    </div>
    <div>${ALERT_LEVELS}</div></div>`)}`;

  try {
    const [{ data: s }, { data: notices }] = await Promise.all([api('/public/stats'), api('/public/notices')]);
    const vals = [s.machines, s.running, s.readings_24h.toLocaleString('en-IN'), s.alerts_24h];
    $$('#heroStats b').forEach((b, i) => { b.textContent = vals[i]; });
    $('#noticeBoard').innerHTML = notices.slice(0, 6).map((n, i) => {
      const d = new Date(n.published_at);
      return `<li><div class="date"><b>${d.getDate()}</b>${d.toLocaleString('en-IN', { month: 'short' })} ${d.getFullYear()}</div><div>${esc(n.title)}${i < 2 ? '<span class="new-tag">NEW</span>' : ''}${n.body ? `<div class="small muted">${esc(n.body)}</div>` : ''}</div></li>`;
    }).join('') || '<li class="muted">No notices.</li>';
  } catch { /* page still useful without live figures */ }
}

// ---------------- About ----------------
export async function about(main) {
  const units = [
    ['⚙️', 'CNC Machining', 'Precision component manufacturing on CNC and VMC machines.'],
    ['🧰', 'Sheet Metal', 'Fabrication and structural assemblies for industrial use.'],
    ['💡', 'Custom Engineering', 'Solutions for automotive and infrastructure clients.'],
    ['✅', 'Design and Quality', 'Mechanical design, prototyping and quality testing.'],
    ['🌐', 'OEM Supply', 'Machined parts supplied to OEMs across India.'],
    ['💻', 'Digital Initiative', 'An in-house software team building tools for the shop floor. This portal is built here.'],
  ];
  main.innerHTML = pageHead('About Us') + sec('SM Engineers', `
    <p class="muted">SM Engineers is a precision engineering company serving automotive, infrastructure and OEM customers. Its Digital Initiative builds software for the shop floor.</p>
    <div class="grid g3">${units.map(([i, h, p], k) => `<div class="card${k === 5 ? ' tinted' : ''}"><h3><span aria-hidden="true">${i}</span>${h}</h3><p class="small muted">${p}</p></div>`).join('')}</div>`);
}

// ---------------- Project overview ----------------
export async function project(main) {
  main.innerHTML = pageHead('Project Overview', [['The Project']]) + sec('Problem Statement and Solution', `<div class="grid g2">
      <div class="card" style="background:#fff6ee;border-color:#f2d3b5"><h3>⚠ The problem</h3><ul class="ticks">
        <li>CNC machines can break without warning and stop the whole shop floor</li>
        <li>Maintenance happens on a fixed calendar or after a breakdown, and both waste money</li>
        <li>Nobody can see live temperature or vibration</li>
        <li>Sensor data is not saved, so the team cannot learn from the past</li></ul></div>
      <div class="card" style="background:#eef8f1;border-color:#bfe0c8"><h3>✔ Our solution</h3><ul class="ticks">
        <li>Machines send sensor readings continuously</li>
        <li>Every reading is saved, and the latest value is kept ready for quick access</li>
        <li>Smart rules and a health score warn the team before a failure</li>
        <li>Live dashboards and reports are fed through secure, role-based APIs</li></ul></div></div>`)
  + sec('Key Backend Modules', `<div class="grid g3">${MODULES.map(([k, h, p]) => `<div class="card"><h3><span class="icon-circle">${k}</span>${h}</h3><p class="small muted">${p}</p></div>`).join('')}</div>
      <p class="small muted" style="margin-top:12px">Each module keeps its routes, logic and database code in separate layers, so one part can change without breaking the others.</p>`)
  + sec('Predictive Maintenance Logic', ALERT_LEVELS)
  + sec('Engineering Challenges and Solutions', `<div class="table-wrap"><table><thead><tr><th>Problem</th><th>Solution</th></tr></thead><tbody>
      <tr><td>Saving one row at a time was too slow when many sensors sent data</td><td>Readings are buffered in memory and written together in one transaction every second</td></tr>
      <tr><td>The same message could arrive twice or in the wrong order</td><td>A unique key on (sensor, time) ignores duplicates automatically; the latest value only moves forward in time</td></tr>
      <tr><td>A faulty machine caused hundreds of repeated alerts</td><td>A cooldown timer per rule, and alerts only when the state changes</td></tr>
      <tr><td>Dashboard slowed down as data reached millions of rows</td><td>A composite index, an hourly summary table and automatic purge of old raw readings</td></tr>
    </tbody></table></div>`)
  + sec('Testing and Results', `<div class="grid g4">
      <div class="kpi"><div class="k-value">8</div><div class="k-label">core database tables</div></div>
      <div class="kpi"><div class="k-value">6</div><div class="k-label">backend modules</div></div>
      <div class="kpi"><div class="k-value">3</div><div class="k-label">user roles</div></div>
      <div class="kpi"><div class="k-value">3</div><div class="k-label">alert levels</div></div></div>
      <ul class="ticks" style="margin-top:14px">
        <li>Unit tests check the alert rules, z-score logic and health score</li>
        <li>Integration tests (Supertest) call the API routes, including wrong-login and forbidden-role cases</li>
        <li>Interactive API documentation (Swagger) at <a href="/api-docs" target="_blank" rel="noopener">/api-docs</a></li>
        <li><strong>Result:</strong> a working end-to-end system, from a sensor reading to a live alert and a maintenance ticket.</li></ul>`)
  + sec('My Contribution', `<div class="grid g3">${[
    ['System design', 'Planned how the system fits together and designed the database tables.'],
    ['Data collection', 'Built the service that receives, checks and saves sensor data quickly.'],
    ['Alert engine', 'Built the rules that spot problems early, plus the health score and emails.'],
    ['APIs and security', 'Created the APIs with login, user roles, input checks and documentation.'],
    ['Testing', 'Wrote automated tests and set up automatic checks on every code push.'],
    ['Deployment', 'Packaged the app and deployed it on a cloud server.']].map(([h, p], i) => `<div class="card"><h3><span class="icon-circle">${'abcdef'[i]}</span>${h}</h3><p class="small muted">${p}</p></div>`).join('')}</div>`)
  + sec('Learnings and Future Scope', `<div class="grid g2">
      <div class="card"><h3>🎓 What I learned</h3><ul class="ticks"><li>How machines and servers exchange data in real time</li><li>Designing a database that stays fast with millions of rows</li><li>Testing and automatic checks as part of daily work</li><li>Building secure, well-documented APIs</li><li>Working in a real team with code reviews</li></ul></div>
      <div class="card tinted"><h3>💡 Future scope</h3><ul class="ticks"><li>A machine-learning model trained on the saved readings</li><li>Grafana-style visual analytics</li><li>SMS and WhatsApp alerts for critical events</li><li>OEE reports (how well machines are being used)</li><li>Support for several factories</li></ul></div></div>`);
}

// ---------------- Architecture ----------------
export async function architecture(main) {
  const flow = (steps, cls = '') => `<div class="flow ${cls}">${steps.map(([b, s], i) => `${i ? '<span class="arrow" aria-hidden="true">→</span>' : ''}<div class="step"><b>${b}</b><span>${s}</span></div>`).join('')}</div>`;
  const tables = [
    ['users', 'id PK, name, email, role (ENUM), password_hash'],
    ['machines', 'id PK, machine_code (UQ), type, location, status (ENUM)'],
    ['sensors', 'id PK, machine_id FK, type, unit, min_val, max_val'],
    ['readings', 'id PK, sensor_id FK, value, recorded_at — UNIQUE(sensor_id, recorded_at)'],
    ['alert_rules', 'id PK, sensor_id FK, operator, threshold, severity, cooldown_s'],
    ['alerts', 'id PK, rule_id FK, severity, status, raised_at'],
    ['maintenance_tickets', 'id PK, alert_id FK, assigned_to FK, status, due_date'],
    ['audit_logs', 'id PK, user_id FK, action, table_name, record_id, changed_at'],
  ];
  const api = [
    ['Auth', 'POST /auth/login · POST /auth/refresh · POST /auth/logout'],
    ['Machines', 'GET /machines · GET /machines/:id/health · POST /machines'],
    ['Telemetry', 'GET /machines/:id/readings · GET /machines/:id/latest · POST /telemetry'],
    ['Alerts', 'GET /alerts · PATCH /alerts/:id/ack · PATCH /alerts/:id/resolve'],
    ['Maintenance', 'POST /tickets · GET /tickets · PATCH /tickets/:id/status'],
    ['Reports', 'GET /reports/uptime · GET /reports/summary · GET /reports/export (CSV)'],
  ];
  main.innerHTML = pageHead('System Architecture', [['The Project', '#/project']])
  + sec('How the System Is Built', `
      <h3 style="color:var(--accent)">Data in: from machine to database</h3>
      ${flow([['Machines', 'CNC sensors send readings'], ['Message channel', 'MQTT broker / device API'], ['Ingestion + Alerts', 'Checks data, spots problems'], ['Cache + Database', 'Latest value and full history']])}
      <h3 style="color:var(--green);margin-top:18px">Data out: from database to people</h3>
      ${flow([['Cache + Database', 'The stored data'], ['REST API', 'Answers requests, checks login & role'], ['Live Updates', 'Pushes new values instantly'], ['Users', 'Dashboard, emails, reports']], 'out')}
      <p class="muted small" style="margin-top:12px">Saving and viewing use separate paths, so heavy sensor traffic never slows the dashboard.</p>`)
  + sec('Journey of One Sensor Reading', `<div class="grid g3 steps-num">${[
    ['Sensor sends', 'The machine sends a small message with temperature, vibration and load every few seconds.'],
    ['Broker delivers', 'The message channel passes it to the ingestion service without losing it on the way.'],
    ['Check', 'Values are validated. Impossible data is rejected and recorded in a log.'],
    ['Collect and save', 'Readings wait in a buffer, then are saved to the database together in one go.'],
    ['Judge', 'The alert engine compares the reading with the machine’s normal behaviour and its limits.'],
    ['Notify', 'The dashboard updates live. Serious problems send an email and create a ticket.']].map(([h, p]) => `<div class="card"><h3>${h}</h3><p class="small muted">${p}</p></div>`).join('')}</div>`)
  + sec('Database Design', `<div class="grid g4">${tables.map(([n, c]) => `<div class="card"><h3 class="mono">${n}</h3><p class="small mono muted">${c}</p></div>`).join('')}</div>
      <p class="small muted" style="margin-top:12px">PK = unique ID · FK = link to another table. The readings table grows fastest, so it has a composite index and an hourly summary table (<code>readings_hourly</code>).</p>`)
  + sec('REST API Endpoints', `<div class="table-wrap"><table><thead><tr><th>Group</th><th>Endpoints (prefix <code>/api/v1</code>)</th></tr></thead><tbody>${api.map(([g, e]) => `<tr><td><b>${g}</b></td><td class="mono">${e}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted" style="margin-top:10px">Live events: <code>machine:update</code>, <code>alert:new</code>, <code>alert:update</code>, <code>ticket:update</code>. Try every route in <a href="/api-docs" target="_blank" rel="noopener">Swagger UI</a>.</p>`)
  + sec('How the Code Goes Live', flow([['Push code', 'Changes uploaded to GitHub'], ['Auto-test', 'Tests run automatically'], ['Build', 'App packaged (Docker image)'], ['Deploy', 'Server gets the new version'], ['Live', 'Health-checked, auto-restarted']]));
}

// ---------------- Technology ----------------
export async function technology(main) {
  const stack = [
    ['Backend', 'Node.js and Express run the logic and serve data. Socket.IO sends live updates.', ['Node.js', 'Express', 'Socket.IO']],
    ['Data & Messaging', 'A relational database stores history; an in-memory cache keeps the latest values; MQTT carries machine messages.', ['MySQL / SQLite', 'Redis-style cache', 'MQTT']],
    ['Security', 'Login passes (JWT), user roles, password hashing, captcha and input checks.', ['JWT', 'bcrypt', 'Helmet', 'Rate limiting']],
    ['Testing & Docs', 'Automated tests check the code; Swagger documents the API for other developers.', ['node:test', 'Supertest', 'Swagger']],
    ['Deployment', 'Docker packs the app; GitHub runs the checks; the cloud host keeps it running.', ['Docker', 'GitHub', 'Render']],
    ['Good Practices', 'Clean layered code, pull requests and a code review before every merge.', ['Layered design', 'Code review', 'Audit trail']],
  ];
  const terms = [
    ['MQTT', 'A light messaging system for machines — like a postman who delivers each sensor’s message to the right place.'],
    ['Redis / cache', 'A very fast short-term memory. It holds the latest values so the dashboard never waits for the database.'],
    ['Docker', 'A shipping container for software: the app and everything it needs are packed together, so it runs the same anywhere.'],
    ['API', 'A waiter between the app and the data. The dashboard asks for something and the API brings it back.'],
    ['JWT', 'A digital entry pass. After login, the user shows this pass with every request to prove who they are.'],
    ['Z-score', 'A number showing how far a reading is from normal. A big number means something may be wrong.'],
  ];
  main.innerHTML = pageHead('Technology Stack', [['The Project', '#/project']])
  + sec('Technologies Used', `<div class="grid g3">${stack.map(([h, p, tags]) => `<div class="card"><h3>${h}</h3><p class="small muted">${p}</p><div class="tag-list">${tags.map((x) => `<span>${x}</span>`).join('')}</div></div>`).join('')}</div>`)
  + sec('Key Terms in Simple Words', `<div class="grid g3">${terms.map(([h, p]) => `<div class="card tinted"><h3>${h}</h3><p class="small">${p}</p></div>`).join('')}</div>`);
}

// ---------------- Access control ----------------
export async function access(main) {
  main.innerHTML = pageHead('Roles & Access Control', [['The Project', '#/project']]) + sec('Role-Based Access Control (RBAC)', `
    <div class="grid g3" style="margin-bottom:18px">
      <div class="card accent-top"><h3><span class="badge role-ADMIN">ADMIN</span></h3><p class="small muted">Full control: machines, users and roles, alert rules, ticket assignment, notices, feedback, audit trail and system status.</p></div>
      <div class="card accent-top"><h3><span class="badge role-ENGINEER">ENGINEER</span></h3><p class="small muted">Works on the shop floor: acknowledges and resolves alerts, tunes thresholds, creates tickets and updates tickets assigned to them, exports reports.</p></div>
      <div class="card accent-top"><h3><span class="badge role-VIEWER">VIEWER</span></h3><p class="small muted">Read-only: dashboards, machines, live charts, alerts, tickets and reports. Cannot change anything.</p></div>
    </div>
    <div class="table-wrap" id="rbacTable"><div class="empty"><span class="loader"></span></div></div>
    <p class="small muted" style="margin-top:10px">Every API route checks a <em>permission</em> on the server (not just the menu in the browser). Roles are re-checked from the database on each request, so a role change or deactivation takes effect immediately.</p>`);
  const { data } = await api('/public/rbac');
  $('#rbacTable').innerHTML = `<table><caption class="sr-only">Permission matrix</caption><thead><tr><th>Permission</th>${data.roles.map((r) => `<th class="num">${r}</th>`).join('')}</tr></thead><tbody>
    ${data.permissions.map((p) => `<tr><td>${esc(p.label)} <span class="muted small mono">${esc(p.key)}</span></td>${data.roles.map((r) => `<td class="num">${p.roles[r] ? '<span class="yes" aria-label="Allowed">✔</span>' : '<span class="no" aria-label="Not allowed">✖</span>'}</td>`).join('')}</tr>`).join('')}
  </tbody></table>`;
}

// ---------------- Sitemap / Help / Policies ----------------
export async function sitemap(main) {
  const groups = [
    ['Public Pages', [['Home', '#/'], ['About Us', '#/about'], ['Project Overview', '#/project'], ['System Architecture', '#/architecture'], ['Technology Stack', '#/technology'], ['Roles & Access Control', '#/access'], ['Help', '#/help'], ['Website Policies', '#/policies'], ['Feedback / Grievance', '#/feedback'], ['API Documentation', '/api-docs']]],
    ['Portal (login required)', [['Dashboard', '#/portal'], ['Machines', '#/portal/machines'], ['Alerts', '#/portal/alerts'], ['Maintenance Tickets', '#/portal/tickets'], ['Reports', '#/portal/reports'], ['My Profile', '#/portal/profile']]],
    ['Engineer & Admin', [['Alert Rules', '#/portal/rules'], ['User Management (Admin)', '#/portal/users'], ['Audit Trail (Admin)', '#/portal/audit'], ['Notices (Admin)', '#/portal/notices'], ['Feedback Inbox (Admin)', '#/portal/feedback'], ['System Status (Admin)', '#/portal/system']]],
  ];
  main.innerHTML = pageHead('Sitemap') + sec('All pages', `<div class="grid g3">${groups.map(([h, links]) => `<div class="card"><h3>${h}</h3><ul class="ticks">${links.map(([n, href]) => `<li><a href="${href}">${n}</a></li>`).join('')}</ul></div>`).join('')}</div>`);
}

export async function help(main) {
  main.innerHTML = pageHead('Help') + sec('Accessibility Statement', `
    <p>This portal aims to be usable by everyone, following the Guidelines for Indian Government Websites (GIGW) and WCAG 2.1 level AA where practical.</p>
    <div class="table-wrap"><table><thead><tr><th>Feature</th><th>How to use it</th></tr></thead><tbody>
      <tr><td>Skip to main content</td><td>Press <kbd>Tab</kbd> once after the page loads, then <kbd>Enter</kbd>.</td></tr>
      <tr><td>Text size</td><td>Use <b>A-</b>, <b>A</b>, <b>A+</b> in the top bar.</td></tr>
      <tr><td>High contrast</td><td>Use the <b>◐</b> button in the top bar.</td></tr>
      <tr><td>Language</td><td>Choose English or हिन्दी from the top bar.</td></tr>
      <tr><td>Screen readers</td><td>Works with NVDA, JAWS (Windows), VoiceOver (macOS/iOS) and TalkBack (Android).</td></tr>
      <tr><td>Moving ticker</td><td>Hover over it, or use the pause button, to stop the “What's New” ticker.</td></tr>
    </tbody></table></div>`, 'screen-reader')
  + sec('Frequently Asked Questions', `<div class="grid g2">${[
    ['How do I get an account?', 'Accounts are created by the portal Administrator. Contact the Digital Initiative team through the Feedback page.'],
    ['Why can I not see some menu items?', 'Menus depend on your role (Admin, Engineer or Viewer). See Roles & Access Control.'],
    ['What does the health score mean?', '100 is perfect. Open alerts and abnormal readings reduce it. 80+ is Good, 60–79 Fair, 40–59 Poor, below 40 Critical.'],
    ['What happens on a critical alert?', 'Engineers and admins get an email, an engineer is assigned a maintenance ticket and the dashboard shows a live alert.'],
    ['I forgot my password.', 'Ask an Administrator to reset it from User Management. You can change it yourself from My Profile.'],
    ['Why was I logged out?', 'For security you are signed out after 20 minutes of inactivity.']].map(([q, a]) => `<div class="card"><h3>${q}</h3><p class="small muted">${a}</p></div>`).join('')}</div>`);
}

export async function policies(main) {
  main.innerHTML = pageHead('Website Policies')
  + sec('Privacy Policy', '<p>The portal does not collect personal information from public visitors except what is voluntarily submitted through the feedback form (name, email, message), which is used only to respond. Staff accounts store name, email, role and a one-way hashed password. Session cookies are used only to keep staff signed in and are marked HttpOnly and SameSite=Strict. No information is sold or shared with third parties.</p>', 'privacy')
  + sec('Terms & Conditions', '<p>Content on this portal is provided for operational use by SM Engineers. Machine data shown is for monitoring and maintenance planning; final maintenance decisions remain with qualified engineers. Unauthorised attempts to access restricted areas or to alter data are prohibited and are recorded in the audit trail.</p>', 'terms')
  + sec('Copyright Policy', '<p>Material on this portal may be reproduced free of charge after taking proper permission from the Digital Initiative team. It must be reproduced accurately and not used in a misleading context. Where material is published or issued to others, the source must be acknowledged.</p>', 'copyright')
  + sec('Hyperlinking Policy', '<p>Links to external websites are provided for convenience only; SM Engineers is not responsible for their contents. Links to this portal from other websites do not need prior permission, but the portal must not be loaded inside frames on another site.</p>', 'hyperlinking')
  + sec('Security Policy', '<ul class="ticks"><li>Passwords are hashed with bcrypt and never stored as plain text.</li><li>Short-lived access tokens (15 minutes) with rotating refresh tokens.</li><li>Login captcha and rate limiting against password-guessing.</li><li>Every request is validated; database queries are parameterised against SQL injection.</li><li>Secure HTTP headers (Content-Security-Policy, X-Frame-Options and others).</li><li>All changes are recorded in an audit trail with the user and time.</li></ul>', 'security')
  + sec('Disclaimer', '<p>Though all efforts have been made to ensure accuracy, the content should not be construed as a statement of law or used for legal purposes. Live figures are generated from shop-floor sensors (or the built-in demonstration simulator) and may contain gaps.</p>', 'disclaimer');
}

// ---------------- Feedback ----------------
export async function feedback(main) {
  main.innerHTML = pageHead('Feedback / Grievance') + sec('Share your feedback', `
    <form class="card" id="fbForm" novalidate>
      <div class="form-grid">
        <div class="field"><label for="fbName">Full name <span class="req">*</span></label><input id="fbName" name="name" required maxlength="80" autocomplete="name"></div>
        <div class="field"><label for="fbEmail">Email <span class="req">*</span></label><input id="fbEmail" name="email" type="email" required maxlength="120" autocomplete="email"></div>
        <div class="field"><label for="fbCat">Category <span class="req">*</span></label><select id="fbCat" name="category" required><option>Feedback</option><option>Grievance</option><option>Suggestion</option><option>Technical Issue</option></select></div>
      </div>
      <div class="field" style="margin-top:14px"><label for="fbMsg">Message <span class="req">*</span></label><textarea id="fbMsg" name="message" required minlength="10" maxlength="2000"></textarea><small>10–2000 characters</small></div>
      <div id="fbStatus" style="margin-top:12px"></div>
      <div class="btn-row" style="margin-top:14px"><button class="btn btn-primary" type="submit">Submit</button><button class="btn btn-light" type="reset">Reset</button></div>
    </form>`);
  $('#fbForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const status = $('#fbStatus');
    const body = Object.fromEntries(new FormData(f));
    try {
      const r = await api('/public/feedback', { method: 'POST', body });
      status.innerHTML = `<div class="form-ok" role="status">Thank you. Your submission has been recorded. Reference number: <b>${esc(r.reference)}</b></div>`;
      f.reset();
    } catch (ex) { status.innerHTML = errorBox(ex); }
  };
}

// ---------------- Login ----------------
export async function login(main, { query }) {
  main.innerHTML = pageHead('Staff Login') + `<section class="section"><div class="container login-wrap">
    <form class="card accent-top" id="loginForm" novalidate aria-describedby="loginHelp">
      <h2>Sign in to the portal</h2>
      <p class="small muted" id="loginHelp">Use the credentials issued by your Administrator. All fields are mandatory.</p>
      <div class="field"><label for="lgEmail">Email ID <span class="req">*</span></label><input id="lgEmail" name="email" type="email" autocomplete="username" required></div>
      <div class="field" style="margin-top:12px"><label for="lgPass">Password <span class="req">*</span></label>
        <div style="display:flex;gap:6px"><input id="lgPass" name="password" type="password" autocomplete="current-password" required><button type="button" class="btn btn-light btn-sm" id="togglePw" aria-pressed="false">Show</button></div></div>
      <div class="field" style="margin-top:12px"><label for="lgCaptcha">Enter the result shown <span class="req">*</span></label>
        <div class="captcha-row"><img class="captcha-img" id="captchaImg" alt="Captcha loading" width="180" height="44"><button type="button" class="btn btn-light btn-sm" id="captchaRefresh" aria-label="Refresh captcha">↻</button><input id="lgCaptcha" name="captchaAnswer" inputmode="numeric" autocomplete="off" required maxlength="4"></div></div>
      <div id="loginErr" style="margin-top:12px"></div>
      <div class="btn-row" style="margin-top:16px"><button class="btn btn-primary" type="submit" id="loginBtn">Login</button><button class="btn btn-light" type="reset">Reset</button></div>
      <p class="small muted" style="margin-top:14px">🔒 Sessions expire after 20 minutes of inactivity. Do not share your password.</p>
    </form>
    <div>
      <div class="card"><h3>Instructions</h3><ul class="ticks small"><li>Accounts are role-based: <b>Admin</b>, <b>Engineer</b> or <b>Viewer</b>.</li><li>After 10 failed attempts, login is blocked for 15 minutes.</li><li>Forgot password? Contact the portal Administrator.</li></ul></div>
      <div class="card tinted" id="demoBox" style="margin-top:16px" hidden><h3>Demonstration accounts</h3><p class="small muted">Click a row to fill the form.</p>
        <div class="table-wrap"><table class="demo-creds"><thead><tr><th>Role</th><th>Email</th><th>Password</th></tr></thead><tbody>
          <tr data-e="admin@smengineers.demo" data-p="Admin@123" tabindex="0"><td><span class="badge role-ADMIN">ADMIN</span></td><td>admin@smengineers.demo</td><td class="mono">Admin@123</td></tr>
          <tr data-e="engineer@smengineers.demo" data-p="Engineer@123" tabindex="0"><td><span class="badge role-ENGINEER">ENGINEER</span></td><td>engineer@smengineers.demo</td><td class="mono">Engineer@123</td></tr>
          <tr data-e="viewer@smengineers.demo" data-p="Viewer@123" tabindex="0"><td><span class="badge role-VIEWER">VIEWER</span></td><td>viewer@smengineers.demo</td><td class="mono">Viewer@123</td></tr>
        </tbody></table></div></div>
    </div></div></section>`;

  let captchaId = null;
  const loadCaptcha = async () => {
    const c = await api('/auth/captcha');
    captchaId = c.id;
    const img = $('#captchaImg');
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(c.svg)}`;
    img.alt = (/aria-label="([^"]+)"/.exec(c.svg) || [])[1] || 'Captcha';
    $('#lgCaptcha').value = '';
  };
  await loadCaptcha();
  $('#captchaRefresh').onclick = loadCaptcha;
  $('#togglePw').onclick = (e) => {
    const p = $('#lgPass'); const show = p.type === 'password';
    p.type = show ? 'text' : 'password'; e.target.textContent = show ? 'Hide' : 'Show'; e.target.setAttribute('aria-pressed', String(show));
  };
  api('/public/stats').then(({ data }) => { $('#demoBox').hidden = !data.demo; }).catch(() => {});
  $$('#demoBox tr[data-e]').forEach((tr) => {
    const fill = () => { $('#lgEmail').value = tr.dataset.e; $('#lgPass').value = tr.dataset.p; $('#lgCaptcha').focus(); };
    tr.style.cursor = 'pointer'; tr.onclick = fill; tr.onkeydown = (e) => { if (e.key === 'Enter') fill(); };
  });
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const body = { ...Object.fromEntries(new FormData(e.target)), captchaId };
    const btn = $('#loginBtn');
    btn.disabled = true;
    $('#loginErr').innerHTML = '';
    try {
      const r = await api('/auth/login', { method: 'POST', body, retry: false });
      setSession(r.accessToken, r.user);
      toast(`Welcome, ${r.user.name}`, `Signed in as ${r.user.role}.`, 'ok');
      location.hash = `#${query.next && query.next.startsWith('/portal') ? query.next : '/portal'}`;
    } catch (ex) {
      $('#loginErr').innerHTML = errorBox(ex);
      await loadCaptcha().catch(() => {});
    } finally { btn.disabled = false; }
  };
}

export function notFound() {
  return `${pageHead('Page Not Found')}<section class="section"><div class="container"><div class="card"><h2>404 — The page you requested was not found</h2><p>It may have been moved or the address may be mistyped.</p><a class="btn btn-primary" href="#/">Go to Home</a> <a class="btn btn-light" href="#/sitemap">View Sitemap</a></div></div></section>`;
}

export { fmtDate, t, toast };
