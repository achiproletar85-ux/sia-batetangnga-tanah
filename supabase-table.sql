-- ============================================================
-- TABEL: permohonan_surat_tanah
-- Sumber data utama: Supabase (sebelumnya dari Google Spreadsheet "TANAH FINAL")
-- (layanan HIBAH / JUALBELI / AHLIWARIS, detail tersimpan di JSON data_raw)
-- Jalankan script ini di Supabase Dashboard -> SQL Editor.
-- ============================================================

-- 1. BUAT TABEL (idempoten)
CREATE TABLE IF NOT EXISTS public.permohonan_surat_tanah (
    id                text PRIMARY KEY,               -- contoh: REG-907237 (dibuat Apps Script yang sudah ada)
    timestamp         text,                            -- Jumat, 22 Mei 2026 (dari sheet)
    layanan           text,                            -- HIBAH | JUALBELI | AHLIWARIS
    nama              text,
    hp                text,
    pembayaran        text,                            -- LUNAS | BELUM | dsb
    data_raw          jsonb,                           -- seluruh payload JSON DATA_RAW
    status_berkas     text,                            -- SUDAH_DIUKUR | dsb
    catatan_admin     text,
    last_updated      text,                            -- string LAST_UPDATED asli dari sheet (17/6/2026, 23.55.18)
    synced_at         timestamptz DEFAULT now(),       -- kapan terakhir disinkron dari sheet
    created_at        timestamptz DEFAULT now(),
    updated_at        timestamptz DEFAULT now()
);

-- 2. INDEKS
CREATE INDEX IF NOT EXISTS idx_permohonan_layanan  ON public.permohonan_surat_tanah (layanan);
CREATE INDEX IF NOT EXISTS idx_permohonan_status   ON public.permohonan_surat_tanah (status_berkas);
CREATE INDEX IF NOT EXISTS idx_permohonan_nama     ON public.permohonan_surat_tanah (nama);
CREATE INDEX IF NOT EXISTS idx_permohonan_updated  ON public.permohonan_surat_tanah (updated_at DESC);

-- 3. ROW LEVEL SECURITY + POLICIES
ALTER TABLE public.permohonan_surat_tanah ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_read"  ON public.permohonan_surat_tanah;
DROP POLICY IF EXISTS "allow_all_insert" ON public.permohonan_surat_tanah;
DROP POLICY IF EXISTS "allow_all_update" ON public.permohonan_surat_tanah;
DROP POLICY IF EXISTS "allow_all_delete" ON public.permohonan_surat_tanah;

-- anon (dipakai auto-sync GAS) hanya SELECT/INSERT/UPDATE, TIDAK DELETE.
CREATE POLICY "allow_all_read"   ON public.permohonan_surat_tanah FOR SELECT USING (true);
CREATE POLICY "allow_all_insert" ON public.permohonan_surat_tanah FOR INSERT WITH CHECK (true);
CREATE POLICY "allow_all_update" ON public.permohonan_surat_tanah FOR UPDATE USING (true);
CREATE POLICY "allow_all_delete" ON public.permohonan_surat_tanah FOR DELETE USING (true) TO authenticated, service_role;

GRANT ALL ON TABLE public.permohonan_surat_tanah TO anon, authenticated, service_role;

-- 4. REALTIME: aktifkan publication untuk tabel ini
-- (Wajib agar server Node bisa mendengarkan perubahan DB real-time)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'permohonan_surat_tanah'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.permohonan_surat_tanah;
  END IF;
END
$$;

-- ============================================================
-- TABEL: permohonan_uploads  (tab "Uploads" di spreadsheet)
-- Setiap ID_REGISTRASI bisa punya BANYAK file (KK, KTP, dsb).
-- Kunci unik: FILE_ID (ID file Google Drive).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.permohonan_uploads (
    id_registrasi  text NOT NULL,                       -- contoh: REG-215568
    jenis_upload   text,                                -- KK | KTP | dsb
    file_name      text,
    file_url       text,
    file_id        text PRIMARY KEY,                    -- ID file Drive (unik)
    timestamp      text,                                -- "26/5/2026, 11.41.25"
    synced_at      timestamptz DEFAULT now(),
    created_at     timestamptz DEFAULT now(),
    updated_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_uploads_registrasi ON public.permohonan_uploads (id_registrasi);
CREATE INDEX IF NOT EXISTS idx_uploads_jenis      ON public.permohonan_uploads (jenis_upload);

ALTER TABLE public.permohonan_uploads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "uploads_read"  ON public.permohonan_uploads;
DROP POLICY IF EXISTS "uploads_insert" ON public.permohonan_uploads;
DROP POLICY IF EXISTS "uploads_update" ON public.permohonan_uploads;
DROP POLICY IF EXISTS "uploads_delete" ON public.permohonan_uploads;

CREATE POLICY "uploads_read"   ON public.permohonan_uploads FOR SELECT USING (true);
CREATE POLICY "uploads_insert" ON public.permohonan_uploads FOR INSERT WITH CHECK (true);
CREATE POLICY "uploads_update" ON public.permohonan_uploads FOR UPDATE USING (true);
CREATE POLICY "uploads_delete" ON public.permohonan_uploads FOR DELETE USING (true) TO authenticated, service_role;

GRANT ALL ON TABLE public.permohonan_uploads TO anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'permohonan_uploads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.permohonan_uploads;
  END IF;
END
$$;

-- ============================================================
-- 4. TABEL PENGGUNA (AUTH: login + ubah sandi aplikasi)
--    Jalankan bagian 4 ini setelah tabel data dibuat.
--    app_users.id = 1 berisi satu baris akun admin (username, password_hash scrypt).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.app_users (
    id            integer PRIMARY KEY DEFAULT 1,
    username      text,
    password_hash text,
    name          text,
    updated_at    timestamptz DEFAULT now()
);
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "app_users_admin_all" ON public.app_users FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT ALL ON TABLE public.app_users TO anon, authenticated, service_role;
