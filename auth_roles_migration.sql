-- ============================================================
-- MIGRASI ROLE USER (Bendahara vs Petugas/User)
-- Jalankan di Supabase > SQL Editor, lalu klik Run.
--
-- Tujuan:
--   - Menambah kolom role di app_users.
--   - Menjadikan akun admin lama (id=1 / username 'admin') sebagai BENDARAHA
--     (satu-satunya yang boleh meng-input data di tab Keuangan).
--   - Menyiapkan sequence id agar bisa menambah akun petugas (user) baru.
--
-- Cara menambah akun PETUGAS (user biasa, hanya bisa Cek Tagihan & Berkas):
--   1. Generate hash password:  node scripts/hash-password.js "sandiPetugas"
--   2. INSERT:
--        INSERT INTO public.app_users (username, password_hash, name, role)
--        VALUES ('petugas', '<HASIL_HASH>', 'Nama Petugas', 'user');
-- ============================================================

-- 1. Tambah kolom role (default 'user')
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';

-- 2. Akun admin yang sudah ada dijadikan Bendahara
UPDATE public.app_users
   SET role = 'bendahara'
 WHERE id = 1 OR username = 'admin';

-- 3. Sequence id agar bisa punya lebih dari satu akun
--    (sebelumnya id DEFAULT 1 sehingga semua insert menimpa id=1)
DROP SEQUENCE IF EXISTS app_users_id_seq;
CREATE SEQUENCE app_users_id_seq;
ALTER TABLE public.app_users ALTER COLUMN id SET DEFAULT nextval('app_users_id_seq');
SELECT setval('app_users_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM public.app_users), 1) + 1, 2), false);

-- 4. Update skema referensi komentar
COMMENT ON COLUMN public.app_users.role IS 'Role akun: bendahara (bisa input keuangan) atau user (hanya cek tagihan & berkas).';
