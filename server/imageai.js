// Image AI (APINEX) — thumbnail/poster untuk video yang sudah jadi.
// APINEX BUKAN provider video (verifikasi 15 Nov 19:07 WIB: 44 model /models
// semuanya teks/LLM, 6 model /media semuanya gambar, tidak ada tab Video).
// Yang dipakai di sini HANYA model gambarnya, untuk thumbnail/poster opsional.
// Endpoint OpenAI-compatible: POST https://api.apinex.bond/v1/images/generations
// Key: satu key APINEX (sk-apx-...) yang sama dengan Text AI, dibuat user
// sendiri di apinex.bond/keys — jangan buat key atas nama user.
// Harga per gambar (verifikasi 15 Nov 19:07 WIB): Nano Banana 2 ada varian
// FREE, GPT Image 2.6 Flare $0,05, Seedream 5 $0,02, Grok Imagine 2 $0,02.
// CATATAN ID MODEL: ID di bawah diturunkan dari nama model yang terverifikasi;
// bila API menolak dengan "model not found", cek ID persisnya di
// apinex.bond/models dan perbarui daftar ini.
const BASE = 'https://api.apinex.bond/v1/images/generations';

const IMAGE_MODELS = [
  { id: 'nano-banana-2', name: 'Nano Banana 2', priceLabel: 'FREE', price: 0, free: true },
  { id: 'gpt-image-2.6-flare', name: 'GPT Image 2.6 Flare', priceLabel: '$0,05/gambar', price: 0.05 },
  { id: 'seedream-5', name: 'Seedream 5', priceLabel: '$0,02/gambar', price: 0.02 },
  { id: 'grok-imagine-2', name: 'Grok Imagine 2', priceLabel: '$0,02/gambar', price: 0.02 }
];
const DEFAULT_MODEL = 'nano-banana-2';

function modelInfo(id) {
  return IMAGE_MODELS.find((m) => m.id === id) || IMAGE_MODELS[0];
}

// input: { title, prompt, apiKey, model }
// return: { imageUrl } (URL langsung) atau { imageBase64, mime } (base64).
async function generateThumbnail(input) {
  const model = modelInfo(input.model);
  const visualPrompt =
    'Poster/thumbnail vertikal 9:16 yang eye-catching untuk video berjudul "' +
    (input.title || input.prompt || 'video') + '". ' +
    'Ide video: ' + (input.prompt || input.title || '') + ' ' +
    'Satu tokoh/obyek utama besar di tengah, warna kontras tinggi, teks judul singkat ' +
    'yang mudah dibaca, gaya poster film modern.';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 90000);
  try {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + input.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model.id, prompt: visualPrompt, size: '1024x1536', n: 1 }),
      signal: ctrl.signal,
      redirect: 'manual'
    });
    clearTimeout(t);
    if (res.status === 401 || res.status === 403) throw new Error('APINEX: API key ditolak (401/403).');
    if (!res.ok) throw new Error('APINEX: HTTP ' + res.status + '.');
    const data = await res.json();
    const item = data && data.data && data.data[0];
    if (!item) throw new Error('APINEX: respons tanpa gambar.');
    if (item.url) return { imageUrl: item.url, model: model.id, price: model.price };
    if (item.b64_json) return { imageBase64: item.b64_json, mime: 'image/png', model: model.id, price: model.price };
    throw new Error('APINEX: respons tanpa URL maupun base64.');
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

async function testConnection(apiKey) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch('https://api.apinex.bond/v1/models', {
      headers: { Authorization: 'Bearer ' + apiKey },
      signal: ctrl.signal,
      redirect: 'manual'
    });
    clearTimeout(t);
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'API key ditolak (401/403).' };
    if (res.status === 200) return { ok: true, message: 'Koneksi OK — key diterima.' };
    return { ok: false, message: 'Respons HTTP ' + res.status + ' (tidak bisa dipastikan).' };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, message: 'Tidak dapat menjangkau APINEX: ' + e.message };
  }
}

module.exports = { IMAGE_MODELS, DEFAULT_MODEL, modelInfo, generateThumbnail, testConnection };
