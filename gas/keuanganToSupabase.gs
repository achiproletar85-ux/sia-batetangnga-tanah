// ============================================================
// MANUAL: Spreadsheet 'TRANSAKSI' -> Supabase 'transaksi_keuangan'
// TIDAK LAGI OTOMATIS — sinkronisasi GAS telah DIPUTUS.
//
// Koneksi otomatis sheet -> Supabase telah dimatikan sesuai permintaan:
//   - onEdit / onSheetChange sengaja dijadikan no-op (tidak menulis apa pun).
//   - installTriggers() tidak lagi memasang trigger, malah MENGHAPUS trigger.
//   - Semua tulis memakai 'resolution=ignore-duplicates' (INSERT-ONLY):
//     baris yang SUDAH ADA di Supabase TIDAK PERNAH ditimpa oleh spreadsheet,
//     jadi edit/hapus lewat aplikasi web dijamin aman.
//
// Sinkronisasi keuangan sekarang hanya MANUAL lewat tombol "Tarik dari Sheet"
// di aplikasi (server membaca CSV publik spreadsheet secara langsung).
//
// CARA MEMUTUS KONEKSI OTOMATIS YANG MASIH TERPASANG DI GOOGLE:
//   1. Buka spreadsheet -> Extensions > Apps Script.
//   2. Ganti isi file script keuangan dengan kode ini (hapus kode lama).
//   3. Pilih fungsi "uninstallTriggers" lalu klik "Run" (sekali saja)
//      untuk menghapus trigger otomatis yang masih berjalan di Google.
//   4. Berikan izin (otorisasi) yang diminta.
//
// Script properties (Project Settings -> Script properties):
//   SUPABASE_URL       = https://<ref>.supabase.co
//   SUPABASE_ANON_KEY  = tombol "anon public" Supabase
// ============================================================

// Konfigurasi Tab dan Tabel Tujuan
const SYNC_CONFIG = {
  'TRANSAKSI': {
    table: 'transaksi_keuangan',
    onConflict: 'id', // Kolom Primary Key di Supabase
    buildFunction: buildTransaksi // Fungsi untuk memetakan kolom
  }
};

// AUTO-SYNC DIMATIKAN: fungsi ini TIDAK lagi memasang trigger.
// Jika dijalankan, ia justru menghapus semua trigger proyek ini
// (menghentikan sinkronisasi otomatis yang masih terpasang di Google).
function installTriggers() {
  Logger.log('AUTO-SYNC DIMATIKAN: tidak ada trigger baru yang dipasang.');
  uninstallTriggers();
}

// Hapus semua trigger proyek ini (bila masih terpasang di Google).
function uninstallTriggers() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  Logger.log('Semua trigger proyek ini dihapus.');
}

// AUTO-SYNC DIMATIKAN: no-op sengaja — kalau trigger lama masih terpasang,
// ia TIDAK menulis apa pun ke Supabase. Sinkronisasi hanya manual
// lewat tombol "Tarik dari Sheet" di aplikasi.
function onEdit(e) {
  console.log('Auto-sync dimatikan: onEdit tidak menulis apa pun ke Supabase.');
}

// AUTO-SYNC DIMATIKAN: no-op (lihat onEdit).
function onSheetChange(e) {
  console.log('Auto-sync dimatikan: onSheetChange tidak menulis apa pun ke Supabase.');
}

// Baca baris ke-`rowNum` (1-indexed) lalu upsert ke Supabase.
function syncRow(sheetName, rowNum, conf) {
  const tab = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!tab) return;

  const lastCol = tab.getLastColumn();
  if (lastCol < 1) return;

  // Baca header dan baris yang bersangkutan
  const headerRange = tab.getRange(1, 1, 1, lastCol);
  const rowRange = tab.getRange(rowNum, 1, 1, lastCol);

  const headers = headerRange.getValues()[0].map((h) => String(h || '').trim().toUpperCase());
  const rowValues = rowRange.getValues()[0];

  // Bangun record (payload) untuk dikirim ke Supabase
  const record = conf.buildFunction(headers, rowValues);
  if (!record) {
    Logger.log(`Baris ${rowNum} di '${sheetName}' dilewati karena data tidak valid (mungkin ID kosong).`);
    return;
  }

  // Kirim ke Supabase
  postToSupabase(conf.table, record, conf.onConflict);
}

/**
 * Memetakan kolom dari sheet 'TRANSAKSI' ke field tabel 'transaksi_keuangan'.
 * @param {string[]} headers - Array header dari sheet.
 * @param {any[]} row - Array nilai dari baris yang di-sync.
 * @returns {Object|null} Objek yang akan dikirim ke Supabase, atau null jika tidak valid.
 */
function buildTransaksi(headers, row) {
  const headerMap = {};
  headers.forEach((h, i) => { headerMap[h] = i; });

  const record = {};

  const id = cell(row[headerMap['ID_TRANSAKSI']]);
  if (!id) return null; // ID wajib ada

  record.id = id;
  record.tanggal = toISOString(cell(row[headerMap['TANGGAL']]));
  record.jenis_transaksi = cell(row[headerMap['JENIS']]);
  // Hanya tautkan ID pemohon yang valid (REG-*); nilai placeholder seperti
  // "Pengeluaran"/"Pemasukan Lainnya" harus null agar tidak melanggar foreign key.
  const idPemohon = cell(row[headerMap['ID_PEMOHON']]);
  record.id_permohonan = /^REG-/i.test(idPemohon) ? idPemohon : null;
  record.nominal = parseNominal(cell(row[headerMap['NOMINAL']]));
  record.keterangan = cell(row[headerMap['KETERANGAN']]);
  record.url_bukti = cell(row[headerMap['URL_BUKTI']]);
  record.updated_at = toISOString(cell(row[headerMap['MODIFIED_AT']])) || new Date().toISOString();

  return record;
}

/**
 * Mengirim data ke Supabase menggunakan UrlFetchApp.
 */
function postToSupabase(table, record, onConflict) {
  const props = PropertiesService.getScriptProperties();
  const supabaseUrl = props.getProperty('SUPABASE_URL');
  const supabaseKey = props.getProperty('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Properti 'SUPABASE_URL' dan 'SUPABASE_ANON_KEY' harus diatur di Script Properties.");
  }

  const url = `${supabaseUrl}/rest/v1/${table}?on_conflict=${onConflict}`;

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      // INSERT-ONLY: baris yang sudah ada TIDAK PERNAH ditimpa (hanya menambah baris baru).
      'Prefer': 'resolution=ignore-duplicates,return=minimal'
    },
    payload: JSON.stringify(record),
    muteHttpExceptions: true // Penting agar bisa menangkap error
  };

  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();

  if (responseCode >= 300) {
    const errorMsg = response.getContentText();
    throw new Error(`Error dari Supabase (HTTP ${responseCode}): ${errorMsg.slice(0, 500)}`);
  }

  Logger.log(`Baris dengan ID '${record.id}' berhasil disinkronisasi ke tabel '${table}'.`);
}


// ==========================================
// HELPER FUNCTIONS
// ==========================================

/**
 * Membersihkan nilai sel. Mengembalikan null jika kosong.
 */
function cell(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str === '' ? null : str;
}

/**
 * Mengonversi nilai tanggal ke format ISO string.
 * Menerima objek Date atau string tanggal.
 */
function toISOString(dateValue) {
    if (!dateValue) return null;
    try {
        const date = new Date(dateValue);
        if (isNaN(date.getTime())) return null;
        return date.toISOString();
    } catch (e) {
        return null;
    }
}

/**
 * Membersihkan dan mengubah nilai nominal ke tipe integer.
 */
function parseNominal(value) {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return value;
    const clean = String(value).replace(/[^0-9]/g, '');
    return parseInt(clean, 10) || 0;
}


/**
 * Fungsi opsional untuk menjalankan sinkronisasi semua baris di tab 'TRANSAKSI'.
 * Berguna untuk 'catch-up' atau inisialisasi data.
 * Jalankan secara manual dari editor Apps Script jika diperlukan.
 * (Baris yang SUDAH ADA di Supabase TIDAK akan ditimpa — INSERT-ONLY.)
 */
function syncAllTransaksiNow() {
  const sheetName = 'TRANSAKSI';
  const conf = SYNC_CONFIG[sheetName];
  if (!conf) {
    Logger.log(`Konfigurasi untuk sheet '${sheetName}' tidak ditemukan.`);
    return;
  }

  const tab = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!tab) {
    Logger.log(`Sheet '${sheetName}' tidak ditemukan.`);
    return;
  }

  const lastRow = tab.getLastRow();
  if (lastRow < 2) {
    Logger.log(`Sheet '${sheetName}' tidak memiliki data untuk disinkronisasi.`);
    return;
  }

  Logger.log(`Memulai sinkronisasi total untuk ${lastRow - 1} baris dari '${sheetName}'...`);
  for (let r = 2; r <= lastRow; r++) {
    try {
      syncRow(sheetName, r, conf);
    } catch (err) {
      Logger.log(`Gagal sinkronisasi baris ${r}: ${err}`);
    }
  }
  Logger.log(`Sinkronisasi total untuk '${sheetName}' selesai.`);
}