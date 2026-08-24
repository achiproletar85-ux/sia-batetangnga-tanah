-- ==============================================================================
-- SKRIP INPUT DATA TAMU LAMA KE SUPABASE CLOUD DATABASE
-- Jalankan skrip ini di Dashboard Supabase > SQL Editor > Klik Run
-- ==============================================================================

-- 1. Pastikan Kategori Acara sudah ada
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

-- 2. Masukkan 11 Data Tamu Asli Desa ke Tabel tamu_undangan
INSERT INTO public.tamu_undangan (id, name, jabatan, alamat, kategori, selected)
VALUES 
    ('1787569549915', 'AMIRULLAH S, Sos', 'Sekretaris Desa Paku', 'Tempat', 'Pernikahan', true),
    ('1787569500373', 'Drs SYAMSUDDIN', 'Kepala Desa Paku', 'Tempat', 'Pernikahan', true),
    ('1787569439937', 'HERMAN SH', 'Kepala Desa Kaleok', 'Tempat', 'Pernikahan', true),
    ('1787569393704', 'MUH ALWI', 'Sekretaris Desa Mammi', 'Tempat', 'Pernikahan', true),
    ('1787569354984', 'ABDUL NAING S.Pd. I', 'Kepala Desa Mammi', 'Tempat', 'Pernikahan', true),
    ('1787569282672', 'HERNAWATI', 'Sekretaris Desa Amola', 'Tempat', 'Pernikahan', true),
    ('1787569212704', 'SYAMSUDDIN S.Ip', 'Kepala Desa Mirring', 'Tempat', 'Pernikahan', true),
    ('1787569143367', 'RAKHMAT ADITIA WARDHANA', 'Sekretaris Desa Rea', 'Tempat', 'Pernikahan', true),
    ('1787569059376', 'ZAIFULLAH', 'Kepala Desa Rea', 'Tempat', 'Pernikahan', true),
    ('1787569025331', 'ISMAIL', 'Sekretaris Desa Mirring', 'Tempat', 'Pernikahan', true),
    ('1', 'SARIANTO A.Md', 'Kepala Desa Mirring', 'Tempat', 'Pernikahan', true)
ON CONFLICT (id) DO UPDATE 
SET 
    name = EXCLUDED.name,
    jabatan = EXCLUDED.jabatan,
    alamat = EXCLUDED.alamat,
    kategori = EXCLUDED.kategori,
    selected = EXCLUDED.selected,
    updated_at = timezone('utc'::text, now());

-- Selesai!
