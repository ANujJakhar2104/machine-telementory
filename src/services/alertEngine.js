// Pure alerting logic: rolling statistics, z-score, consecutive-reading confirmation and cooldown.
// No database access here, so it is fully unit-testable.

class SensorStats {
  constructor({ alpha = 0.05, warmup = 20 } = {}) {
    this.alpha = alpha;
    this.warmup = warmup;
    this.n = 0;
    this.mean = 0;
    this.variance = 0;
  }

  /** Returns the z-score of `value` against the stats seen so far (null while warming up), then learns from it. */
  push(value) {
    let z = null;
    if (this.n >= this.warmup) {
      const sd = Math.sqrt(this.variance);
      z = sd > 1e-9 ? (value - this.mean) / sd : 0;
    }
    if (this.n === 0) {
      this.mean = value;
    } else {
      // Learn slowly from abnormal readings so a developing fault does not become the new "normal" too fast.
      const a = this.n < this.warmup ? 1 / (this.n + 1) : z !== null && Math.abs(z) > 3 ? this.alpha / 5 : this.alpha;
      const diff = value - this.mean;
      this.mean += a * diff;
      this.variance = (1 - a) * (this.variance + a * diff * diff);
    }
    this.n += 1;
    return z;
  }
}

function conditionMet(rule, value, z) {
  switch (rule.operator) {
    case '>': return value > rule.threshold;
    case '<': return value < rule.threshold;
    case 'ZSCORE': return z !== null && Math.abs(z) > rule.threshold;
    default: return false;
  }
}

/**
 * Evaluates one rule for one reading and mutates `state` ({ streak, active, lastFired }).
 * Fires only on a transition into the bad state (state-change alerting) and never within the cooldown.
 */
function evaluateRule(rule, value, z, state, now = Date.now()) {
  if (!rule.enabled) { state.streak = 0; state.active = false; return false; }
  const met = conditionMet(rule, value, z);
  state.streak = met ? (state.streak || 0) + 1 : 0;
  const triggered = state.streak >= (rule.consecutive || 1);
  if (!triggered) { state.active = false; return false; }
  if (state.active) return false;
  state.active = true;
  const cooledDown = state.lastFired == null || now - state.lastFired >= rule.cooldown_s * 1000;
  if (!cooledDown) return false;
  state.lastFired = now;
  return true;
}

const SEVERITY_PENALTY = { CRITICAL: 30, WARNING: 12, INFO: 3 };

/** Health score 0-100: starts at 100, unresolved alerts and current abnormality pull it down. */
function healthScore(openAlerts, maxAbsZ = 0) {
  let score = 100;
  for (const a of openAlerts) {
    const p = SEVERITY_PENALTY[a.severity] || 0;
    score -= a.status === 'ACKNOWLEDGED' ? p / 2 : p;
  }
  score -= Math.min(15, Math.max(0, (maxAbsZ || 0) - 1) * 3);
  return Math.round(Math.max(0, Math.min(100, score)));
}

function describe(rule, sensor, machine, value, z) {
  const v = `${value.toFixed(2)} ${sensor.unit}`;
  if (rule.operator === 'ZSCORE') {
    return `${machine.machine_code}: abnormal ${sensor.type} (${v}, z-score ${z.toFixed(1)}) for ${rule.consecutive} readings in a row`;
  }
  const word = rule.severity === 'CRITICAL' ? 'crossed hard limit' : rule.severity === 'WARNING' ? 'crossed soft limit' : 'is close to its limit';
  return `${machine.machine_code}: ${sensor.type} ${v} ${word} (${rule.operator} ${rule.threshold} ${sensor.unit})`;
}

module.exports = { SensorStats, evaluateRule, conditionMet, healthScore, describe, SEVERITY_PENALTY };
