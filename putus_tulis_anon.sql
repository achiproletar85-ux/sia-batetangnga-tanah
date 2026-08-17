-- ============================================================
-- PUTUS TOTAL KONEKSI SPREADSHEET (GAS) -> SUPABASE
-- ------------------------------------------------------------
-- Sumber masalah: Google Apps Script (GAS) menulis langsung ke
-- Supabase memakai key "anon" (merger data spreadsheet ke tabel).
-- Akibatnya data yang dihapus/diubah lewat aplikasi bisa muncul
-- lagi / jadi ganda / tidak sinkron.
--
-- Script ini MENCABUT semua hak tulis (INSERT/UPDATE/DELETE/
-- TRUNCATE/REFERENCES/TRIGGER) dari role 'anon' dan 'authenticated'
-- pada tabel aplikasi. Role anon hanya boleh SELECT (baca).
--
-- Server aplikasi (Node) memakai SERVICE ROLE key, sehingga TIDAK
-- terpengaruh — semua fitur aplikasi tetap berfungsi, termasuk
-- tombol "Tarik dari Sheet" yang menulis lewat server.
--
-- CARA PAKAI:
--   1. Buka dashboard Supabase -> SQL Editor -> New query.
--   2. Tempel seluruh kode ini -> Run.
--   3. Selesai. (Tidak perlu men-deploy ulang aplikasi.)
-- ============================================================

-- 1) Pastikan RLS aktif pada semua tabel aplikasi (server service
--    role tetap bisa menulis meskipun RLS aktif).
ALTER TABLE public.permohonan_surat_tanah ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permohonan_uploads    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaksi_keuangan    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pengaturan_app        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users             ENABLE ROW LEVEL SECURITY;

-- 2) Cabut SEMUA hak tulis dari anon & authenticated.
--    SELECT tetap diizinkan (hanya baca), agar GAS read-only dan
--    integrasi lain yang hanya membaca tidak rusak.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.permohonan_surat_tanah FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.permohonan_uploads    FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.transaksi_keuangan    FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.pengaturan_app        FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.app_users             FROM anon, authenticated;

-- 3) Pastikan SELECT anon tersedia (jika sebelumnya ikut tercabut).
GRANT SELECT ON public.permohonan_surat_tanah TO anon;
GRANT SELECT ON public.permohonan_uploads    TO anon;
GRANT SELECT ON public.transaksi_keuangan    TO anon;
GRANT SELECT ON public.pengaturan_app        TO anon;
GRANT SELECT ON public.app_users             TO anon;