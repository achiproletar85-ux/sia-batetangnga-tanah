# Google Apps Script (gas/)

Skrip GAS yang dipakai aplikasi. **Koneksi otomatis spreadsheet → Supabase
sudah DIPUTUS.** Sinkronisasi sekarang **hanya manual** lewat tombol
**Tarik dari Sheet** di aplikasi web.

## Kenapa diputus?

Sebelumnya ada skrip auto-sync (`onEdit`/`onChange`) yang meng-`upsert`
setiap baris spreadsheet ke Supabase **setiap sheet berubah** (melewati
server). Karena spreadsheet menyimpan nilai lama (mis. jumlah anak = 2),
setiap aktivitas di sheet bisa **menimpa edit yang dilakukan lewat aplikasi
web** (mis. jumlah anak diubah menjadi 3) — lalu beberapa menit kemudian
data kembali ke nilai lama. Itulah yang membuat edit terasa "tidak tersimpan".

## 1. `Code.gs` — Web App read-only untuk tombol "Tarik dari Sheet" (TETAP DIPAKAI)

Web App yang hanya **membaca** isi tab dan mengembalikannya sebagai JSON.
Dipanggil server Node saat admin menekan tombol **Tarik dari Sheet**
(endpoint `/api/import-from-sheet`). Tidak ada trigger/onEdit.

Import di server memakai kebijakan **INSERT-ONLY**: baris yang sudah ada
di Supabase **tidak pernah ditimpa** — spreadsheet hanya menambah baris baru.

### Deploy
1. [script.google.com](https://script.google.com) → **New project** → tempel `Code.gs`.
2. **Script properties**: `GAS_SYNC_TOKEN` → **sama persis** dengan `GAS_SYNC_TOKEN` di `.env` server.
3. **Deploy → New deployment → Web app**: *Execute as: Me*, *Who has access: Anyone*.
4. Salin **Web app URL** → isi `GAS_SYNC_WEB_APP_URL` di `.env` server (untuk Vercel: Environment Variables).

> Tips: update web app nanti via **Manage deployments → Edit → New version** agar URL tetap sama.

## 2. `SheetToSupabase.gs` / `SheetToSupabase-standalone.gs` / `Standalone-AllInOne.gs` — AUTO-SYNC DIMATIKAN

Ketiga file ini dulunya auto-sync real-time. Sekarang:
- `onEdit` / `onSheetChange` → **no-op** (tidak menulis apa pun).
- `installTriggers()` → tidak lagi memasang trigger; justru **menghapus** semua trigger proyek (`uninstallTriggers`).
- Semua tulis memakai `Prefer: resolution=ignore-duplicates` (**INSERT-ONLY**): baris yang sudah ada di Supabase tidak pernah ditimpa.

Fungsi `syncAllNow()` tetap ada untuk dorongan manual sekali jalan (INSERT-ONLY), bila suatu saat benar-benar dibutuhkan.

### Langkah WAJIB: hapus trigger lama yang masih terpasang di Google
Kode baru di repo ini **tidak otomatis** mengubah skrip yang sudah berjalan
di Google. Selama trigger lama masih terpasang, sinkronisasi otomatis (yang
menimpa edit web) **masih aktif**. Untuk memutuskannya sekarang:

1. Buka spreadsheet **TANAH FINAL** → menu **Extensions → Apps Script**.
2. Di panel kiri klik ikon **Triggers** (gambar jam/⚡) — untuk setiap trigger,
   klik ⋮ → **Delete trigger**. Hapus **semua** trigger di proyek ini.
   (Ulangi juga di proyek Apps Script standalone bila ada.)
3. (Opsional tapi disarankan) Ganti isi editor dengan versi baru
   `gas/SheetToSupabase.gs`, simpan (**Ctrl+S**), lalu jalankan fungsi
   `uninstallTriggers()` sekali dari editor — memastikan bersih.

Setelah itu, sheet **tidak akan pernah lagi** menulis ke Supabase secara
otomatis. Edit di aplikasi web dijamin aman.

## Token
- Tarik manual (Code.gs): pakai token `GAS_SYNC_TOKEN` yang dicek di Script Properties; panggilan tanpa token benar ditolak.
- Auto-sync: **tidak dipakai lagi** (diputus).
