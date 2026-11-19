# Machine Telemetry & Predictive Maintenance Portal — SM Engineers

A role-based (RBAC) web portal styled like a public-sector website. It does four things:

- monitors live CNC/VMC sensor data (temperature, vibration, spindle load)
- predicts failures with z-score and threshold rules
- scores the health of every machine
- turns critical alerts into maintenance tickets

Internship project by **Puneet Kumar (BT23CSH006)**, IIIT Nagpur. Mentor: Dr. Nishat Ansari. Industry guide: Mr. Rajesh Kumar (Technical Head).

## Features

| Area | What is included |
|---|---|
| Public website | Home with live figures, About, Project overview, Architecture, Technology, RBAC matrix, Sitemap, Help/Accessibility, Website Policies, Feedback/Grievance form |
| Accessibility | Skip link, text size A-/A/A+, high-contrast mode, English/हिन्दी toggle, pausable "What's New" ticker, keyboard focus styles, screen-reader labels |
| Security | JWT access token (15 min) and rotating httpOnly refresh cookie, bcrypt, login captcha, rate limiting, Helmet/CSP, parameterised SQL, validation, audit trail, 20-minute idle logout |
| RBAC | Every API route checks a permission on the server (see `src/rbac.js`); the menus and buttons in the browser follow the same permissions |
| Live data | Socket.IO events `machine:update`, `alert:new`, `alert:update`, `ticket:update`; Chart.js charts |
| Alert engine | Rolling mean/std z-score with 3-in-a-row confirmation, info/soft/hard limits, per-rule cooldown, state-change alerting |
| Maintenance | Critical alert or health below 40 → auto-ticket assigned to the least-loaded engineer and an email (outbox) |
| Reports | Daily/weekly uptime, summary, MTTR, CSV export (readings / alerts / tickets) |
| Admin | Users and roles, notices, feedback inbox, audit trail, system status, email outbox, fault simulator |
| API docs | Swagger UI at `/api-docs` |

### Roles

| Role | Can do |
|---|---|
| **ADMIN** | Everything: machines, users, rules, assign/close tickets, notices, feedback, audit, system, fault simulation |
| **ENGINEER** | Acknowledge/resolve alerts, edit alert rules, create tickets, update own tickets, export CSV |
| **VIEWER** | Read-only dashboards, machines, alerts, tickets, reports |

Demo accounts (created when `SEED_DEMO_USERS=true`):

| Role | Email | Password |
|---|---|---|
| Admin | admin@smengineers.demo | Admin@123 |
| Engineer | engineer@smengineers.demo | Engineer@123 |
| Viewer | viewer@smengineers.demo | Viewer@123 |

## Run locally

Requires Node.js 22.13 or newer (it uses the built-in `node:sqlite`).

```bash
npm install
npm start          # http://localhost:3000
npm test           # 20 unit + API tests (node:test + Supertest)
```

A built-in simulator streams readings for 5 machines every 2 seconds and starts a realistic fault every few minutes. An Admin can also trigger one from **Machines → ⚡ Fault**.

## Deploy on Render (free)

1. Push this folder to a new GitHub repository.
2. In Render, choose **New → Blueprint** and select the repo. `render.yaml` sets everything up: build, start, health check, and generated `JWT_SECRET` / `DEVICE_API_KEY`.
3. Open the `.onrender.com` URL.

Notes on the free plan:
- The service sleeps after about 15 minutes without traffic. The first visit after that takes about 30–60 seconds.
- The disk is temporary, so the SQLite database is re-created (and re-seeded) on every deploy or restart. To keep data, attach a Render persistent disk (paid) and point `DB_PATH` at it.
- For a real deployment, set `SEED_DEMO_USERS=false`, log in as the seeded admin, and change the password at once.

Docker: `docker build -t sm-portal . && docker run -p 3000:3000 -e JWT_SECRET=... sm-portal`

## Real machines

Real machines (or an MQTT bridge) send readings to the same pipeline as the simulator:

```http
POST /api/v1/telemetry
x-device-key: <DEVICE_API_KEY>
Content-Type: application/json

{ "machine_code": "CNC-01", "ts": 1767225600000, "temperature": 54.2, "vibration": 2.9, "load": 61 }
```

Set `SIMULATOR=off` when real data is flowing.

## Project layout

```
src/
  server.js          HTTP + Socket.IO, background jobs (batch flush, health, hourly roll-up, retention)
  app.js             Express app, security headers, static site, Swagger
  rbac.js            role → permission map
  db/                schema.sql (8 core tables + supporting), seed, query helpers
  routes/            auth, machines, alerts, tickets, rules, reports, users, admin, public
  services/          telemetry ingestion, alert engine, tickets, notifier, simulator, realtime
public/              government-style SPA (vanilla JS modules, no build step)
tests/               node:test unit + Supertest integration tests
```

How this build differs from the slides: the slides list MySQL, Redis and an MQTT broker. To make free one-service hosting possible, this build uses SQLite (same schema), in-process caching and buffering (the role Redis plays), and an HTTP device endpoint plus a simulator in place of the broker. The layered design keeps these swappable.
