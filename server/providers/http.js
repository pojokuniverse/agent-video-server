// Helper HTTP untuk provider video: fetch + timeout + error yang rapi.
// TIDAK PERNAH me-log API key / Authorization header.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJSON(url, opts = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* bukan JSON */ }
    return { status: res.status, ok: res.ok, data, text: text.slice(0, 500) };
  } finally {
    clearTimeout(t);
  }
}

function authError(status, providerName) {
  if (status === 401 || status === 403) {
    return new Error(providerName + ': API key ditolak (401/403) — cek key di Settings.');
  }
  return null;
}

// Polling generik: fn() mengembalikan { done, result } atau throw.
async function poll(fn, { intervalMs = 5000, timeoutMs = 180000, label = 'job' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const out = await fn();
    if (out.done) return out.result;
    if (Date.now() > deadline) throw new Error(label + ' masih diproses setelah ' + Math.round(timeoutMs / 1000) + ' dtk — coba cek lagi nanti (job tetap jalan di provider).');
    await sleep(intervalMs);
  }
}

module.exports = { fetchJSON, authError, poll, sleep };
