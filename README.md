# sync-surat-tanah (Supabase-only)

Aplikasi web terpisah (TIDAK bergabung dengan SIA) untuk pengelolaan pendaftaran
surat tanah Desa Batetangnga, dengan **Supabase sebagai satu-satunya sumber data**.

**Arah sinkronisasi (hanya satu arah, Sheet → Supabase):**
- Baris baru/berubah di spreadsheet **"TANAH FINAL"** otomatis masuk ke Supabase
  via script GAS `gas/SheetToSupabase.gs` (trigger `onEdit`/`onChange`, real-time).
- Perubahan di Supabase **tidak** mengubah spreadsheet.

Menangani **dua tabel**:

| Tabel Supabase            | Isi                                      |
|---------------------------|------------------------------------------|
| `permohonan_surat_tanah`  | Pendaftaran HIBAH/JUALBELI/AHLIWARIS     |
| `permohonan_uploads`      | File KK/KTP/dsb per `ID_REGISTRASI`      |

Fitur:
- Login/logout (token sesi HMAC, kedaluwarsa 24 jam) + ubah kata sandi (hash scrypt,
  tersimpan di tabel `app_users`).
- Kelola pendaftaran: cari, edit status/catatan admin, hapus.
- Daftar & hapus upload per pendaftaran.
- **Tarik dari Sheet**: tombol import manual dari spreadsheet (via GAS web app read-only).
- Cetak surat SPORADIK (editor + pratinjau + cetak) — bisa juga dibuka standalone via `/sporadik`.

## Isi folder

| File / Folder            | Keterangan                                                    |
|--------------------------|----------------------------------------------------------------|
| `supabase-table.sql`     | SQL: 2 tabel data + tabel `app_users` + RLS (jalankan sekali di Supabase SQL Editor) |
| `server.js`              | Server Express (API + auth)                                   |
| `src/supabase.js`        | Koneksi Supabase (service role key, server-only)              |
| `public/`                | UI web (index.html, app.js, style.css)                        |
| `sporadik-executive.html`| Halaman standalone cetak SPORADIK                             |
| `gas/SheetToSupabase.gs` | Auto-sync Sheet → Supabase (bound script, one-way)            |
| `gas/Code.gs`            | Web App read-only utk tombol "Tarik dari Sheet"               |
| `api/server.js`          | Entry serverless Vercel (bukan utk local dev)                 |
| `vercel.json`            | Konfigurasi deploy Vercel                                     |

## Set up singkat (local)

1. **Database**: jalankan `supabase-table.sql` di Supabase SQL Editor.
2. **Auto-sync**: ikuti `gas/README.md` bagian 1 (tempel `SheetToSupabase.gs`, isi Script Properties).
3. **Server**:
   ```bash
   cd sync-surat-tanah
   npm install
   npm start
   ```
4. Buka `http://localhost:3344`.

`.env` diisi dari `.env.example` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`PORT`, `GAS_SYNC_WEB_APP_URL`, `GAS_SYNC_TOKEN`, `ADMIN_*`, `SESSION_SECRET`).

## Deploy ke Vercel (Hobby, gratis)

1. `git init` + commit proyek ini (`.env` & `node_modules/` otomatis tidak ikut).
2. Import repo di [vercel.com](https://vercel.com) → framework **Other**.
3. **Environment Variables** di dashboard Vercel:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `SESSION_SECRET` (acak panjang), `ADMIN_USER`, `ADMIN_PASS`, `ADMIN_NAME`
   - `GAS_SYNC_WEB_APP_URL`, `GAS_SYNC_TOKEN` (opsional, utk tombol Tarik dari Sheet)
4. Deploy. Aset statis (`public/`) dilayani langsung oleh Vercel CDN, rute `/sporadik` dialihkan ke `sporadik-executive.html`, dan Rute API (`/api/*`) dialihkan ke serverless function (`api/server.js`).

> Tanpa auto-sync pun aplikasi tetap jalan penuh (data dikelola langsung di aplikasi).
> Cron Vercel Hobby (2×/hari) tidak dipakai.

## Keamanan

- Semua route data (`/api/permohonan*`, `/api/uploads*`, `/api/import-from-sheet`)
  butuh token `Bearer` hasil login; token ditandatangani `SESSION_SECRET`.
- Key **service_role** hanya ada di server (tidak pernah di frontend).
- Auto-sync pakai **anon key** + RLS (insert/update diizinkan, tidak pernah delete dari sheet).
- `.env` & `node_modules/` tidak ikut di-commit (lihat `.gitignore`).
