// Vault API key per user Telegram — TERENKRIPSI (AES-256-GCM).
// - Satu file JSON per server: server/data/vault.json (chmod 600).
// - Kunci enkripsi dari env ENCRYPTION_KEY (64 hex = 32 byte) atau
//   ENCRYPTION_PASSPHRASE (diturunkan via scrypt). Bila keduanya kosong,
//   kunci acak dibuat sekali dan disimpan di server/data/.encryption-key (0600)
//   + peringatan keras di log (key hilang = vault lama tidak bisa dibuka).
// - Yang disimpan per provider: ciphertext + last4 + status + updatedAt.
// - Key UTUH tidak pernah dikirim ke client, tidak pernah di-log,
//   dan tidak pernah tampil di UI (hanya •••• + 4 karakter terakhir).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const VAULT_PATH = path.join(DATA_DIR, 'vault.json');
const KEY_PATH = path.join(DATA_DIR, '.encryption-key');
const ALGO = 'aes-256-gcm';

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getEncryptionKey() {
  if (process.env.ENCRYPTION_KEY) {
    const hex = process.env.ENCRYPTION_KEY.trim();
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('ENCRYPTION_KEY harus 64 karakter hex (32 byte).');
    return Buffer.from(hex, 'hex');
  }
  if (process.env.ENCRYPTION_PASSPHRASE) {
    const saltPath = path.join(DATA_DIR, '.vault-salt');
    let salt;
    if (fs.existsSync(saltPath)) salt = fs.readFileSync(saltPath);
    else {
      ensureDir();
      salt = crypto.randomBytes(16);
      fs.writeFileSync(saltPath, salt, { mode: 0o600 });
    }
    return crypto.scryptSync(process.env.ENCRYPTION_PASSPHRASE, salt, 32);
  }
  ensureDir();
  if (fs.existsSync(KEY_PATH)) return fs.readFileSync(KEY_PATH);
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_PATH, key, { mode: 0o600 });
  console.warn('[vault] PERINGATAN: ENCRYPTION_KEY/ENCRYPTION_PASSPHRASE tidak di-set — kunci acak dibuat di server/data/.encryption-key. Backup file itu; bila hilang, semua key tersimpan tidak bisa dibuka.');
  return key;
}

function encrypt(plain) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: data.toString('base64')
  };
}

function decrypt(blob) {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(blob.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  const out = Buffer.concat([decipher.update(Buffer.from(blob.data, 'base64')), decipher.final()]);
  return out.toString('utf8');
}

// ---------- Store ----------
function loadVault() {
  ensureDir();
  if (!fs.existsSync(VAULT_PATH)) return { users: {} };
  try {
    return JSON.parse(fs.readFileSync(VAULT_PATH, 'utf8'));
  } catch (e) {
    console.error('[vault] vault.json rusak, mulai dari kosong:', e.message);
    return { users: {} };
  }
}

function saveVault(vault) {
  ensureDir();
  const tmp = VAULT_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(vault, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, VAULT_PATH);
  try { fs.chmodSync(VAULT_PATH, 0o600); } catch (e) {}
}

function getUser(vault, userId) {
  if (!vault.users[userId]) {
    vault.users[userId] = {
      activeProvider: 'mock', fallbackEnabled: true, providers: {},
      textProvider: 'xingchi', // xingchi | apinex | template
      apinex: null // { enc, last4, status, textModel, imageModel, updatedAt } — SATU key APINEX untuk teks + gambar
    };
  }
  return vault.users[userId];
}

// ---------- APINEX (satu key untuk Text AI + Image AI) ----------
// Key APINEX format sk-apx-..., dibuat user sendiri di apinex.bond/keys.
// APINEX BUKAN provider video (verifikasi 15 Nov 19:07 WIB: 44 model /models
// semuanya teks/LLM, 6 model /media semuanya gambar, tidak ada tab Video).
const APINEX_TEXT_MODELS = [
  'free/gemini-4-hydrogen', 'free/kimi-k3',
  'free/deepseek-v4-pro-0813', 'free/minimax-m3.1-flash'
];
const APINEX_IMAGE_MODELS = ['nano-banana-2', 'gpt-image-2.6-flare', 'seedream-5', 'grok-imagine-2'];

function saveApinexKey(userId, apiKey, opts = {}) {
  const vault = loadVault();
  const user = getUser(vault, userId);
  user.apinex = {
    enc: encrypt(apiKey),
    last4: last4(apiKey),
    status: 'untested',
    textModel: APINEX_TEXT_MODELS.includes(opts.textModel) ? opts.textModel : 'free/gemini-4-hydrogen',
    imageModel: APINEX_IMAGE_MODELS.includes(opts.imageModel) ? opts.imageModel : 'nano-banana-2',
    updatedAt: new Date().toISOString()
  };
  saveVault(vault);
  return publicApinex(user);
}

function getApinexKey(userId) {
  const vault = loadVault();
  const rec = vault.users[userId] && vault.users[userId].apinex;
  if (!rec || !rec.enc) return null;
  try {
    return { apiKey: decrypt(rec.enc), textModel: rec.textModel, imageModel: rec.imageModel };
  } catch (e) {
    console.error('[vault] gagal dekripsi key APINEX untuk user ' + userId + ':', e.message);
    return null;
  }
}

function deleteApinexKey(userId) {
  const vault = loadVault();
  const user = getUser(vault, userId);
  user.apinex = null;
  if (user.textProvider === 'apinex') user.textProvider = 'template';
  saveVault(vault);
}

function setApinexStatus(userId, status) {
  const vault = loadVault();
  const user = getUser(vault, userId);
  if (!user.apinex) return;
  user.apinex.status = status;
  user.apinex.checkedAt = new Date().toISOString();
  saveVault(vault);
}

function setApinexModels(userId, opts = {}) {
  const vault = loadVault();
  const user = getUser(vault, userId);
  if (!user.apinex) return;
  if (APINEX_TEXT_MODELS.includes(opts.textModel)) user.apinex.textModel = opts.textModel;
  if (APINEX_IMAGE_MODELS.includes(opts.imageModel)) user.apinex.imageModel = opts.imageModel;
  saveVault(vault);
}

function setTextProvider(userId, provider) {
  const vault = loadVault();
  const user = getUser(vault, userId);
  if (['xingchi', 'apinex', 'template'].includes(provider)) user.textProvider = provider;
  saveVault(vault);
}

function publicApinex(user) {
  const rec = user.apinex;
  if (!rec) return { hasKey: false, last4: null, status: 'none', textModel: 'free/gemini-4-hydrogen', imageModel: 'nano-banana-2' };
  return {
    hasKey: true, last4: rec.last4, status: rec.status || 'untested',
    textModel: rec.textModel, imageModel: rec.imageModel,
    updatedAt: rec.updatedAt, checkedAt: rec.checkedAt || null
  };
}

function last4(key) { return (key || '').slice(-4); }

// Simpan key (terenkripsi). Mengembalikan info aman untuk client.
function saveKey(userId, providerId, apiKey, extra = {}) {
  const vault = loadVault();
  const user = getUser(vault, userId);
  user.providers[providerId] = {
    enc: encrypt(apiKey),
    last4: last4(apiKey),
    status: 'untested',
    updatedAt: new Date().toISOString(),
    endpoint: extra.endpoint || undefined,
    model: extra.model || undefined
  };
  saveVault(vault);
  return publicProvider(user, providerId);
}

// Hapus key.
function deleteKey(userId, providerId) {
  const vault = loadVault();
  const user = getUser(vault, userId);
  delete user.providers[providerId];
  if (user.activeProvider === providerId) user.activeProvider = 'mock';
  saveVault(vault);
}

// Ambil key utuh (HANYA dipakai server saat generate/test — jangan kirim ke client).
function getKey(userId, providerId) {
  const vault = loadVault();
  const rec = vault.users[userId] && vault.users[userId].providers[providerId];
  if (!rec || !rec.enc) return null;
  try {
    return { apiKey: decrypt(rec.enc), endpoint: rec.endpoint, model: rec.model };
  } catch (e) {
    console.error('[vault] gagal dekripsi key ' + providerId + ' untuk user ' + userId + ':', e.message);
    return null;
  }
}

function setStatus(userId, providerId, status) {
  const vault = loadVault();
  const user = getUser(vault, userId);
  if (!user.providers[providerId]) return;
  user.providers[providerId].status = status;
  user.providers[providerId].checkedAt = new Date().toISOString();
  saveVault(vault);
}

function setActive(userId, providerId) {
  const vault = loadVault();
  const user = getUser(vault, userId);
  user.activeProvider = providerId;
  saveVault(vault);
}

function setFallback(userId, enabled) {
  const vault = loadVault();
  const user = getUser(vault, userId);
  user.fallbackEnabled = !!enabled;
  saveVault(vault);
}

// Info aman untuk client (tanpa key, tanpa ciphertext).
function publicProvider(user, providerId) {
  const rec = user.providers[providerId];
  if (!rec) return { id: providerId, hasKey: false, last4: null, status: 'none' };
  return {
    id: providerId, hasKey: true, last4: rec.last4, status: rec.status || 'untested',
    updatedAt: rec.updatedAt, checkedAt: rec.checkedAt || null,
    endpoint: rec.endpoint || null, model: rec.model || null
  };
}

function publicSettings(userId) {
  const vault = loadVault();
  const user = getUser(vault, userId);
  return {
    userId,
    activeProvider: user.activeProvider || 'mock',
    fallbackEnabled: user.fallbackEnabled !== false
  };
}

module.exports = {
  saveKey, deleteKey, getKey, setStatus, setActive, setFallback,
  publicProvider, publicSettings, loadVault, getUser, last4,
  saveApinexKey, getApinexKey, deleteApinexKey, setApinexStatus,
  setApinexModels, setTextProvider, publicApinex,
  APINEX_TEXT_MODELS, APINEX_IMAGE_MODELS
};
