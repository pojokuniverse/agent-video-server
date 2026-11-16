// Registry provider video — provider-agnostic.
// Tiap provider mengekspor:
//   { id, name, desc, keyLabel, keyHint, needsEndpoint?, generate(job, apiKey, opts), testConnection(apiKey, opts) }
// generate() menerima key MILIK USER yang sedang login (dari vault terenkripsi),
// BUKAN key env global. Env global hanya fallback bila user belum isi key.
// API key HANYA dari env / vault — JANGAN PERNAH hardcode di file mana pun.
const mock = require('./mock');
const runway = require('./runway');
const kling = require('./kling');
const luma = require('./luma');
const veo = require('./veo');
const minimax = require('./minimax');
const custom = require('./custom');

const REGISTRY = { mock, runway, kling, luma, veo, minimax, custom };

// Urutan tampil di Settings (mock paling bawah karena itu mode demo).
const ORDER = ['runway', 'kling', 'luma', 'veo', 'minimax', 'custom', 'mock'];

function list() {
  return ORDER.map((id) => {
    const p = REGISTRY[id];
    return {
      id: p.id, name: p.name, desc: p.desc,
      keyLabel: p.keyLabel, keyHint: p.keyHint,
      needsEndpoint: !!p.needsEndpoint
    };
  });
}

function load(name) {
  const id = (name || 'mock').toLowerCase();
  if (REGISTRY[id]) return REGISTRY[id];
  console.warn('[provider] "' + id + '" tidak dikenal — fallback ke mock.');
  return mock;
}

function isKnown(name) { return !!REGISTRY[(name || '').toLowerCase()]; }

module.exports = { list, load, isKnown, ORDER };
