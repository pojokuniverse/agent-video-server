# Agent Video — Telegram Mini App

AI bikin video, siap upload ke sosmed yang terhubung (Facebook, YouTube, X).
Login pakai Telegram. Home punya 3 mode:

| Mode | Cara kerja |
|---|---|
| 🔥 Popular Video | AI bikin video berdasarkan video populer pekan ini (tren diambil dari `GET /api/trends`) |
| 😂 Funny Video | AI bikin video lucu dari prompt kamu |
| 🎞️ Film Video | AI bikin video film. Ada 2 sub-opsi: **New Film** (film baru) atau **Lanjutkan Cerita** (lanjut dari film sebelumnya di riwayat) |

Dua bagian AI yang terpisah:

| Bagian | Teknologi | Key dari mana |
|---|---|---|
| **Teks / naskah** (ide prompt Popular, skrip lucu, lanjutan cerita + storyboard Film) | **Xingchi** (chat/text-only, model `gpt-6-astra` / `gpt-6.1-sol`) — server-side | Env server `XINGCHI_API_KEY` (inject saat deploy dari Secure Vault) |
| **Render video** | Provider video AI aktif (Runway / Kling / Luma / Veo / MiniMax / Custom) | Key user di menu **Settings** (per provider, terenkripsi) |

> ⚠️ Xingchi **TIDAK punya model video** — key Xingchi tidak bisa dan tidak dipakai untuk render video. Render video tetap butuh key provider video dari Settings.

## Struktur

```
agent-video/
├── README.md                 # file ini
├── webapp/                   # Telegram Mini App (frontend)
│   ├── index.html            # UI: login, home, form, job, riwayat, sosmed, settings
│   ├── app.js                # logika WebApp + mode demo (mock lokal)
│   ├── style.css             # tema gelap, ikut tema Telegram
│   ├── sample-popular.mp4    # video contoh (provider mock)
│   ├── sample-funny.mp4
│   └── sample-film.mp4
└── server/                   # backend + bot Telegram
    ├── index.js              # Express API + bot grammy + sajikan WebApp
    ├── package.json
    ├── .env.example          # contoh env (JANGAN isi token/key asli di sini)
    ├── vault.js              # penyimpanan API key user: AES-256-GCM, per Telegram user id
    ├── textai.js             # Text AI Xingchi (naskah saja) + fallback template lokal
    └── providers/            # provider-agnostic: tiap modul terima key user, bukan env global
        ├── index.js          # registry + loader provider
        ├── http.js           # helper fetch/polling
        ├── mock.js           # provider demo: kembalikan video contoh
        ├── runway.js         # Runway Gen-4 Turbo
        ├── kling.js          # Kling v1 (JWT AccessKey:SecretKey)
        ├── luma.js           # Luma Dream Machine
        ├── veo.js            # Google Veo 3 via Gemini API
        ├── minimax.js        # MiniMax / Hailuo T2V-01
        └── custom.js         # Custom / OpenAI-compatible endpoint
```

## Cara jalanin lokal

```bash
cd server
npm install
cp .env.example .env   # lalu isi bila perlu (lihat bawah)
npm start              # jalan di http://localhost:3000/
```

Buka `http://localhost:3000/` di browser — WebApp langsung jalan (mode demo
bila dibuka di luar Telegram). Alur lengkap sudah bisa dicoba: pilih mode →
isi prompt → Generate → progress → video hasil → tombol upload (stub).

## Cara pasang bot Telegram (BotFather)

1. Chat `@BotFather` di Telegram → `/newbot` → ikuti langkahnya → salin token.
2. `/setmenubutton` → pilih bot → kirim URL WebApp publik kamu
   (mis. `https://agent-video.example.com/`).
3. Di server, isi `.env`:
   ```
   BOT_TOKEN=<token dari BotFather>
   WEBAPP_URL=https://agent-video.example.com/
   PORT=3000
   ```
4. Restart server. `/start` di bot akan menampilkan tombol **🎬 Buka Agent Video**.

## Settings — API key video AI sendiri

Buka tab **⚙️ Settings** di WebApp:

1. **Pilih provider aktif** dari dropdown (Runway, Kling, Luma Dream Machine,
   Google Veo, MiniMax/Hailuo, Custom, atau Demo/Mock).
2. **Tempel API key** di kartu provider (kolom password, masked) → **💾 Simpan Key**.
   Satu key per provider — kamu bisa simpan BANYAK key sekaligus, satu per provider.
   - Kling: tempel format `ACCESS_KEY:SECRET_KEY` (dipisah titik dua).
   - Custom: isi juga **Endpoint URL** + **Model** (mis. `https://api.contoh.com/v1`, model `video-1`).
3. **🔌 Test Koneksi** — server mengetes key itu ke API provider (cek auth murah,
   tidak membuat video) dan menampilkan status **OK / gagal / belum dites**.
4. **Ganti provider aktif kapan saja** tanpa restart — generate berikutnya
   langsung memakai provider yang baru dipilih.
5. **Fallback otomatis** (centang di Settings): bila provider aktif gagal saat
   generate, server otomatis mencoba provider lain yang punya key tersimpan,
   sesuai urutan. Matikan bila mau generate gagal saja daripada pindah provider.

**Keamanan key:**
- Key disimpan **server-side, per Telegram user id, terenkripsi AES-256-GCM**
  (`server/vault.js`, file `server/data/vault.json`, chmod 600).
- Kunci enkripsi dari env server: `ENCRYPTION_KEY` (64 hex) atau
  `ENCRYPTION_PASSPHRASE`. Bila keduanya kosong, server membuat kunci acak sekali
  di `server/data/.encryption-key` — **backup file itu**; bila hilang, semua key
  tersimpan tidak bisa dibuka lagi.
- Key **TIDAK PERNAH** dikirim utuh kembali ke client (API hanya mengembalikan
  `••••` + 4 karakter terakhir + status), **TIDAK PERNAH** ditulis ke log,
  dan tidak tampil penuh di UI. Kolom tempel key selalu kosong saat halaman dibuka.
- Hasil generate menampilkan jelas sumber key-nya: **"(key kamu)"**,
  **"(key default server)"**, atau **"(demo)"**.

> ⚠️ Jangan bagikan API key kamu ke orang lain — key itu terhubung ke tagihan
> akun AI kamu. Key di Settings hanya dipakai server untuk generate videomu.

**Key default server (opsional, fallback):** bila user belum isi key sendiri,
server memakai key dari env (`RUNWAY_API_KEY`, `KLING_API_KEY`, `LUMA_API_KEY`,
`GOOGLE_API_KEY`, `MINIMAX_API_KEY`, `CUSTOM_API_KEY` + `CUSTOM_VIDEO_BASE_URL` /
`CUSTOM_VIDEO_MODEL`). Prioritas generate: **key user → key default server → mock demo**.

## Text AI — naskah pakai Xingchi (teks saja)

Tombol **✨ Bantu Tulis Naskah AI** di form generate:

- **Popular Video** — Xingchi merangkum tren pekan ini jadi ide prompt video.
- **Funny Video** — Xingchi menulis skrip/naskah lucu (3 adegan + punchline).
- **Film Video** — Xingchi menulis lanjutan cerita + storyboard teks
  (Lanjutkan Cerita dari film sebelumnya, atau New Film).

Prompt/naskah hasil Xingchi diisi ke kolom prompt — kamu bisa edit dulu —
lalu diteruskan ke **provider video aktif** sebagai input generate.

- Key Xingchi dibaca **HANYA dari env server `XINGCHI_API_KEY` saat runtime**.
  Langkah deploy manual: inject dari Secure Vault. **JANGAN** tulis nilai key
  di repo, client, log, UI, atau README ini.
- Model yang dipakai: `gpt-6.1-sol` (fallback internal `gpt-6-astra` bila perlu).
  Keduanya **text-only** — tidak ada model video di Xingchi.
- Status Text AI terlihat di Settings: **"Text AI: Xingchi (terhubung /
  belum dikonfigurasi)"** — tanpa pernah menampilkan key.
- Bila env tidak ada atau Xingchi gagal: fitur naskah fallback ke **template
  lokal** dan UI melabelinya jelas: **"naskah template, bukan AI"**.
- Pemakaian makan **kuota Xingchi user**; jangan kirim rahasia (seed, password,
  private key) lewat Text AI.

## Download video

Setiap video yang selesai dibuat bisa diunduh — tombol **⬇️ Download Video**
di bawah pemutar hasil, dan tombol **⬇️ Download** di tiap item tab Riwayat.

Cara kerjanya (penting, supaya download selalu jalan):

- **Server menyimpan salinan lokal** tiap video hasil generate di
  `server/data/videos/<jobId>.mp4` (`ensureLocalCopy`, di latar begitu job
  selesai). Tombol Download SELALU dilayani dari salinan lokal ini, bukan
  dari URL provider langsung — jadi download tetap jalan walau URL provider
  sudah kedaluwarsa, dan tidak kena CORS/hotlink dari WebView Telegram.
- **Video remote (URL dari provider asli)** diunduh server ke cache saat job
  selesai; bila belum siap saat tombol ditekan, server menyiapkan dulu saat
  itu juga. Di UI tampil status "⏳ Menyiapkan file video…" sampai salinan
  siap, atau pesan gagal yang jelas bila provider tidak bisa diambil.
- **Video mock (contoh lokal)** disalin dari `webapp/sample-*.mp4`.
- **Batas ukuran salinan: 200 MB** — file lebih besar ditolak + dicatat.
- Endpoint `GET /api/download/:id` mengirim file sebagai `attachment`
  (`Content-Disposition: attachment; filename=<judul>-<id>.mp4`,
  `Content-Type: video/mp4`) dan **mendukung Range request (206 Partial
  Content)** — file besar bisa di-resume bila koneksi putus. `HEAD` juga
  dilayani (untuk cek ukuran sebelum unduh).
- Di UI tampil **ukuran file + durasi** (bila diketahui) di bawah tombol
  download; status penyiapan/gagal tampil di bawahnya.
- **Fallback Telegram WebView:** WebView Telegram kadang mengabaikan atribut
  `download` — tombol **🌐 Buka di Browser** membuka URL download di browser
  luar (`Telegram.WebApp.openLink`), tempat download berjalan normal.
- **Keamanan:** endpoint hanya melayani file di bawah `server/data/videos/`
  berdasarkan `jobId` yang divalidasi (`[A-Za-z0-9_-]` saja) — path file
  internal dan key provider TIDAK PERNAH terekspos lewat endpoint ini.
- **Pratinjau statis Space (tanpa backend):** download hanya untuk video
  contoh/mock lokal. Download video provider asli butuh backend produksi.

## Colok provider video AI beneran

Provider sudah diimplementasikan di `server/providers/` (bukan kerangka kosong):
tiap modul mengekspor `{ id, name, desc, keyLabel, keyHint, generate(job, apiKey, opts), testConnection(apiKey, opts) }`
dan memanggil API resmi providernya (submit → polling status → URL video).
`job` berisi: `{ mode, prompt, duration, style, filmKind, parentFilmId }`.

| Provider | Auth | Catatan |
|---|---|---|
| Runway | Bearer API key (`dev.runwayml.com`) | Gen-4 Turbo, rasio 9:16 |
| Kling | JWT dari AccessKey + SecretKey | Key user format `ACCESS_KEY:SECRET_KEY` |
| Luma | Bearer API key | Dream Machine |
| Google Veo | API key Google AI Studio | Veo 3 via Gemini API, durasi maks 8 dtk |
| MiniMax / Hailuo | Bearer API key | T2V-01 |
| Custom | Bearer API key + endpoint + model | Pola OpenAI-compatible (`/video/generations`) |

> ⚠️ API key HANYA dari environment variable / vault terenkripsi. Jangan pernah
> hardcode key di file mana pun.

## Upload ke sosmed (OAuth) — masih stub

Saat ini tombol upload + hubungkan akun mengembalikan pesan "belum terhubung"
yang rapi. Yang harus disiapkan user per platform:

- **Facebook** — buat App di [Meta for Developers](https://developers.facebook.com/),
  aktifkan produk Facebook Login + Pages API, minta izin `pages_manage_posts`
  / `publish_video`. Simpan `FB_APP_ID`, `FB_APP_SECRET`, `FB_PAGE_ID` di env.
- **YouTube** — buat project di [Google Cloud Console](https://console.cloud.google.com/),
  aktifkan YouTube Data API v3, buat OAuth Client ID, scope
  `https://www.googleapis.com/auth/youtube.upload`. Simpan `YT_CLIENT_ID`,
  `YT_CLIENT_SECRET` + refresh token user di env.
- **X** — buat App di [X Developer Portal](https://developer.x.com/),
  aktifkan OAuth 2.0 + scope `tweet.write` dan `media.write`.
  Simpan `X_CLIENT_ID`, `X_CLIENT_SECRET` di env.

Setelah OAuth jadi, ganti stub di `POST /api/upload/:platform` (server/index.js)
dengan pemanggilan API upload masing-masing platform.

## API backend

| Endpoint | Fungsi |
|---|---|
| `GET /health` | cek server + provider terdaftar |
| `GET /api/trends` | daftar tren pekan ini (untuk Popular Video) |
| `POST /api/assist` | Text AI Xingchi: `{ mode, prompt, style, filmKind?, parentFilmId? }` → `{ text, source: 'xingchi' \| 'template' }` |
| `GET /api/settings` | Settings user: provider aktif, fallback, status key (last4 saja), status Text AI |
| `POST /api/settings/key` | simpan key provider (terenkripsi) |
| `DELETE /api/settings/key` | hapus key provider |
| `POST /api/settings/active` | ganti provider aktif |
| `POST /api/settings/fallback` | on/off fallback otomatis |
| `POST /api/settings/test` | test koneksi key ke provider |
| `POST /api/generate` | buat job: `{ mode, prompt, duration, style, filmKind?, parentFilmId?, userId?, initData? }` |
| `GET /api/jobs/:id` | status job + progress + `videoUrl` + `usedProvider` + `keySource` bila selesai |
| `GET /api/history` | riwayat job selesai |
| `GET /api/videos/:id` | metadata video + status download: `{ ok, id, title, mode, videoUrl, durationSec, fileSize, downloadReady, downloadError, filename, downloadUrl }` |
| `GET /api/download/:id` | unduh file video (attachment `.mp4`, dukung Range 206 + HEAD; bila salinan belum siap, server menyiapkan dulu, gagal → 502 JSON) |
| `POST /api/upload/:platform` | upload ke `facebook` / `youtube` / `x` (stub) |

## Launch checklist (ke Telegram)

Jangan eksekusi langkah launch sebelum semua centang — urutannya:

**1. Bot — BotFather (di Telegram, oleh user)**
- [ ] Chat `@BotFather` → `/newbot` → beri nama + username bot → salin token.
- [ ] `/setdescription` → deskripsi singkat Agent Video.
- [ ] `/setabouttext` → teks "tentang" bot (opsional, 1 baris).
- [ ] `/setmenubutton` → pilih bot → kirim **URL WebApp publik** (lihat langkah 2).
      Alternatif: `/setmenubutton` + tombol WebApp juga bisa dipasang dari kode
      bot (`InlineKeyboard().webApp(...)` sudah ada di `/start`).

**2. Hosting backend + HTTPS (wajib — Telegram Mini App hanya mau HTTPS)**
- [ ] Deploy `server/` ke host publik (Railway / Render / Fly.io / VPS).
- [ ] Pastikan URL publiknya HTTPS, mis. `https://agent-video.example.com/`.
- [ ] Isi env di host:
  ```
  BOT_TOKEN=<token dari BotFather>
  WEBAPP_URL=https://agent-video.example.com/
  PORT=3000
  ENCRYPTION_KEY=<64 hex — kunci vault key user; backup, jangan hilang>
  XINGCHI_API_KEY=<inject dari Secure Vault — untuk naskah AI>
  APINEX_API_KEY=<opsional — key default server APINEX>
  ```
  (Key video AI per provider TIDAK dimasukkan ke env — user isi sendiri di
  menu Settings, terenkripsi per akun Telegram.)
- [ ] Cek `GET /health` di URL publik menjawab `{"ok":true,...}`.

**3. Pasang URL Space sebagai WebApp**
- [ ] URL WebApp = URL Space `agent-video` (atau URL backend bila WebApp
      disajikan dari server — server menyuntik `window.AGENT_VIDEO_API`
      otomatis saat dibuka dari `/`).
- [ ] Bila WebApp disajikan dari Space (statis) sementara backend terpisah,
      pastikan WebApp tahu alamat backend (env/build-time `AGENT_VIDEO_API`).

**4. Test sebelum go-live (urut)**
- [ ] Buka bot di Telegram → `/start` → tombol **🎬 Buka Agent Video** muncul.
- [ ] Login Telegram terbaca (nama + foto tampil, badge TELEGRAM bukan DEMO).
- [ ] Generate mock (provider Demo): pilih Funny → Generate → progress →
      video contoh tampil.
- [ ] **Download**: tekan ⬇️ Download Video → file `.mp4` terunduh dengan nama
      `<judul>-<id>.mp4`; cek ukuran + durasi tampil; coba juga dari tab Riwayat.
- [ ] Download di WebView Telegram: bila tombol langsung tidak jalan, coba
      **🌐 Buka di Browser** — file harus terunduh dari browser luar.
- [ ] Settings: tempel key provider video → Test Koneksi → ganti provider aktif.
- [ ] Text AI: tekan ✨ Bantu Tulis Naskah AI (butuh `XINGCHI_API_KEY` di server).
- [ ] (Opsional) Generate 1 video beneran dengan key provider aktif → cek hasil
      + download-nya.

**5. Go-live**
- [ ] Umumkan bot ke user; pantau log server 1–2 hari pertama
      (error provider / download gagal / kuota key).

## Yang MASIH butuh user

1. **Token bot** dari @BotFather (lihat atas) — tanpa ini bot tidak jalan.
2. **Hosting backend** — server Node ini harus jalan di server/VPS yang bisa diakses
   publik (URL-nya dipakai sebagai WebApp URL bot). Opsi: Railway, Render, Fly.io, VPS.
3. **API key video AI** — isi sendiri di menu Settings (Runway/Kling/Luma/Veo/
   MiniMax/Custom) bila mau hasil video beneran, bukan contoh.
4. **Xingchi API key** — inject `XINGCHI_API_KEY` dari Secure Vault saat deploy
   bila mau naskah AI beneran (bila tidak ada, naskah pakai template lokal).
5. **OAuth sosmed** — App + izin tiap platform (lihat atas) agar upload beneran jalan.
6. **Domain/HTTPS** — Telegram Mini App wajib HTTPS.

## Status (15 Nov 2026)

- ✅ WebApp lengkap (login Telegram + fallback demo, 3 mode, Film New/Lanjutkan,
  progress job, player, riwayat, hubungkan sosmed)
- ✅ Backend + bot skeleton (Express + grammy, `/start` tombol WebApp)
- ✅ Alur generate end-to-end jalan dengan provider mock (ditest lokal)
- ✅ Settings: key per provider terenkripsi (AES-256-GCM), ganti provider aktif
  tanpa restart, fallback otomatis, test koneksi, last4 + status saja
- ✅ Text AI Xingchi (server-side, env saja): ide prompt Popular, skrip lucu,
  lanjutan cerita + storyboard Film; fallback template dilabeli jelas
- ✅ Download video: tombol di hasil + tiap item Riwayat, salinan lokal server
  (`server/data/videos/`, batas 200 MB), endpoint `GET /api/download/:id`
  (attachment + Range 206 + HEAD), ukuran + durasi tampil di UI, status
  "menyiapkan file…" / gagal, fallback 🌐 Buka di Browser untuk WebView
  Telegram (ditest lokal: full 200, Range 206, HEAD, 416, traversal 404)
- ✅ Launch checklist di README (BotFather → hosting HTTPS → pasang WebApp →
  test urut → go-live); launch BELUM dieksekusi (butuh token bot user)
- ⏳ Stub: OAuth + upload sosmed (butuh item 1–6 di atas)
