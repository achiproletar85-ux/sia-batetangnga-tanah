// ============================================================
// AUTO: Spreadsheet 'TRANSAKSI' -> Supabase 'transaksi_keuangan' (satu arah, real-time)
// Script TERIKAT (bound) pada spreadsheet utama Anda.
// Setiap baris baru/berubah di tab 'TRANSAKSI' akan otomatis dikirim
// (di-upsert) ke tabel 'transaksi_keuangan' di Supabase.
//
// TIDAK ADA arah balik: perubahan di Supabase tidak akan mengubah isi Sheet.
//
// CARA PENGGUNAAN:
//   1. Buka spreadsheet Anda -> Extensions > Apps Script.
//   2. Buat file script baru (misal: keuanganToSupabase.gs) dan tempel semua kode ini.
//   3. Di Editor Apps Script, buka Project Settings (ikon gerigi di kiri).
//   4. Di bagian "Script Properties", klik "Add script property".
//   5. Tambahkan dua properti berikut:
//      - Nama Properti: SUPABASE_URL
//        Nilai        : URL proyek Supabase Anda (contoh: https://xyz.supabase.co)
//      - Nama Properti: SUPABASE_ANON_KEY
//        Nilai        : Kunci 'anon' (public) proyek Supabase Anda.
//   6. Simpan properti, lalu kembali ke editor kode.
//   7. Dari menu dropdown "Select function", pilih "installTriggers" lalu klik "Run".
//   8. Berikan izin (otorisasi) yang diminta oleh Google.
//   9. Selesai! Sinkronisasi otomatis sekarang aktif.
// ============================================================

// Konfigurasi Tab dan Tabel Tujuan
const SYNC_CONFIG = {
  'TRANSAKSI': {
    table: 'transaksi_keuangan',
    onConflict: 'id', // Kolom Primary Key di Supabase
    buildFunction: buildTransaksi // Fungsi untuk memetakan kolom
  }
};

/**
 * Menginstal trigger 'onChange' untuk spreadsheet ini.
 * Jalankan fungsi ini SEKALI dari editor Apps Script untuk mengaktifkan sinkronisasi.
 */
function installTriggers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // Hapus trigger lama untuk menghindari duplikasi
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'onSheetChange')
    .forEach((t) => ScriptApp.deleteTrigger(t));

  // Buat trigger baru
  ScriptApp.newTrigger('onSheetChange')
    .forSpreadsheet(ss)
    .onChange()
    .create();
  Logger.log('Trigger sinkronisasi otomatis untuk keuangan telah terpasang.');
  Browser.msgBox('Trigger sinkronisasi otomatis untuk keuangan telah berhasil diaktifkan.');
}

/**
 * Fungsi ini akan dipanggil secara otomatis oleh trigger 'onEdit' (simple trigger)
 * saat pengguna mengedit sel secara manual.
 */
function onEdit(e) {
  if (!e || !e.range) return;
  const sheetName = e.range.getSheet().getName();
  const conf = SYNC_CONFIG[sheetName];

  // Hanya proses jika sheet yang diedit ada di dalam konfigurasi
  if (!conf) return;

  const rowStart = e.range.getRow();
  if (rowStart < 2) return; // Abaikan baris header

  const numRows = e.range.getNumRows();
  processRange(sheetName, rowStart, numRows, conf);
}

/**
 * Fungsi ini dipanggil oleh trigger 'onChange' (installable trigger)
 * yang lebih andal untuk mendeteksi perubahan seperti penambahan baris baru.
 */
function onSheetChange(e) {
  if (!e || !e.source) return;
  const sheet = e.source.getActiveSheet();
  const sheetName = sheet.getName();
  const conf = SYNC_CONFIG[sheetName];

  // Hanya proses jika sheet yang berubah ada di dalam konfigurasi
  if (!conf) return;
  
  const changeType = e.changeType || '';

  // Jika ada baris baru atau editan, proses range yang aktif
  if (changeType === 'INSERT_ROW' || changeType === 'EDIT') {
    const activeRange = sheet.getActiveRange();
    if (activeRange) {
      processRange(sheetName, activeRange.getRow(), activeRange.getNumRows(), conf);
    }
  }
}

/**
 * Memproses baris yang berubah dan memanggil fungsi sinkronisasi
 * dengan debounce untuk menghindari pemanggilan berulang yang terlalu cepat.
 */
function processRange(sheetName, rowStart, numRows, conf) {
  const now = Date.now();
  const cache = CacheService.getScriptCache();
  for (let i = 0; i < numRows; i++) {
    const r = rowStart + i;
    const key = `sync|${sheetName}|${r}`;
    const lastSync = cache.get(key);

    // Debounce: jangan sinkronisasi baris yang sama dalam 1.5 detik terakhir
    if (lastSync && now - Number(lastSync) < 1500) continue;
    
    cache.put(key, String(now), 60); // Simpan timestamp sync di cache selama 60 detik
    try {
      syncRow(sheetName, r, conf);
    } catch (err) {
      console.error(`Gagal sinkronisasi baris ${r} dari sheet '${sheetName}': ${err}`);
    }
  }
}

/**
 * Membaca satu baris dari sheet, memetakannya ke format Supabase, dan mengirimnya.
 */
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
  
  // Stempel waktu edit (MODIFIED_AT) sudah disertakan di dalam record.updated_at.
  
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
  // Stempel waktu edit (kolom H) -> dipakai 'latest-wins' agar edit di
  // aplikasi web (updated_at) tidak tertimpa. Jatuh ke sekarang bila kosong.
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
      'Prefer': 'resolution=merge-duplicates,return=minimal' // 'upsert'
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
