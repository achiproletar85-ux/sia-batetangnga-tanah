// ============================================================
// PERUBAHAN YANG PERLU DITEMPEL KE APPS SCRIPT "apk keuangan"
// (project web app yang terikat di spreadsheet keuangan).
//
// YANG HARUS DILAKUKAN DI SPREADSHEET:
//   1. Buka tab TRANSAKSI.
//   2. Tambahkan header di sel H1:  MODIFIED_AT
//      (baris lama dibiarkan kosong - akan otomatis terisi saat
//       transaksi disimpan/diubah melalui aplikasi atau diedit manual).
//
// YANG HARUS DILAKUKAN DI APPS SCRIPT:
//   1. Ganti fungsi  simpanTransaksi  dengan versi di bawah.
//   2. Ganti fungsi  updateTransaksi  dengan versi di bawah.
//   3. Tempel fungsi  onEdit  (stempel manual) di bawah.
//   4. Simpan + deploy ulang (Deploy > Manage deployments > Edit >
//      Version > New version > Deploy).
// ============================================================

// ==========================================
// FUNGSI SIMPAN TRANSAKSI  (GANTI VERSI LAMA)
// ==========================================
function simpanTransaksi(formObj) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('TRANSAKSI');
    if (!sheet) {
      sheet = ss.insertSheet('TRANSAKSI');
      sheet.appendRow(['ID_TRANSAKSI', 'TANGGAL', 'JENIS', 'ID_PEMOHON', 'NOMINAL', 'KETERANGAN', 'URL_BUKTI', 'MODIFIED_AT']);
    } else {
      // Pastikan header MODIFIED_AT ada (aman kalau belum sempat ditambah manual).
      const h = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(c) { return String(c).trim().toUpperCase(); });
      if (h.indexOf('MODIFIED_AT') === -1) {
        sheet.getRange(1, 8).setValue('MODIFIED_AT');
      }
    }

    let urlBukti = "-";
    if (formObj.fileData && formObj.fileName) {
      urlBukti = uploadFileKeDrive(formObj.fileData, formObj.fileName);
      if (urlBukti.includes("ERROR")) return { status: 'error', pesan: urlBukti };
    }

    const idTransaksi = "TRX-" + new Date().getTime();
    const tanggal = new Date();
    const modifiedAt = new Date(); // stempel waktu edit (untuk sync latest-wins)
    const jenis = formObj.jenisTransaksi;
    const idPemohon = (jenis === 'Pemasukan Cicilan') ? String(formObj.idPemohon).trim().toUpperCase() : jenis;
    const nominal = parseInt(formObj.nominal.replace(/[^0-9]/g, ''), 10) || 0;

    sheet.appendRow([idTransaksi, tanggal, jenis, idPemohon, nominal, formObj.keterangan, urlBukti, modifiedAt]);
    
    simpanLog('TRANSAKSI', 'Transaksi baru: ' + idTransaksi + ' | ' + jenis + ' | Rp ' + nominal);
    
    return { status: 'success', pesan: 'Transaksi berhasil!', idTransaksi: idTransaksi };
  } catch (error) {
    return { status: 'error', pesan: error.toString() };
  }
}

// ==========================================
// FUNGSI UPDATE TRANSAKSI  (GANTI VERSI LAMA)
// ==========================================
function updateTransaksi(idTransaksi, formObj) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetTrx = ss.getSheetByName('TRANSAKSI');
    
    if (!sheetTrx) {
      return { status: 'error', pesan: 'Sheet TRANSAKSI tidak ditemukan' };
    }
    
    const dataTrx = sheetTrx.getDataRange().getDisplayValues();
    let rowIndex = -1;
    
    for (let i = 1; i < dataTrx.length; i++) {
      if (String(dataTrx[i][0]).trim() === String(idTransaksi).trim()) {
        rowIndex = i + 1;
        break;
      }
    }
    
    if (rowIndex === -1) {
      return { status: 'error', pesan: 'Transaksi tidak ditemukan' };
    }
    
    let urlBukti = formObj.buktiLama || '-';
    if (formObj.fileData && formObj.fileName) {
      urlBukti = uploadFileKeDrive(formObj.fileData, formObj.fileName);
      if (urlBukti.includes("ERROR")) return { status: 'error', pesan: urlBukti };
    }
    
    const jenis = formObj.jenisTransaksi;
    const idPemohon = (jenis === 'Pemasukan Cicilan') ? String(formObj.idPemohon).trim().toUpperCase() : jenis;
    const nominal = parseInt(String(formObj.nominal).replace(/[^0-9]/g, ''), 10) || 0;
    
    sheetTrx.getRange(rowIndex, 2).setValue(new Date(formObj.tanggal) || new Date());
    sheetTrx.getRange(rowIndex, 3).setValue(jenis);
    sheetTrx.getRange(rowIndex, 4).setValue(idPemohon);
    sheetTrx.getRange(rowIndex, 5).setValue(nominal);
    sheetTrx.getRange(rowIndex, 6).setValue(formObj.keterangan);
    sheetTrx.getRange(rowIndex, 7).setValue(urlBukti);
    sheetTrx.getRange(rowIndex, 8).setValue(new Date()); // stempel waktu edit
    
    simpanLog('UPDATE', 'Transaksi diupdate: ' + idTransaksi);
    
    return { status: 'success', pesan: 'Transaksi berhasil diupdate!' };
  } catch (error) {
    return { status: 'error', pesan: error.toString() };
  }
}

// ==========================================
// ONEDIT: STEMPEL EDIT MANUAL DI SPREADSHEET
// ==========================================
// Simple trigger onEdit TIDAK dipicu oleh perubahan dari kode (script),
// sehingga tidak ada loop tak berujung. Hanya menyentuh baris data
// (bukan header) di tab TRANSAKSI, kolom A-G.
function onEdit(e) {
  try {
    const sheet = e.range.getSheet();
    if (sheet.getName() !== 'TRANSAKSI') return;
    const row = e.range.getRow();
    const col = e.range.getColumn();
    if (row < 2) return;         // abaikan header
    if (col > 7) return;         // hanya kolom data A-G yang relevan
    const idCell = sheet.getRange(row, 1).getValue();
    if (!idCell || String(idCell).trim() === '') return;
    sheet.getRange(row, 8).setValue(new Date()); // MODIFIED_AT
  } catch (err) {
    Logger.log('onEdit MODIFIED_AT error: ' + err.toString());
  }
}
