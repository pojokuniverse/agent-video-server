// Text AI — HANYA untuk teks/naskah, BUKAN render video.
// Dua penyedia teks:
//   1. Xingchi (xingchiapi.com) — key dari env XINGCHI_API_KEY (server-side,
//      inject dari Secure Vault). Model: gpt-6-astra, gpt-6.1-sol (text-only).
//   2. APINEX (api.apinex.bond) — key user sendiri (sk-apx-...), disimpan
//      terenkripsi di vault seperti key video. Endpoint OpenAI-compatible.
//      Model teks FREE: free/gemini-4-hydrogen, free/kimi-k3,
//      free/deepseek-v4-pro-0813, free/minimax-m3.1-flash.
// APINEX BUKAN provider video (verifikasi 15 Nov 19:07 WIB: 44 model /models
// semuanya teks/LLM, 6 model /media semuanya gambar, tidak ada tab Video).
// Bila penyedia teks tidak tersedia / gagal -> fallback template lokal dan
// kembalikan source='template' supaya UI bisa melabelinya dengan jujur
// ("naskah template, bukan AI"). Pemakaian makan kuota user di penyedia itu.
const XINGCHI_BASE = 'https://xingchiapi.com/v1/chat/completions';
const XINGCHI_MODEL = 'gpt-6.1-sol';
const APINEX_BASE = 'https://api.apinex.bond/v1/chat/completions';
const APINEX_TEXT_MODELS = [
  { id: 'free/gemini-4-hydrogen', name: 'Gemini 4 Hydrogen (FREE)' },
  { id: 'free/kimi-k3', name: 'Kimi K3 (FREE)' },
  { id: 'free/deepseek-v4-pro-0813', name: 'DeepSeek V4 Pro (FREE)' },
  { id: 'free/minimax-m3.1-flash', name: 'MiniMax M3.1 Flash (FREE)' }
];
const APINEX_DEFAULT_MODEL = 'free/gemini-4-hydrogen';

function xingchiConfigured() {
  return !!process.env.XINGCHI_API_KEY;
}

async function postChat(url, apiKey, model, prompt, maxTokens) {
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens || 400
  };
  // Satu retry untuk timeout transient (perilaku terverifikasi konektor Xingchi).
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
        redirect: 'manual'
      });
      clearTimeout(t);
      if (res.status === 401 || res.status === 403) throw new Error('API key ditolak (401/403).');
      if (!res.ok) throw new Error('HTTP ' + res.status + '.');
      const data = await res.json();
      const text = data && data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content : '';
      if (!text || !text.trim()) throw new Error('Respons kosong.');
      return text.trim();
    } catch (e) {
      clearTimeout(t);
      if (attempt === 1) throw e;
    }
  }
  throw new Error('Tidak dapat dijangkau.');
}

async function xingchiChat(prompt, maxTokens) {
  if (!xingchiConfigured()) throw new Error('XINGCHI_API_KEY belum dikonfigurasi.');
  return postChat(XINGCHI_BASE, process.env.XINGCHI_API_KEY, XINGCHI_MODEL, prompt, maxTokens);
}

async function apinexChat(prompt, apiKey, model, maxTokens) {
  if (!apiKey) throw new Error('Key APINEX belum diisi.');
  return postChat(APINEX_BASE, apiKey, model || APINEX_DEFAULT_MODEL, prompt, maxTokens);
}

async function testXingchi() {
  try {
    await xingchiChat('Balas dengan satu kata: ok', 5);
    return { ok: true, message: 'Koneksi OK — Xingchi merespons.' };
  } catch (e) {
    return { ok: false, message: 'Xingchi gagal: ' + e.message };
  }
}

async function testApinex(apiKey, model) {
  try {
    await apinexChat('Balas dengan satu kata: ok', apiKey, model, 5);
    return { ok: true, message: 'Koneksi OK — APINEX merespons.' };
  } catch (e) {
    return { ok: false, message: 'APINEX gagal: ' + e.message };
  }
}

// ---------- Template lokal (fallback bila Text AI tidak tersedia) ----------
const TRENDS = ['Kucing oren', 'AI robot joget', 'Mukbang pedas', 'Drama kantor', 'Dance challenge'];

function templateAssist(input) {
  const topic = (input.prompt || '').trim() || 'ide acak';
  if (input.mode === 'popular') {
    const trend = TRENDS[Math.floor(Math.random() * TRENDS.length)];
    return 'Video vertikal 9:16, gaya ' + (input.style || 'realistis') + ': ' + topic +
      ' dengan sentuhan tren pekan ini (' + trend + '). ' +
      'Satu adegan utama yang kuat, gerakan kamera pelan, cahaya hangat, akhir yang mengejutkan.';
  }
  if (input.mode === 'funny') {
    return 'NASKAH LUCU — Premis: ' + topic + '\n' +
      'Adegan 1: tokoh utama mencoba hal mustahil dan gagal total.\n' +
      'Adegan 2: teman tokoh malah sukses tanpa sengaja, ekspresi kaget.\n' +
      'Adegan 3: punchline — tokoh pura-pura memang sengaja dari awal.\n' +
      'Visual: vertikal 9:16, ekspresi wajah dilebih-lebihkan, tempo cepat.';
  }
  if (input.mode === 'film' && input.filmKind === 'continue') {
    return 'LANJUTAN CERITA — dari "' + (input.parentTitle || 'film sebelumnya') + '":\n' +
      'Adegan 1: tokoh melanjutkan dari akhir episode lalu — ' + topic + '.\n' +
      'Adegan 2: konflik baru muncul, tokoh harus memilih.\n' +
      'Adegan 3: klimaks kecil + gantungan untuk episode berikut.\n' +
      'Visual: vertikal 9:16, sinematik, warna konsisten dengan episode sebelumnya.';
  }
  return 'STORYBOARD FILM BARU — "' + topic + '":\n' +
    'Adegan 1 (pembuka): perkenalkan tokoh + dunia film ini.\n' +
    'Adegan 2 (konflik): masalah muncul, taruhan makin tinggi.\n' +
    'Adegan 3 (penutup): penyelesaian + gantungan cerita.\n' +
    'Visual: vertikal 9:16, sinematik, satu palet warna konsisten.';
}

// ---------- Assist utama ----------
// input: { mode, prompt, style, filmKind, parentTitle, parentPrompt }
// config: { provider: 'xingchi' | 'apinex' | 'template', apiKey?, model? }
// return: { text, source: 'xingchi' | 'apinex' | 'template', model? }
async function assist(input, config = {}) {
  const provider = config.provider || 'xingchi';
  const topic = (input.prompt || '').trim();
  let systemPrompt;
  if (input.mode === 'popular') {
    systemPrompt =
      'Kamu penulis ide video viral Indonesia. Tren pekan ini: ' + TRENDS.join(', ') + '.\n' +
      'Tema dari user: "' + (topic || 'bebas') + '".\n' +
      'Buatkan SATU prompt video (bahasa Inggris, 2-3 kalimat) untuk AI video generator: ' +
      'deskripsi visual vertikal 9:16 yang kuat, terinspirasi tren di atas, satu adegan utama, ' +
      'gerakan kamera, suasana. Jawab HANYA prompt-nya, tanpa penjelasan.';
  } else if (input.mode === 'funny') {
    systemPrompt =
      'Kamu penulis skenario komedi Indonesia. Premis dari user: "' + (topic || 'bebas') + '".\n' +
      'Tulis naskah video lucu singkat (Bahasa Indonesia): 3 adegan dengan setup dan punchline, ' +
      'lalu satu baris "Visual:" berisi prompt visual bahasa Inggris untuk AI video generator ' +
      '(vertikal 9:16, ekspresi dilebih-lebihkan). Singkat, padat, langsung naskah.';
  } else if (input.mode === 'film' && input.filmKind === 'continue') {
    systemPrompt =
      'Kamu penulis cerita film bersambung. Film sebelumnya: "' + (input.parentTitle || 'film sebelumnya') + '"' +
      (input.parentPrompt ? ' (ide awal: ' + input.parentPrompt + ')' : '') + '.\n' +
      'Arahan user untuk episode lanjutan: "' + (topic || 'lanjutkan cerita') + '".\n' +
      'Tulis kelanjutan cerita (Bahasa Indonesia): sinopsis 2 kalimat + storyboard 3 adegan ' +
      '(adegan, isi, suasana), lalu satu baris "Visual:" berisi prompt visual bahasa Inggris ' +
      'untuk AI video generator (vertikal 9:16, sinematik, konsisten dengan episode sebelumnya).';
  } else {
    systemPrompt =
      'Kamu penulis cerita film. Ide film baru dari user: "' + (topic || 'bebas') + '".\n' +
      'Tulis (Bahasa Indonesia): judul film + sinopsis 2 kalimat + storyboard 3 adegan ' +
      '(pembuka, konflik, penutup dengan gantungan cerita), lalu satu baris "Visual:" berisi ' +
      'prompt visual bahasa Inggris untuk AI video generator (vertikal 9:16, sinematik).';
  }
  const fallback = (reason) => ({
    text: templateAssist(input), source: 'template', fallbackReason: reason || undefined
  });
  try {
    if (provider === 'apinex') {
      const text = await apinexChat(systemPrompt, config.apiKey, config.model, 500);
      return { text, source: 'apinex', model: config.model || APINEX_DEFAULT_MODEL };
    }
    if (provider === 'xingchi') {
      const text = await xingchiChat(systemPrompt, 500);
      return { text, source: 'xingchi', model: XINGCHI_MODEL };
    }
    return fallback('provider teks = template');
  } catch (e) {
    console.warn('[textai] ' + provider + ' gagal (' + e.message + ') — fallback template.');
    return fallback(e.message);
  }
}

module.exports = {
  configured: xingchiConfigured,
  assist, xingchiChat, apinexChat, testXingchi, testApinex,
  MODEL: XINGCHI_MODEL,
  APINEX_TEXT_MODELS, APINEX_DEFAULT_MODEL
};
