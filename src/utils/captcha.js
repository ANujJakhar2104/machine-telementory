const crypto = require('crypto');

// Simple arithmetic image captcha (as on most public-sector login pages). Answers live in memory for 5 minutes.
const store = new Map();
const TTL = 5 * 60 * 1000;

function sweep() {
  const now = Date.now();
  for (const [k, v] of store) if (v.exp < now) store.delete(k);
}

function create() {
  sweep();
  const a = crypto.randomInt(2, 20);
  const b = crypto.randomInt(1, 10);
  const plus = crypto.randomInt(0, 2) === 0 || a <= b;
  const answer = plus ? a + b : a - b;
  const text = `${a} ${plus ? '+' : '−'} ${b} = ?`;
  const id = crypto.randomUUID();
  store.set(id, { answer: String(answer), exp: Date.now() + TTL });

  const chars = [...text].map((ch, i) => {
    const rot = crypto.randomInt(-12, 13);
    const y = 30 + crypto.randomInt(-3, 4);
    return `<text x="${14 + i * 15}" y="${y}" transform="rotate(${rot} ${14 + i * 15} ${y})">${ch}</text>`;
  }).join('');
  const lines = Array.from({ length: 4 }, () =>
    `<line x1="${crypto.randomInt(0, 60)}" y1="${crypto.randomInt(0, 44)}" x2="${crypto.randomInt(120, 180)}" y2="${crypto.randomInt(0, 44)}" stroke="#8a97ab" stroke-width="1"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="44" viewBox="0 0 180 44" role="img" aria-label="Captcha: ${text.replace('−', 'minus')}"><rect width="180" height="44" fill="#eef2f7"/>${lines}<g font-family="Courier New, monospace" font-size="22" font-weight="700" fill="#1b3a6b">${chars}</g></svg>`;
  return { id, svg };
}

function verify(id, answer) {
  const entry = id && store.get(id);
  if (!entry) return false;
  store.delete(id); // single use
  return entry.exp > Date.now() && String(answer ?? '').trim() === entry.answer;
}

// test helper
function _answer(id) { return store.get(id)?.answer; }

module.exports = { create, verify, _answer };
