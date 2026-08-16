// ============================================================
// MANUAL: Spreadsheet -> Supabase TIDAK LAGI OTOMATIS.
// Script TERIKAT (bound) pada spreadsheet "TANAH FINAL".
//
// Koneksi otomatis sheet -> Supabase telah DIPUTUS sesuai permintaan:
//   - onEdit / onSheetChange sengaja dijadikan no-op (tidak menulis apa pun).
//   - installTriggers() tidak lagi memasang trigger, malah MENGHAPUS trigger.
//   - Semua tulis memakai 'resolution=ignore-duplicates' (INSERT-ONLY):
//     baris yang SUDAH ADA di Supabase TIDAK PERNAH ditimpa oleh spreadsheet,
//     jadi edit lewat aplikasi web (mis. jumlah anak) dijamin aman.
//
// Sinkronisasi sekarang hanya MANUAL lewat tombol "Tarik dari Sheet"
// di aplikasi (web app read-only Code.gs + import INSERT-ONLY di server).
//
// Script properties (Project Settings -> Script properties):
//   SUPABASE_URL       = https://<ref>.supabase.co
//   SUPABASE_ANON_KEY  = tombol "anon public" Supabase
// ============================================================

const DATA_TABS = {
  'Database_Pendaftaran': { table: 'permohonan_surat_tanah', onConflict: 'id', kind: 'permohonan' },
  'Uploads': { table: 'permohonan_uploads', onConflict: 'file_id', kind: 'upload' }
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

function processRange(sheetName, rowStart, numRows, conf) {
  const now = Date.now();
  const cache = CacheService.getScriptCache();
  for (let i = 0; i < numRows; i++) {
    const r = rowStart + i;
    const key = sheetName + '|' + r;
    const last = cache.get(key);
    if (last && now - Number(last) < 1500) continue; // debounce singkat
    cache.put(key, String(now), 60);
    try {
      syncRow(sheetName, r, conf);
    } catch (err) {
      console.error('Gagal sync baris ' + r + ' (' + sheetName + '): ' + err);
    }
  }
}

// Baca baris ke-`rowNum` (1-indexed) lalu upsert ke Supabase.
function syncRow(sheetName, rowNum, conf) {
  const tab = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!tab) return;
  const lastCol = tab.getLastColumn();
  if (lastCol < 1) return;
  const values = tab.getRange(1, 1, rowNum, lastCol).getValues(); // baris 1 = header
  const headers = values[0].map((h) => String(h).trim());
  const row = values[rowNum - 1];

  const rec = conf.kind === 'upload' ? buildUpload(headers, row) : buildPermohonan(headers, row);
  if (!rec) return;
  rec.updated_at = new Date().toISOString();
  postToSupabase(conf.table, rec, conf.onConflict);
}

function buildPermohonan(headers, row) {
  const rec = {};
  const extra = {};
  for (let j = 0; j < headers.length; j++) {
    const h = headers[j];
    const up = h.toUpperCase();
    const v = cell(row[j]);
    if (up === 'ID') rec.id = v;
    else if (up === 'TIMESTAMP') rec.timestamp = v;
    else if (up === 'LAYANAN') rec.layanan = v;
    else if (up === 'NAMA') rec.nama = v;
    else if (up === 'HP' || up === 'NO_HP') rec.hp = v;
    else if (up === 'PEMBAYARAN') rec.pembayaran = v;
    else if (up === 'STATUS_BERKAS' || up === 'STATUS') rec.status_berkas = v;
    else if (up === 'CATATAN_ADMIN') rec.catatan_admin = v;
    else if (up === 'LAST_UPDATED') rec.last_updated = v;
    else if (up === 'DATA_RAW') {
      if (v) { try { rec.data_raw = JSON.parse(v); } catch (err) { extra[h] = v; } }
    } else if (v) {
      extra[h] = v;
    }
  }
  if (!rec.id) return null;
  if (!rec.data_raw && Object.keys(extra).length) rec.data_raw = extra;
  return rec;
}

function buildUpload(headers, row) {
  const rec = {};
  for (let j = 0; j < headers.length; j++) {
    const up = headers[j].toUpperCase();
    const v = cell(row[j]);
    if (up === 'ID_REGISTRASI') rec.id_registrasi = v;
    else if (up === 'JENIS_UPLOAD') rec.jenis_upload = v;
    else if (up === 'FILE_NAME' || up === 'NAMA_FILE') rec.file_name = v;
    else if (up === 'FILE_URL') rec.file_url = v;
    else if (up === 'FILE_ID') rec.file_id = v;
    else if (up === 'TIMESTAMP') rec.timestamp = v;
  }
  if (!rec.file_id) return null;
  rec.id_registrasi = rec.id_registrasi || '';
  return rec;
}

// Normalisasi nilai sel: null/undefined -> null, string dipangkas.
function cell(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function postToSupabase(table, rec, onConflict) {
  const props = PropertiesService.getScriptProperties();
  const base = props.getProperty('SUPABASE_URL');
  const anon = props.getProperty('SUPABASE_ANON_KEY');
  if (!base || !anon) throw new Error('Script Properties SUPABASE_URL / SUPABASE_ANON_KEY belum diisi.');
  const url = base + '/rest/v1/' + table + '?on_conflict=' + onConflict;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      apikey: anon,
      Authorization: 'Bearer ' + anon,
      // INSERT-ONLY: baris yang sudah ada TIDAK PERNAH ditimpa (hanya menambah baris baru).
      Prefer: 'resolution=ignore-duplicates,return=minimal'
    },
    payload: JSON.stringify(rec),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code >= 300) {
    throw new Error('Supabase ' + code + ': ' + res.getContentText().slice(0, 300));
  }
}

// Opsional: dorong SEMUA baris kedua tab sekali jalan (catch-up).
function syncAllNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  for (const sheetName of Object.keys(DATA_TABS)) {
    const conf = DATA_TABS[sheetName];
    const tab = ss.getSheetByName(sheetName);
    if (!tab) continue;
    const lastRow = tab.getLastRow();
    if (lastRow < 2) continue;
    for (let r = 2; r <= lastRow; r++) {
      try { syncRow(sheetName, r, conf); } catch (err) { Logger.log('Baris ' + r + ': ' + err); }
    }
    Logger.log(sheetName + ': ' + (lastRow - 1) + ' baris dikirim.');
  }
}
