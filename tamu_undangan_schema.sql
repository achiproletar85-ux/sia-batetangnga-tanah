-- ==============================================================================
-- SKEMA DATABASE SUPABASE: TAMU UNDANGAN & CETAK LABEL (ANTI-ERROR)
-- Jalankan skrip ini di Dashboard Supabase > SQL Editor > Klik Run
-- ==============================================================================

-- 1. Tabel Kategori / Acara
CREATE TABLE IF NOT EXISTS public.tamu_undangan_kategori (
    id SERIAL PRIMARY KEY,
    nama_kategori TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Pastikan ada unique constraint pada nama_kategori
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tamu_undangan_kategori_nama_kategori_key'
    ) THEN
        ALTER TABLE public.tamu_undangan_kategori ADD CONSTRAINT tamu_undangan_kategori_nama_kategori_key UNIQUE (nama_kategori);
    END IF;
EXCEPTION
    WHEN OTHERS THEN NULL;
END $$;

-- Insert Kategori Bawaan secara aman (tanpa bergantung on conflict constraint)
INSERT INTO public.tamu_undangan_kategori (nama_kategori)
SELECT val FROM (VALUES 
    ('Pernikahan'),
    ('Acara Kantor / Dinas'),
    ('Keluarga Besar'),
    ('Tamu VVIP / Tokoh'),
    ('Sahabat & Rekan')
) AS t(val)
WHERE NOT EXISTS (
    SELECT 1 FROM public.tamu_undangan_kategori WHERE nama_kategori = t.val
);

-- 2. Tabel Tamu Undangan
CREATE TABLE IF NOT EXISTS public.tamu_undangan (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    jabatan TEXT DEFAULT '',
    alamat TEXT DEFAULT 'Tempat',
    kategori TEXT DEFAULT 'Pernikahan',
    selected BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Index pencarian cepat
CREATE INDEX IF NOT EXISTS idx_tamu_undangan_kategori ON public.tamu_undangan (kategori);
CREATE INDEX IF NOT EXISTS idx_tamu_undangan_created ON public.tamu_undangan (created_at DESC);

-- 3. Tabel Login Pengguna (app_users)
CREATE TABLE IF NOT EXISTS public.app_users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT 'Admin Desa',
    role TEXT NOT NULL DEFAULT 'admin',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Pastikan ada unique constraint pada username
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'app_users_username_key'
    ) THEN
        ALTER TABLE public.app_users ADD CONSTRAINT app_users_username_key UNIQUE (username);
    END IF;
EXCEPTION
    WHEN OTHERS THEN NULL;
END $$;

-- Insert Akun Default (Username: admin | Password: admin123) secara aman
INSERT INTO public.app_users (username, password_hash, name, role)
SELECT 'admin', 'admin123', 'Administrator Utama', 'admin'
WHERE NOT EXISTS (
    SELECT 1 FROM public.app_users WHERE LOWER(username) = 'admin'
);

-- 4. Hak Akses Row Level Security (RLS) & Policies
ALTER TABLE public.tamu_undangan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tamu_undangan_kategori ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    -- Policy tamu_undangan
    DROP POLICY IF EXISTS "Akses Penuh Tamu Undangan" ON public.tamu_undangan;
    CREATE POLICY "Akses Penuh Tamu Undangan" ON public.tamu_undangan FOR ALL USING (true) WITH CHECK (true);

    -- Policy tamu_undangan_kategori
    DROP POLICY IF EXISTS "Akses Penuh Kategori Tamu" ON public.tamu_undangan_kategori;
    CREATE POLICY "Akses Penuh Kategori Tamu" ON public.tamu_undangan_kategori FOR ALL USING (true) WITH CHECK (true);

    -- Policy app_users
    DROP POLICY IF EXISTS "Akses App Users" ON public.app_users;
    CREATE POLICY "Akses App Users" ON public.app_users FOR ALL USING (true) WITH CHECK (true);
END $$;

-- Selesai!
