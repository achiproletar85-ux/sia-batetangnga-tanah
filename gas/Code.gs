// ============================================================
// GAS READ-ONLY untuk IMPORT MANUAL data spreadsheet -> Supabase.
// Tidak ada trigger / onEdit / sinkronisasi otomatis.
// Satu-satunya fungsi: membaca isi tab spreadsheet dan mengembalikannya
// sebagai JSON lewat doPost(action=getRows) yang dipanggil server Node
// (endpoint /api/import-from-sheet).
// ============================================================
const TOKEN_KEY = 'GAS_SYNC_TOKEN';
const SPREADSHEET_ID = '1KK7EUwdZe7jRfuymJ43GLH3zf7uKoouQwJx2QSfxlwc';

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  const token = String(body.token || '');

  const props = PropertiesService.getScriptProperties();
  if (token !== props.getProperty(TOKEN_KEY)) {
    return respond(401, { success: false, error: 'Token salah.' });
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = String(body.sheet || 'Database_Pendaftaran');
  const tab = ss.getSheetByName(sheet);
  if (!tab) {
    return respond(404, { success: false, error: 'Tab tidak ditemukan: ' + sheet });
  }

  const range = tab.getDataRange();
  const values = range.getValues();
  if (values.length === 0) {
    return respond(200, { success: true, tab: sheet, count: 0, headers: [], rows: [] });
  }

  const headers = values[0].map((h) => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[i][j] === null || values[i][j] === undefined ? '' : values[i][j];
    }
    rows.push(row);
  }

  return respond(200, { success: true, tab: sheet, count: rows.length, headers: headers, rows: rows });
}

function doGet() {
  return respond(405, { success: false, error: 'Gunakan POST.' });
}

function respond(code, obj) {
  const out = ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
  try {
    out.setStatusCode(code);
  } catch (err) {
    // Versi Apps Script lama: abaikan status code (tetap JSON).
  }
  return out;
}


function test_ListSheetNames() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheets = ss.getSheets();
  const names = sheets.map(sheet => sheet.getName());
  Logger.log(names);
  Browser.msgBox('Nama-nama Sheet yang Ditemukan:', JSON.stringify(names, null, 2));
}
