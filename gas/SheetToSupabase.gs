// ============================================================
// AUTO: Spreadsheet -> Supabase (satu arah, real-time)
// Script TERIKAT (bound) pada spreadsheet "TANAH FINAL".
// Setiap baris baru/berubah di tab Database_Pendaftaran / Uploads
// langsung dikirim ke Supabase REST (upsert) via anon key + RLS.
//
// TIDAK ADA arah balik: perubahan di Supabase tidak menyentuh sheet.
//
// Cara pakai:
//   1. Buka spreadsheet -> Extensions > Apps Script -> tempel file ini.
//   2. Project Settings (ikon gerigi) > Script properties, tambahkan:
//        SUPABASE_URL       = https://<ref>.supabase.co
//        SUPABASE_ANON_KEY  = tombol "anon public" Supabase
//   3. Simpan & jalankan `installTriggers()` SEKALI (izinkan akses).
//      (Atau cukup dengan trigger onEdit bawaan: tidak perlu langkah 3
//      untuk edit manual — simple trigger onEdit langsung aktif.)
// ============================================================

const DATA_TABS = {
  'Database_Pendaftaran': { table: 'permohonan_surat_tanah', onConflict: 'id', kind: 'permohonan' },
  'Uploads': { table: 'permohonan_uploads', onConflict: 'file_id', kind: 'upload' }
};

// Trigger installable onChange (lebih andal, ikut mendeteksi
// penyisipan baris via script). Jalankan SEKALI dari editor Apps Script.
function installTriggers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'onSheetChange')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onSheetChange')
    .forSpreadsheet(ss)
    .onChange()
    .create();
  Logger.log('Trigger onChange terpasang.');
}

// Simple trigger (edit manual). onEdit bawaan tidak perlu instalasi.
function onEdit(e) {
  if (!e || !e.range) return;
  const sheetName = e.range.getSheet().getName();
  const conf = DATA_TABS[sheetName];
  if (!conf) return;
  const rowStart = e.range.getRow();
  const numRows = e.range.getNumRows();
  if (rowStart < 2) return; // jangan sentuh baris header
  processRange(sheetName, rowStart, numRows, conf);
}

// Handler untuk trigger installable onChange (opsional).
function onSheetChange(e) {
  if (!e || !e.source) return;
  const changeType = e.changeType || '';
  if (changeType === 'INSERT_ROW') {
    const sheet = e.source.getActiveSheet();
    const name = sheet.getName();
    const conf = DATA_TABS[name];
    if (!conf) return;
    const activeRange = sheet.getActiveRange();
    if (activeRange) {
      processRange(name, activeRange.getRow(), activeRange.getNumRows(), conf);
    }
  } else if (changeType === 'EDIT' || changeType === 'INSERT_COLUMN' || changeType === 'OTHER') {
    // onEdit simple trigger sudah menangani edit sel; biarkan di sini
    // (onChange tidak membawa detail range sel).
    if (changeType === 'EDIT') {
      const sheet = e.source.getActiveSheet();
      const name = sheet.getName();
      const conf = DATA_TABS[name];
      if (!conf) return;
      const activeRange = sheet.getActiveRange();
      if (activeRange) {
        processRange(name, activeRange.getRow(), activeRange.getNumRows(), conf);
      }
    }
  }
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
      Prefer: 'resolution=merge-duplicates,return=minimal'
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
