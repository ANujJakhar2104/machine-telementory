const config = require('../config');

function line(level, msg) {
  if (config.isTest) return;
  const out = `${new Date().toISOString()} ${level.padEnd(5)} ${msg}`;
  (level === 'ERROR' ? console.error : console.log)(out);
}

module.exports = {
  info: (m) => line('INFO', m),
  warn: (m) => line('WARN', m),
  error: (m) => line('ERROR', m),
};
