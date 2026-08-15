-- Tabel untuk menyimpan semua transaksi keuangan
CREATE TABLE IF NOT EXISTS transaksi_keuangan (
    id TEXT PRIMARY KEY DEFAULT 'TRX-' || substr(uuid_generate_v4()::text, 1, 12),
    tanggal TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    jenis_transaksi TEXT NOT NULL, -- 'Pemasukan Cicilan', 'Pemasukan Lainnya', 'Pengeluaran'
    id_permohonan TEXT REFERENCES permohonan_surat_tanah(id) ON DELETE SET NULL,
    nominal BIGINT NOT NULL,
    keterangan TEXT,
    url_bukti TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tambahkan komentar untuk menjelaskan tabel dan kolom
COMMENT ON TABLE transaksi_keuangan IS 'Menyimpan semua transaksi pemasukan dan pengeluaran.';
COMMENT ON COLUMN transaksi_keuangan.jenis_transaksi IS 'Jenis transaksi, contoh: Pemasukan Cicilan, Pemasukan Lainnya, Pengeluaran.';
COMMENT ON COLUMN transaksi_keuangan.id_permohonan IS 'Referensi ke ID pendaftaran jika jenisnya adalah Pemasukan Cicilan.';
COMMENT ON COLUMN transaksi_keuangan.url_bukti IS 'URL ke file bukti transfer/pembayaran, di-host di Supabase Storage.';


-- Tabel untuk pengaturan aplikasi (seperti target bulanan)
CREATE TABLE IF NOT EXISTS pengaturan_app (
    kunci TEXT PRIMARY KEY,
    nilai TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tambahkan komentar
COMMENT ON TABLE pengaturan_app IS 'Tabel key-value untuk menyimpan pengaturan aplikasi.';

-- Masukkan nilai awal untuk target bulanan dan biaya total jika belum ada
INSERT INTO pengaturan_app (kunci, nilai) VALUES ('target_bulanan', '5000000') ON CONFLICT (kunci) DO NOTHING;
INSERT INTO pengaturan_app (kunci, nilai) VALUES ('biaya_total_sertifikat', '250000') ON CONFLICT (kunci) DO NOTHING;
