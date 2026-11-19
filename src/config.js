const crypto = require('crypto');

const env = process.env.NODE_ENV || 'development';

function required(name, fallback) {
  const v = process.env[name];
  if (v) return v;
  if (env === 'production' && fallback === undefined) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return fallback;
}

module.exports = {
  env,
  isProd: env === 'production',
  isTest: env === 'test',
  port: Number(process.env.PORT || 3000),
  dbPath: process.env.DB_PATH || (env === 'test' ? ':memory:' : 'data/telemetry.db'),
  // In production set these via the hosting dashboard; random per-boot values are used otherwise.
  jwtSecret: required('JWT_SECRET', crypto.randomBytes(32).toString('hex')),
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTokenDays: Number(process.env.REFRESH_TOKEN_DAYS || 7),
  deviceApiKey: process.env.DEVICE_API_KEY || 'dev-device-key',
  simulator: process.env.SIMULATOR !== 'off' && env !== 'test',
  simulatorIntervalMs: Number(process.env.SIMULATOR_INTERVAL_MS || 2000),
  rawRetentionHours: Number(process.env.RAW_RETENTION_HOURS || 48),
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  seedDemoUsers: process.env.SEED_DEMO_USERS !== 'false',
};
