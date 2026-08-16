-- ============================================================
-- PUTUS KONEKSI SPREADSHEET -> SUPABASE (AUTO-SYNC GAS DIMATIKAN)
-- Jalankan di Supabase Dashboard -> SQL Editor -> klik RUN (sekali saja).
--
-- LATAR BELAKANG:
--   Skrip Google Apps Script lama yang masih terpasang di spreadsheet
--   (dengan trigger waktu ±5 menit / onEdit) meng-UPSErt baris sheet ke
--   tabel ini LANGSUNG ke Supabase (melewati server aplikasi), sehingga
--   MENIMPA edit yang dilakukan lewat aplikasi web — mis. jumlah anak
--   yang diubah 3 kembali ke 2 beberapa menit kemudian — TANPA mengubah
--   kolom updated_at.
--
-- FIX INI 2 LAPIS:
--   1) RLS: cabut hak INSERT/UPDATE role "anon" (kunci yang dipakai skrip
--      GAS) -> semua tulis skrip GAS langsung ditolak Supabase (403).
--      Aplikasi web TIDAK terpengaruh karena server memakai service_role.
--   2) TRIGGER: tolak SEMUA update yang tidak memperbarui updated_at
--      (jaring pengaman kedua, termasuk bila skrip GAS memakai service key).
--
-- Aman dijalankan ulang (idempoten).
-- ============================================================

-- ---------- LAPIS 1: cabut hak tulis anon (jalur skrip GAS) ----------

DROP POLICY IF EXISTS "allow_all_insert" ON public.permohonan_surat_tanah;
DROP POLICY IF EXISTS "allow_all_update" ON public.permohonan_surat_tanah;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.permohonan_surat_tanah FROM anon;

DROP POLICY IF EXISTS "uploads_insert" ON public.permohonan_uploads;
DROP POLICY IF EXISTS "uploads_update" ON public.permohonan_uploads;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.permohonan_uploads FROM anon;

-- Catatan: policy SELECT dibiarkan (anon tetap bisa membaca bila perlu).

-- ---------- LAPIS 2: trigger tolak penimpaan tanpa updated_at ----------

CREATE OR REPLACE FUNCTION public.block_overwrite_without_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
    RAISE EXCEPTION
      'Diblokir: update pada % wajib memperbarui updated_at (penulisan langsung dari spreadsheet/GAS dilarang).',
      TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_overwrite_no_updated_at ON public.permohonan_surat_tanah;
CREATE TRIGGER trg_block_overwrite_no_updated_at
  BEFORE UPDATE ON public.permohonan_surat_tanah
  FOR EACH ROW EXECUTE FUNCTION public.block_overwrite_without_updated_at();

-- Semua jalur tulis aplikasi (POST/PATCH/import) SELALU mengisi updated_at,
-- jadi tidak terpengaruh. Yang diblokir hanya penulis yang mengabaikannya
-- (persis perilaku auto-sync spreadsheet).
