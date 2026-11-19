const http = require('http');
const { Server } = require('socket.io');
const config = require('./config');
const db = require('./db');
const { seed } = require('./db/seed');
const { createApp } = require('./app');
const realtime = require('./services/realtime');
const telemetry = require('./services/telemetry');
const simulator = require('./services/simulator');
const { verifyAccessToken } = require('./middleware/auth');
const logger = require('./utils/logger');

db.open();
seed();

const app = createApp();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: config.corsOrigins.length ? config.corsOrigins : false } });

// Live updates are only for logged-in users: the socket handshake must carry a valid access token.
io.use((socket, next) => {
  try {
    const payload = verifyAccessToken(socket.handshake.auth?.token);
    const user = db.get('SELECT id, role, is_active FROM users WHERE id = ?', payload.sub);
    if (!user || !user.is_active) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});
io.on('connection', (socket) => socket.join('authenticated'));
realtime.attach(io);

const jobs = [
  setInterval(() => { try { telemetry.flush(); } catch (e) { logger.error(`[flush] ${e.message}`); } }, 1000),
  setInterval(() => { try { telemetry.refreshHealth(); } catch (e) { logger.error(`[health] ${e.message}`); } }, 5000),
  setInterval(() => { try { telemetry.rollupHourly(); } catch (e) { logger.error(`[rollup] ${e.message}`); } }, 5 * 60000),
  setInterval(() => {
    try {
      const n = telemetry.purgeRaw(config.rawRetentionHours);
      if (n) logger.info(`[retention] purged ${n} raw readings older than ${config.rawRetentionHours} h`);
    } catch (e) { logger.error(`[retention] ${e.message}`); }
  }, 60 * 60000),
];

if (config.simulator) simulator.start(config.simulatorIntervalMs);

server.listen(config.port, () => logger.info(`SM Telemetry Portal listening on http://localhost:${config.port}`));

function shutdown(sig) {
  logger.info(`${sig} received, shutting down`);
  simulator.stop();
  jobs.forEach(clearInterval);
  try { telemetry.flush(); telemetry.rollupHourly(); } catch { /* best effort */ }
  io.close();
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
