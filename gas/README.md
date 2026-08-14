# Google Apps Script (gas/)

Dua skrip GAS yang dipakai aplikasi — keduanya **read-only / satu arah**:

## 1. `SheetToSupabase.gs` — AUTO sinkron Sheet → Supabase (real-time)

Script **terikat (bound)** pada spreadsheet "TANAH FINAL". Setiap baris
baru/berubah di tab `Database_Pendaftaran` / `Uploads` langsung dikirim ke
Supabase REST (upsert). **Tidak ada arah balik** — perubahan di Supabase
tidak menyentuh spreadsheet.

### Setup
1. Buka spreadsheet → **Extensions → Apps Script** → tempel seluruh isi `SheetToSupabase.gs`.
2. **Project Settings (ikon gerigi) → Script properties** → tambahkan:
   - `SUPABASE_URL` → `https://<ref>.supabase.co`
   - `SUPABASE_ANON_KEY` → tombol **anon public** Supabase (Dashboard → Settings → API keys). Aman karena RLS membatasi; untuk edit manual trigger `onEdit` bawaan langsung aktif (tanpa instalasi).
3. (Opsional, lebih andal utk penyisipan baris via script) jalankan `installTriggers()` sekali dan izinkan akses.
4. (Opsional) jalankan `syncAllNow()` untuk mengejar semua baris yang sudah ada.

> Catatan: `onEdit` simple trigger hanya menyala untuk **edit manual**. Perubahan
> yang dilakukan oleh proses/script luar tidak memicu — gunakan `installTriggers()`
> (installable `onChange`) atau tombol **Tarik dari Sheet** di aplikasi untuk itu.

## 2. `Code.gs` — Web App read-only untuk tombol "Tarik dari Sheet"

Web App yang hanya **membaca** isi tab dan mengembalikannya sebagai JSON.
Dipanggil server Node saat admin menekan tombol **Tarik dari Sheet**
(endpoint `/api/import-from-sheet`). Tidak ada trigger/onEdit.

### Deploy
1. [script.google.com](https://script.google.com) → **New project** → tempel `Code.gs`.
2. **Script properties**: `GAS_SYNC_TOKEN` → **sama persis** dengan `GAS_SYNC_TOKEN` di `.env` server.
3. **Deploy → New deployment → Web app**: *Execute as: Me*, *Who has access: Anyone*.
4. Salin **Web app URL** → isi `GAS_SYNC_WEB_APP_URL` di `.env` server (untuk Vercel: Environment Variables).

> Tips: update web app nanti via **Manage deployments → Edit → New version** agar URL tetap sama.

## Token
- Auto-sync (SheetToSupabase): tidak pakai token — pakai `SUPABASE_ANON_KEY` (publik) + RLS.
- Tarik manual (Code.gs): pakai token `GAS_SYNC_TOKEN` yang dicek di Script Properties; panggilan tanpa token benar ditolak.
