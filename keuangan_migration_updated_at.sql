-- ============================================================
-- MIGRASI: tambah kolom updated_at di transaksi_keuangan
-- Jalankan di Supabase > SQL Editor, lalu klik Run.
-- (Logika "latest-wins" import dari Sheet membandingkan
--  MODIFIED_AT (kolom H di sheet) vs updated_at di tabel ini.)
-- ============================================================

ALTER TABLE transaksi_keuangan
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill: untuk baris yang sudah ada, set updated_at = created_at
-- agar perbandingan awal bersifat netral (sheet tanpa MODIFIED_AT
-- dianggap "tidak ada sinyal edit" dan dilewati).
UPDATE transaksi_keuangan
   SET updated_at = created_at
 WHERE updated_at IS NULL AND created_at IS NOT NULL;
