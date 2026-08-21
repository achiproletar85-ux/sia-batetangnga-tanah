-- Tabel untuk menyimpan riwayat surat yang dirender dari Google Docs
-- (placeholder {{...}} sudah diisi dengan data pendaftaran terpilih).
CREATE TABLE IF NOT EXISTS surat_terbit (
    id TEXT PRIMARY KEY DEFAULT 'SRT-' || substr(uuid_generate_v4()::text, 1, 12),
    id_registrasi TEXT REFERENCES permohonan_surat_tanah(id) ON DELETE CASCADE,
    doc_id TEXT,
    generated_doc_id TEXT,
    judul TEXT,
    html_content TEXT,
    filled JSONB DEFAULT '[]'::jsonb,
    missing JSONB DEFAULT '[]'::jsonb,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE surat_terbit IS 'Riwayat surat yang dirender dari Google Docs dengan placeholder {{...}} diisi data pendaftaran.';
COMMENT ON COLUMN surat_terbit.id_registrasi IS 'Referensi ke ID pendaftaran (REG-XXXXXX).';
COMMENT ON COLUMN surat_terbit.doc_id IS 'ID Google Docs sumber template.';
COMMENT ON COLUMN surat_terbit.generated_doc_id IS 'ID Google Docs hasil salinan yang placeholder-nya sudah diisi.';

-- Kolom tambahan untuk versi lama (idempoten: aman dijalankan ulang).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'surat_terbit' AND column_name = 'generated_doc_id') THEN
    ALTER TABLE public.surat_terbit ADD COLUMN generated_doc_id TEXT;
  END IF;
END $$;
COMMENT ON COLUMN surat_terbit.html_content IS 'Hasil render HTML yang siap dicetak.';
COMMENT ON COLUMN surat_terbit.filled IS 'Daftar placeholder yang berhasil diisi.';
COMMENT ON COLUMN surat_terbit.missing IS 'Daftar placeholder yang tidak ditemukan nilainya.';
