const test = require('node:test');
const assert = require('node:assert/strict');
const { SensorStats, evaluateRule, healthScore } = require('../src/services/alertEngine');

test('z-score is null during warm-up and large for an outlier', () => {
  const s = new SensorStats({ warmup: 20 });
  for (let i = 0; i < 20; i += 1) assert.equal(s.push(50 + (i % 2 ? 0.5 : -0.5)), null);
  const zNormal = s.push(50.3);
  assert.ok(Math.abs(zNormal) < 3, `normal reading z=${zNormal}`);
  const zSpike = s.push(60);
  assert.ok(zSpike > 3, `spike z=${zSpike}`);
});

test('z-score rule needs N readings in a row', () => {
  const rule = { operator: 'ZSCORE', threshold: 3, consecutive: 3, cooldown_s: 300, enabled: 1 };
  const st = {};
  assert.equal(evaluateRule(rule, 0, 4, st, 1000), false);
  assert.equal(evaluateRule(rule, 0, 1, st, 2000), false); // streak broken: random spike ignored
  assert.equal(evaluateRule(rule, 0, 4, st, 3000), false);
  assert.equal(evaluateRule(rule, 0, 5, st, 4000), false);
  assert.equal(evaluateRule(rule, 0, 6, st, 5000), true);
});

test('limit rule fires once per state change and respects cooldown', () => {
  const rule = { operator: '>', threshold: 90, consecutive: 1, cooldown_s: 60, enabled: 1 };
  const st = {};
  assert.equal(evaluateRule(rule, 95, null, st, 0), true);
  assert.equal(evaluateRule(rule, 96, null, st, 1000), false); // still bad: no repeat
  assert.equal(evaluateRule(rule, 80, null, st, 2000), false); // recovered
  assert.equal(evaluateRule(rule, 97, null, st, 3000), false); // bad again but inside cooldown
  assert.equal(evaluateRule(rule, 80, null, st, 4000), false);
  assert.equal(evaluateRule(rule, 97, null, st, 70000), true); // after cooldown
});

test('disabled rules never fire', () => {
  const rule = { operator: '>', threshold: 1, consecutive: 1, cooldown_s: 0, enabled: 0 };
  assert.equal(evaluateRule(rule, 100, null, {}, 0), false);
});

test('health score starts at 100 and drops with alerts', () => {
  assert.equal(healthScore([]), 100);
  assert.equal(healthScore([{ severity: 'CRITICAL', status: 'OPEN' }]), 70);
  assert.equal(healthScore([{ severity: 'CRITICAL', status: 'ACKNOWLEDGED' }]), 85);
  assert.equal(healthScore(Array(5).fill({ severity: 'CRITICAL', status: 'OPEN' })), 0);
  assert.ok(healthScore([], 6) < 100);
});
