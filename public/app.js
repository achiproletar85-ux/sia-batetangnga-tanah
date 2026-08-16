(() => {
  let allData = [];
  let uploads = [];
  let keuState = [];
  let pemohonCache = [];
  let currentEditId = null;
  let currentEditLayanan = 'HIBAH';
  let rowsCache = [];
  let activeTab = 'dashboard';
  let curFp = '0';
  const renderedFp = {};

  const $ = (id) => document.getElementById(id);

  // Indikator "sedang bekerja" pada tombol: nonaktifkan + spinner + label
  // (label asli disimpan agar bisa dipulihkan setelah selesai).
  function busyBtn(btn, on, label) {
    if (!btn) return;
    if (on) {
      if (!btn.dataset.busyOrig) btn.dataset.busyOrig = btn.innerHTML;
      btn.disabled = true;
      btn.classList.add('is-busy');
      btn.innerHTML = `<span class="spinner" aria-hidden="true"></span> ${label || 'Memuat…'}`;
    } else {
      btn.disabled = false;
      btn.classList.remove('is-busy');
      if (btn.dataset.busyOrig) { btn.innerHTML = btn.dataset.busyOrig; delete btn.dataset.busyOrig; }
    }
  }

  // ---------- Keuangan Tab ----------

  function formatRp(num) {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(num || 0);
  }

  function initKeuangan() {
    $('btnTambahTransaksi').addEventListener('click', () => openTrxModal(null));
    $('btnCloseTrx').addEventListener('click', closeTrxModal);
    $('trxForm').addEventListener('submit', handleTrxFormSubmit);
    $('keuSearchInput').addEventListener('input', () => { if(pageState.keuangan) pageState.keuangan.p = 1; renderKeuanganTable(); });
    $('btnCekTagihanBerkas').addEventListener('click', () => { openCekTbPanel(); });
    $('btnCloseCekTb').addEventListener('click', () => { $('cekTbPanel').style.display = 'none'; });
    $('btnCekTbCari').addEventListener('click', () => cekTagihanBerkas());
    $('cekTbId').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); cekTagihanBerkas(); } });
    $('trxJenis').addEventListener('change', (e) => {
      $('trxPemohonLabel').style.display = e.target.value === 'Pemasukan Cicilan' ? 'block' : 'none';
    });
    $('keuBody').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-id]');
      if (btn) {
        const id = btn.dataset.id;
        const trx = keuState.find(t => t.id === id);
        if (trx) openTrxModal(trx);
      }
    });
    $('btnDeleteTrx').addEventListener('click', async () => {
      const id = $('trxId').value;
      if (!id) return;
      if (!confirm(`Anda yakin ingin menghapus transaksi ${id}?`)) return;
      busyBtn($('btnDeleteTrx'), true, 'Menghapus…');
      try {
        const res = await fetch(`/api/keuangan/transaksi/${id}`, { method: 'DELETE' });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        closeTrxModal();
        await Promise.all([fetchKeuanganSummary(), fetchKeuanganTransaksi()]);
        renderKeuanganTable();
      } catch(e) {
        alert(`Gagal menghapus: ${e.message}`);
      } finally {
        busyBtn($('btnDeleteTrx'), false);
      }
    });
  }

  async function fetchPemohonList() {
      if (pemohonCache.length > 0) return; // Avoid re-fetching
      try {
          const res = await fetch('/api/permohonan');
          const json = await res.json();
          if(json.success) {
              pemohonCache = json.data || [];
              const list = $('pemohonList');
              list.innerHTML = '';
              pemohonCache.forEach(p => {
                  const opt = document.createElement('option');
                  opt.value = p.id;
                  opt.textContent = `${p.nama} (${p.id})`;
                  list.appendChild(opt);
              });
          }
      } catch(e) {
          console.error("Gagal memuat daftar pemohon:", e);
      }
  }

  async function fetchKeuanganSummary() {
    try {
      const res = await fetch('/api/keuangan/ringkasan');
      const json = await res.json();
      if (json.success) {
        $('keuTotalPemasukan').textContent = formatRp(json.data.total_pemasukan);
        $('keuTotalPengeluaran').textContent = formatRp(json.data.total_pengeluaran);
        $('keuSaldoAkhir').textContent = formatRp(json.data.saldo_akhir);
      }
    } catch (e) {
      console.error('Gagal memuat ringkasan keuangan:', e);
    }
  }

  async function fetchKeuanganTransaksi() {
    try {
      const res = await fetch('/api/keuangan/transaksi');
      const json = await res.json();
      if (json.success) {
        keuState = json.data || [];
      }
    } catch (e) {
      console.error('Gagal memuat transaksi keuangan:', e);
      keuState = [];
    }
  }

  function renderKeuanganTable() {
    const q = $('keuSearchInput').value.toLowerCase().trim();
    const body = $('keuBody');
    body.innerHTML = '';

    const filtered = keuState.filter(t => {
      if (!q) return true;
      const makerName = t.permohonan_surat_tanah ? t.permohonan_surat_tanah.nama : '';
      const hay = [t.id, t.jenis_transaksi, t.keterangan, t.id_permohonan, makerName].join(' ').toLowerCase();
      return hay.includes(q);
    });

    $('keuEmpty').hidden = filtered.length > 0;
    
    if (!pageState.keuangan) pageState.keuangan = { p: 1 };
    const stp = pageState.keuangan;
    const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    if (stp.p > totalPages) stp.p = totalPages;
    const shown = filtered.slice((stp.p - 1) * PER_PAGE, stp.p * PER_PAGE);

    const frag = document.createDocumentFragment();
    const canInput = isBendahara();
    shown.forEach(t => {
      const tr = document.createElement('tr');
      const makerName = t.permohonan_surat_tanah ? t.permohonan_surat_tanah.nama : (t.id_permohonan || '-');
      tr.innerHTML = `
        <td>${new Date(t.tanggal).toLocaleDateString('id-ID')}</td>
        <td><span class="tag ${t.jenis_transaksi.includes('Pemasukan') ? 'status-ok' : 'status-ko'}">${esc(t.jenis_transaksi)}</span></td>
        <td>${esc(makerName)}</td>
        <td class="num">${formatRp(t.nominal)}</td>
        <td class="wrap">${esc(t.keterangan)}</td>
        <td>${t.url_bukti ? `<a class="flink" href="${esc(t.url_bukti)}" target="_blank" rel="noopener">🔗 Lihat</a>` : '—'}</td>
        ${canInput ? `<td><button class="btn" data-id="${esc(t.id)}">✏️ Edit</button></td>` : ''}
      `;
      frag.appendChild(tr);
    });
    body.appendChild(frag);
    drawPager('pagerKeuangan', 'keuangan', filtered.length);
  }

  function openCekTbPanel() {
    fetchPemohonList();
    $('cekTbPanel').style.display = 'block';
    $('cekTbResult').innerHTML = '';
    const inp = $('cekTbId');
    inp.value = '';
    setTimeout(() => inp.focus(), 50);
    inp.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function statusLunasBadge(lunas) {
    return lunas
      ? '<span class="tag status-ok">LUNAS</span>'
      : '<span class="tag status-ko">BELUM LUNAS</span>';
  }

  // Label Indonesia untuk field data_raw (agar tampilan Cek Tagihan & Berkas mudah dibaca).
  const DATA_RAW_LABELS = {
    nama_lengkap: 'Nama Lengkap',
    no_hp: 'No. HP',
    nik: 'NIK',
    alamat: 'Alamat',
    dusun: 'Dusun',
    jenis_tanah: 'Jenis Tanah',
    alamat_tanah: 'Alamat Tanah (Pihak Kedua)',
    luas_tanah: 'Luas Tanah',
    batas_utara: 'Batas Utara',
    batas_timur: 'Batas Timur',
    batas_selatan: 'Batas Selatan',
    batas_barat: 'Batas Barat',
    tahun_pemberian: 'Tahun Pemberian',
    status_bayar: 'Status Bayar',
    nama_pasangan: 'Nama Pasangan',
    pasangan_nama: 'Nama Pasangan',
    anak_1_nama: 'Anak 1',
    anak_2_nama: 'Anak 2',
    anak_3_nama: 'Anak 3',
    anak_4_nama: 'Anak 4',
    anak_5_nama: 'Anak 5',
    anak_6_nama: 'Anak 6',
    jumlah_anak: 'Jumlah Anak',
    saksi_1_nama: 'Saksi 1',
    saksi_2_nama: 'Saksi 2',
    saksi1_nama: 'Saksi 1',
    saksi2_nama: 'Saksi 2',
    identitas_pihak_kedua: 'Identitas Pihak Kedua',
    nama_pihak_kedua: 'Nama Pihak Kedua',
    alamat_pihak_kedua: 'Alamat Pihak Kedua',
    nama_pemberi: 'Nama Pemberi (Pihak Pertama)',
    nama_penerima: 'Nama Penerima (Pihak Kedua)',
    hak_atas_tanah: 'Hak Atas Tanah',
    nomor_hak: 'Nomor Hak',
    atas_nama: 'Atas Nama',
    luas_sertifikat: 'Luas Sertifikat',
    keterangan: 'Keterangan',
    permohonan_online: 'Permohonan Online',
    tgl_permohonan: 'Tanggal Permohonan',
    _nomorSuratTercetak: 'Nomor Surat Tercetak',
    _tglCetakSurat: 'Tanggal Cetak Surat',
  };
  function humanizeKey(k) {
    const s = String(k || '')
      .replace(/^_+/, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    return s;
  }
  function dataRawLabel(k) {
    return DATA_RAW_LABELS[k] || humanizeKey(k);
  }
  function parseRawData(v) {
    if (!v) return null;
    if (typeof v === 'object') return v;
    try { return JSON.parse(String(v)); } catch (_) { return null; }
  }
  // Field data_raw yang dianggap penting untuk ditampilkan di panel Cek.
  // Hanya ±10 kolom kunci agar tampilan tidak membludak dengan semua isian.
  const DATA_RAW_PRIORITY = [
    'jenis_tanah',
    'alamat_tanah',
    'alamat',
    'dusun',
    'luas_tanah',
    'tahun_pemberian',
    'batas_utara',
    'batas_timur',
    'batas_selatan',
    'batas_barat',
  ];
  // Bangun grid detail permohonan: kolom utama + field data_raw yang penting saja.
  function buildDetailRows(pm) {
    const rows = [];
    if (!pm) return rows;
    const push = (k, v) => {
      const s = (v === null || v === undefined) ? '' : String(v).trim();
      if (s === '') return;
      rows.push({ k: String(k), v: s });
    };
    push('ID Pendaftaran', pm.id);
    push('Nama Pemohon', pm.nama);
    push('No. HP', pm.hp);
    push('Layanan', pm.layanan);
    push('Status Berkas', pm.status_berkas);
    push('Pembayaran', pm.pembayaran);
    push('Catatan Admin', pm.catatan_admin);
    const raw = parseRawData(pm.data_raw);
    if (raw && typeof raw === 'object') {
      DATA_RAW_PRIORITY.forEach((k) => {
        const v = raw[k];
        if (v === null || v === undefined) return;
        if (typeof v === 'object') {
          try { push(dataRawLabel(k), JSON.stringify(v)); } catch (_) {}
          return;
        }
        push(dataRawLabel(k), v);
      });
    }
    return rows;
  }

  function renderCekTb(data) {
    const pm = data.permohonan;
    const tg = data.tagihan;
    const riwayat = data.riwayat || [];
    const berkas = data.berkas || [];

    const pct = tg.biaya_total > 0 ? Math.min(100, Math.round((tg.total_terbayar / tg.biaya_total) * 100)) : 0;

    const detailRows = buildDetailRows(pm);
    const infoHtml = detailRows.length
      ? `<div class="detail-grid">
           ${detailRows.map((r) => `<div class="k">${esc(r.k)}</div><div><strong>${esc(r.v)}</strong></div>`).join('')}
         </div>`
      : '<p class="empty">Data permohonan tidak ditemukan.</p>';

    const riwayatHtml = riwayat.length
      ? `<table class="mini-table">
           <thead><tr><th>Tanggal</th><th>Jenis</th><th>Nominal</th><th>Keterangan</th><th>Bukti</th></tr></thead>
           <tbody>
             ${riwayat.map((t) => `
               <tr>
                 <td>${new Date(t.tanggal).toLocaleDateString('id-ID')}</td>
                 <td><span class="tag ${t.jenis_transaksi.includes('Pemasukan') ? 'status-ok' : 'status-ko'}">${esc(t.jenis_transaksi)}</span></td>
                 <td class="num">${formatRp(t.nominal)}</td>
                 <td class="wrap">${esc(t.keterangan)}</td>
                 <td>${t.url_bukti && t.url_bukti !== '-' ? `<a class="flink" href="${esc(t.url_bukti)}" target="_blank" rel="noopener">🔗 Lihat</a>` : '—'}</td>
               </tr>`).join('')}
           </tbody>
         </table>`
      : '<p class="empty">Belum ada riwayat transaksi.</p>';

    const berkasHtml = berkas.length
      ? `<table class="mini-table">
           <thead><tr><th>Jenis Berkas</th><th>Nama File</th><th>Waktu</th><th>Aksi</th></tr></thead>
           <tbody>
             ${berkas.map((b) => `
               <tr>
                 <td><span class="tag status-s">${esc(b.jenis_upload)}</span></td>
                 <td class="wrap">${esc(b.file_name)}</td>
                 <td>${esc(b.timestamp)}</td>
                 <td>${b.file_url ? `<a class="flink" href="${esc(b.file_url)}" target="_blank" rel="noopener">🔗 Buka</a>` : '—'}</td>
               </tr>`).join('')}
           </tbody>
         </table>`
      : '<p class="empty">Belum ada berkas.</p>';

    $('cekTbResult').innerHTML = `
      ${tg.status_lunas ? `<div style="margin-bottom:14px;"><button id="btnCetakNota" class="btn primary" style="display:inline-flex; align-items:center; gap:6px;"><i data-lucide="printer" style="width:16px;height:16px;"></i> Cetak Nota Lunas</button></div>` : ''}
      <div class="dash-grid" style="grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); margin-bottom:16px;">
        <div class="dash-card total">
          <div class="dash-ic" style="background-color:#e0f2fe;">💰</div>
          <div><div class="dash-val">${formatRp(tg.biaya_total)}</div><div class="dash-lb">Biaya Total</div></div>
        </div>
        <div class="dash-card ok">
          <div class="dash-ic" style="background-color:#ecfdf5;">✅</div>
          <div><div class="dash-val">${formatRp(tg.total_terbayar)}</div><div class="dash-lb">Total Terbayar</div></div>
        </div>
        <div class="dash-card ko">
          <div class="dash-ic" style="background-color:#fee2e2;">📌</div>
          <div><div class="dash-val">${formatRp(tg.sisa_tagihan)}</div><div class="dash-lb">Sisa Tagihan</div></div>
        </div>
        <div class="dash-card">
          <div class="dash-ic" style="background-color:#fef3c7;">📋</div>
          <div><div class="dash-val">${statusLunasBadge(tg.status_lunas)}</div><div class="dash-lb">Status</div></div>
        </div>
      </div>
      <div class="progress" style="margin-bottom:16px;"><div class="progress-bar" style="width:${pct}%"></div></div>
      <h3 style="margin:0 0 8px; font-size:14px;">Data Pemohon</h3>
      ${infoHtml}
      <h3 style="margin:18px 0 8px; font-size:14px;">Riwayat Pembayaran (${riwayat.length})</h3>
      ${riwayatHtml}
      <h3 style="margin:18px 0 8px; font-size:14px;">Berkas (${berkas.length})</h3>
      ${berkasHtml}`;

    const btnNota = $('btnCetakNota');
    if (btnNota) btnNota.addEventListener('click', () => cetakNotaLunas(data));
    if (window.lucide) window.lucide.createIcons();
  }

  async function cekTagihanBerkas() {
    const id = $('cekTbId').value.trim().toUpperCase();
    if (!id) { alert('Masukkan ID pendaftaran terlebih dahulu.'); return; }
    const btn = $('btnCekTbCari');
    busyBtn(btn, true, 'Mencari…');
    $('cekTbResult').innerHTML = '<p class="empty">Memuat...</p>';
    try {
      const res = await fetch('/api/pemohon/' + encodeURIComponent(id) + '/tagihan-berkas');
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error((json && json.error) || 'Gagal memuat data.');
      if (!json.data || !json.data.permohonan) {
        $('cekTbResult').innerHTML = '<p class="empty">ID <strong>' + esc(id) + '</strong> tidak ditemukan.</p>';
        return;
      }
      renderCekTb(json.data);
    } catch (e) {
      $('cekTbResult').innerHTML = '<p class="empty">Gagal: ' + esc(e.message) + '</p>';
    } finally {
      busyBtn(btn, false);
    }
  }

  // Ubah angka menjadi kata-kata bahasa Indonesia (mis. 250000 -> "dua ratus lima puluh ribu").
  function terbilang(n) {
    n = Math.floor(Math.abs(Number(n) || 0));
    if (n === 0) return 'nol';
    const satuan = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
    const urai = (x) => {
      if (x < 12) return satuan[x];
      if (x < 20) return satuan[x - 10] + ' belas';
      if (x < 100) return urai(Math.floor(x / 10)) + ' puluh ' + urai(x % 10);
      if (x < 200) return 'seratus ' + urai(x - 100);
      if (x < 1000) return urai(Math.floor(x / 100)) + ' ratus ' + urai(x % 100);
      if (x < 2000) return 'seribu ' + urai(x - 1000);
      if (x < 1000000) return urai(Math.floor(x / 1000)) + ' ribu ' + urai(x % 1000);
      if (x < 1000000000) return urai(Math.floor(x / 1000000)) + ' juta ' + urai(x % 1000000);
      return urai(Math.floor(x / 1000000000)) + ' miliar ' + urai(x % 1000000000);
    };
    return urai(n).trim().replace(/\s+/g, ' ');
  }

  // Buka jendela nota pelunasan siap cetak (hanya saat status LUNAS).
  function cetakNotaLunas(data) {
    if (!data || !data.permohonan || !data.tagihan || !data.tagihan.status_lunas) {
      alert('Nota hanya dapat dicetak bila tagihan sudah LUNAS.');
      return;
    }
    const pm = data.permohonan;
    const tg = data.tagihan;
    const riwayat = data.riwayat || [];
    const raw = parseRawData(pm.data_raw) || {};
    const v = (k, d) => (raw[k] !== undefined && raw[k] !== null && String(raw[k]).trim() !== '') ? String(raw[k]).trim() : (d || '');
    const tanggal = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
    const noNota = 'NOTA/' + (pm.id || '') + '/' + new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const riwayatRows = riwayat.map((t, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${new Date(t.tanggal).toLocaleDateString('id-ID')}</td>
        <td>${esc(t.jenis_transaksi)}</td>
        <td>${esc(t.keterangan || '-')}</td>
        <td class="num">${formatRp(t.nominal)}</td>
      </tr>`).join('');

    const win = window.open('', '_blank', 'width=900,height=1200');
    if (!win) { alert('Browser memblokir pop-up. Izinkan pop-up untuk mencetak nota.'); return; }
    win.document.write(`<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>Nota Pelunasan ${esc(pm.nama || pm.id || '')}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Times New Roman', Times, serif; margin: 0; padding: 24px; color: #000; }
  .kop { text-align: center; border-bottom: 3px double #000; padding-bottom: 8px; margin-bottom: 14px; }
  .kop h1 { margin: 0; font-size: 20px; letter-spacing: 1px; }
  .kop h2 { margin: 2px 0 0; font-size: 14px; font-weight: normal; }
  .kop p { margin: 2px 0 0; font-size: 11px; }
  .judul { text-align: center; font-size: 16px; font-weight: bold; text-transform: uppercase; margin: 10px 0 4px; }
  .sub { text-align: center; font-size: 12px; margin-bottom: 18px; }
  table.data { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 16px; }
  table.data td { padding: 3px 4px; vertical-align: top; }
  table.data td.k { width: 210px; font-weight: bold; }
  table.trx { width: 100%; border-collapse: collapse; font-size: 12px; margin: 10px 0 16px; }
  table.trx th, table.trx td { border: 1px solid #000; padding: 5px 6px; }
  table.trx th { background: #eee; text-align: left; }
  .num { text-align: right; white-space: nowrap; }
  .total-lunas { margin: 14px 0; padding: 10px 14px; border: 2px solid #000; display: inline-block; font-size: 14px; font-weight: bold; }
  .terbilang { font-size: 13px; margin-bottom: 28px; }
  .ttd { display: flex; justify-content: space-between; margin-top: 50px; font-size: 12px; }
  .ttd > div { text-align: center; width: 45%; }
  .ttd .sp { height: 70px; }
  .ttd .garis { border-top: 1px solid #000; width: 100%; margin-top: 4px; }
  @media print { body { padding: 12px; } }
</style>
</head>
<body>
  <div class="kop">
    <h1>PEMERINTAH KABUPATEN POLEWALI MANDAR</h1>
    <h2>KECAMATAN &mdash; DESA BATETANGNGA</h2>
    <p>Desa Batetangnga, Kabupaten Polewali Mandar, Sulawesi Barat</p>
  </div>
  <div class="judul">Nota Pelunasan Biaya Administrasi Sertifikat Tanah</div>
  <div class="sub">Nomor: <strong>${esc(noNota)}</strong></div>

  <table class="data">
    <tr><td class="k">Nomor / ID Pendaftaran</td><td>: ${esc(pm.id || '-')}</td></tr>
    <tr><td class="k">Nama Pemohon</td><td>: ${esc(pm.nama || '-')}</td></tr>
    <tr><td class="k">No. HP</td><td>: ${esc(pm.hp || '-')}</td></tr>
    <tr><td class="k">Layanan</td><td>: ${esc(pm.layanan || '-')}</td></tr>
    <tr><td class="k">Jenis Tanah</td><td>: ${esc(v('jenis_tanah', '-'))}</td></tr>
    <tr><td class="k">Alamat Tanah</td><td>: ${esc(v('alamat_tanah', '-'))}</td></tr>
    <tr><td class="k">Alamat</td><td>: ${esc(v('alamat', '-'))}</td></tr>
    <tr><td class="k">Dusun</td><td>: ${esc(v('dusun', '-'))}</td></tr>
    <tr><td class="k">Luas Tanah</td><td>: ${esc(v('luas_tanah', '-'))} m&sup2;</td></tr>
  </table>

  <table class="trx">
    <thead><tr><th>No</th><th>Tanggal</th><th>Jenis</th><th>Keterangan</th><th class="num">Nominal</th></tr></thead>
    <tbody>
      ${riwayatRows || '<tr><td colspan="5">Tidak ada riwayat.</td></tr>'}
      <tr><td colspan="4" style="text-align:right; font-weight:bold;">TOTAL PEMBAYARAN</td><td class="num" style="font-weight:bold;">${formatRp(tg.total_terbayar)}</td></tr>
    </tbody>
  </table>

  <div class="total-lunas">STATUS: LUNAS &mdash; Biaya ${formatRp(tg.biaya_total)} telah dibayar penuh (${formatRp(tg.total_terbayar)})</div>
  <div class="terbilang">Terbilang: <strong>${esc(terbilang(tg.total_terbayar))} rupiah</strong>.</div>

  <div class="ttd">
    <div>
      <div>Pemohon,</div>
      <div class="sp"></div>
      <div class="garis"></div>
      <div><strong>${esc(pm.nama || '............................')}</strong></div>
    </div>
    <div>
      <div>Batetangnga, ${esc(tanggal)}</div>
      <div>Bendahara Desa,</div>
      <div class="sp"></div>
      <div class="garis"></div>
      <div><strong>............................</strong></div>
    </div>
  </div>

  <script>
    window.onload = function () { setTimeout(function () { window.print(); }, 300); };
  <\/script>
</body>
</html>`);
    win.document.close();
    win.focus();
  }

  function openTrxModal(trx) {
    const m = $('trxModal');
    $('trxForm').reset();
    $('trxId').value = '';
    $('trxBukti').value = '';
    $('trxBuktiPreview').innerHTML = '';
    $('trxBuktiOld').value = '';
    $('btnDeleteTrx').style.display = 'none';

    if (trx) {
      $('trxModalTitle').textContent = 'Edit Transaksi';
      $('trxId').value = trx.id;
      $('trxTanggal').value = new Date(trx.tanggal).toISOString().split('T')[0];
      $('trxJenis').value = trx.jenis_transaksi;
      $('trxIdPemohon').value = trx.id_permohonan || '';
      $('trxNominal').value = trx.nominal;
      $('trxKeterangan').value = trx.keterangan || '';
      if (trx.url_bukti && trx.url_bukti !== '-') {
        $('trxBuktiOld').value = trx.url_bukti;
        $('trxBuktiPreview').innerHTML = `<a href="${esc(trx.url_bukti)}" target="_blank">Lihat Bukti Lama</a>`;
      }
      $('btnDeleteTrx').style.display = 'inline-block';
    } else {
      $('trxModalTitle').textContent = 'Tambah Transaksi';
      $('trxTanggal').value = new Date().toISOString().split('T')[0];
    }

    $('trxPemohonLabel').style.display = $('trxJenis').value === 'Pemasukan Cicilan' ? 'block' : 'none';
    fetchPemohonList();
    if (typeof m.showModal === 'function') m.showModal(); else m.setAttribute('open', '');
  }

  function closeTrxModal() {
    const m = $('trxModal');
    if (m && typeof m.close === 'function') m.close();
  }

  async function handleTrxFormSubmit(e) {
    e.preventDefault();

    const btn = $('btnSaveTrx');
    busyBtn(btn, true, 'Menyimpan…');

    try {
      const id = $('trxId').value;

      // Bukti pembayaran: file biner TIDAK disimpan di Supabase Storage.
      // Jika bendahara memilih file, unggah ke Google Drive via server,
      // lalu simpan hanya LINK-nya (konsisten dengan alur upload permohonan).
      const fileInput = $('trxBukti');
      let urlBukti = null;
      if (fileInput.files && fileInput.files.length > 0) {
        const f = fileInput.files[0];
        if (f.size > 8 * 1024 * 1024) {
          throw new Error('Ukuran file bukti melebihi 8 MB.');
        }
        const dataUrl = await readFileAsDataURL(f);
        busyBtn(btn, true, 'Mengunggah bukti…');
        const upRes = await fetch('/api/keuangan/upload-bukti', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: f.name, fileData: dataUrl }),
        });
        const upJson = await upRes.json();
        if (!upRes.ok || !upJson.success) throw new Error((upJson && upJson.error) || 'Gagal mengunggah bukti ke Google Drive.');
        urlBukti = upJson.url;
      }

      // Saat edit tanpa file baru, pertahankan bukti lama.
      if (!urlBukti && id) {
        const oldTrx = keuState.find(t => t.id === id);
        urlBukti = (oldTrx && oldTrx.url_bukti !== '-') ? oldTrx.url_bukti : null;
      }

      const payload = {
        tanggal: $('trxTanggal').value,
        jenis_transaksi: $('trxJenis').value,
        id_permohonan: $('trxJenis').value === 'Pemasukan Cicilan' ? $('trxIdPemohon').value : null,
        nominal: parseInt($('trxNominal').value, 10),
        keterangan: $('trxKeterangan').value,
        url_bukti: urlBukti,
      };

      const url = id ? `/api/keuangan/transaksi/${id}` : '/api/keuangan/transaksi';
      const method = id ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      
      closeTrxModal();
      await Promise.all([fetchKeuanganSummary(), fetchKeuanganTransaksi()]);
      renderKeuanganTable();

    } catch(e) {
      alert(`Gagal menyimpan transaksi: ${e.message}`);
    } finally {
      busyBtn(btn, false);
    }
  }

  // ---------- Autentikasi User (Login / Logout) ----------
  const AUTH_KEY = 'sta_auth_session';
  let isAuthed = false;

  function getSession() {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (_) { return null; }
  }
  function setSession(s) {
    try { localStorage.setItem(AUTH_KEY, JSON.stringify(s)); } catch (_) {}
  }
  function clearSession() {
    try { localStorage.removeItem(AUTH_KEY); } catch (_) {}
  }

  // Role user: 'bendahara' bisa meng-input data keuangan; selain itu hanya baca + cek.
  function currentRole() {
    const s = getSession();
    const role = (s && s.user && s.user.role) || 'user';
    return (role === 'bendahara' || role === 'user') ? role : 'user';
  }
  function isBendahara() {
    return currentRole() === 'bendahara';
  }
  function updateKeuPermissions() {
    const canInput = isBendahara();
    const setVisible = (id, show) => {
      const el = document.getElementById(id);
      if (el) el.style.display = show ? '' : 'none';
    };
    // Hanya Bendahara yang boleh meng-input & melihat tabel/ringkasan keuangan.
    setVisible('btnTambahTransaksi', canInput);
    setVisible('btnImportKeuangan', canInput);
    setVisible('keuRingkasan', canInput);
    setVisible('keuSearchInput', canInput);
    setVisible('keuTableWrap', canInput);
    setVisible('keuEmpty', canInput);
    setVisible('pagerKeuangan', canInput);
    // Cek Tagihan & Berkas tetap tersedia untuk semua user.
    setVisible('btnCekTagihanBerkas', true);
    // Kolom "Aksi" di tabel hanya relevan untuk Bendahara.
    const tbl = document.getElementById('keuTable');
    if (tbl) {
      const head = tbl.querySelector('thead tr');
      if (head) {
        const thAksi = head.querySelector('th:last-child');
        if (thAksi) thAksi.style.display = canInput ? '' : 'none';
      }
    }
    // Jika bukan Bendahara, isi tabel dikosongkan agar tidak menampilkan data.
    if (!canInput) {
      const body = document.getElementById('keuBody');
      if (body) body.innerHTML = '';
    }
  }

  // Sisipkan token Bearer ke setiap panggilan /api/* secara otomatis.
  {
    const _fetch = window.fetch;
    window.fetch = function (url, opts) {
      opts = opts || {};
      const sess = getSession();
      if (sess && sess.token && typeof url === 'string' && url.indexOf('/api/') === 0) {
        opts.headers = Object.assign({}, opts.headers || {}, { Authorization: 'Bearer ' + sess.token });
      }
      return _fetch(url, opts);
    };
  }

  function setAuthedUI(user) {
    isAuthed = true;
    const role = (user && user.role === 'bendahara') ? 'bendahara' : 'user';
    if ($('displayUserName')) $('displayUserName').textContent = (user && user.name) || 'Admin Desa';
    if ($('displayUserRole')) {
      $('displayUserRole').textContent = role === 'bendahara' ? '🏦 Bendahara' : '👤 Petugas / Pengguna';
      $('displayUserRole').style.color = role === 'bendahara' ? '#059669' : '#0ea5e9';
    }
    if ($('btnOpenLogin')) $('btnOpenLogin').style.display = 'none';
    if ($('btnOpenLoginNotice')) $('btnOpenLoginNotice').style.display = 'none';
    if ($('userProfileNav')) $('userProfileNav').style.display = 'flex';
    if ($('authGuestNotice')) $('authGuestNotice').style.display = 'none';
    if ($('appWorkspace')) $('appWorkspace').style.display = '';
    document.body.classList.remove('guest-mode');
    updateKeuPermissions();
  }

  function setGuestUI() {
    isAuthed = false;
    if ($('userProfileNav')) $('userProfileNav').style.display = 'none';
    if ($('btnOpenLogin')) $('btnOpenLogin').style.display = 'inline-flex';
    if ($('btnOpenLoginNotice')) $('btnOpenLoginNotice').style.display = 'inline-flex';
    if ($('authGuestNotice')) $('authGuestNotice').style.display = 'block';
    if ($('appWorkspace')) $('appWorkspace').style.display = 'none';
    document.body.classList.add('guest-mode');
  }

  function openLogin() {
    hideLoginError();
    const m = $('loginModal');
    if (!m) return;
    if (typeof m.showModal === 'function') m.showModal(); else m.setAttribute('open', '');
    setTimeout(() => { const f = $('loginEmail'); if (f) f.focus(); }, 60);
  }
  function closeLogin() {
    const m = $('loginModal');
    if (m && typeof m.close === 'function') m.close();
  }
  function setLoginLoading(on) {
    if ($('btnLoginSubmit')) $('btnLoginSubmit').disabled = on;
    if ($('loginSpinner')) $('loginSpinner').style.display = on ? 'inline-block' : 'none';
    if ($('loginSubmitLabel')) $('loginSubmitLabel').textContent = on ? 'Memproses…' : 'Masuk ke Sistem';
  }
  function showLoginError(msg) {
    const el = $('loginError');
    if (!el) return;
    el.textContent = msg || 'Username atau kata sandi salah.';
    el.style.display = 'block';
  }
  function hideLoginError() {
    const el = $('loginError');
    if (el) el.style.display = 'none';
  }

  async function handleLogin(e) {
    if (e && e.preventDefault) e.preventDefault();
    const username = ($('loginEmail') ? $('loginEmail').value : '').trim();
    const password = $('loginPassword') ? $('loginPassword').value : '';
    if (!username || !password) { showLoginError('Username dan kata sandi wajib diisi.'); return; }
    setLoginLoading(true);
    hideLoginError();
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error((j && j.error) || 'Login gagal.');
      setSession({ token: j.token, user: j.user });
      setAuthedUI(j.user);
      closeLogin();
      loadData();
    } catch (err) {
      showLoginError((err && err.message) || 'Username atau kata sandi salah.');
    } finally {
      setLoginLoading(false);
    }
  }

  function handleLogout() {
    clearSession();
    try { fetch('/api/logout', { method: 'POST' }).catch(() => {}); } catch (_) {}
    setGuestUI();
    closeLogin();
  }
  window.handleLogout = handleLogout;

  function togglePassword() {
    const inp = $('loginPassword');
    if (!inp) return;
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    const btn = $('togglePassword');
    if (btn && window.lucide) {
      const ic = document.createElement('i');
      ic.setAttribute('data-lucide', show ? 'eye-off' : 'eye');
      ic.style.cssText = 'width:17px;height:17px;';
      btn.replaceChildren(ic);
      window.lucide.createIcons();
    }
  }

  // ---------- Ubah Kata Sandi ----------
  function openChangePw() {
    const m = $('changePwModal');
    if (!m) return;
    hideChangePwMsg();
    if (typeof m.showModal === 'function') m.showModal(); else m.setAttribute('open', '');
    setTimeout(() => { const f = $('cpCurrent'); if (f) f.focus(); }, 60);
  }
  function closeChangePw() {
    const m = $('changePwModal');
    if (m && typeof m.close === 'function') m.close();
  }
  function setChangePwLoading(on) {
    if ($('btnChangePwSubmit')) $('btnChangePwSubmit').disabled = on;
    if ($('changePwSpinner')) $('changePwSpinner').style.display = on ? 'inline-block' : 'none';
    if ($('changePwSubmitLabel')) $('changePwSubmitLabel').textContent = on ? 'Menyimpan…' : 'Simpan Kata Sandi';
  }
  function showChangePwMsg(kind, msg) {
    const err = $('changePwError');
    const ok = $('changePwOk');
    if (kind === 'ok') {
      if (ok) { ok.textContent = msg; ok.style.display = 'block'; }
      if (err) err.style.display = 'none';
    } else {
      if (err) { err.textContent = msg; err.style.display = 'block'; }
      if (ok) ok.style.display = 'none';
    }
  }
  function hideChangePwMsg() {
    if ($('changePwError')) $('changePwError').style.display = 'none';
    if ($('changePwOk')) $('changePwOk').style.display = 'none';
  }
  async function handleChangePw(e) {
    if (e && e.preventDefault) e.preventDefault();
    const current = $('cpCurrent') ? $('cpCurrent').value : '';
    const next = $('cpNew') ? $('cpNew').value : '';
    const confirm = $('cpConfirm') ? $('cpConfirm').value : '';
    if (!current) { showChangePwMsg('err', 'Kata sandi lama wajib diisi.'); return; }
    if (String(next).length < 6) { showChangePwMsg('err', 'Kata sandi baru minimal 6 karakter.'); return; }
    if (next !== confirm) { showChangePwMsg('err', 'Konfirmasi kata sandi tidak cocok.'); return; }
    if (next === current) { showChangePwMsg('err', 'Kata sandi baru tidak boleh sama dengan kata sandi lama.'); return; }
    setChangePwLoading(true);
hideChangePwMsg();
    try {
      const res = await fetch('/api/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: current, new_password: next })
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error((j && j.error) || 'Gagal mengubah kata sandi.');
      if ($('cpCurrent')) $('cpCurrent').value = '';
      if ($('cpNew')) $('cpNew').value = '';
      if ($('cpConfirm')) $('cpConfirm').value = '';
      showChangePwMsg('ok', (j.message) || 'Kata sandi berhasil diperbarui.');
      setTimeout(closeChangePw, 1500);
    } catch (err) {
      showChangePwMsg('err', (err && err.message) || 'Gagal mengubah kata sandi.');
    } finally {
      setChangePwLoading(false);
    }
  }
  window.openChangePw = openChangePw;

  // ---------- Import manual dari spreadsheet (via GAS read-only) ----------
  async function importFromSheet() {
    if (!confirm('Tarik data dari spreadsheet ke Supabase sekarang? Data akan di-merge (upsert) ke tabel pendaftaran & uploads.')) return;
    const btn = $('btnImportSheet');
    busyBtn(btn, true, 'Mengimpor…');
    try {
      const res = await fetch('/api/import-from-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheet: 'ALL' })
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error((j && j.error) || 'Gagal import dari spreadsheet.');
      const parts = (j.tables || []).map((t) => t.sheet + ': ditulis ' + t.upserted + ' dari ' + t.received + ' | dilewati (sudah terbaru): ' + (t.skipped || 0));
      alert('Import selesai (latest-wins).\n' + parts.join('\n') + '\nTotal ditulis: ' + j.totalUpserted + ' baris.');
      await loadData();
    } catch (e) {
      alert('Import gagal: ' + (e && e.message));
    } finally {
      busyBtn(btn, false);
    }
  }
  window.importFromSheet = importFromSheet;

  // ---------- Import manual transaksi keuangan dari spreadsheet (CSV publik) ----------
  async function importKeuanganFromSheet() {
    if (!confirm('Tarik data transaksi keuangan dari spreadsheet sekarang? Data akan di-merge (upsert) ke tabel transaksi_keuangan.')) return;
    const btn = $('btnImportKeuangan');
    busyBtn(btn, true, 'Mengimpor…');
    try {
      const res = await fetch('/api/keuangan/import-from-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error((j && j.error) || 'Gagal import keuangan.');
      alert('Import keuangan selesai (latest-wins).\nDitulis (baru/diperbarui): ' + (j.inserted || 0) + ' transaksi.\nDilewati (data di aplikasi lebih baru/sama): ' + (j.skipped || 0) + ' baris.');
      await Promise.all([fetchKeuanganSummary(), fetchKeuanganTransaksi()]);
      renderKeuanganTable();
    } catch (e) {
      alert('Import keuangan gagal: ' + (e && e.message));
    } finally {
      busyBtn(btn, false);
    }
  }
  window.importKeuanganFromSheet = importKeuanganFromSheet;

  async function initAuth() {
    const sess = getSession();
    if (sess && sess.token) {
      try {
        const res = await fetch('/api/me');
        const j = await res.json();
        if (j.success) { setAuthedUI(j.user); loadData(); return; }
      } catch (_) {}
      clearSession();
    }
    setGuestUI();
  }

  const badge = $('connStatus');
  const countBadge = $('countBadge');

  function setConn(ok, text) {
    badge.className = 'badge ' + (ok ? 'ok' : 'err');
    badge.textContent = text;
  }

  function statusOptions() {
    const set = new Set();
    allData.forEach((r) => r.status_berkas && set.add(r.status_berkas));
    const sel = $('filterStatus');
    sel.innerHTML = '<option value="">Semua Status</option>';
    [...set].sort().forEach((s) => {
      const o = document.createElement('option');
      o.value = s;
      o.textContent = s;
      sel.appendChild(o);
    });
  }

  async function loadData() {
    busyBtn($('btnRefresh'), true, 'Memuat…');
    try {
      const [resD, resU] = await Promise.all([
        fetch('/api/permohonan'),
        fetch('/api/uploads')
      ]);
      const [jsonD, jsonU] = await Promise.all([resD.json(), resU.json()]);
      if (!jsonD.success) throw new Error(jsonD.error || 'Gagal memuat daftar');
      if (!jsonU.success) throw new Error(jsonU.error || 'Gagal memuat uploads');
      allData = jsonD.data || [];
      uploads = jsonU.data || [];
      countBadge.textContent = allData.length + ' pendaftaran, ' + uploads.length + ' upload';
      setConn(true, '✅ Terhubung ke Supabase');
      buildCache();
      fillSpLoadList();
      buildCitizenCache();
      statusOptions();
      fetchPemohonList(); // Pre-fetch list for finance modal
      const koCount = rowsCache.filter((c) => c.missing.length > 0).length;
      $('spSummary').textContent = koCount > 0
        ? '🟠 ' + koCount + ' belum lengkap SPORADIK'
        : '🟢 Semua data SPORADIK lengkap';
      // Sidik data murah (id + updated_at) agar render ulang tab bisa di-skip
      // saat data tidak berubah — kunci untuk mencegah "berat".
      // CATATAN: dulu memakai XOR bitwise pada string (h ^ '...'), yang selalu
      // menghasilkan 0 karena string -> NaN, jadi curFp TIDAK PERNAH berubah dan
      // tabel tidak pernah di-render ulang setelah edit/tambah data. Sekarang
      // memakai string concatenation agar setiap perubahan id/updated_at terlihat.
      let fp = '';
      allData.forEach((r) => {
        fp += (r.id || '') + '\u0001' + (r.updated_at || r.last_updated || '') + '\u0002';
      });
      curFp = allData.length + ':' + uploads.length + ':' + fp;
      renderCurrent();
    } catch (e) {
      setConn(false, '❌ Gagal ambil data: ' + e.message);
    } finally {
      busyBtn($('btnRefresh'), false);
    }
  }

  // Render hanya tab yang sedang aktif (hemat beban; data dikunci, tabel 817
  // baris tidak di-render saat tab lain dibuka). Render dilewati bila data
  // belum berubah sejak render terakhir (memo berdasarkan curFp). Tandai
  // "sudah dirender" HANYA setelah fungsi render benar-benar selesai berjalan
  // (ada fungsi yang me-return awal bila view surat sedang terbuka).
  const showTab = (name, fn) => {
    if (renderedFp[name] === curFp) return;
    fn();
    renderedFp[name] = curFp;
  };

  function renderCurrent() {
    if (activeTab === 'dashboard') showTab('dashboard', renderDashboard);
    else if (activeTab === 'pendaftaran') showTab('pendaftaran', render);
    else if (activeTab === 'sporadik') { if ($('suratView').hidden) showTab('sporadik', renderSporadik); }
    else if (activeTab === 'uploads') showTab('uploads', renderUploads);
  }

  // Field wajib surat SPORADIK (label untuk laporan).
  // NIB dan Nomor Surat sengaja TIDAK ada di sini:
  //   - NIB dikunci kosong (tidak wajib).
  //   - Nomor Surat opsional, dibiarkan kosong (nomor resmi diisi manual saat cetak).
  const SPORADIK_REQUIRED = {
    nama_pihak_pertama: 'Nama (Pihak Pertama)',
    ttl_pihak_pertama: 'Tempat/Tanggal Lahir Pihak Pertama',
    pekerjaan_pihak_pertama: 'Pekerjaan Pihak Pertama',
    nik_pihak_pertama: 'Nomor KTP (NIK)',
    alamat_pihak_pertama: 'Alamat Pihak Pertama',
    luas: 'Luas Tanah',
    dusun: 'Dusun',
    jenis_tanah: 'Jenis Tanah',
    batas_utara: 'Batas Utara',
    batas_timur: 'Batas Timur',
    batas_selatan: 'Batas Selatan',
    batas_barat: 'Batas Barat',
    pihak_kedua: 'Pihak Kedua',
    tahun_pemberian: 'Tahun Pemberian',
    saksi1_nama: 'Nama Saksi 1',
    saksi1_umur: 'Umur Saksi 1',
    saksi1_pekerjaan: 'Pekerjaan Saksi 1',
    saksi1_alamat: 'Alamat Saksi 1',
    saksi1_ttl: 'TTL Saksi 1',
    saksi2_nama: 'Nama Saksi 2',
    saksi2_umur: 'Umur Saksi 2',
    saksi2_pekerjaan: 'Pekerjaan Saksi 2',
    saksi2_alamat: 'Alamat Saksi 2',
    saksi2_ttl: 'TTL Saksi 2'
  };

  // Subset "field inti" untuk mengukur kelengkapan surat (tanpa data saksi,
  // yang hampir selalu kosong di data mentah & hanya isian pelengkap modal).
  // Dipakai kartu "Siap Cetak" di dashboard agar angkanya bermakna.
  const SPORADIK_CORE = {
    nama_pihak_pertama: 'Nama (Pihak Pertama)',
    ttl_pihak_pertama: 'Tempat/Tanggal Lahir Pihak Pertama',
    pekerjaan_pihak_pertama: 'Pekerjaan Pihak Pertama',
    nik_pihak_pertama: 'Nomor KTP (NIK)',
    alamat_pihak_pertama: 'Alamat Pihak Pertama',
    luas: 'Luas Tanah',
    dusun: 'Dusun',
    jenis_tanah: 'Jenis Tanah',
    batas_utara: 'Batas Utara',
    batas_timur: 'Batas Timur',
    batas_selatan: 'Batas Selatan',
    batas_barat: 'Batas Barat',
    pihak_kedua: 'Pihak Kedua',
    tahun_pemberian: 'Tahun Pemberian'
  };

  // Hitung field inti yang masih kosong (dipakai dashboard: "Siap Cetak").
  function sporadikCoreMissing(r, info) {
    const t = templateForLayanan(r.layanan);
    const fill = fillForTemplate(t, r, info);
    const core = TEMPLATE_CORE[t] || {};
    return Object.keys(core)
      .filter((k) => !String(fill[k] ?? '').trim())
      .map((k) => core[k]);
  }

  // Format TTL dari tempat + tanggal lahir ke "Tempat, 12 Januari 1990".
  function fmtTtl(tempat, tanggal) {
    let t = '';
    if (tanggal) {
      const s = String(tanggal).trim();
      const d = new Date(s);
      if (!isNaN(d.getTime())) {
        const bulan = ['Januari','Februari','Maret','April','Mei','Juni',
                       'Juli','Agustus','September','Oktober','November','Desember'];
        t = d.getDate() + ' ' + bulan[d.getMonth()] + ' ' + d.getFullYear();
      } else {
        t = s;
      }
    }
    return (tempat ? String(tempat).trim() : '') + (t ? (tempat ? ', ' : '') + t : '');
  }

  // Label tampilan layanan (database simpan 'AHLIWARIS', tampil 'AHLI WARIS').
  function layananLabel(layanan) {
    const L = String(layanan || '').toUpperCase();
    if (L === 'AHLIWARIS') return 'AHLI WARIS';
    return layanan;
  }

  // Bangun nilai isian surat SPORADIK — TIPE-AWARE (struktur data_raw berbeda per layanan).
  // Pilih peran sesuai layanan: siapa pihak pertama & kedua, dari field mana.
  // Struktur data_raw berbeda per jenis layanan (HIBAH/JUALBELI/AHLIWARIS).
  // Dipakai fillSporadik (pratinjau & panel lengkapi) agar konsisten.
  function sporadikRoles(layanan, raw, r) {
    const upper = (s) => String(s ?? '').toUpperCase();
    const L = String(layanan || '').toUpperCase();
    let pk1, pk2;
    if (L === 'JUALBELI') {
      // Pembeli = pihak pertama, Penjual = pihak kedua.
      pk1 = {
        nama: upper(raw.pembeli_nama || raw.nama_lengkap || r.nama),
        ttl: fmtTtl(raw.pembeli_tempat_lahir, raw.pembeli_tanggal_lahir),
        pekerjaan: raw.pembeli_pekerjaan || '',
        nik: raw.nik || '',
        alamat: raw.pembeli_alamat || raw.alamat || ''
      };
      pk2 = upper(raw.penjual_nama || '');
    } else if (L === 'AHLIWARIS') {
      // Ahli waris (pemohon) = pihak pertama, almarhum = pihak kedua.
      // TTL & Pekerjaan pemohon ditarik otomatis dari data anak yang
      // namanya sama dengan nama_lengkap; fallback ke isian manual pemohon_*.
      const pemohonNama = String(raw.nama_lengkap || r.nama || '').trim().toLowerCase();
      let ptl = raw.pemohon_ttl || '';
      let pkj = raw.pemohon_pekerjaan || '';
      let tempat = raw.pemohon_tempat_lahir;
      let tanggal = raw.pemohon_tanggal_lahir;
      for (let i = 1; i <= 8; i++) {
        if (String(raw['anak_' + i + '_nama'] || '').trim().toLowerCase() === pemohonNama) {
          tempat = raw['anak_' + i + '_tempat_lahir'];
          tanggal = raw['anak_' + i + '_tanggal_lahir'];
          if (!pkj) pkj = raw['anak_' + i + '_pekerjaan'] || '';
          break;
        }
      }
      pk1 = {
        nama: upper(raw.pemohon_nama || raw.nama_lengkap || r.nama),
        ttl: ptl || fmtTtl(tempat, tanggal),
        pekerjaan: pkj,
        nik: raw.pemohon_nik || raw.nik || '',
        alamat: raw.pemohon_alamat || raw.alamat || ''
      };
      pk2 = upper(raw.almarhum_nama || '');
    } else {
      // HIBAH (default) — penerima = pihak pertama, pemberi = pihak kedua.
      pk1 = {
        nama: upper(raw.penerima_nama || raw.nama_lengkap || r.nama),
        ttl: fmtTtl(raw.penerima_tempat_lahir, raw.penerima_tanggal_lahir),
        pekerjaan: raw.penerima_pekerjaan || '',
        nik: raw.nik || '',
        alamat: raw.penerima_alamat || raw.alamat || ''
      };
      pk2 = upper(raw.pemberi_nama || '');
    }
    return { pk1, pk2 };
  }

  function fillSporadik(r, info) {
    const raw = info;
    const upper = (s) => String(s ?? '').toUpperCase();
    const layanan = String(r.layanan || '').toUpperCase();
    const today = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const { pk1, pk2 } = sporadikRoles(layanan, raw, r);

    return {
      no_surat: raw._nomorSuratTercetak || '',
      nama_pihak_pertama: upper(pk1.nama),
      ttl_pihak_pertama: pk1.ttl,
      pekerjaan_pihak_pertama: pk1.pekerjaan,
      nik_pihak_pertama: pk1.nik,
      alamat_pihak_pertama: pk1.alamat,
      luas: raw.luas_tanah || '',
      dusun: raw.dusun || '',
      rt: '…..…',
      rw: '…..…',
      nib: '',
      jenis_tanah: raw.jenis_tanah || '',
      batas_utara: raw.batas_utara || '',
      batas_timur: raw.batas_timur || '',
      batas_selatan: raw.batas_selatan || '',
      batas_barat: raw.batas_barat || '',
      pihak_kedua: upper(pk2),
      layanan: layanan === 'JUALBELI'
        ? 'SURAT PERNYATAAN PENGOPERAN/PENGALIHAN HAK'
        : layananLabel(layanan),
      tahun_pemberian: raw.tahun_pemberian || '',
      saksi1_nama: upper(raw.saksi1_nama),
      saksi1_umur: raw.saksi1_umur || '',
      saksi1_pekerjaan: raw.saksi1_pekerjaan || '',
      saksi1_alamat: raw.saksi1_alamat || '',
      saksi1_ttl: raw.saksi1_ttl || '',
      saksi1_tmpl: raw.saksi1_tmpl || '',
      saksi2_nama: upper(raw.saksi2_nama),
      saksi2_umur: raw.saksi2_umur || '',
      saksi2_pekerjaan: raw.saksi2_pekerjaan || '',
      saksi2_alamat: raw.saksi2_alamat || '',
      saksi2_ttl: raw.saksi2_ttl || '',
      saksi2_tmpl: raw.saksi2_tmpl || '',
      tgl_surat: today
    };
  }

  // Kunci field-wajib yang diisi dari data_raw (selain isian yang dihitung sendirian).
  function sporadikMissing(info, r) {
    return suratMissingFor(templateForLayanan(r.layanan), r, info);
  }

  // Parse data_raw & siapkan string pencarian SEKALI per pemuatan (hemat reflow).
  function buildCache() {
    rowsCache = allData.map((r) => {
      const info = rawToRow(r);
      const hay = String(r.id + ' ' + r.nama + ' ' + r.layanan + ' ' + r.hp + ' ' +
        r.status_berkas + ' ' + r.catatan_admin + ' ' + JSON.stringify(r.data_raw || ''))
        .toLowerCase();
      const missing = sporadikMissing(info, r);
      const coreMissing = sporadikCoreMissing(r, info);
      return { r, info, hay, missing, coreMissing };
    });
  }

  function rawToRow(row) {
    let dr = {};
    try { dr = typeof row.data_raw === 'string' ? JSON.parse(row.data_raw || '{}') : (row.data_raw || {}); } catch (_) {}
    let last = row.updated_at || row.last_updated || '';
    if (last && typeof last === 'string' && last.indexOf('T') !== -1) {
      try { last = new Date(last).toLocaleString('id-ID'); } catch (_) {}
    }
    return Object.assign({}, dr, { _adminLast: last });
  }

  // Pagination client-side (per tabel). Jumlah baris per halaman.
  const PER_PAGE = 15;
  const pageState = { pendaftaran: { p: 1 }, sporadik: { p: 1 }, uploads: { p: 1 }, keuangan: { p: 1 } };

  function drawPager(elId, key, total) {
    const el = $(elId);
    if (!el) return;
    const st = pageState[key];
    const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
    if (st.p > totalPages) st.p = totalPages;
    const cur = st.p;
    let lo = Math.max(1, cur - 2);
    let hi = Math.min(totalPages, lo + 4);
    lo = Math.max(1, hi - 4);
    let nums = '';
    for (let i = lo; i <= hi; i++) {
      nums += `<button class="pg-btn${i === cur ? ' active' : ''}" data-pg="${i}">${i}</button>`;
    }
    el.innerHTML =
      `<div class="pager-info">${total} baris · Halaman ${cur}/${totalPages}</div>` +
      `<div class="pager-btns">` +
      `<button class="pg-btn" data-pg="${cur - 1}" ${cur <= 1 ? 'disabled' : ''}>‹</button>` +
      nums +
      `<button class="pg-btn" data-pg="${cur + 1}" ${cur >= totalPages ? 'disabled' : ''}>›</button>` +
      `</div>`;
  }

  // Tab "Pendaftaran": data utama ringkas (tanpa catatan & kelengkapan SPORADIK).
  function render() {
    const q = ($('searchInput').value || '').toLowerCase().trim();
    const lay = $('filterLayanan').value;
    const st = $('filterStatus').value;
    const body = $('dataBody');
    body.innerHTML = '';
    const items = rowsCache.filter((c) => {
      if (lay && c.r.layanan !== lay) return false;
      if (st && c.r.status_berkas !== st) return false;
      if (q && !c.hay.includes(q)) return false;
      return true;
    });
    $('emptyMsg').hidden = items.length > 0;
    const stp = pageState.pendaftaran;
    const totalPages = Math.max(1, Math.ceil(items.length / PER_PAGE));
    if (stp.p > totalPages) stp.p = totalPages;
    const shown = items.slice((stp.p - 1) * PER_PAGE, stp.p * PER_PAGE);
    const uploadMap = new Map();
    uploads.forEach((u) => uploadMap.set(u.id_registrasi, (uploadMap.get(u.id_registrasi) || 0) + 1));
    const frag = document.createDocumentFragment();
    shown.forEach((c) => {
      const { r, info } = c;
      const upCount = uploadMap.get(r.id) || 0;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="ID"><strong>${esc(r.id)}</strong> ${upCount ? `<span class="tag status-s" title="${upCount} upload">📎${upCount}</span>` : ''}</td>
        <td data-label="Layanan"><span class="tag ${esc(r.layanan)}">${esc(r.layanan)}</span></td>
        <td data-label="Nama"><strong>${esc(r.nama)}</strong></td>
        <td data-label="HP">${esc(formatHp(r.hp))}</td>
        <td data-label="Pembayaran">${esc(r.pembayaran)}</td>
        <td data-label="Jenis Tanah">${esc(info.jenis_tanah || info.luas_tanah || '')}</td>
        <td data-label="Status"><span class="tag status-s">${esc(r.status_berkas)}</span></td>
        <td data-label="Last Updated">${esc(info._adminLast)}</td>
        <td data-label="Aksi">
          <button class="btn" data-action="view" data-id="${esc(r.id)}">👁 Detail</button>
          <button class="btn" data-action="edit" data-id="${esc(r.id)}">✏️ Edit</button>
        </td>`;
      frag.appendChild(tr);
    });
    body.appendChild(frag);
    drawPager('pagerPendaftaran', 'pendaftaran', items.length);
  }

  // Tab "Surat SPORADIK": fokus kelengkapan & cetak.
  function renderSporadik() {
    // Saat view surat sedang terbuka (inline), jangan ganggu tampilannya.
    if (!$('suratView').hidden) return;
    const q = ($('spSearch').value || '').toLowerCase().trim();
    const lay = $('spFilterLayanan').value;
    const kp = $('spFilterKelengkapan').value;
    const body = $('sporadikBody');
    body.innerHTML = '';
    const items = rowsCache.filter((c) => {
      if (lay && c.r.layanan !== lay) return false;
      if (kp) {
        const miss = c.missing;
        if (kp === 'ok' && miss.length > 0) return false;
        if (kp === 'ko' && miss.length === 0) return false;
      }
      if (q && !String(c.r.id + ' ' + c.r.nama + ' ' + c.r.layanan).toLowerCase().includes(q)) return false;
      return true;
    });
    $('spEmpty').hidden = items.length > 0;
    const stp = pageState.sporadik;
    const totalPages = Math.max(1, Math.ceil(items.length / PER_PAGE));
    if (stp.p > totalPages) stp.p = totalPages;
    const shown = items.slice((stp.p - 1) * PER_PAGE, stp.p * PER_PAGE);
    const frag = document.createDocumentFragment();
    shown.forEach((c) => {
      const { r, info, missing } = c;
      const badgeHtml = missing.length
        ? `<span class="tag status-ko" title="Kurang: ${esc(missing.join(', '))}">🟠 Kurang ${missing.length}</span>`
        : `<span class="tag status-ok" title="Siap dicetak">🟢 Lengkap</span>`;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="ID"><strong>${esc(r.id)}</strong></td>
        <td data-label="Layanan"><span class="tag ${esc(r.layanan)}">${esc(r.layanan)}</span></td>
        <td data-label="Nama"><strong>${esc(r.nama)}</strong></td>
        <td data-label="Jenis Tanah">${esc(info.jenis_tanah || info.luas_tanah || '')}</td>
        <td data-label="Sporadik">${badgeHtml}</td>
        <td data-label="Status Berkas">${statusBadge(r.status_berkas)}</td>
        <td data-label="Catatan Admin" class="sp-catatan">${esc(r.catatan_admin || '')}</td>
        <td data-label="Aksi">
          <button class="btn primary" data-action="surat" data-id="${esc(r.id)}">🖨 Surat</button>
          <button class="btn" data-action="surat-sporadik" data-id="${esc(r.id)}" title="Cetak Surat SPORADIK (Penguasaan Fisik Bidang Tanah)">🖨 SPORADIK</button>
        </td>`;
      frag.appendChild(tr);
    });
    body.appendChild(frag);
    drawPager('pagerSporadik', 'sporadik', items.length);
  }

  // Badge warna status berkas: hijau (siap cetak), kuning/oranye (proses), merah (ditolak).
  function statusBadge(status) {
    const s = String(status || '').trim().toUpperCase();
    if (!s) return '<span class="tag st-any">—</span>';
    let cls = 'st-any', icon = '';
    if (['SUDAH_DIUKUR', 'SUDAH_UKUR', 'SELESAI'].includes(s)) { cls = 'st-ok'; icon = '🟢 '; }
    else if (['DIPROSES', 'PENDING', 'PROSES', 'BELUM_DIUKUR'].includes(s)) { cls = 'st-warn'; icon = '🟠 '; }
    else if (['DITOLAK', 'TMS'].includes(s)) { cls = 'st-bad'; icon = '🔴 '; }
    return `<span class="tag ${cls}">${icon}${esc(status)}</span>`;
  }

  // ==== Pembantu analitik (tabel 1/2/3 arah & grafik SVG) ====
  const DASH_COLORS = ['#38bdf8', '#6366f1', '#34d399', '#f59e0b', '#fb7185', '#22d3ee', '#a78bfa', '#f472b6', '#facc15', '#4ade80'];

  function freq(arr) {
    const m = {};
    arr.forEach((v) => {
      const k = (v === null || v === undefined || v === '') ? '(kosong)' : String(v);
      m[k] = (m[k] || 0) + 1;
    });
    return m;
  }

  // Tabel 1 arah: frekuensi + persen.
  function freqTable(obj, elId) {
    const rows = Object.entries(obj).sort((a, b) => b[1] - a[1]);
    const n = rows.reduce((s, [, v]) => s + v, 0);
    $('t1' + elId).innerHTML = `
      <table class="dt c1">
        <thead><tr><th>Kategori</th><th>Frekuensi</th><th>Persen</th></tr></thead>
        <tbody>
          ${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v}</td><td class="num">${n ? ((v / n) * 100).toFixed(1) : 0}%</td></tr>`).join('')}
        </tbody>
      </table>`;
  }

  // Tabulasi silang 2 arah: {keysA, keysB, grid}.
  function cross2(keyA, keyB) {
    const mk = (r) => ({
      a: (r[keyA] === null || r[keyA] === undefined || r[keyA] === '') ? '(kosong)' : String(r[keyA]),
      b: (r[keyB] === null || r[keyB] === undefined || r[keyB] === '') ? '(kosong)' : String(r[keyB])
    });
    const keysA = [...new Set(allData.map(mk).map((x) => x.a))].sort();
    const keysB = [...new Set(allData.map(mk).map((x) => x.b))].sort();
    const grid = {};
    allData.forEach((r) => {
      const { a, b } = mk(r);
      grid[a + '\u0000' + b] = (grid[a + '\u0000' + b] || 0) + 1;
    });
    return { keysA, keysB, grid };
  }

  function cross2Table(elId, keyA, keyB) {
    const { keysA, keysB, grid } = cross2(keyA, keyB);
    const colTotals = keysB.map((b) => keysA.reduce((s, a) => s + (grid[a + '\u0000' + b] || 0), 0));
    const rowTotals = keysA.map((a) => keysB.reduce((s, b) => s + (grid[a + '\u0000' + b] || 0), 0));
    const grand = rowTotals.reduce((s, v) => s + v, 0);
    $('t2' + elId).innerHTML = `
      <table class="dt c2">
        <thead>
          <tr><th>${esc(keyA)} ↓ / ${esc(keyB)} →</th>
          ${keysB.map((b) => `<th>${esc(b)}</th>`).join('')}<th>Total</th></tr>
        </thead>
        <tbody>
          ${keysA.map((a, i) => `
            <tr><td><strong>${esc(a)}</strong></td>
            ${keysB.map((b) => `<td class="num">${grid[a + '\u0000' + b] || 0}</td>`).join('')}
            <td class="num"><strong>${rowTotals[i]}</strong></td></tr>`).join('')}
          <tr class="tfoot"><td><strong>Total</strong></td>
          ${colTotals.map((v) => `<td class="num"><strong>${v}</strong></td>`).join('')}
          <td class="num"><strong>${grand}</strong></td></tr>
        </tbody>
      </table>`;
  }

  function cross3(elId) {
    const set3 = (r) => {
      const g = (k) => (r[k] === null || r[k] === undefined || r[k] === '') ? '(kosong)' : String(r[k]);
      return { a: g('layanan'), b: g('status_berkas'), c: g('pembayaran') };
    };
    const dim = [...new Set(allData.map(set3).map((x) => x.a))].sort();
    const cols = [...new Set(allData.map(set3).map((x) => x.b))].sort();
    const inner = [...new Set(allData.map(set3).map((x) => x.c))].sort();
    const grid = {};
    allData.forEach((r) => {
      const { a, b, c } = set3(r);
      grid[a + '\u0000' + b + '\u0000' + c] = (grid[a + '\u0000' + b + '\u0000' + c] || 0) + 1;
    });
    const dTotals = cols.map((b) => inner.map((c) => dim.reduce((s, a) => s + (grid[a + '\u0000' + b + '\u0000' + c] || 0), 0)));
    const grand = dim.reduce((s, a) => s + cols.reduce((s2, b) => s2 + inner.reduce((s3, c) => s3 + (grid[a + '\u0000' + b + '\u0000' + c] || 0), 0), 0), 0);
    $('t3' + elId).innerHTML = `
      <table class="dt c3">
        <thead>
          <tr><th>Layanan ↓</th>${cols.map((b) => `<th colspan="${inner.length + 1}">${esc(b)}</th>`).join('')}<th>Total</th></tr>
          <tr><th></th>${cols.flatMap((b) => [...inner.map((c) => `<th class="sub">${esc(c)}</th>`), '<th class="sub">Total</th>']).join('')}<th class="sub">Total</th></tr>
        </thead>
        <tbody>
          ${dim.map((a) => {
            const rowTot = cols.reduce((s, b) => s + inner.reduce((s2, c) => s2 + (grid[a + '\u0000' + b + '\u0000' + c] || 0), 0), 0);
            return `<tr><td><strong>${esc(a)}</strong></td>
              ${cols.map((b) => {
                const bt = inner.reduce((s, c) => s + (grid[a + '\u0000' + b + '\u0000' + c] || 0), 0);
                return inner.map((c) => `<td class="num">${grid[a + '\u0000' + b + '\u0000' + c] || 0}</td>`).join('') + `<td class="num"><strong>${bt}</strong></td>`;
              }).join('')}
              <td class="num"><strong>${rowTot}</strong></td></tr>`;
          }).join('')}
          <tr class="tfoot"><td><strong>Total</strong></td>
          ${cols.map((b, i) => inner.map((c) => `<td class="num"><strong>${dTotals[i][c]}</strong></td>`).join('') + `<td class="num"><strong>${dTotals[i].reduce((s, v) => s + v, 0)}</strong></td>`).join('')}
          <td class="num"><strong>${grand}</strong></td></tr>
        </tbody>
      </table>`;
  }

  // Grafik batang horizontal SVG.
  function barChartSVG(obj) {
    const rows = Object.entries(obj).sort((a, b) => b[1] - a[1]);
    if (!rows.length) return '<div class="chart-empty">Tidak ada data</div>';
    const max = Math.max(1, ...rows.map(([, v]) => v));
    const charW = 7, barH = 26, gap = 8, top = 6;
    // Lebar label dihitung dari teks terpanjang agar teks TIDAK menutupi bar.
    const labelW = Math.min(140, Math.max(...rows.map(([k]) => String(k).length)) * charW);
    const left = 12 + labelW + 12;
    const plotW = 380, valGap = 10, valPad = 52;
    const W = left + plotW + valGap + valPad;
    const H = top + rows.length * (barH + gap) + 6;
    const bars = rows.map(([k, v], i) => {
      const y = top + i * (barH + gap);
      const bw = Math.max(2, (v / max) * plotW);
      const label = k.length > 17 ? k.slice(0, 16) + '…' : k;
      return `
        <text x="${left - 12}" y="${y + barH / 2 + 4}" text-anchor="end" class="ch-label">${esc(label)}</text>
        <rect x="${left}" y="${y}" width="${bw}" height="${barH}" rx="5" fill="${DASH_COLORS[i % DASH_COLORS.length]}">
          <title>${esc(k)}: ${v}</title>
        </rect>
        <text x="${left + bw + valGap}" y="${y + barH / 2 + 4}" class="ch-val">${v}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="svg-chart" role="img" aria-label="Grafik batang">
      ${bars}</svg>`;
  }

  // Grafik garis SVG: deret waktu per tanggal.
  function lineChartSVG(points) {
    const sorted = points.slice().sort((a, b) => a.x - b.x);
    if (!sorted.length) return '<div class="chart-empty">Tidak ada data waktu</div>';
    const W = 620, H = 240, padL = 46, padR = 18, padT = 16, padB = 34;
    const vals = sorted.map((p) => p.y);
    const maxY = Math.max(1, ...vals);
    const dx = (W - padL - padR) / Math.max(1, sorted.length - 1);
    const gx = (i) => padL + i * dx;
    const py = (v) => padT + (H - padT - padB) * (1 - v / maxY);
    const coords = sorted.map((p, i) => `${gx(i).toFixed(1)},${py(p.y).toFixed(1)}`);
    const yTicks = [0, 0.25, 0.5, 0.75, 1];
    // Label x cukup utk ~7 titik agar tidak bertumpuk; sisanya grid saja.
    const step = Math.max(1, Math.ceil(sorted.length / 7));
    const shortLabel = (ds) => {
      const m = String(ds).match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? m[3] + '/' + m[2] : String(ds);
    };
    const xLabels = sorted.map((p, i) => {
      if (i % step !== 0) return '';
      return `<text x="${gx(i).toFixed(1)}" y="${H - padB + 16}" class="ch-x" text-anchor="${i === 0 ? 'start' : i === sorted.length - 1 ? 'end' : 'middle'}">${esc(shortLabel(p.x))}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="svg-chart" role="img" aria-label="Grafik garis tren pendaftaran">
      ${yTicks.map((t) => {
        const y = padT + (H - padT - padB) * (1 - t);
        return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" class="ch-grid"/>
          <text x="${padL - 8}" y="${(y + 4).toFixed(1)}" class="ch-ytick" text-anchor="end">${Math.round(t * maxY)}</text>`;
      }).join('')}
      ${sorted.map((p, i) => `<line x1="${gx(i).toFixed(1)}" y1="${padT}" x2="${gx(i).toFixed(1)}" y2="${H - padB}" class="ch-vgrid${i === sorted.length - 1 ? ' last' : ''}"/>`).join('')}
      ${xLabels}
      <polyline points="${coords.join(' ')}" fill="none" class="ch-line"/>
      ${sorted.map((p, i) => `<circle cx="${gx(i).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="3.5" class="ch-dot"><title>${esc(p.x)}: ${p.y}</title></circle>`).join('')}
    </svg>`;
  }

  // Grafik pie/donut SVG.
  function pieChartSVG(obj) {
    const rows = Object.entries(obj).sort((a, b) => b[1] - a[1]);
    const n = rows.reduce((s, [, v]) => s + v, 0);
    if (!n) return '<div class="chart-empty">Tidak ada data</div>';
    const cx = 110, cy = 110, R = 92, innerR = 52;
    let ang = -Math.PI / 2;
    const segs = rows.map(([k, v], i) => {
      const frac = v / n;
      const a2 = ang + frac * Math.PI * 2;
      const x1 = cx + R * Math.cos(ang), y1 = cy + R * Math.sin(ang);
      const x2 = cx + R * Math.cos(a2), y2 = cy + R * Math.sin(a2);
      const large = frac > 0.5 ? 1 : 0;
      const path = `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
      ang = a2;
      return `<path d="${path}" fill="${DASH_COLORS[i % DASH_COLORS.length]}"><title>${esc(k)}: ${v} (${(frac * 100).toFixed(1)}%)</title></path>`;
    }).join('');
    const legY = rows.map(([k, v], i) => `
      <div class="pie-legend-item">
        <span class="pie-swatch" style="background:${DASH_COLORS[i % DASH_COLORS.length]}"></span>
        <span class="pie-leg-text">${esc(k)}</span>
        <span class="pie-leg-val">${v} (${((v / n) * 100).toFixed(1)}%)</span>
      </div>`).join('');
    return `<div class="chart-pie-wrap">
      <svg viewBox="0 0 220 220" class="svg-chart pie-svg" role="img" aria-label="Grafik pie">
        <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="var(--panel)"/>
        ${segs}</svg>
      <div class="pie-legend">${legY}</div>
    </div>`;
  }

  // Tab "Dashboard": analitik lengkap (tabel 1/2/3 arah + grafik batang/garis/pie).
  function renderDashboard() {
    const total = allData.length;
    const lengkap = rowsCache.filter((c) => c.coreMissing.length === 0).length;
    const kurang = total - lengkap;
    $('dbTotal').textContent = total;
    $('dbUpload').textContent = uploads.length;
    $('dbLengkap').textContent = lengkap;
    $('dbKurang').textContent = kurang;

    // Stat tambahan: hari ini / pending / selesai / sudah diukur / sudah cetak.
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayId = new Date().toLocaleDateString('id-ID');
    let hariIni = 0;
    allData.forEach((r) => {
      const d = r.timestamp || r.created_at || '';
      if (!d) return;
      const ds = String(d).slice(0, 10);
      if (ds === todayStr) hariIni++;
    });
    if (hariIni === 0) {
      hariIni = allData.filter((r) => {
        const ts = r.timestamp || r.created_at || '';
        return ts && String(ts).includes(todayId.split(',')[0].trim()) && String(ts).includes(new Date().getFullYear());
      }).length;
    }
    $('dbHariIni').textContent = hariIni;
    $('dbPending').textContent = allData.filter((r) => r.status_berkas === 'PENDING').length;
    $('dbSelesai').textContent = allData.filter((r) => r.status_berkas === 'SELESAI').length;
    $('dbDiukur').textContent = allData.filter((r) => r.status_berkas === 'SUDAH_DIUKUR').length;
    $('dbCetak').textContent = allData.filter((r) => String(r.data_raw && r.data_raw._nomorSuratTercetak || '').trim()).length;

    const fLay = freq(allData.map((r) => r.layanan));
    const fSta = freq(allData.map((r) => r.status_berkas));
    const fBay = freq(allData.map((r) => r.pembayaran));
    const fTan = freq(rowsCache.map((c) => c.info.jenis_tanah || c.info.luas_tanah || ''));

    // Grafik batang.
    $('chartBarLayanan').innerHTML = barChartSVG(fLay);
    $('chartBarStatus').innerHTML = barChartSVG(fSta);

    // Grafik garis — tren pendaftaran per tanggal (kolom `timestamp` = waktu pendaftaran asli).
    const byDate = {};
    allData.forEach((r) => {
      const d = r.timestamp || r.created_at || '';
      if (!d) return;
      const ds = String(d).slice(0, 10);
      byDate[ds] = (byDate[ds] || 0) + 1;
    });
    const sortedDates = Object.keys(byDate).sort();
    $('chartLineTren').innerHTML = lineChartSVG(sortedDates.map((ds) => ({ x: ds, y: byDate[ds] })));

    // Grafik pie.
    $('chartPieLayanan').innerHTML = pieChartSVG(fLay);
    $('chartPieStatus').innerHTML = pieChartSVG(fSta);

    // Grafik dusun (dari field dusun pada data sporadik).
    const fDusun = freq(rowsCache.map((c) => (c.info.dusun || '').trim()).filter(Boolean));
    $('chartDusun').innerHTML = Object.keys(fDusun).length
      ? barChartSVG(fDusun)
      : '<div class="chart-empty">Belum ada data dusun pada pendaftaran.</div>';

    // Tabel 1 arah (frekuensi + persen).
    freqTable(fLay, 'Layanan');
    freqTable(fSta, 'Status');
    freqTable(fBay, 'Bayar');
    freqTable(fTan, 'Tanah');

    // Tabel 2 arah (tabulasi silang).
    cross2Table('LayananStatus', 'layanan', 'status_berkas');
    cross2Table('LayananBayar', 'layanan', 'pembayaran');

    // Tabel 3 arah.
    cross3('LayananStatusBayar');
  }

  function formatHp(hp) {
    if (!hp) return '';
    let s = String(hp).replace(/\D/g, '');
    if (s.length === 11 && s.charAt(0) === '6') return s;
    return s;
  }

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Gagal membaca file.'));
      reader.readAsDataURL(file);
    });
  }

  function renderUploads() {
    const q = ($('uploadSearch').value || '').toLowerCase().trim();
    const body = $('uploadBody');
    body.innerHTML = '';
    const rows2 = uploads.filter((u) => {
      if (!q) return true;
      const hay = [u.id_registrasi, u.jenis_upload, u.file_name].join(' ').toLowerCase();
      return hay.includes(q);
    });
    $('uploadEmpty').hidden = rows2.length > 0;
    const stp = pageState.uploads;
    const totalPages = Math.max(1, Math.ceil(rows2.length / PER_PAGE));
    if (stp.p > totalPages) stp.p = totalPages;
    const shown = rows2.slice((stp.p - 1) * PER_PAGE, stp.p * PER_PAGE);
    shown.forEach((u) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="ID Registrasi"><strong>${esc(u.id_registrasi)}</strong></td>
        <td data-label="Jenis"><span class="tag status-s">${esc(u.jenis_upload)}</span></td>
        <td data-label="Nama File" class="wrap">${esc(u.file_name)}</td>
        <td data-label="Timestamp">${esc(u.timestamp)}</td>
        <td data-label="File">
          ${u.file_url ? `<a class="flink" href="${esc(u.file_url)}" target="_blank" rel="noopener">🔗 Buka</a>` : '—'}
          ${u.file_id ? ` <button class="btn" data-del-up="${esc(u.file_id)}">🗑</button>` : ''}
        </td>`;
      body.appendChild(tr);
    });
    drawPager('pagerUploads', 'uploads', rows2.length);
  }

  function showDetail(id) {
    const r = allData.find((x) => x.id === id);
    if (!r) return;
    const info = rawToRow(r);
    const keys = Object.keys(info).sort();
    const grid = keys.map((k) => {
      const isName = String(k).toUpperCase().includes('NAMA');
      return `<div class="k">${esc(k)}</div><div>${isName ? '<strong>' + esc(info[k]) + '</strong>' : esc(info[k])}</div>`;
    }).join('');
    const ups = uploads.filter((u) => u.id_registrasi === id);
    const upHtml = ups.length
      ? ups.map((u) =>
          `<div class="k">📎 ${esc(u.jenis_upload)}</div><div><a class="flink" href="${esc(u.file_url || '#')}" target="_blank" rel="noopener">${esc(u.file_name)}</a></div>`
        ).join('')
      : '<div class="k">📎 File</div><div>—</div>';
    $('detailTitle').textContent = 'Detail ' + id;
    $('detailBody').innerHTML =
      `<div class="detail-grid">
         ${grid}
         <div class="k">TIMESTAMP</div><div>${esc(r.timestamp)}</div>
         ${upHtml}
         <div class="k">DATA_RAW (JSON)</div>
         <pre class="raw-json">${esc(prettyRaw(r.data_raw))}</pre>
       </div>`;
    $('detailModal').showModal();
  }

  function prettyRaw(raw) {
    try { return JSON.stringify(typeof raw === 'string' ? JSON.parse(raw) : raw || {}, null, 2); }
    catch (_) { return String(raw || ''); }
  }

  function openEdit(id) {
    const r = allData.find((x) => x.id === id);
    if (!r) return;
    currentEditId = r.id;
    currentEditLayanan = r.layanan || 'HIBAH';
    const raw = parseRaw(r.data_raw);
    renderEditBody(r, raw);
    $('editModal').showModal();
  }

  function parseRaw(data_raw) {
    try {
      return typeof data_raw === 'string' ? JSON.parse(data_raw || '{}') : (data_raw || {});
    } catch (_) { return {}; }
  }

  // Bangun form edit lengkap (semua field = form Tambah) dengan nilai terisi.
  function renderEditBody(r, raw) {
    const p = 'ed_';
    const secs = (list) => tambahSeksiHtml(list, p, raw);
    const nomor = String(raw._nomorSuratTercetak || '');
    const urutMatch = /145-(\d{3})\//.exec(nomor);
    const tglSurat = toISODate(raw._tglCetakSurat || raw._tglSurat);
    const html = `
      <div class="form">
        <div class="edit-meta">
          <div class="field"><label>ID Registrasi</label><input id="ed_id" readonly value="${esc(r.id)}"></div>
          <div class="field"><label>Jenis Surat</label>
            <select id="ed_layanan">
              <option value="HIBAH"${currentEditLayanan === 'HIBAH' ? ' selected' : ''}>HIBAH</option>
              <option value="JUALBELI"${currentEditLayanan === 'JUALBELI' ? ' selected' : ''}>JUAL BELI</option>
              <option value="AHLIWARIS"${currentEditLayanan === 'AHLIWARIS' ? ' selected' : ''}>AHLI WARIS</option>
            </select></div>
          <div class="field"><label>Status Berkas</label>
            <select id="ed_status">
              <option value="">— Pilih —</option>
              <option${String(r.status_berkas || '') === 'PENDING' ? ' selected' : ''}>PENDING</option>
              <option${String(r.status_berkas || '') === 'PROSES' ? ' selected' : ''}>PROSES</option>
              <option${String(r.status_berkas || '') === 'DIPROSES' ? ' selected' : ''}>DIPROSES</option>
              <option${String(r.status_berkas || '') === 'SUDAH_DIUKUR' ? ' selected' : ''}>SUDAH_DIUKUR</option>
              <option${String(r.status_berkas || '') === 'BELUM_DIUKUR' ? ' selected' : ''}>BELUM_DIUKUR</option>
              <option${String(r.status_berkas || '') === 'DITOLAK' ? ' selected' : ''}>DITOLAK</option>
              <option${String(r.status_berkas || '') === 'SELESAI' ? ' selected' : ''}>SELESAI</option>
            </select></div>
        </div>

        <div class="form-box form-box-nomor">
          <h4>📄 Nomor Surat (Otomatis)</h4>
          <p>Nomor urut diambil dari surat terakhir; bisa diubah manual. Kosongkan jika belum mau dicetak.</p>
          <div class="tambah-nomor-row">
            <div class="field"><label>Tanggal Surat</label><input type="date" id="${p}tglSurat" value="${esc(tglSurat)}"></div>
            <div class="field"><label>Nomor Urut (3 digit)</label><input type="text" id="${p}noUrut" inputmode="numeric" maxlength="3" value="${esc(urutMatch ? urutMatch[1] : '')}" placeholder="001"></div>
            <button id="${p}btnNoUrut" class="btn" type="button">🔄 Auto</button>
          </div>
          <div class="field"><label>Nomor Surat (hasil)</label>
            <input type="text" id="${p}nomorSurat" readonly value="${esc(nomor)}"></div>
        </div>

        <div class="form-box">
          <div class="field-grid">
            ${secs(TAMBAH_SECTIONS.pemohon)}
          </div>
        </div>

        <div class="form-box">
          <div class="field-grid">
            ${secs(TAMBAH_SECTIONS[currentEditLayanan] || [])}
            <div id="editAnakWrap" class="field full"></div>
          </div>
        </div>

        <div class="form-box">
          <div class="field-grid">
            ${secs(TAMBAH_SECTIONS.tanah)}
          </div>
        </div>

        <div class="form-box">
          <div class="field-grid">
            <div class="field full"><label>Catatan Admin</label><textarea id="ed_catatan" rows="3">${esc(r.catatan_admin || '')}</textarea></div>
          </div>
        </div>

        <div class="form-box form-box-upload">
          <h4>📎 Upload Dokumen (KK / KTP)</h4>
          <p>Pilih file baru untuk mengganti, atau kosongkan jika tidak diubah.</p>
          <div class="upload-slots">
            <div class="upload-slot">
              <span class="slot-label">KK</span>
              <input type="file" id="editKkFile" accept="image/*,.pdf" />
              <div id="editKkStatus" class="slot-status"></div>
            </div>
            <div class="upload-slot">
              <span class="slot-label">KTP</span>
              <input type="file" id="editKtpFile" accept="image/*,.pdf" />
              <div id="editKtpStatus" class="slot-status"></div>
            </div>
          </div>
        </div>

        <div class="form-actions">
          <button id="btnSaveEdit" class="btn primary">💾 Simpan Data</button>
          <button id="btnDelete" class="btn danger">🗑 Hapus</button>
        </div>
      </div>`;
    $('editBody').innerHTML = html;
    renderEditUploadStatus(r.id);
    wireFormSync($('editBody'), p);
    wireNomorSurat(p, $('editBody'));
    const nik = $(`${p}nik`);
    if (nik) nik.addEventListener('input', () => { nik.value = nik.value.replace(/\D/g, '').slice(0, 16); });
    if (currentEditLayanan === 'AHLIWARIS') {
      renderEditAnak(raw);
      $(`${p}jumlah_anak`).addEventListener('input', () => renderEditAnak(collectEditRaw()));
    }
    bindTambahUmurHints($('editBody'));
    $(`${p}layanan`).addEventListener('change', () => {
      currentEditLayanan = $(`${p}layanan`).value;
      renderEditBody(r, collectEditRaw());
    });
    if (currentEditLayanan === 'JUALBELI') {
      const h = $(`${p}harga_pembelian`);
      if (h) h.addEventListener('input', () => { formatHargaInput(h); $(`${p}harga_terbilang`).value = terbilangHarga(h); });
    }
    $('btnSaveEdit').addEventListener('click', saveEdit);
    $('btnDelete').addEventListener('click', deleteRow);
  }

  // Kumpulkan nilai semua input ed_* (untuk re-render saat layanan berubah).
  function collectEditRaw() {
    const raw = {};
    $('editBody').querySelectorAll('[id^="ed_"]').forEach((el) => {
      if (el.id === 'ed_id' || el.id === 'ed_status' || el.id === 'ed_catatan' || el.id === 'ed_layanan') return;
      raw[el.id.slice(3)] = el.value;
    });
    return raw;
  }

  function renderEditAnak(raw) {
    const wrap = $('editAnakWrap');
    if (!wrap) return;
    const n = Math.max(0, Math.min(20, parseInt(raw.jumlah_anak || '0', 10) || 0));
    const t = $('ed_jumlah_anak_terbilang');
    if (t) t.value = n > 0 ? terbilang(n) + ' Orang' : '';
    let html = '';
    for (let i = 1; i <= n; i++) {
      html += `<div class="sec-title" style="margin-top:6px;">Anak ke-${i}</div>`;
      ['nama', 'tempat_lahir', 'tanggal_lahir', 'pekerjaan', 'alamat'].forEach((k) => {
        html += tambahFieldHtml({ id: `anak_${i}_${k}`, label: k === 'nama' ? 'Nama' : k.replace('_', ' ') }, raw[`anak_${i}_${k}`], 'ed_');
      });
    }
    wrap.innerHTML = html;
    bindTambahUmurHints(wrap);
  }

  function renderEditUploadStatus(id) {
    const ups = uploads.filter((u) => u.id_registrasi === id);
    const pick = (jenis) => ups.find((u) => (u.jenis_upload || '').toUpperCase() === jenis);
    setSlotStatus('editKkStatus', pick('KK'));
    setSlotStatus('editKtpStatus', pick('KTP'));
  }

  function setSlotStatus(elId, up) {
    const el = $(elId);
    if (!el) return;
    if (up && up.file_url) {
      el.innerHTML = `✅ Ada: <a href="${esc(up.file_url)}" target="_blank" rel="noopener">${esc(up.file_name || 'buka')}</a>`;
    } else {
      el.textContent = '';
    }
  }

  async function saveEdit() {
    if (!currentEditId) return;
    const btn = $('btnSaveEdit');
    busyBtn(btn, true, 'Menyimpan…');
    try {
      const p = 'ed_';
      // Kumpulkan semua field data (pemohon + layanan + tanah + anak).
      const raw = collectEditRaw();
      const layanan = $(`${p}layanan`).value;
      const nomorSurat = $(`${p}nomorSurat`).value.trim();
      if (nomorSurat) raw._nomorSuratTercetak = nomorSurat;
      else delete raw._nomorSuratTercetak;
      const tglEl = $(`${p}tglSurat`);
      const tgl = tglEl.type === 'date' ? tglEl.value : dmyToIso(tglEl.value);
      if (tgl) raw._tglCetakSurat = tgl;
      else delete raw._tglCetakSurat;
      if (nomorSurat) {
        const dupe = nomorSuratTerpakai(nomorSurat, currentEditId);
        if (dupe) throw new Error('Nomor surat ' + nomorSurat + ' sudah dipakai ' + dupe.r.id + '. Gunakan nomor lain.');
      }
      if (raw.harga_pembelian) raw.harga_pembelian = String(raw.harga_pembelian).replace(/\./g, '');
      if (layanan === 'AHLIWARIS') {
        const n = parseInt(raw.jumlah_anak || '0', 10) || 0;
        for (let i = 1; i <= n; i++) {
          ['nama', 'tempat_lahir', 'tanggal_lahir', 'pekerjaan', 'alamat'].forEach((k) => {
            const el = $(`${p}anak_${i}_${k}`);
            if (el) raw[`anak_${i}_${k}`] = el.value.trim();
          });
        }
      }
      const hp = raw.no_hp || '';
      if (hp && !/^08\d{8,11}$/.test(hp)) throw new Error('No. HP tidak valid (08…, 10-13 digit).');
      if (!raw.nama_lengkap) throw new Error('Nama lengkap wajib diisi.');
      const nik = (raw.nik || '').replace(/\D/g, '');
      if (nik.length !== 16) throw new Error('NIK wajib diisi tepat 16 digit angka.');
      raw.nik = nik;

      const res = await fetch('/api/permohonan/' + encodeURIComponent(currentEditId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layanan,
          status_berkas: $(`${p}status`).value,
          catatan_admin: $(`${p}catatan`).value,
          data_raw: raw
        })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Gagal simpan');
      // Upload KK & KTP jika ada file yang dipilih.
      await uploadEditFile(currentEditId, 'KK', $('editKkFile'));
      await uploadEditFile(currentEditId, 'KTP', $('editKtpFile'));
      $('editModal').close();
      await loadData();
    } catch (e) {
      alert('Simpan gagal: ' + e.message);
    } finally {
      busyBtn(btn, false);
    }
  }

  async function uploadEditFile(idReg, jenis, input) {
    if (!input || !input.files || input.files.length === 0) return;
    const f = input.files[0];
    if (f.size > 8 * 1024 * 1024) throw new Error('Ukuran file ' + jenis + ' melebihi 8 MB.');
    const dataUrl = await readFileAsDataURL(f);
    const res = await fetch('/api/permohonan/' + encodeURIComponent(idReg) + '/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jenis_upload: jenis, fileName: f.name, fileData: dataUrl })
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error((json && json.error) || 'Gagal upload ' + jenis);
  }

  async function deleteRow() {
    if (!currentEditId) return;
    if (!confirm('Hapus pendaftaran ' + currentEditId + ' dari Supabase?')) return;
    busyBtn($('btnDelete'), true, 'Menghapus…');
    try {
      const res = await fetch('/api/permohonan/' + encodeURIComponent(currentEditId), { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) {
        alert('Hapus gagal: ' + (json.error || ''));
        return;
      }
      $('editModal').close();
      await loadData();
    } catch (e) {
      alert('Hapus gagal: ' + e.message);
    } finally {
      busyBtn($('btnDelete'), false);
    }
  }

  let currentSurat = null;
  let currentSuratTemplate = 'SPORADIK';

  async function cetakSporadik(id, forceTemplate) {
    const c = rowsCache.find((x) => x.r.id === id);
    if (!c) return;
    const { r, info } = c;
    currentSuratTemplate = forceTemplate || templateForLayanan(r.layanan);
    const t = currentSuratTemplate;
    currentSurat = {
      r, info,
      fill: fillForTemplate(t, r, info),
      missing: suratMissingFor(t, r, info)
    };

    setSuratTitle(t);
    $('suratIdLine').innerHTML = 'ID: ' + escFill(id) + ' | Layanan: ' + escFill(r.layanan) + ' | Nama: <b>' + escFill(r.nama || '') + '</b>';
    // Isi kontrol manual tanggal & nomor urut dari data tersimpan bila ada.
    $('srTgl').value = isoToDmy(info._tglCetakSurat || info._tglSurat);
    $('srNoUrut').value = (String(info._nomorSuratTercetak || '').match(/145-(\d{3})\//) || [])[1] || '001';
    $('srNoSurat').value = '';

    renderSuratEditor();
    renderSurat();
    // Tampilkan langsung di halaman (lebar), bukan pop-up.
    $('sporadikPanel').hidden = true;
    $('suratView').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function backToSporadik() {
    $('suratView').hidden = true;
    $('sporadikPanel').hidden = false;
    // Render ulang daftar (memo dilewati) agar badge kelengkapan segar.
    renderSporadik();
    renderedFp.sporadik = curFp;
  }

  // Isi dropdown saran "Cari & Muat" (datalist) dari semua record.
  function fillSpLoadList() {
    const dl = $('spLoadList');
    if (!dl) return;
    dl.innerHTML = '';
    const seen = new Set();
    rowsCache.forEach((c) => {
      const nm = String(c.r.nama || '').trim();
      const no = String((c.info && c.info._nomorSuratTercetak) || '').trim();
      const cand = [nm ? (c.r.id + ' \u00b7 ' + nm) : c.r.id];
      if (no) cand.push(c.r.id + ' \u00b7 ' + no);
      cand.forEach((v) => {
        if (!seen.has(v)) {
          seen.add(v);
          const o = document.createElement('option');
          o.value = v;
          dl.appendChild(o);
        }
      });
    });
  }

  // Muat langsung data ke form editor berdasarkan kata kunci:
  // ID (sebagian/akhir), Nomor Surat, atau Nama. Tanpa keluar dari tab.
  function loadSpData() {
    const inp = $('spLoadInput');
    const qRaw = (inp && inp.value || '').trim();
    if (!qRaw) return;
    const q = qRaw.split('\u00b7')[0].trim().toLowerCase();
    const ql = qRaw.toLowerCase();
    let hit = rowsCache.find((c) => String(c.r.id || '').toLowerCase() === q);
    if (!hit) hit = rowsCache.find((c) => String(c.r.id || '').toLowerCase().includes(q));
    if (!hit) hit = rowsCache.find((c) => String(c.info._nomorSuratTercetak || '').toLowerCase().includes(ql));
    if (!hit) hit = rowsCache.find((c) => String(c.r.nama || '').toLowerCase().includes(ql));
    if (!hit) {
      const qNum = q.replace(/\D/g, '');
      if (qNum) hit = rowsCache.find((c) => String(c.r.id || '').replace(/\D/g, '').endsWith(qNum));
    }
    if (!hit) {
      alert('Tidak ditemukan data untuk "' + qRaw + '".');
      return;
    }
    cetakSporadik(hit.r.id);
  }

  // Bersihkan pencarian & kembali ke daftar untuk memilih ID lain / mulai baru.
  function resetSpForm() {
    const inp = $('spLoadInput');
    if (inp) inp.value = '';
    currentSurat = null;
    if (!$('suratView').hidden) backToSporadik();
  }

  // ===== Validasi sebelum cetak / simpan (form input tab Sporadik) =====

  // Hapus penanda merah pada field yang sebelumnya dianggap kosong.
  function clearSuratFieldMarks() {
    const fieldsEl = $('suratEditFields');
    if (fieldsEl) {
      fieldsEl.querySelectorAll('.se-field.invalid').forEach((el) => el.classList.remove('invalid'));
    }
  }

  // Beri penanda "Wajib Diisi!" (border merah) pada field wajib yang kosong.
  function markSuratFieldMarks(missingKeys) {
    clearSuratFieldMarks();
    const fieldsEl = $('suratEditFields');
    if (!fieldsEl) return;
    missingKeys.forEach((k) => {
      const inp = fieldsEl.querySelector('[data-fill-key="' + k + '"]');
      const lab = inp && inp.closest('.se-field');
      if (lab) lab.classList.add('invalid');
    });
  }

  // Validasi 2 lapis: (1) status_berkas hanya boleh SUDAH_UKUR/SELESAI untuk cetak,
  // (2) seluruh field wajib terisi. Opsi skipStatus = cek kelengkapan saja (utk simpan).
  function validateSuratBeforePrint(skipStatus) {
    const st = currentSurat;
    if (!st) return { ok: false, msg: 'Tidak ada dokumen yang dimuat.' };

    // Batasan status berkas (PENDING tidak boleh cetak) KHUSUS untuk SPORADIK.
    // Tiga surat keterangan — JUAL BELI, HIBAH, AHLI WARIS — bebas dicetak
    // apa pun status berkasnya (mis. masih PENDING).
    if (!skipStatus && activeTemplate() === 'SPORADIK') {
      const stt = String(st.r.status_berkas || '').trim().toUpperCase();
      const allowed = ['SUDAH_DIUKUR', 'SUDAH_UKUR', 'SELESAI'];
      if (!allowed.includes(stt)) {
        return {
          ok: false,
          msg: 'Dokumen tidak dapat dicetak karena Status Berkas saat ini masih ' +
               (stt || '(kosong)') +
               '. Hanya berkas dengan status SUDAH_UKUR atau SELESAI yang dapat dicetak.'
        };
      }
    }

    const req = TEMPLATE_REQUIRED[activeTemplate()] || {};
    const reqKeys = Object.keys(req);
    const missing = reqKeys.filter((k) => !String(st.fill[k] ?? '').trim());
    if (missing.length) {
      markSuratFieldMarks(missing);
      const first = $('suratEditFields').querySelector('[data-fill-key="' + missing[0] + '"]');
      if (first) {
        first.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => { try { first.focus({ preventScroll: true }); } catch (_) {} }, 350);
      }
      return { ok: false, msg: 'Mohon lengkapi seluruh field yang masih kosong sebelum mencetak dokumen.' };
    }

    clearSuratFieldMarks();
    return { ok: true, msg: '' };
  }

  function handleCetak() {
    const v = validateSuratBeforePrint(false);
    if (!v.ok) { alert(v.msg); return; }
    window.print();
  }

  function handleSimpan() {
    const v = validateSuratBeforePrint(true);
    if (!v.ok) { alert(v.msg); return; }
    saveSuratEdit();
  }

  // ==== Editor data surat (inline, lebar) ====
  // Kunci penulisan per layanan: ke field data_raw mana nilai disimpan.
  function suratPartyKeys(L) {
    if (L === 'JUALBELI') return { nama: 'pembeli_nama', ttl: 'pembeli_tempat_lahir', kerja: 'pembeli_pekerjaan', alamat: 'pembeli_alamat', nik: 'nik', pk2: 'penjual_nama' };
    if (L === 'AHLIWARIS') return { nama: 'pemohon_nama', ttl: 'pemohon_ttl', kerja: 'pemohon_pekerjaan', alamat: 'pemohon_alamat', nik: 'pemohon_nik', pk2: 'almarhum_nama' };
    return { nama: 'penerima_nama', ttl: 'penerima_tempat_lahir', kerja: 'penerima_pekerjaan', alamat: 'penerima_alamat', nik: 'nik', pk2: 'pemberi_nama' };
  }

  // Pemetaan key isian surat → key data_raw yang benar (per layanan).
  const SURAT_RAW = {
    nama_pihak_pertama: (P) => P.nama,
    ttl_pihak_pertama: (P) => P.ttl,
    pekerjaan_pihak_pertama: (P) => P.kerja,
    nik_pihak_pertama: (P) => P.nik,
    alamat_pihak_pertama: (P) => P.alamat,
    luas: () => 'luas_tanah',
    dusun: () => 'dusun',
    jenis_tanah: () => 'jenis_tanah',
    batas_utara: () => 'batas_utara',
    batas_timur: () => 'batas_timur',
    batas_selatan: () => 'batas_selatan',
    batas_barat: () => 'batas_barat',
    pihak_kedua: (P) => P.pk2,
    tahun_pemberian: () => 'tahun_pemberian',
    saksi1_nama: () => 'saksi1_nama',
    saksi1_tmpl: () => 'saksi1_tmpl',
    saksi1_umur: () => 'saksi1_umur',
    saksi1_pekerjaan: () => 'saksi1_pekerjaan',
    saksi1_alamat: () => 'saksi1_alamat',
    saksi1_ttl: () => 'saksi1_ttl',
    saksi2_nama: () => 'saksi2_nama',
    saksi2_tmpl: () => 'saksi2_tmpl',
    saksi2_umur: () => 'saksi2_umur',
    saksi2_pekerjaan: () => 'saksi2_pekerjaan',
    saksi2_alamat: () => 'saksi2_alamat',
    saksi2_ttl: () => 'saksi2_ttl'
  };

  // Field yang dikunci selamanya (otomatis / tidak bisa diisi manual).
  const SURAT_LOCKED = new Set(['no_surat', 'rt', 'rw', 'nib', 'layanan']);

  // ===== Master Warga (autocomplete & auto-fill) =====
  // "Database" warga dibangun dari SELURUH riwayat surat yang sudah ada:
  // Pihak Pertama, Pihak Kedua, Saksi 1, Saksi 2, anak/ahli waris (AHLIWARIS),
  // dan pasangan — + data manual yang baru disimpan lewat localStorage.
  // Struktur database TIDAK diubah (semua agregasi di sisi klien).

  const CITIZEN_STORE_KEY = 'sia_citizens_v1';
  let citizenCache = {};

  // Fill-key sasaran per field nama warga di editor. Kosong (pihak_kedua):
  // hanya nama yang bisa diisi karena di form hanya ada satu kolom.
  const AC_ROLES = {
    nama_pihak_pertama: {
      ttl: 'ttl_pihak_pertama', kerja: 'pekerjaan_pihak_pertama',
      alamat: 'alamat_pihak_pertama', nik: 'nik_pihak_pertama'
    },
    pihak_kedua: {},
    saksi1_nama: {
      tmpl: 'saksi1_tmpl', ttl: 'saksi1_ttl', umur: 'saksi1_umur',
      kerja: 'saksi1_pekerjaan', alamat: 'saksi1_alamat'
    },
    saksi2_nama: {
      tmpl: 'saksi2_tmpl', ttl: 'saksi2_ttl', umur: 'saksi2_umur',
      kerja: 'saksi2_pekerjaan', alamat: 'saksi2_alamat'
    }
  };

  function normName(n) { return String(n || '').trim().toUpperCase(); }

  // === Tanggal Lahir (data binding) ===
  // Ekstrak tanggal lahir dari berbagai format menjadi ISO (yyyy-MM-dd) yang
  // wajib dipakai input type="date": ISO, "12-08-1970", "12/8/1970",
  // "12 Agustus 1970", atau "Makassar, 12 Agustus 1970". '' bila tak dikenal.
  function toBirthISO(v) {
    const s = String(v ?? '').trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    let m = /(\d{1,2})[-\/.](\d{1,2})[-\/.]((?:19|20)\d{2})/.exec(s);
    if (m) {
      const y = parseInt(m[3], 10), mo = parseInt(m[2], 10), d = parseInt(m[1], 10);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y > 1900) {
        return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      }
    }
    m = /(\d{1,2})\s+([A-Za-z]{3,})\s+((?:19|20)\d{2})/.exec(s);
    if (m) {
      const MON = {
        'januari': '01', 'februari': '02', 'maret': '03', 'april': '04', 'mei': '05',
        'juni': '06', 'juli': '07', 'agustus': '08', 'september': '09',
        'oktober': '10', 'november': '11', 'desember': '12'
      };
      const mo = MON[(m[2] || '').toLowerCase()];
      if (mo) return m[3] + '-' + mo + '-' + String(m[1]).padStart(2, '0');
    }
    return '';
  }

  // Umur (angka tahun) dari tanggal lahir ISO; '' bila kosong/tidak valid.
  // Dokumen menampilkan "35 Tahun" lewat fmtUmur() saat render {{saksiX_umur}}.
  function calcAgeFromTtl(tglISO) {
    return umurFromTgl(tglISO);
  }

  // Identitas 4 orang (Pihak 1, Pihak 2, Saksi 1, Saksi 2) dari fill surat.
  // Record warga dapat membawa: nama, tmpl (tempat lahir), tgl (ISO) / ttl
  // (gabungan), umur, kerja, alamat, nik — dipakai ulang pada autocomplete.
  function citizenEntries(fill) {
    const f = fill || {};
    const pk1 = {
      nama: normName(f.nama_pihak_pertama),
      ttl: f.ttl_pihak_pertama,
      kerja: f.pekerjaan_pihak_pertama,
      alamat: f.alamat_pihak_pertama,
      nik: f.nik_pihak_pertama
    };
    // TTL Pihak Pertama sering "Makassar, 12-08-1970" → pisah tempat & tanggal
    // agar bisa menyumbang data tanggal lahir ke peran lain (mis. Saksi).
    if (toBirthISO(pk1.ttl)) pk1.tgl = toBirthISO(pk1.ttl);
    const koma = String(pk1.ttl || '').indexOf(',');
    const tempat = koma > 0 ? String(pk1.ttl).slice(0, koma).trim() : '';
    if (tempat) pk1.tmpl = tempat;
    return [
      pk1,
      { nama: normName(f.pihak_kedua) },
      { nama: normName(f.saksi1_nama), tmpl: f.saksi1_tmpl, tgl: f.saksi1_ttl, umur: f.saksi1_umur, kerja: f.saksi1_pekerjaan, alamat: f.saksi1_alamat },
      { nama: normName(f.saksi2_nama), tmpl: f.saksi2_tmpl, tgl: f.saksi2_ttl, umur: f.saksi2_umur, kerja: f.saksi2_pekerjaan, alamat: f.saksi2_alamat }
    ];
  }

  // Gabungkan catatan warga: field kosong diisi dari catatan lain (tidak menimpa).
  function mergeCitizen(dst, src) {
    Object.keys(src || {}).forEach((k) => {
      if (k === 'nama') return;
      const v = String(src[k] ?? '').trim();
      if (v && !String(dst[k] ?? '').trim()) dst[k] = v;
    });
    return dst;
  }

  // Daftarkan daftar warga ke cache (dedup by nama + merge data saling melengkapi).
  function registerCitizenList(list) {
    (list || []).forEach((c) => {
      if (!c || !c.nama) return;
      if (!citizenCache[c.nama]) citizenCache[c.nama] = c;
      else mergeCitizen(citizenCache[c.nama], c);
    });
  }

  // Daftarkan identitas warga dari fill surat ke cache (data manual editor).
  function registerCitizens(fill) {
    registerCitizenList(citizenEntries(fill));
  }

  // Warga (ahli waris / anak) yang tertera di surat AHLI WARIS: nama + tempat &
  // tanggal lahir + pekerjaan + alamat → sumber data lengkap untuk auto-fill.
  function childrenEntries(raw) {
    const out = [];
    for (let i = 1; i <= 8; i++) {
      const n = normName(raw && raw['anak_' + i + '_nama']);
      if (!n) continue;
      out.push({
        nama: n,
        tmpl: String(raw['anak_' + i + '_tempat_lahir'] || '').trim(),
        tgl: toBirthISO(raw['anak_' + i + '_tanggal_lahir']),
        kerja: raw['anak_' + i + '_pekerjaan'] || '',
        alamat: raw['anak_' + i + '_alamat'] || ''
      });
    }
    return out;
  }

  // SEMUA warga dalam satu riwayat surat: Pihak Pertama, Pihak Kedua,
  // Saksi 1, Saksi 2 + anak/ahli waris + pasangan → basis pencarian
  // SILANG-PERAN & silang-riwayat di seluruh dokumen.
  function registerRecordCitizens(r, info) {
    registerCitizens(fillSporadik(r, info));
    registerCitizenList(childrenEntries(info));
    const pasangan = normName(info && info.pasangan_nama);
    if (pasangan) registerCitizenList([{ nama: pasangan }]);
  }

  function loadManualCitizens() {
    try {
      const raw = JSON.parse(localStorage.getItem(CITIZEN_STORE_KEY) || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch (_) { return {}; }
  }

  function saveManualCitizens() {
    try { localStorage.setItem(CITIZEN_STORE_KEY, JSON.stringify(citizenCache)); } catch (_) {}
  }

  // Bangun Master Warga: riwayat semua surat + entri manual (manual menang).
  function buildCitizenCache() {
    const manual = loadManualCitizens();
    citizenCache = {};
    rowsCache.forEach((c) => registerRecordCitizens(c.r, c.info));
    Object.keys(manual).forEach((k) => {
      if (k && manual[k]) citizenCache[k] = mergeCitizen(manual[k], citizenCache[k] || {});
    });
  }

  // Cari warga SILANG-PERAN & silang-riwayat: nama diawali > nama mengandung
  // (termasuk sebagian kata, mis. "FARA SAFRI") > NIK diawali. Maks 10 hasil.
  function queryCitizens(q) {
    const qs = String(q || '').trim().toUpperCase();
    const qn = qs.replace(/\D/g, '');
    if (!qs) return [];
    const words = qs.split(/\s+/).filter(Boolean);
    const allWords = words.length > 1;
    const out = [];
    Object.keys(citizenCache).forEach((k) => {
      const c = citizenCache[k];
      if (!c || !c.nama) return;
      let score = -1;
      if (c.nama.startsWith(qs)) score = 0;
      else if (c.nama.includes(qs) || (allWords && words.every((w) => c.nama.includes(w)))) score = 1;
      else if (qn && String(c.nik || '').replace(/\D/g, '').startsWith(qn)) score = 2;
      if (score >= 0) out.push({ c, score });
    });
    out.sort((a, b) => a.score - b.score || normName(a.c.nama).localeCompare(normName(b.c.nama)));
    return out.slice(0, 10).map((x) => x.c);
  }

  function citizenSub(c) {
    const parts = [];
    const dob = c.tgl || toBirthISO(c.ttl);
    if (dob) parts.push('Lahir ' + dob + ' · Umur ' + (umurFromTgl(dob) || '-'));
    else if (c.umur) parts.push('Umur ' + c.umur);
    if (c.tmpl) parts.push('Lahir ' + c.tmpl);
    if (c.kerja) parts.push(c.kerja);
    if (c.alamat) parts.push(c.alamat);
    if (c.ttl && !dob) parts.push(c.ttl);
    if (c.nik) parts.push('NIK ' + c.nik);
    return parts.join(' · ');
  }

  // Isi otomatis semua field terkait setelah warga dipilih dari dropdown.
  // Alur: nama → tanggal lahir (diikat ke input TTL) → umur DIHITUNG ULANG
  // dari tanggal lahir → pekerjaan & alamat. Field terkunci tidak ditimpa.
  function applyCitizen(inp, roleKey, c) {
    const fieldsEl = $('suratEditFields');
    if (!fieldsEl || !currentSurat) return;
    const role = (TEMPLATE_AC[activeTemplate()] || {})[roleKey] || {};
    const set = (fk, value) => {
      const el = fieldsEl.querySelector('[data-fill-key="' + fk + '"]');
      if (!el || el.readOnly) return;
      const v = String(value ?? '');
      el.value = v;
      currentSurat.fill[fk] = v;
      if (el.dataset.rawKey) currentSurat.info[el.dataset.rawKey] = v;
    };
    // Isi field hanya bila datanya ADA — jangan menimpa isian manual yang
    // sudah diketik pengguna dengan nilai kosong (mis. Umur/TTL tak ditemukan).
    const setIf = (fk, value) => {
      if (value != null && String(value).trim() !== '') set(fk, value);
    };

    // 1) Nama.
    set(roleKey, c.nama);

    // Pihak Kedua tidak punya field lain di form → cukup nama.
    if (!role.ttl) { clearSuratFieldMarks(); renderSurat(); return; }

    // 2) Pekerjaan & Alamat (bisa ikut dari data Pihak Pertama yang sama).
    setIf(role.kerja, c.kerja);
    setIf(role.alamat, c.alamat);
    if (role.nik) setIf(role.nik, c.nik);

    // 3) Tempat Lahir.
    if (role.tmpl) setIf(role.tmpl, c.tmpl);

    // 4) Tanggal Lahir: c.tgl (ISO) atau diekstrak dari string gabungan c.ttl,
    //    lalu diikat ke input tanggal lahir / TTL saksi (harus format ISO).
    const tanggalLahir = c.tgl || toBirthISO(c.ttl);
    if (role.ttl) setIf(role.ttl, role.tmpl ? toBirthISO(tanggalLahir) : c.ttl);

    // 5) Umur: hitung eksplisit dari tanggal lahir yang baru diikat.
    //    {{saksiX_umur}} otomatis terbaca "35 Tahun" saat render (fmtUmur).
    if (role.umur) setIf(role.umur, calcAgeFromTtl(tanggalLahir) || c.umur);

    clearSuratFieldMarks();
    renderSurat();
  }

  // Pasang dropdown autocomplete pada input nama warga.
  function attachCitizenAc(inp, roleKey) {
    if (!inp || inp.readOnly) return;
    const dd = document.createElement('div');
    dd.className = 'ac-dd';
    dd.hidden = true;
    inp.insertAdjacentElement('afterend', dd);
    let activeIdx = -1;

    const refreshActive = () => {
      Array.from(dd.children).forEach((el, i) => el.classList.toggle('active', i === activeIdx));
    };

    // Nama warga yang baru saja dipilih — selama input masih bernilai sama,
    // dropdown tidak boleh terbuka lagi (mencegah "menggantung" saat klik).
    let pickedName = '';

    const renderItems = () => {
      const matches = queryCitizens(inp.value);
      dd.innerHTML = '';
      activeIdx = -1;
      if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'ac-empty';
        empty.textContent = 'Tidak ada warga dengan nama tersebut — isi manual, akan tersimpan otomatis.';
        dd.appendChild(empty);
        dd.hidden = false;
        return;
      }
      matches.forEach((c, i) => {
        const it = document.createElement('div');
        it.className = 'ac-item' + (i === 0 ? ' active' : '');
        it.dataset.key = c.nama;
        if (citizenSub(c)) it.innerHTML = '<strong>' + escFill(c.nama) + '</strong><small>' + escFill(citizenSub(c)) + '</small>';
        else it.textContent = c.nama;
        it.addEventListener('mousedown', (ev) => { ev.preventDefault(); select(c); });
        it.addEventListener('mouseenter', () => { activeIdx = i; refreshActive(); });
        dd.appendChild(it);
      });
      activeIdx = 0;
      dd.hidden = false;
    };

    const close = () => { dd.hidden = true; activeIdx = -1; };

    // Pilih warga: isi field, tutup dropdown, lepas fokus (supaya tidak
    // "menggantung" / menutupi form setelah pemilihan). close() dijamin lewat
    // finally — tetap menutup walaupun applyCitizen melempar error.
    const select = (c) => {
      pickedName = c.nama;
      try {
        applyCitizen(inp, roleKey, c);
      } finally {
        close();
        inp.blur();
      }
    };

    inp.addEventListener('input', () => {
      if (inp.value === pickedName) { close(); return; }
      if (inp.value.trim()) renderItems(); else close();
    });
    inp.addEventListener('blur', () => setTimeout(close, 120));
    inp.addEventListener('keydown', (ev) => {
      if (dd.hidden) return;
      const items = Array.from(dd.querySelectorAll('.ac-item'));
      if (!items.length) return;
      if (ev.key === 'ArrowDown') { ev.preventDefault(); activeIdx = (activeIdx + 1) % items.length; refreshActive(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); activeIdx = (activeIdx - 1 + items.length) % items.length; refreshActive(); }
      else if (ev.key === 'Enter') {
        ev.preventDefault();
        const c = items[activeIdx] && citizenCache[items[activeIdx].dataset.key];
        if (c) select(c);
      }
      else if (ev.key === 'Escape') close();
    });
  }

  // Bangun grid SEMUA data surat: field terisi → terkunci (readonly),
  // field kosong → bisa diketik; perubahan langsung memperbarui pratinjau.
  function renderSuratEditor() {
    const fieldsEl = $('suratEditFields');
    if (!fieldsEl || !currentSurat) return;
    const st = currentSurat;
    const L = String(st.r.layanan || '').toUpperCase();
    const P = suratPartyKeys(L);
    const t = activeTemplate();
    const isSp = t === 'SPORADIK';
    const fields = TEMPLATE_FIELDS[t] || SPORADIK_FIELD_LABELS;
    const lockedSet = TEMPLATE_LOCKED[t] || SURAT_LOCKED;
    const textareas = TEMPLATE_TEXTAREA[t] || [];
    const dateInputs = TEMPLATE_DATE[t] || [];
    const autoAgeMap = TEMPLATE_AUTOAAGE[t] || {};
    const acRoles = TEMPLATE_AC[t] || {};

    const rawKeyFor = (key) => {
      if (isSp) return SURAT_RAW[key] ? SURAT_RAW[key](P) : key;
      if (key === 'nama_pemohon') return 'pemohon_nama';
      return key;
    };
    const forceEditable = (key) =>
      key === 'saksi1_nama' || key === 'saksi2_nama' ||
      (isSp && (key === 'saksi1_umur' || key === 'saksi2_umur' || key === 'saksi1_tmpl' || key === 'saksi2_tmpl'));

    const rows = fields.map(([key, label]) => {
      if (key === 'tgl_surat') return ''; // diatur lewat kontrol Tanggal Surat.
      const val = String(st.fill[key] ?? '');
      const locked = lockedSet.has(key) || (!forceEditable(key) && val.trim() !== '');
      const rawKey = locked ? '' : rawKeyFor(key);
      const isDate = dateInputs.includes(key);
      const isTextarea = textareas.includes(key);
      const inpVal = isDate ? toBirthISO(val) : val;
      const isAcName = Object.prototype.hasOwnProperty.call(acRoles, key);
      const isAutoField = isDate || !!autoAgeMap[key];
      const isManualField = isSp
        ? (key === 'pekerjaan_pihak_pertama' || key === 'alamat_pihak_pertama' ||
           key === 'saksi1_pekerjaan' || key === 'saksi2_pekerjaan' ||
           key === 'saksi1_alamat' || key === 'saksi2_alamat')
        : isManualLetter(key);
      const chip = isAcName ? '🔍 Cari Data' : (isAutoField ? '⚡ Otomatis' : '');
      const placeholder = isAcName ? 'Ketik Nama untuk Cari Data Warga...' : (isManualField ? 'Isi manual...' : '');
      const variant = isAcName ? 'ac' : (isAutoField ? 'auto' : (isManualField ? 'manual' : ''));
      return `
        <label class="se-field${locked ? ' locked' : ''}${variant ? ' se-' + variant : ''}">
          <span>${chip ? chip + ' · ' : ''}${esc(label)}</span>
          ${isTextarea
            ? `<textarea data-fill-key="${key}" data-raw-key="${rawKey}" rows="3" ${placeholder && !locked ? 'placeholder="' + placeholder + '"' : ''} ${locked ? 'readonly title="Terkunci (sudah terisi / otomatis)"' : ''}>${esc(inpVal)}</textarea>`
            : `<input type="${isDate ? 'date' : 'text'}" data-fill-key="${key}" data-raw-key="${rawKey}"
             ${autoAgeMap[key] ? 'data-auto-age="' + autoAgeMap[key] + '"' : ''}
             ${placeholder && !locked ? 'placeholder="' + placeholder + '"' : ''}
             value="${esc(inpVal)}" ${locked ? 'readonly title="Terkunci (sudah terisi / otomatis)"' : ''} />`}
        </label>`;
    }).join('');

    // AHLIWARIS: blok anak / ahli waris (jumlah mengikuti fill.jumlah_anak).
    let extra = '';
    if (t === 'AHLIWARIS') {
      const n = Math.max(0, Math.min(20, parseInt(String(st.fill.jumlah_anak || '0').replace(/\D/g, ''), 10) || 0));
      const anakRows = [];
      for (let i = 1; i <= n; i++) {
        const base = 'anak_' + i;
        anakRows.push(`
          <div class="se-anak-title">Anak ${i}</div>
          <label class="se-field"><span>Nama Anak ${i}</span>
            <input type="text" data-fill-key="${base}_nama" data-raw-key="${base}_nama" value="${esc(st.fill[base + '_nama'] || '')}" placeholder="Ketik nama..." /></label>
          <label class="se-field"><span>Tempat Lahir Anak ${i}</span>
            <input type="text" data-fill-key="${base}_tempat_lahir" data-raw-key="${base}_tempat_lahir" value="${esc(st.fill[base + '_tempat_lahir'] || '')}" placeholder="Isi manual..." /></label>
          <label class="se-field"><span>Tanggal Lahir Anak ${i}</span>
            <input type="date" data-fill-key="${base}_tanggal_lahir" data-raw-key="${base}_tanggal_lahir" value="${esc(toBirthISO(st.fill[base + '_tanggal_lahir'] || ''))}" /></label>
          <label class="se-field"><span>Pekerjaan Anak ${i}</span>
            <input type="text" data-fill-key="${base}_pekerjaan" data-raw-key="${base}_pekerjaan" value="${esc(st.fill[base + '_pekerjaan'] || '')}" placeholder="Isi manual..." /></label>
          <label class="se-field"><span>Alamat Anak ${i}</span>
            <textarea data-fill-key="${base}_alamat" data-raw-key="${base}_alamat" rows="2" placeholder="Isi manual...">${esc(st.fill[base + '_alamat'] || '')}</textarea></label>
        `);
      }
      if (n > 0) extra = `<div class="se-anak-head">👨‍👩‍👧‍👦 Daftar Anak / Ahli Waris (${n})</div>` + anakRows.join('');
    }

    fieldsEl.innerHTML = rows + extra;
    fieldsEl.querySelectorAll('input, textarea').forEach((inp) => {
      inp.addEventListener('input', () => {
        const fk = inp.dataset.fillKey;
        currentSurat.fill[fk] = inp.value;
        if (inp.dataset.rawKey) currentSurat.info[inp.dataset.rawKey] = inp.value;
        // Tanggal lahir terisi → Umur dihitung & diisi otomatis.
        const ageKey = inp.dataset.autoAge;
        if (ageKey) {
          const age = umurFromTgl(inp.value);
          const ageInp = fieldsEl.querySelector('input[data-fill-key="' + ageKey + '"]');
          if (ageInp) {
            ageInp.value = age;
            currentSurat.fill[ageKey] = age;
            if (ageInp.dataset.rawKey) currentSurat.info[ageInp.dataset.rawKey] = age;
          }
        }
        if (fk === 'jumlah_anak') { renderSuratEditor(); renderSurat(); return; }
        renderSurat();
      });
    });
    // Autocomplete Master Warga pada field nama (hanya yang masih bisa diketik).
    Object.keys(acRoles).forEach((key) => {
      const nameInp = fieldsEl.querySelector('input[data-fill-key="' + key + '"]');
      if (nameInp) attachCitizenAc(nameInp, key);
    });
    // Bila tanggal lahir (auto umur) sudah berisi tapi umur masih kosong, isi otomatis.
    Object.keys(autoAgeMap).forEach((ttlKey) => {
      const ttlInp = fieldsEl.querySelector('input[data-fill-key="' + ttlKey + '"]');
      const umrInp = fieldsEl.querySelector('input[data-fill-key="' + autoAgeMap[ttlKey] + '"]');
      if (ttlInp && umrInp && !String(umrInp.value).trim() && umrInp.dataset.rawKey) {
        const age = umurFromTgl(ttlInp.value);
        if (age) {
          umrInp.value = age;
          currentSurat.fill[autoAgeMap[ttlKey]] = age;
          currentSurat.info[umrInp.dataset.rawKey] = age;
        }
      }
    });
    $('btnSaveSuratEdit').hidden = fieldsEl.querySelectorAll('input:not([readonly]), textarea:not([readonly])').length === 0;
  }

  // Klasifikasi field isian manual pada surat resmi (hanya untuk chip/hint).
  function isManualLetter(key) {
    return /(_pekerjaan|_alamat|_tempat_lahir|_tanggal_lahir|_umur|_nama)$/.test(key);
  }

  // Simpan perubahan data surat (semua input yang tidak terkunci).
  async function saveSuratEdit() {
    const id = currentSurat && currentSurat.r && currentSurat.r.id;
    if (!id) return;
    const btn = $('btnSaveSuratEdit');
    busyBtn(btn, true, 'Menyimpan…');
    // Kumpulkan nilai dari semua input editor yang BISA diisi (tidak readonly).
    const raw = {};
    $('suratEditFields').querySelectorAll('input:not([readonly]), textarea:not([readonly])').forEach((inp) => {
      const rk = inp.dataset.rawKey;
      if (rk && String(inp.value).trim()) raw[rk] = inp.value;
    });
    // Nomor surat & tanggal ikut tersimpan agar bisa dipulihkan di lain hari.
    const noSurat = $('srNoSurat').value;
    if (noSurat) raw._nomorSuratTercetak = noSurat;
    const tgl = dmyToIso($('srTgl').value);
    if (tgl) raw._tglCetakSurat = tgl;
    if (noSurat) {
      const dupe = nomorSuratTerpakai(noSurat, id);
      if (dupe) throw new Error('Nomor surat ' + noSurat + ' sudah dipakai ' + dupe.r.id + '. Gunakan nomor lain.');
    }
    try {
      const res = await fetch('/api/permohonan/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data_raw: raw })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Gagal simpan');
      // Data yang baru disimpan otomatis masuk ke "Master Warga" (dipakai ulang).
      if (activeTemplate() === 'SPORADIK' && currentSurat && currentSurat.fill) {
        registerCitizens(currentSurat.fill);
        saveManualCitizens();
      }
      await loadData();
      // Muat ulang data surat yang baru disimpan agar editor & pratinjau sinkron.
      const c2 = rowsCache.find((x) => x.r.id === id);
      if (c2) {
        currentSurat = {
          r: c2.r, info: c2.info,
          fill: fillForTemplate(currentSuratTemplate, c2.r, c2.info),
          missing: suratMissingFor(currentSuratTemplate, c2.r, c2.info)
        };
        $('srTgl').value = isoToDmy(c2.info._tglCetakSurat || c2.info._tglSurat);
        $('srNoUrut').value = (String(c2.info._nomorSuratTercetak || '').match(/145-(\d{3})\//) || [])[1] || '';
        $('srNoSurat').value = '';
        renderSuratEditor();
        renderSurat();
      }
    } catch (e) {
      alert('Simpan gagal: ' + e.message);
    } finally {
      busyBtn(btn, false);
    }
  }

  function todayISO() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // Normalisasi tanggal apa pun (ISO "2026-08-14" atau Indonesia "21 Juni 2026")
  // menjadi format "yyyy-MM-dd" untuk <input type="date">.
  function toISODate(v) {
    if (!v) return todayISO();
    if (/^\d{4}-\d{2}-\d{2}/.test(String(v))) return v;
    // Data lama tersimpan DD-MM-YYYY (input teks) -> baca ulang jadi ISO.
    const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(v).trim());
    if (dmy) {
      const dd = parseInt(dmy[1], 10), mm = parseInt(dmy[2], 10);
      if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) return dmy[3] + '-' + dmy[2] + '-' + dmy[1];
    }
    const m = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(String(v));
    if (m) {
      const MON = {
        'januari': '01', 'februari': '02', 'maret': '03', 'april': '04',
        'mei': '05', 'juni': '06', 'juli': '07', 'agustus': '08',
        'september': '09', 'oktober': '10', 'november': '11', 'desember': '12'
      };
      const mo = MON[(m[2] || '').toLowerCase()];
      if (mo) return m[3] + '-' + mo + '-' + String(m[1]).padStart(2, '0');
    }
    return todayISO();
  }

  // Konversi format tanggal: ISO (YYYY-MM-DD) <-> tampilan (DD-MM-YYYY).
  function isoToDmy(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
    if (!m) return '';
    return m[3] + '-' + m[2] + '-' + m[1];
  }

  function dmyToIso(v) {
    const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(v || '').trim());
    if (!m) return '';
    const [, dd, mm, yyyy] = m;
    const mo = parseInt(mm, 10), day = parseInt(dd, 10);
    if (mo < 1 || mo > 12 || day < 1 || day > 31) return '';
    return yyyy + '-' + mm + '-' + dd;
  }

  // Masking input tanggal tampilan DD-MM-YYYY (isi otomatis strip "-").
  function maskDmyInput(inp) {
    if (!inp) return;
    inp.addEventListener('input', () => {
      let d = inp.value.replace(/\D/g, '').slice(0, 8);
      let out = '';
      if (d.length > 4) out = d.slice(0, 2) + '-' + d.slice(2, 4) + '-' + d.slice(4);
      else if (d.length > 2) out = d.slice(0, 2) + '-' + d.slice(2);
      else out = d;
      inp.value = out;
    });
  }

  // Cek apakah nomor surat sudah dipakai record lain (untuk mencegah duplikat).
  function nomorSuratTerpakai(no, excludeId) {
    const target = String(no || '').trim().toLowerCase();
    if (!target) return null;
    return rowsCache.find((c) => {
      if (excludeId && c.r.id === excludeId) return false;
      return String((c.info && c.info._nomorSuratTercetak) || '').trim().toLowerCase() === target;
    }) || null;
  }

  // Hitung umur (dalam tahun) dari tanggal lahir ISO (YYYY-MM-DD).
  function umurFromTgl(tglISO) {
    if (!tglISO) return '';
    const b = new Date(String(tglISO).slice(0, 10) + 'T00:00:00');
    if (isNaN(b.getTime())) return '';
    const now = new Date();
    let age = now.getFullYear() - b.getFullYear();
    const mDiff = now.getMonth() - b.getMonth();
    if (mDiff < 0 || (mDiff === 0 && now.getDate() < b.getDate())) age--;
    return age >= 0 ? String(age) : '';
  }

  // Bangun nomor surat dari nomor urut manual + tanggal yang dipilih.
  // Pola: 145-{urut}/Des.Bat/560/{bulan}/{tahun}  (bulan & tahun dari tanggal surat).
  function buildNomorSurat(urut, tglISO) {
    if (!urut) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(tglISO || ''));
    if (!m) return '';
    const [, thn, bln] = m;
    return '145-' + String(urut).padStart(3, '0') + '/Des.Bat/560/' + bln + '/' + thn;
  }

  function renderSurat() {
    if (!currentSurat) return;
    const st = currentSurat;
    const t = activeTemplate();
    const tglISO = dmyToIso($('srTgl').value);
    const urut = ($('srNoUrut').value || '').replace(/\D/g, '').slice(0, 3);
    const f = Object.assign({}, st.fill);

    // Tanggal surat: dari kontrol manual (format Indonesia).
    if (tglISO) {
      const d = new Date(tglISO + 'T00:00:00');
      if (!isNaN(d.getTime())) {
        f.tgl_surat = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      }
    }
    f.no_surat = buildNomorSurat(urut, tglISO);
    $('srNoSurat').value = f.no_surat;

    // Sinkronkan nilai semua input grid (mis. no_surat otomatis, dsb.).
    $('suratEditFields').querySelectorAll('input, textarea').forEach((inp) => {
      const key = inp.dataset.fillKey;
      if (!key) return;
      const target = inp.type === 'date' ? toBirthISO(String(f[key] ?? '')) : String(f[key] ?? '');
      if (inp.value !== target) inp.value = target;
    });

    // Status kelengkapan field wajib (per template).
    const req = TEMPLATE_REQUIRED[t] || {};
    const reqKeys = Object.keys(req);
    const missing = reqKeys.filter((k) => !String(f[k] ?? '').trim());
    const filledCnt = reqKeys.length - missing.length;
    $('seStatus').textContent = missing.length
      ? `⚠️ ${filledCnt} dari ${reqKeys.length} field wajib terisi. Isi field yang masih kosong di kiri, lalu klik "💾 Simpan Data".`
      : `✅ Semua ${reqKeys.length} field wajib terisi — surat siap dicetak.`;

    // Surat Jual Beli, Hibah & Ahli Waris boleh cetak lebih dari 1 halaman
    // (jangan dipaksa 1 halaman karena data bisa terpotong/hilang).
    // SPORADIK tetap terkunci pas 1 halaman (kertas 8.5x13in).
    document.body.classList.toggle('multi-print', t === 'JUALBELI' || t === 'HIBAH' || t === 'AHLIWARIS');
    // Ahli Waris memakai halaman bernama 'aw' (margin + footer halaman).
    // Class dipasang di <html> agar seluruh konten memakai page: aw dan
    // tidak memicu pecah halaman kosong di awal (beda nama halaman = break paksa).
    document.documentElement.classList.toggle('aw-print', t === 'AHLIWARIS');

    // Jumlah halaman Ahli Waris berbasis jumlah anak:
    // <= 4 anak -> mode 1 halaman (spasi dirapatkan, footer "Halaman 1 dari 1").
    // >= 5 anak -> mode 2 halaman (spasi normal, footer "Halaman 1 dari 2").
    const nAnakAw = Math.max(0, Math.min(20, parseInt(String(f.jumlah_anak || '0').replace(/\D/g, ''), 10) || 0));
    document.body.classList.toggle('aw-1pg', t === 'AHLIWARIS' && nAnakAw <= 4);
    document.body.classList.toggle('aw-2pg', t === 'AHLIWARIS' && nAnakAw >= 5);

    if (t === 'JUALBELI') renderJualBeliPreview(f);
    else if (t === 'AHLIWARIS') renderAhliWarisPreview(f);
    else if (t === 'HIBAH') renderHibahPreview(f);
    else renderSporadikPreview(f);
  }

  function escFill(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // escFill + konversi Enter (newline) ke <br> agar multi-line alamat/textarea
  // tampil turun baris di template/sheet (nl2br efeknya).
  function escBr(v) {
    return escFill(v).replace(/\n/g, '<br>');
  }

  // Format umur agar selalu berakhiran "Tahun" di dokumen:
  // "20" -> "20 Tahun"; "20 Tahun" (kelebihan) -> dibiarkan; kosong -> kosong.
  function fmtUmur(v) {
    const s = String(v ?? '').trim();
    if (!s) return '';
    if (/tahun$/i.test(s)) return s;
    return s + ' Tahun';
  }

  // Format luas agar memuat satuan baku "Meter Persegi (m²)" tepat sekali
  // (menghapus satuan lama yang mungkin ikut terbawa data, mis. "M2" / "tertruncat").
  function fmtLuas(v) {
    const s = String(v ?? '').trim();
    if (!s) return '';
    const bare = s.replace(/\s*\(?\s*(?:m\^?2|m²|meter\s*persegi)\s*\)?\s*$/i, '');
    return (bare || '').replace(/\s+$/, '') + ' Meter Persegi (m²)';
  }

  // Urutan & label semua field SPORADIK untuk panel review data.
  const SPORADIK_FIELD_LABELS = [
    ['no_surat', 'Nomor Surat (opsional)'],
    ['nama_pihak_pertama', 'Nama Pihak Pertama'],
    ['ttl_pihak_pertama', 'Tempat/Tanggal Lahir Pihak Pertama'],
    ['pekerjaan_pihak_pertama', 'Pekerjaan Pihak Pertama'],
    ['nik_pihak_pertama', 'Nomor KTP (NIK)'],
    ['alamat_pihak_pertama', 'Alamat Pihak Pertama'],
    ['luas', 'Luas Tanah'],
    ['dusun', 'Dusun'],
    ['rt', 'RT'],
    ['rw', 'RW'],
    ['nib', 'N.I.B. (dikunci)'],
    ['jenis_tanah', 'Jenis Tanah / Dipergunakan untuk'],
    ['batas_utara', 'Batas Utara'],
    ['batas_timur', 'Batas Timur'],
    ['batas_selatan', 'Batas Selatan'],
    ['batas_barat', 'Batas Barat'],
    ['pihak_kedua', 'Pihak Kedua / Pemberi'],
    ['layanan', 'Jenis Layanan'],
    ['tahun_pemberian', 'Tahun Pemberian'],
    ['saksi1_nama', 'Nama Saksi 1'],
    ['saksi1_tmpl', 'Tempat Lahir Saksi 1 (helper)'],
    ['saksi1_ttl', 'Tanggal Lahir Saksi 1 (auto Umur)'],
    ['saksi1_umur', 'Umur Saksi 1 (bisa manual)'],
    ['saksi1_pekerjaan', 'Pekerjaan Saksi 1'],
    ['saksi1_alamat', 'Alamat Saksi 1'],
    ['saksi2_nama', 'Nama Saksi 2'],
    ['saksi2_tmpl', 'Tempat Lahir Saksi 2 (helper)'],
    ['saksi2_ttl', 'Tanggal Lahir Saksi 2 (auto Umur)'],
    ['saksi2_umur', 'Umur Saksi 2 (bisa manual)'],
    ['saksi2_pekerjaan', 'Pekerjaan Saksi 2'],
    ['saksi2_alamat', 'Alamat Saksi 2'],
    ['tgl_surat', 'Tanggal Surat (pilih manual)']
  ];

  function renderSporadikPreview(f) {
    const b = document.createElement('div');
    b.className = 'surat-sheet';

    const kv = (rows, cls) =>
      '<table class="surat-tb' + (cls ? ' ' + cls : '') + '"><tbody>' +
      rows.map((r) => {
        const l = r[0];
        const sep = r.length >= 3 ? r[1] : ':';
        const v = r.length >= 3 ? r[2] : r[1];
        const bold = r.length === 4 && r[3] === true;
        return `<tr><td class="lbl">${l}</td><td>${sep}</td><td>${bold ? '<b>' : ''}${escFill(v)}${bold ? '</b>' : ''}</td></tr>`;
      }).join('') +
      '</tbody></table>';

    // Baris nilai berNama yang wajib TEBAL sesuai aturan Bold Global.
    // Memakai markup tabel yang sama (surat-tb/.lbl) agar layout tidak berubah.
    const bRow = (lab, v) => `<tr><td class="lbl">${lab}</td><td>:</td><td>Tanah Milik <b>${escFill(v)}</b></td></tr>`;

    // N.I.B. -> 13 kotak digit (2-2-2-2-5) dipisah tanda hubung.
    const nibBoxes = (str) => {
      const d = (str || '').replace(/\D/g, '').padEnd(13, ' ').slice(0, 13).split('');
      const groups = [2, 2, 2, 2, 5];
      let out = '', i = 0;
      groups.forEach((g, gi) => {
        let grp = '';
        for (let k = 0; k < g; k++) {
          const ch = d[i++];
          grp += `<span class="nib-box">${ch === ' ' ? '' : escFill(ch)}</span>`;
        }
        out += grp + (gi < groups.length - 1 ? '<span class="nib-box nib-dot">&#8226;</span>' : '');
      });
      return '<span class="nib-wrap">' + out + '</span>';
    };

    const T = [];
    T[0]  = kv([['Nama', ':', f.nama_pihak_pertama, true]]);
    T[1]  = kv([['Tempat dan Tanggal Lahir', f.ttl_pihak_pertama]]);
    T[2]  = kv([['Pekerjaan', f.pekerjaan_pihak_pertama]]);
    T[3]  = kv([['Nomor KTP', f.nik_pihak_pertama]]);
    T[4]  = kv([['Alamat', f.alamat_pihak_pertama]]);
    T[6]  = '<table class="surat-tb nib-table"><tbody><tr><td class="lbl">N.I.B.</td><td>:</td><td>' + nibBoxes(f.nib) + '</td></tr></tbody></table>';
    T[7]  = kv([['Status Tanah', 'Tanah Negara']]);
    T[8]  = kv([['Dipergunakan untuk', f.jenis_tanah]]);
    T[9]  = '<table class="surat-tb"><tbody>' +
      '<tr><td class="lbl">Batas-batas tanah</td><td>;</td><td></td></tr>' +
      bRow('Utara', f.batas_utara) +
      bRow('Timur', f.batas_timur) +
      bRow('Selatan', f.batas_selatan) +
      bRow('Barat', f.batas_barat) +
      '</tbody></table>';
    const saksiBlock = (n, nama, umur, pek, alm) =>
      '<table class="surat-tb surat-saksi-col"><tbody>' +
      `<tr><td class="lbl"><span class="s-no">${n}.&nbsp;</span>Nama</td><td>:</td><td><b>${escFill(nama)}</b></td></tr>` +
      `<tr><td class="lbl"><span class="s-no"></span>Umur</td><td>:</td><td>${escFill(fmtUmur(umur))}</td></tr>` +
      `<tr><td class="lbl"><span class="s-no"></span>Pekerjaan</td><td>:</td><td>${escFill(pek)}</td></tr>` +
      `<tr><td class="lbl"><span class="s-no"></span>Alamat</td><td>:</td><td>${escBr(alm)}</td></tr>` +
      '</tbody></table>';
    T[11] = '<div class="surat-saksi-grid">' +
      saksiBlock('1', f.saksi1_nama, f.saksi1_umur, f.saksi1_pekerjaan, f.saksi1_alamat) +
      saksiBlock('2', f.saksi2_nama, f.saksi2_umur, f.saksi2_pekerjaan, f.saksi2_alamat) +
      '</div>';
    T[12] = kv([
      ['Tanggal', f.tgl_surat],
      ['Nomor Registrasi', f.no_surat],
    ], 'surat-reg');

    b.innerHTML = `
      <div class="surat-head">
        SURAT PERNYATAAN PENGUASAAN FISIK<br>BIDANG TANAH (SPORADIK)
      </div>
      <p class="surat-p">Yang bertanda tangan dibawah ini :</p>
      ${T[0]}${T[1]}
      ${T[2]}${T[3]}${T[4]}
      <p class="surat-p">Dengan ini menerangkan bahwa saya dengan itikad baik telah menguasai sebidang tanah seluas <b>${escFill(fmtLuas(f.luas))}</b> yang terletak di Dusun <b>${escFill(f.dusun)}</b> RT : <b>${escFill(f.rt)}</b> RW : <b>${escFill(f.rw)}</b> Desa/<s>Kelurahan</s> : Batetangnga. Kecamatan Binuang Kabupaten Polewali Mandar.</p>
      ${T[6]}${T[7]}${T[8]}${T[9]}
      <p class="surat-p">Bidang tanah tersebut saya peroleh dari <b>${escFill(f.pihak_kedua)}</b> berdasarkan surat keterangan <b>${escFill(f.layanan)}</b> yang dikuasai sejak tahun <b>${escFill(f.tahun_pemberian)}</b> yang sampai saat ini saya kuasai secara terus menerus, tidak dijadikan / menjadi jaminan sesuatu hutang dan tidak dalam sengketa. Pernyataan ini disaksikan oleh :</p>
      ${T[11]}
      <p class="surat-p">Surat Pernyataan ini saya buat dengan sebenarnya dengan penuh tanggung jawab dan saya bersedia untuk mengangkat sumpah bila diperlukan. Apabila pernyataan ini tidak benar saya bersedia dituntut dihadapan pejabat yang berwenang.</p>
      <div class="surat-ttd-row">
        <div></div>
        <div class="surat-ttd">
          <div>Batetangnga, ${escFill(f.tgl_surat)}</div>
          <div>Yang membuat pernyataan,</div>
          <div class="surat-baris-3">
            <div class="surat-materai">Materai 10.000</div>
            <div class="surat-tdd-spasi"></div>
          </div>
          <div class="surat-tdd-nama">( <b>${escFill(f.nama_pihak_pertama)}</b> )</div>
        </div>
      </div>
      <p class="surat-p surat-saksi-head">Saksi-Saksi :</p>
      <div class="surat-saksi">
        <div class="surat-saksi-baris">
          <div class="surat-saksi-kiri">1 . <b>${escFill(f.saksi1_nama)}</b></div>
          <div class="surat-saksi-kanan">( ...................................... )</div>
        </div>
        <div class="surat-saksi-baris">
          <div class="surat-saksi-kiri">2 . <b>${escFill(f.saksi2_nama)}</b></div>
          <div class="surat-saksi-kanan">( ...................................... )</div>
        </div>
      </div>
      ${T[12]}
      <div class="surat-ttd-row">
        <div></div>
        <div class="surat-ttd">
          <div>Mengetahui Kepala Desa Batetangnga</div>
          <div class="surat-ttd-space"></div>
          <div><b>(SUMAILA DAMANG)</b></div>
        </div>
      </div>`;
    $('suratBody').innerHTML = '';
    $('suratBody').appendChild(b);
  }

  // ============================================================
  // SURAT RESMI (JUAL BELI / AHLI WARIS / HIBAH)
  // Template 100% mengikuti PDF resmi Desa Batetangnga, termasuk
  // tanda baca & typo yang memang ada di dokumen cetak.
  // ============================================================
  const SURAT_TITLE = {
    SPORADIK: 'Surat SPORADIK',
    JUALBELI: 'Surat Jual Beli / Pengoperan Hak',
    AHLIWARIS: 'Surat Ahli Waris',
    HIBAH: 'Surat Hibah'
  };

  // Template WAJIB mengikuti layanan record (AHLIWARIS → hanya Surat Ahli Waris,
  // JUALBELI → hanya Surat Jual Beli, HIBAH → hanya Surat Hibah, selainnya → SPORADIK).
  function templateForLayanan(L) {
    const s = String(L || '').toUpperCase();
    if (s === 'JUALBELI') return 'JUALBELI';
    if (s === 'AHLIWARIS') return 'AHLIWARIS';
    if (s === 'HIBAH') return 'HIBAH';
    return 'SPORADIK';
  }
  function activeTemplate() { return currentSuratTemplate || 'SPORADIK'; }

  function setSuratTitle(t) {
    const h = $('suratTitle');
    if (h) h.textContent = SURAT_TITLE[t] || 'Surat';
  }

  // Format tanggal lahir (ISO / DD-MM-YYYY / Indonesia) → "12 Agustus 1970".
  function fmtTglDate(v) {
    const iso = toBirthISO(v);
    if (!iso) return String(v ?? '').trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return String(v ?? '').trim();
    const bulan = ['Januari','Februari','Maret','April','Mei','Juni',
                   'Juli','Agustus','September','Oktober','November','Desember'];
    return parseInt(m[3], 10) + ' ' + bulan[parseInt(m[2], 10) - 1] + ' ' + m[1];
  }

  // Format harga rupiah untuk dokumen: angka → "Rp 5.000.000".
  function fmtHarga(v) {
    const s = String(v ?? '').trim();
    if (!s) return '';
    if (/^[\d\s.,]+$/.test(s)) {
      const n = Number(String(s).replace(/\./g, '').replace(/\s/g, ''));
      if (!isNaN(n)) return formatRp(Math.round(n));
    }
    return s;
  }

  function terbilangHargaFromNum(v) {
    const n = parseInt(String(v || '').replace(/[^\d]/g, ''), 10) || 0;
    if (!n) return '';
    return terbilang(n).replace(/\s*Rupiah\s*$/i, '').trim() + ' Rupiah';
  }

  // ===== Fill per layanan (nilai isian surat) =====
  function fillJualBeli(r, info) {
    const raw = info;
    const upper = (s) => String(s ?? '').toUpperCase();
    const today = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const umur = (tanggalKey, umurKey) => umurFromTgl(raw[tanggalKey]) || raw[umurKey] || '';
    return {
      no_surat: raw._nomorSuratTercetak || '',
      tgl_surat: today,
      penjual_nama: upper(raw.penjual_nama || ''),
      penjual_umur: umur('penjual_tanggal_lahir', 'penjual_umur'),
      penjual_pekerjaan: raw.penjual_pekerjaan || '',
      penjual_alamat: raw.penjual_alamat || '',
      pembeli_nama: upper(raw.pembeli_nama || raw.nama_lengkap || r.nama || ''),
      pembeli_umur: umur('pembeli_tanggal_lahir', 'pembeli_umur'),
      pembeli_pekerjaan: raw.pembeli_pekerjaan || '',
      pembeli_alamat: raw.pembeli_alamat || raw.alamat || '',
      jenis_tanah: raw.jenis_tanah || '',
      luas_tanah: raw.luas_tanah || '',
      alamat_tanah: raw.alamat_tanah || '',
      dusun: raw.dusun || '',
      tahun_pemberian: raw.tahun_pemberian || '',
      batas_utara: raw.batas_utara || '',
      batas_timur: raw.batas_timur || '',
      batas_selatan: raw.batas_selatan || '',
      batas_barat: raw.batas_barat || '',
      harga_pembelian: raw.harga_pembelian || '',
      harga_terbilang: raw.harga_terbilang || terbilangHargaFromNum(raw.harga_pembelian),
      saksi1_nama: upper(raw.saksi1_nama || ''),
      saksi2_nama: upper(raw.saksi2_nama || '')
    };
  }

  function fillAhliWaris(r, info) {
    const raw = info;
    const upper = (s) => String(s ?? '').toUpperCase();
    const today = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const n = parseInt(raw.jumlah_anak || '0', 10) || 0;
    const out = {
      no_surat: raw._nomorSuratTercetak || '',
      tgl_surat: today,
      almarhum_nama: upper(raw.almarhum_nama || ''),
      pasangan_nama: upper(raw.pasangan_nama || ''),
      tahun_meninggal: raw.tahun_meninggal || raw.tahun_pemberian || '',
      jumlah_anak: raw.jumlah_anak || '',
      jumlah_anak_terbilang: raw.jumlah_anak_terbilang || (n ? terbilang(n) + ' orang' : ''),
      nama_pemohon: upper(raw.pemohon_nama || raw.nama_lengkap || r.nama || ''),
      jenis_tanah: raw.jenis_tanah || '',
      luas_tanah: raw.luas_tanah || '',
      alamat_tanah: raw.alamat_tanah || '',
      dusun: raw.dusun || '',
      batas_utara: raw.batas_utara || '',
      batas_timur: raw.batas_timur || '',
      batas_selatan: raw.batas_selatan || '',
      batas_barat: raw.batas_barat || '',
      saksi1_nama: upper(raw.saksi1_nama || ''),
      saksi2_nama: upper(raw.saksi2_nama || '')
    };
    for (let i = 1; i <= 20; i++) {
      out['anak_' + i + '_nama'] = upper(raw['anak_' + i + '_nama'] || '');
      out['anak_' + i + '_tempat_lahir'] = raw['anak_' + i + '_tempat_lahir'] || '';
      out['anak_' + i + '_tanggal_lahir'] = raw['anak_' + i + '_tanggal_lahir'] || '';
      out['anak_' + i + '_pekerjaan'] = raw['anak_' + i + '_pekerjaan'] || '';
      out['anak_' + i + '_alamat'] = raw['anak_' + i + '_alamat'] || '';
    }
    return out;
  }

  function fillHibah(r, info) {
    const raw = info;
    const upper = (s) => String(s ?? '').toUpperCase();
    const today = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const umur = (tanggalKey, umurKey) => umurFromTgl(raw[tanggalKey]) || raw[umurKey] || '';
    return {
      no_surat: raw._nomorSuratTercetak || '',
      tgl_surat: today,
      pemberi_nama: upper(raw.pemberi_nama || ''),
      pemberi_tempat_lahir: raw.pemberi_tempat_lahir || '',
      pemberi_tanggal_lahir: raw.pemberi_tanggal_lahir || '',
      pemberi_umur: umur('pemberi_tanggal_lahir', 'pemberi_umur'),
      pemberi_pekerjaan: raw.pemberi_pekerjaan || '',
      pemberi_alamat: raw.pemberi_alamat || '',
      penerima_nama: upper(raw.penerima_nama || raw.nama_lengkap || r.nama || ''),
      penerima_tempat_lahir: raw.penerima_tempat_lahir || '',
      penerima_tanggal_lahir: raw.penerima_tanggal_lahir || '',
      penerima_umur: umur('penerima_tanggal_lahir', 'penerima_umur'),
      penerima_pekerjaan: raw.penerima_pekerjaan || '',
      penerima_alamat: raw.penerima_alamat || raw.alamat || '',
      jenis_tanah: raw.jenis_tanah || '',
      luas_tanah: raw.luas_tanah || '',
      alamat_tanah: raw.alamat_tanah || '',
      dusun: raw.dusun || '',
      tahun_pemberian: raw.tahun_pemberian || '',
      batas_utara: raw.batas_utara || '',
      batas_timur: raw.batas_timur || '',
      batas_selatan: raw.batas_selatan || '',
      batas_barat: raw.batas_barat || '',
      saksi1_nama: upper(raw.saksi1_nama || ''),
      saksi2_nama: upper(raw.saksi2_nama || '')
    };
  }

  function fillForTemplate(t, r, info) {
    if (t === 'JUALBELI') return fillJualBeli(r, info);
    if (t === 'AHLIWARIS') return fillAhliWaris(r, info);
    if (t === 'HIBAH') return fillHibah(r, info);
    return fillSporadik(r, info);
  }

  // ===== Field wajib & inti per template =====
  const TEMPLATE_REQUIRED = {
    SPORADIK: SPORADIK_REQUIRED,
    JUALBELI: {
      penjual_nama: 'Nama Penjual (Pihak Pertama)',
      penjual_umur: 'Umur Penjual',
      penjual_pekerjaan: 'Pekerjaan Penjual',
      penjual_alamat: 'Alamat Penjual',
      pembeli_nama: 'Nama Pembeli (Pihak Kedua)',
      pembeli_umur: 'Umur Pembeli',
      pembeli_pekerjaan: 'Pekerjaan Pembeli',
      pembeli_alamat: 'Alamat Pembeli',
      jenis_tanah: 'Jenis Tanah',
      luas_tanah: 'Luas Tanah',
      alamat_tanah: 'Alamat Tanah',
      dusun: 'Dusun',
      tahun_pemberian: 'Tahun',
      batas_utara: 'Batas Utara',
      batas_timur: 'Batas Timur',
      batas_selatan: 'Batas Selatan',
      batas_barat: 'Batas Barat',
      harga_pembelian: 'Harga Pembelian',
      harga_terbilang: 'Terbilang Harga',
      saksi1_nama: 'Nama Saksi 1',
      saksi2_nama: 'Nama Saksi 2'
    },
    AHLIWARIS: {
      almarhum_nama: 'Nama Almarhum/Almarhumah',
      pasangan_nama: 'Nama Istri/Suami',
      tahun_meninggal: 'Tahun Meninggal',
      jumlah_anak: 'Jumlah Anak',
      nama_pemohon: 'Nama Pemohon',
      jenis_tanah: 'Jenis Tanah',
      luas_tanah: 'Luas Tanah',
      alamat_tanah: 'Alamat Tanah',
      dusun: 'Dusun',
      batas_utara: 'Batas Utara',
      batas_timur: 'Batas Timur',
      batas_selatan: 'Batas Selatan',
      batas_barat: 'Batas Barat',
      saksi1_nama: 'Nama Saksi 1',
      saksi2_nama: 'Nama Saksi 2'
    },
    HIBAH: {
      pemberi_nama: 'Nama Pemberi (Pihak Pertama)',
      pemberi_umur: 'Umur Pemberi',
      pemberi_pekerjaan: 'Pekerjaan Pemberi',
      pemberi_alamat: 'Alamat Pemberi',
      penerima_nama: 'Nama Penerima (Pihak Kedua)',
      penerima_umur: 'Umur Penerima',
      penerima_pekerjaan: 'Pekerjaan Penerima',
      penerima_alamat: 'Alamat Penerima',
      jenis_tanah: 'Jenis Tanah',
      luas_tanah: 'Luas Tanah',
      alamat_tanah: 'Alamat Tanah',
      dusun: 'Dusun',
      tahun_pemberian: 'Tahun',
      batas_utara: 'Batas Utara',
      batas_timur: 'Batas Timur',
      batas_selatan: 'Batas Selatan',
      batas_barat: 'Batas Barat',
      saksi1_nama: 'Nama Saksi 1',
      saksi2_nama: 'Nama Saksi 2'
    }
  };

  // Subset inti (tanpa saksi) untuk kartu "Siap Cetak" dashboard.
  const TEMPLATE_CORE = {
    SPORADIK: SPORADIK_CORE,
    JUALBELI: {
      penjual_nama: 'Nama Penjual (Pihak Pertama)',
      penjual_umur: 'Umur Penjual',
      penjual_pekerjaan: 'Pekerjaan Penjual',
      penjual_alamat: 'Alamat Penjual',
      pembeli_nama: 'Nama Pembeli (Pihak Kedua)',
      pembeli_umur: 'Umur Pembeli',
      pembeli_pekerjaan: 'Pekerjaan Pembeli',
      pembeli_alamat: 'Alamat Pembeli',
      jenis_tanah: 'Jenis Tanah',
      luas_tanah: 'Luas Tanah',
      alamat_tanah: 'Alamat Tanah',
      dusun: 'Dusun',
      tahun_pemberian: 'Tahun',
      batas_utara: 'Batas Utara',
      batas_timur: 'Batas Timur',
      batas_selatan: 'Batas Selatan',
      batas_barat: 'Batas Barat',
      harga_pembelian: 'Harga Pembelian',
      harga_terbilang: 'Terbilang Harga'
    },
    AHLIWARIS: {
      almarhum_nama: 'Nama Almarhum/Almarhumah',
      pasangan_nama: 'Nama Istri/Suami',
      tahun_meninggal: 'Tahun Meninggal',
      jumlah_anak: 'Jumlah Anak',
      nama_pemohon: 'Nama Pemohon',
      jenis_tanah: 'Jenis Tanah',
      luas_tanah: 'Luas Tanah',
      alamat_tanah: 'Alamat Tanah',
      dusun: 'Dusun',
      batas_utara: 'Batas Utara',
      batas_timur: 'Batas Timur',
      batas_selatan: 'Batas Selatan',
      batas_barat: 'Batas Barat'
    },
    HIBAH: {
      pemberi_nama: 'Nama Pemberi (Pihak Pertama)',
      pemberi_umur: 'Umur Pemberi',
      pemberi_pekerjaan: 'Pekerjaan Pemberi',
      pemberi_alamat: 'Alamat Pemberi',
      penerima_nama: 'Nama Penerima (Pihak Kedua)',
      penerima_umur: 'Umur Penerima',
      penerima_pekerjaan: 'Pekerjaan Penerima',
      penerima_alamat: 'Alamat Penerima',
      jenis_tanah: 'Jenis Tanah',
      luas_tanah: 'Luas Tanah',
      alamat_tanah: 'Alamat Tanah',
      dusun: 'Dusun',
      tahun_pemberian: 'Tahun',
      batas_utara: 'Batas Utara',
      batas_timur: 'Batas Timur',
      batas_selatan: 'Batas Selatan',
      batas_barat: 'Batas Barat'
    }
  };

  function suratMissingFor(t, r, info) {
    const fill = fillForTemplate(t, r, info);
    const req = TEMPLATE_REQUIRED[t] || {};
    return Object.keys(req)
      .map((k) => ({ key: k, label: req[k] }))
      .filter((f) => !String(fill[f.key] ?? '').trim())
      .map((f) => f.label);
  }

  // ===== Render: SURAT PERNYATAAN PENGOPERAN/PENGALIAN HAK (JUAL BELI) =====
  function renderJualBeliPreview(f) {
    const b = document.createElement('div');
    b.className = 'surat-sheet';

    const pRow = (label, v, bold) =>
      `<tr><td class="lbl">${label}</td><td>:</td><td>${bold ? '<b>' : ''}${escFill(v)}${bold ? '</b>' : ''}</td></tr>`;

    const ttd2 = (kiriTitle, kiriNama, kananTitle, kananNama) => `
      <div class="surat-ttd-row letter-ttd">
        <div class="surat-ttd surat-ttd-left">
          <div>${kiriTitle}</div>
          <div class="surat-ttd-space"></div>
          <div>( <b>${escFill(kiriNama)}</b> )</div>
        </div>
        <div class="surat-ttd surat-ttd-right">
          <div>${kananTitle}</div>
          <div class="surat-ttd-space"></div>
          <div>( <b>${escFill(kananNama)}</b> )</div>
        </div>
      </div>`;

    b.innerHTML = `
      <div class="surat-head">SURAT PERNYATAAN PENGOPERAN/PENGALIAN HAK</div>
      <p class="surat-p">Yang bertanda tangan dibawah ini :</p>
      <table class="surat-tb"><tbody>
        ${pRow('N a m a', f.penjual_nama, true)}
        ${pRow('Umur', fmtUmur(f.penjual_umur))}
        ${pRow('Pekerjaan', f.penjual_pekerjaan)}
        ${pRow('Alamat', f.penjual_alamat)}
      </tbody></table>
      <p class="surat-p">Selanjunya disebut <b>Pihak Pertama</b></p>
      <table class="surat-tb"><tbody>
        ${pRow('N a m a', f.pembeli_nama, true)}
        ${pRow('Umur', fmtUmur(f.pembeli_umur))}
        ${pRow('Pekerjaan', f.pembeli_pekerjaan)}
        ${pRow('Alamat', f.pembeli_alamat)}
      </tbody></table>
      <p class="surat-p">Selanjunya disebut <b>Pihak Kedua</b></p>
      <p class="surat-p">Pihak Pertama dengan ini menyatakan telah melakukan Pengoperan Hak Atas sebidang tanah <b>${escFill(f.jenis_tanah)}</b> seluas Kurang Lebih <b>${escFill(f.luas_tanah)}</b> Meter Persegi yang terletak di <b>${escFill(f.alamat_tanah)}</b> Dusun <b>${escFill(f.dusun)}</b> Desa Batetangnga Kecamatan Binuang, Kabupaten Polewali Mandar kepada Pihak Kedua pada tahun <b>${escFill(f.tahun_pemberian)}</b> dengan batas-batas sebagai berikut :</p>
      <table class="surat-tb"><tbody>
        <tr><td class="lbl">Utara</td><td>:</td><td>Berbatasan dengan <b>${escFill(f.batas_utara)}</b></td></tr>
        <tr><td class="lbl">Timur</td><td>:</td><td>Berbatasan dengan <b>${escFill(f.batas_timur)}</b></td></tr>
        <tr><td class="lbl">Selatan</td><td>:</td><td>Berbatasan dengan <b>${escFill(f.batas_selatan)}</b></td></tr>
        <tr><td class="lbl">Barat</td><td>:</td><td>Berbatasan dengan <b>${escFill(f.batas_barat)}</b></td></tr>
      </tbody></table>
      <p class="surat-p">dan Pihak Kedua menerima Pengalihan Hak Milik Tanah tersebut dari Pihak Pertama dengan Senilai <b>${escFill(fmtHarga(f.harga_pembelian))}</b> <b>${escFill(f.harga_terbilang)}</b>, Pihak Kedua telah melunasi Pembelian Tanah tersebut dan Pihak Pertama mengaku telah menerima seluruh biaya Pembelian atas tanah tersebut.</p>
      <p class="surat-p">Demikian Pernyataan Pengalihan Hak Milik tanah ini kami buat dan kami tanda tangani bersama dihadapan 2 orang Saksi yang tersebut namanya dibawah ini untuk dipergunakan seperlunya dan sebagai bukti dikemudian hari.</p>
      <p class="surat-p surat-tgl-line">Batetangnga, ${escFill(f.tgl_surat)}</p>
      ${ttd2('Pihak Kedua<br>Yang Menerima Pengoperan,', f.pembeli_nama, 'Pihak Pertama<br>Yang Melakukan Pengoperan,', f.penjual_nama)}
      <p class="surat-p surat-saksi-head">Saksi - Saksi :</p>
      <div class="surat-saksi">
        <div class="surat-saksi-baris">
          <div class="surat-saksi-kiri">1 . <b>${escFill(f.saksi1_nama)}</b></div>
          <div class="surat-saksi-kanan">( ...................................... )</div>
        </div>
        <div class="surat-saksi-baris">
          <div class="surat-saksi-kiri">2 . <b>${escFill(f.saksi2_nama)}</b></div>
          <div class="surat-saksi-kanan">( ...................................... )</div>
        </div>
      </div>
      <p class="surat-p surat-no-line">Nomor Surat : <b>${escFill(f.no_surat)}</b></p>
      <div class="surat-ttd-row">
        <div></div>
        <div class="surat-ttd">
          <div>Batetangnga, ${escFill(f.tgl_surat)}</div>
          <div>Kepala Desa Batetangnga</div>
          <div class="surat-ttd-space"></div>
          <div><b>(SUMAILA DAMANG)</b></div>
        </div>
      </div>
      <div class="surat-materai-row">
        <div class="surat-materai">Materai<br>Rp. 10000,-</div>
      </div>`;

    $('suratBody').innerHTML = '';
    $('suratBody').appendChild(b);
  }

  // ===== Render: SURAT KETERANGAN dan PERNYATAAN AHLI WARIS =====
  // Tata letak 100% mengikuti dokumen baku (kertas 8.5x13in, PAS 1 HALAMAN).
  function renderAhliWarisPreview(f) {
    const b = document.createElement('div');
    b.className = 'surat-sheet surat-aw';

    const n = Math.max(0, Math.min(20, parseInt(String(f.jumlah_anak || '0').replace(/\D/g, ''), 10) || 0));
    const anakList = [];
    const ttdRows = [];
    for (let i = 1; i <= n; i++) {
      const nm = f['anak_' + i + '_nama'];
      const umur = fmtUmur(umurFromTgl(f['anak_' + i + '_tanggal_lahir']));
      const pek = f['anak_' + i + '_pekerjaan'];
      const alm = f['anak_' + i + '_alamat'];
      if (!nm && !umur && !pek && !alm) continue;
      anakList.push(`
        <div class="aw-anak">
          <div class="aw-anak-line"><span class="aw-no">${i}.</span><span class="aw-lbl">Nama</span> : <b>${escFill(nm)}</b></div>
          <div class="aw-anak-sub"><span class="aw-no"></span><span class="aw-lbl">Umur</span> : ${escFill(umur)}</div>
          <div class="aw-anak-sub"><span class="aw-no"></span><span class="aw-lbl">Pekerjaan</span> : ${escFill(pek)}</div>
          <div class="aw-anak-sub"><span class="aw-no"></span><span class="aw-lbl">Alamat</span> : ${escBr(alm)}</div>
        </div>`);
      if (nm) {
        ttdRows.push(`
          <div class="aw-ttd-row">
            <span class="aw-ttd-name">${i}. <b>${escFill(nm)}</b></span>
            <span class="aw-ttd-dots">( ............................ )</span>
          </div>`);
      }
    }
    const daftar = anakList.length
      ? `<div class="aw-anak-list">${anakList.join('')}</div>`
      : '';
    const ttdBlock = ttdRows.length
      ? `<div class="aw-ttd-para">Para Ahli Waris,</div>
         <div class="aw-ttd-rows">${ttdRows.join('')}</div>`
      : '';

    b.innerHTML = `
      <div class="surat-head">SURAT KETERANGAN dan PERNYATAAN AHLI WARIS</div>
      <p class="surat-p aw-intro">Kami yang bertanda tangan dibawah ini adalah para ahli waris dari Almarhum/mah :</p>
      <p class="surat-p aw-nama">= &nbsp;<b>${escFill(f.almarhum_nama)}</b>&nbsp; =</p>
      <p class="surat-p aw-jus">menerangkan dengan sesungguhnya dan sanggup diangkat sumpah, bahwa Almarhumah/Mah <b>${escFill(f.almarhum_nama)}</b>, yang telah meninggal dunia di Desa /Kel Batetangnga, pada Tahun <b>${escFill(f.tahun_meninggal)}</b> dari perkawinannya dengan Istri/Suami: <b>${escFill(f.pasangan_nama)}</b> dilahirkan (<b>${escFill(f.jumlah_anak)}</b> (<b>${escFill(f.jumlah_anak_terbilang)}</b>) Orang anak yaitu :</p>
      ${daftar}
      <p class="surat-p aw-jus">Demikian kami Anak dengan jumlah <b>${escFill(f.jumlah_anak)}</b> (<b>${escFill(f.jumlah_anak_terbilang)}</b>) anak adalah ahli waris dari mendiang <b>${escFill(f.almarhum_nama)}</b>, telah sepakat untuk membagi harta warisan dengan pembagian sebagai berikut :</p>
      <p class="surat-p aw-jus">Memberikan kepada ahli waris An. <b>${escFill(f.nama_pemohon)}</b>, atas seluruh harta warisan berupa tanah <b>${escFill(f.jenis_tanah)}</b> seluas ± <b>${escFill(f.luas_tanah)}</b> M² yang terletak di <b>${escFill(f.alamat_tanah)}</b> Dusun <b>${escFill(f.dusun)}</b> Desa Batetangnga, Kecamatan Binuang, Kabupaten Polewali Mandar, dengan batas-batas sbb :</p>
      <div class="aw-batas">
        <div><span class="aw-bt-lbl">Sebelah Utara</span>: Berbatasan dengan <b>${escFill(f.batas_utara)}</b></div>
        <div><span class="aw-bt-lbl">Sebelah Timur</span>: Barbatasan denga <b>${escFill(f.batas_timur)}</b></div>
        <div><span class="aw-bt-lbl">Sebelah Selatan</span>: Berbatasan dengan <b>${escFill(f.batas_selatan)}</b></div>
        <div><span class="aw-bt-lbl">Sebelah Barat</span>: Berbatasan dengan <b>${escFill(f.batas_barat)}</b></div>
      </div>
      <p class="surat-p aw-jus">Demikian surat keterangan dan pernyataan ahli waris ini kami buat dengan sebenar-benarnya atas dasar kesepakatan dan tanpa ada paksaan atau tekanan baik dari sesama ahli waris maupun dari pihak lain.</p>
      <div class="aw-sig-block">
        <p class="surat-p aw-tgl">Batetangnga, ${escFill(f.tgl_surat)}</p>
        ${ttdBlock}
        <div class="aw-footer">
          <div class="aw-footer-left">
            <div class="aw-saksi-title">Saksi-Saksi :</div>
            <div class="aw-saksi-space"></div>
            <div class="aw-saksi-pair">
              <div class="aw-saksi-satu">1. ( <b>${escFill(f.saksi1_nama)}</b> )</div>
              <div class="aw-saksi-dua">2. ( <b>${escFill(f.saksi2_nama)}</b> )</div>
            </div>
          </div>
          <div class="aw-footer-right">
            <div class="aw-nomor-wrap">
              <div class="aw-nomor"><span class="aw-lbl2">Nomor</span> : <b>${escFill(f.no_surat)}</b></div>
              <div class="aw-nomor"><span class="aw-lbl2">Tanggal</span> : ${escFill(f.tgl_surat)}</div>
            </div>
            <div class="aw-kades">
              <div>Disaksikan dan Dibenarkan Oleh</div>
              <div>Kepala Desa Batetangnga</div>
              <div class="aw-ttd-space"></div>
              <div><b>SUMAILA DAMANG</b></div>
            </div>
          </div>
        </div>
      </div>`;

    $('suratBody').innerHTML = '';
    $('suratBody').appendChild(b);
  }

  // ===== Render: SURAT PERNYATAAN PEMBERIAN/HIBAH =====
  function renderHibahPreview(f) {
    const b = document.createElement('div');
    b.className = 'surat-sheet';

    const pRow = (label, v, bold) =>
      `<tr><td class="lbl">${label}</td><td>:</td><td>${bold ? '<b>' : ''}${escFill(v)}${bold ? '</b>' : ''}</td></tr>`;

    const ttd2 = (kiriTitle, kiriNama, kananTitle, kananNama) => `
      <div class="surat-ttd-row letter-ttd">
        <div class="surat-ttd surat-ttd-left">
          <div>${kiriTitle}</div>
          <div class="surat-ttd-space"></div>
          <div>( <b>${escFill(kiriNama)}</b> )</div>
        </div>
        <div class="surat-ttd surat-ttd-right">
          <div>${kananTitle}</div>
          <div class="surat-ttd-space"></div>
          <div>( <b>${escFill(kananNama)}</b> )</div>
        </div>
      </div>`;

    b.innerHTML = `
      <div class="surat-head">SURAT PERNYATAAN PEMBERIAN/HIBAH</div>
      <p class="surat-p">Yang bertanda tangan dibawah ini :</p>
      <table class="surat-tb"><tbody>
        ${pRow('N a m a', f.pemberi_nama, true)}
        ${pRow('Tempat/Tanggal Lahir', (f.pemberi_tempat_lahir ? f.pemberi_tempat_lahir + ' / ' : '') + fmtTglDate(f.pemberi_tanggal_lahir))}
        ${pRow('Umur', fmtUmur(f.pemberi_umur))}
        ${pRow('Pekerjaan', f.pemberi_pekerjaan)}
        ${pRow('Alamat', f.pemberi_alamat)}
      </tbody></table>
      <p class="surat-p">Selanjutnya disebut <b>PIHAK PERTAMA</b></p>
      <table class="surat-tb"><tbody>
        ${pRow('N a m a', f.penerima_nama, true)}
        ${pRow('Tempat/Tanggal Lahir', (f.penerima_tempat_lahir ? f.penerima_tempat_lahir + ' / ' : '') + fmtTglDate(f.penerima_tanggal_lahir))}
        ${pRow('Umur', fmtUmur(f.penerima_umur))}
        ${pRow('Pekerjaan', f.penerima_pekerjaan)}
        ${pRow('Alamat', f.penerima_alamat)}
      </tbody></table>
      <p class="surat-p">Selanjutnya disebut <b>PIHAK KEDUA</b></p>
      <p class="surat-p">Pihak Pertama dengan ini memberikan/Menghibahkan Sebidang <b>${escFill(f.jenis_tanah)}</b> seluas <b>${escFill(f.luas_tanah)}</b> Meter Persegi yang terletak di <b>${escFill(f.alamat_tanah)}</b> Dusun <b>${escFill(f.dusun)}</b> Desa Batetangnga Kecamatan Binuang Kabupaten Polewali Mandar Kepada Pihak Kedua Pada tahun <b>${escFill(f.tahun_pemberian)}</b> Dengan batas-batas sebagai berikut :</p>
      <table class="surat-tb"><tbody>
        <tr><td class="lbl">Utara</td><td>:</td><td>Berbatasan dengan <b>${escFill(f.batas_utara)}</b></td></tr>
        <tr><td class="lbl">Timur</td><td>:</td><td>Berbatasan dengan <b>${escFill(f.batas_timur)}</b></td></tr>
        <tr><td class="lbl">Selatan</td><td>:</td><td>Berbatasan dengan <b>${escFill(f.batas_selatan)}</b></td></tr>
        <tr><td class="lbl">Barat</td><td>:</td><td>Berbatasan dengan <b>${escFill(f.batas_barat)}</b></td></tr>
      </tbody></table>
      <p class="surat-p">dan Pihak Kedua menerima pemberian/Hibah atas tanah tersebut. demikian surat pernyataan Pemberian/Hibah ini kami buat dan Kami tanda tangani bersama dihadapan 2 orang saksi yang tersebut namanya dibahwa ini untuk dipergunakan seperlunya dan sebagai bukti dikemudian hari.</p>
      <p class="surat-p surat-tgl-line">Batetangnga, ${escFill(f.tgl_surat)}</p>
      ${ttd2('Pihak Kedua<br>Yang Menerima Hibah,', f.penerima_nama, 'Pihak Pertama<br>Yang Memberikan Hibah,', f.pemberi_nama)}
      <p class="surat-p surat-saksi-head">Saksi - Saksi :</p>
      <div class="surat-saksi">
        <div class="surat-saksi-baris">
          <div class="surat-saksi-kiri">1 . <b>${escFill(f.saksi1_nama)}</b></div>
          <div class="surat-saksi-kanan">( ...................................... )</div>
        </div>
        <div class="surat-saksi-baris">
          <div class="surat-saksi-kiri">2 . <b>${escFill(f.saksi2_nama)}</b></div>
          <div class="surat-saksi-kanan">( ...................................... )</div>
        </div>
      </div>
      <p class="surat-p surat-no-line">Nomor : <b>${escFill(f.no_surat)}</b> &nbsp; Tanggal : ${escFill(f.tgl_surat)}</p>
      <div class="surat-ttd-row">
        <div></div>
        <div class="surat-ttd">
          <div>Diketahui Oleh</div>
          <div>Kepala DesaBatetangnga</div>
          <div class="surat-ttd-space"></div>
          <div><b>(SUMAILA DAMANG)</b></div>
        </div>
      </div>
      <div class="surat-materai-row">
        <div class="surat-materai">Materai<br>Rp. 10000,-</div>
      </div>`;

    $('suratBody').innerHTML = '';
    $('suratBody').appendChild(b);
  }

  // ===== Konfigurasi editor (field per template) =====
  const TEMPLATE_FIELDS = {
    SPORADIK: SPORADIK_FIELD_LABELS,
    JUALBELI: [
      ['no_surat', 'Nomor Surat (opsional)'],
      ['penjual_nama', 'Nama Penjual (Pihak Pertama)'],
      ['penjual_umur', 'Umur Penjual'],
      ['penjual_pekerjaan', 'Pekerjaan Penjual'],
      ['penjual_alamat', 'Alamat Penjual'],
      ['pembeli_nama', 'Nama Pembeli (Pihak Kedua)'],
      ['pembeli_umur', 'Umur Pembeli'],
      ['pembeli_pekerjaan', 'Pekerjaan Pembeli'],
      ['pembeli_alamat', 'Alamat Pembeli'],
      ['jenis_tanah', 'Jenis Tanah'],
      ['luas_tanah', 'Luas Tanah (angka saja)'],
      ['alamat_tanah', 'Alamat Tanah'],
      ['dusun', 'Dusun'],
      ['tahun_pemberian', 'Tahun'],
      ['batas_utara', 'Batas Utara'],
      ['batas_timur', 'Batas Timur'],
      ['batas_selatan', 'Batas Selatan'],
      ['batas_barat', 'Batas Barat'],
      ['harga_pembelian', 'Harga Pembelian (Rp)'],
      ['harga_terbilang', 'Terbilang Harga'],
      ['saksi1_nama', 'Nama Saksi 1'],
      ['saksi2_nama', 'Nama Saksi 2'],
      ['tgl_surat', 'Tanggal Surat (pilih manual)']
    ],
    AHLIWARIS: [
      ['no_surat', 'Nomor Surat (opsional)'],
      ['almarhum_nama', 'Nama Almarhum/Almarhumah'],
      ['pasangan_nama', 'Nama Istri/Suami'],
      ['tahun_meninggal', 'Tahun Meninggal'],
      ['jumlah_anak', 'Jumlah Anak'],
      ['jumlah_anak_terbilang', 'Jumlah Anak (terbilang)'],
      ['nama_pemohon', 'Nama Pemohon (Ahli Waris)'],
      ['jenis_tanah', 'Jenis Tanah'],
      ['luas_tanah', 'Luas Tanah (angka saja)'],
      ['alamat_tanah', 'Alamat Tanah'],
      ['dusun', 'Dusun'],
      ['batas_utara', 'Batas Utara'],
      ['batas_timur', 'Batas Timur'],
      ['batas_selatan', 'Batas Selatan'],
      ['batas_barat', 'Batas Barat'],
      ['saksi1_nama', 'Nama Saksi 1'],
      ['saksi2_nama', 'Nama Saksi 2'],
      ['tgl_surat', 'Tanggal Surat (pilih manual)']
    ],
    HIBAH: [
      ['no_surat', 'Nomor Surat (opsional)'],
      ['pemberi_nama', 'Nama Pemberi (Pihak Pertama)'],
      ['pemberi_tempat_lahir', 'Tempat Lahir Pemberi'],
      ['pemberi_tanggal_lahir', 'Tanggal Lahir Pemberi (auto Umur)'],
      ['pemberi_umur', 'Umur Pemberi'],
      ['pemberi_pekerjaan', 'Pekerjaan Pemberi'],
      ['pemberi_alamat', 'Alamat Pemberi'],
      ['penerima_nama', 'Nama Penerima (Pihak Kedua)'],
      ['penerima_tempat_lahir', 'Tempat Lahir Penerima'],
      ['penerima_tanggal_lahir', 'Tanggal Lahir Penerima (auto Umur)'],
      ['penerima_umur', 'Umur Penerima'],
      ['penerima_pekerjaan', 'Pekerjaan Penerima'],
      ['penerima_alamat', 'Alamat Penerima'],
      ['jenis_tanah', 'Jenis Tanah'],
      ['luas_tanah', 'Luas Tanah (angka saja)'],
      ['alamat_tanah', 'Alamat Tanah'],
      ['dusun', 'Dusun'],
      ['tahun_pemberian', 'Tahun'],
      ['batas_utara', 'Batas Utara'],
      ['batas_timur', 'Batas Timur'],
      ['batas_selatan', 'Batas Selatan'],
      ['batas_barat', 'Batas Barat'],
      ['saksi1_nama', 'Nama Saksi 1'],
      ['saksi2_nama', 'Nama Saksi 2'],
      ['tgl_surat', 'Tanggal Surat (pilih manual)']
    ]
  };

  const TEMPLATE_LOCKED = {
    SPORADIK: SURAT_LOCKED,
    JUALBELI: new Set(['no_surat', 'tgl_surat']),
    AHLIWARIS: new Set(['no_surat', 'tgl_surat', 'jumlah_anak_terbilang']),
    HIBAH: new Set(['no_surat', 'tgl_surat'])
  };

  const TEMPLATE_AC = {
    SPORADIK: AC_ROLES,
    JUALBELI: {
      penjual_nama: {},
      pembeli_nama: {},
      saksi1_nama: {},
      saksi2_nama: {}
    },
    AHLIWARIS: {
      almarhum_nama: {},
      pasangan_nama: {},
      nama_pemohon: {},
      saksi1_nama: {},
      saksi2_nama: {}
    },
    HIBAH: {
      pemberi_nama: { tmpl: 'pemberi_tempat_lahir', ttl: 'pemberi_tanggal_lahir', umur: 'pemberi_umur', kerja: 'pemberi_pekerjaan', alamat: 'pemberi_alamat' },
      penerima_nama: { tmpl: 'penerima_tempat_lahir', ttl: 'penerima_tanggal_lahir', umur: 'penerima_umur', kerja: 'penerima_pekerjaan', alamat: 'penerima_alamat' },
      saksi1_nama: {},
      saksi2_nama: {}
    }
  };

  const TEMPLATE_AUTOAAGE = {
    SPORADIK: { saksi1_ttl: 'saksi1_umur', saksi2_ttl: 'saksi2_umur' },
    JUALBELI: {},
    AHLIWARIS: {},
    HIBAH: { pemberi_tanggal_lahir: 'pemberi_umur', penerima_tanggal_lahir: 'penerima_umur' }
  };

  const TEMPLATE_DATE = {
    SPORADIK: ['saksi1_ttl', 'saksi2_ttl'],
    JUALBELI: [],
    AHLIWARIS: [],
    HIBAH: ['pemberi_tanggal_lahir', 'penerima_tanggal_lahir']
  };

  const TEMPLATE_TEXTAREA = {
    SPORADIK: ['saksi1_alamat', 'saksi2_alamat'],
    JUALBELI: ['penjual_alamat', 'pembeli_alamat', 'alamat_tanah'],
    AHLIWARIS: ['alamat_tanah'],
    HIBAH: ['pemberi_alamat', 'penerima_alamat', 'alamat_tanah']
  };

  async function deleteUpload(fileId) {
    if (!confirm('Hapus upload ini?')) return;
    const res = await fetch('/api/uploads/' + encodeURIComponent(fileId), { method: 'DELETE' });
    const json = await res.json();
    if (!json.success) {
      alert('Hapus gagal: ' + (json.error || ''));
      return;
    }
    await loadData();
  }

  function switchTab(name) {
    document.querySelectorAll('.tabbtn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $('tab-dashboard').hidden = name !== 'dashboard';
    $('tab-pendaftaran').hidden = name !== 'pendaftaran';
    $('tab-sporadik').hidden = name !== 'sporadik';
    $('tab-uploads').hidden = name !== 'uploads';
    $('tab-keuangan').hidden = name !== 'keuangan';
    activeTab = name;
    $('tbTitle').textContent = ({ dashboard: 'Dashboard', pendaftaran: 'Pendaftaran', sporadik: 'Surat SPORADIK', uploads: 'Uploads', keuangan: 'Keuangan' }[name] || name);
    if (name === 'pendaftaran') pageState.pendaftaran.p = 1;
    else if (name === 'sporadik') pageState.sporadik.p = 1;
    else if (name === 'uploads') pageState.uploads.p = 1;
    else if (name === 'keuangan') pageState.keuangan.p = 1;
    
    if (activeTab === 'dashboard') showTab('dashboard', renderDashboard);
    else if (activeTab === 'pendaftaran') showTab('pendaftaran', render);
    else if (activeTab === 'sporadik') {
      if ($('suratView').hidden) {
        $('sporadikPanel').hidden = false;
        showTab('sporadik', renderSporadik);
      }
    }
    else if (activeTab === 'uploads') showTab('uploads', renderUploads);
    else if (activeTab === 'keuangan') {
        // Hanya Bendahara yang melihat ringkasan/tabel; user biasa hanya Cek Tagihan & Berkas.
        updateKeuPermissions();
        if (isBendahara()) {
            Promise.all([fetchKeuanganSummary(), fetchKeuanganTransaksi()]).then(() => {
                renderKeuanganTable();
            });
        }
    }
  }

  // ============================================================
  // TAMBAH DATA — form dinamis 3 jenis surat (Hibah/JualBeli/AhliWaris)
  // ============================================================
  const TAMBAH_DUSUN = ['Kanang', 'Kanang Bendungan', 'Kanang Pulao', 'Biru', 'Eran Batu', "Pamu'tu", 'Rappoang', 'Lumalan', 'Saleko', 'Passembarang', 'Baruga', 'Tallang Bulawan', 'Penaniang', 'Tosalama'];

  // Seksi + field form Tambah Data (struktur meniru form Apps Script).
  const TAMBAH_SECTIONS = {
    pemohon: [
      { sec: '📋 Data Diri Pemohon' },
      { id: 'nama_lengkap', label: 'Nama Lengkap', req: true },
      { id: 'nik', label: 'NIK (16 digit)', req: true, digits: 16 },
      { id: 'no_hp', label: 'No HP (opsional)' },
      { id: 'alamat', label: 'Alamat Pemohon', full: true }
    ],
    HIBAH: [
      { sec: 'A. Pemberi Hibah (Pihak Pertama)' },
      { id: 'pemberi_nama', label: 'Nama Lengkap', req: true },
      { id: 'pemberi_tempat_lahir', label: 'Tempat Lahir' },
      { id: 'pemberi_tanggal_lahir', label: 'Tanggal Lahir', type: 'date' },
      { id: 'pemberi_pekerjaan', label: 'Pekerjaan' },
      { id: 'pemberi_alamat', label: 'Alamat', full: true, req: true },
      { sec: 'B. Penerima Hibah ⚡ (otomatis = Pemohon)' },
      { id: 'penerima_nama', label: 'Nama Lengkap', req: true, sync: 'nama_lengkap' },
      { id: 'penerima_tempat_lahir', label: 'Tempat Lahir' },
      { id: 'penerima_tanggal_lahir', label: 'Tanggal Lahir', type: 'date' },
      { id: 'penerima_pekerjaan', label: 'Pekerjaan' },
      { id: 'penerima_alamat', label: 'Alamat', full: true, req: true, sync: 'alamat' }
    ],
    JUALBELI: [
      { sec: '💰 Status Pembayaran' },
      { id: 'status_bayar', label: 'Status Bayar', select: ['LUNAS', 'BELUM LUNAS'] },
      { sec: 'A. Penjual (Pihak Pertama)' },
      { id: 'penjual_nama', label: 'Nama Lengkap', req: true },
      { id: 'penjual_tempat_lahir', label: 'Tempat Lahir' },
      { id: 'penjual_tanggal_lahir', label: 'Tanggal Lahir', type: 'date' },
      { id: 'penjual_pekerjaan', label: 'Pekerjaan' },
      { id: 'penjual_alamat', label: 'Alamat Lengkap', full: true, req: true },
      { sec: 'B. Pembeli (Pihak Kedua) ⚡ (otomatis = Pemohon)' },
      { id: 'pembeli_nama', label: 'Nama Lengkap', req: true, sync: 'nama_lengkap' },
      { id: 'pembeli_tempat_lahir', label: 'Tempat Lahir' },
      { id: 'pembeli_tanggal_lahir', label: 'Tanggal Lahir', type: 'date' },
      { id: 'pembeli_pekerjaan', label: 'Pekerjaan' },
      { id: 'pembeli_alamat', label: 'Alamat Lengkap', full: true, req: true, sync: 'alamat' },
      { sec: 'C. Harga Transaksi' },
      { id: 'harga_pembelian', label: 'Harga Pembelian (Rp)', price: true },
      { id: 'harga_terbilang', label: 'Terbilang', ro: true }
    ],
    AHLIWARIS: [
      { sec: 'Data Almarhum (Pihak Pertama)' },
      { id: 'almarhum_nama', label: 'Nama Almarhum', req: true },
      { id: 'pasangan_nama', label: 'Suami/Istri', req: true },
      { sec: '👨👩👧 Ahli Waris (Anak)' },
      { id: 'jumlah_anak', label: 'Jumlah Anak', type: 'number', min: 0, max: 20 },
      { id: 'jumlah_anak_terbilang', label: 'Terbilang', ro: true }
    ],
    tanah: [
      { sec: '🌍 Data Tanah' },
      { id: 'jenis_tanah', label: 'Jenis Tanah', select: ['Pekarangan', 'Kebun', 'Sawah'] },
      { id: 'luas_tanah', label: 'Luas (M²)', type: 'number' },
      { id: 'alamat_tanah', label: 'Alamat Tanah', full: true },
      { id: 'dusun', label: 'Dusun', select: TAMBAH_DUSUN },
      { id: 'tahun_pemberian', label: 'Tahun Pemberian', type: 'number' },
      { sec: '📐 Batas Tanah' },
      { id: 'batas_utara', label: 'Utara' },
      { id: 'batas_timur', label: 'Timur' },
      { id: 'batas_selatan', label: 'Selatan' },
      { id: 'batas_barat', label: 'Barat' },
      { sec: '👥 Saksi' },
      { id: 'saksi1_nama', label: 'Saksi 1' },
      { id: 'saksi2_nama', label: 'Saksi 2' }
    ]
  };

  // Slot upload per jenis layanan (mirip Apps Script).
  const TAMBAH_UPLOADS = {
    HIBAH: [
      { key: 'KK', label: '1. Kartu Keluarga (KK)' },
      { key: 'KTP PEMBERI', label: '2. KTP Pemberi Hibah' },
      { key: 'KTP PENERIMA', label: '3. KTP Penerima Hibah' }
    ],
    JUALBELI: [
      { key: 'KK', label: '1. Kartu Keluarga (KK)' },
      { key: 'KTP PENJUAL', label: '2. KTP Penjual' },
      { key: 'KTP PEMBELI', label: '3. KTP Pembeli' },
      { key: 'BUKTI BAYAR', label: '4. Bukti Bayar/Kwitansi' }
    ],
    AHLIWARIS: [
      { key: 'KK', label: '1. Kartu Keluarga (KK)' },
      { key: 'KTP AHLI WARIS', label: '2. KTP Ahli Waris' },
      { key: 'SURAT KEMATIAN', label: '3. Surat Kematian' }
    ]
  };

  let tambahLayanan = 'HIBAH';
  let tambahFilled = {}; // data pemohon yang terisi dari "Cari Pemohon"

  function tambahFieldHtml(f, val, prefix) {
    const p = prefix || 'tb_';
    const v = val == null ? '' : String(val);
    const cls = f.full ? 'field full' : 'field';
    const synced = f.sync ? ` data-sync="${f.sync}"` : '';
    const lockHint = f.sync ? '<small class="sync-hint">⚡ Otomatis mengikuti Data Pemohon</small>' : '';
    let inp;
    if (f.select) {
      inp = `<select id="${p}${f.id}"${f.sync ? ' disabled' : ''}><option value="">— Pilih —</option>` +
        f.select.map((o) => `<option value="${esc(o)}"${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('') + '</select>';
    } else {
      const type = f.type || 'text';
      const umurHint = type === 'date' ? `<span class="umur-hint" id="${p}${f.id}_umur"></span>` : '';
      const ro = (f.ro || f.sync) ? ' readonly' : '';
      const maxLen = f.digits ? ` maxlength="${f.digits}"` : '';
      const inpMode = f.digits ? ' inputmode="numeric"' : '';
      inp = `<input type="${type}" id="${p}${f.id}" value="${esc(v)}"${f.min != null ? ` min="${f.min}"` : ''}${f.max != null ? ` max="${f.max}"` : ''}${ro}${f.price ? ' data-price="1"' : ''}${maxLen}${inpMode}${f.req ? ' required' : ''}${synced}>${umurHint}`;
    }
    return `<div class="${cls}${f.sync ? ' locked' : ''}"><label>${esc(f.label)}${f.req ? ' *' : ''}</label>${inp}${lockHint}</div>`;
  }

  function tambahSeksiHtml(sections, prefix, raw) {
    const p = prefix || 'tb_';
    return sections.map((f) =>
      f.sec ? `<div class="sec-title">${esc(f.sec)}</div>` : tambahFieldHtml(f, raw ? raw[f.id] : '', p)
    ).join('');
  }

  // Perbarui hint "Umur: XX tahun" di bawah tiap input tanggal lahir (seperti SPORADIK).
  function bindTambahUmurHints(root) {
    root.querySelectorAll('input[type="date"]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const hint = $(`${inp.id}_umur`);
        if (!hint) return;
        const age = umurFromTgl(inp.value);
        hint.textContent = age ? `Umur: ${age} tahun` : '';
      });
      if (inp.value) {
        const age = umurFromTgl(inp.value);
        const hint = $(`${inp.id}_umur`);
        if (hint && age) hint.textContent = `Umur: ${age} tahun`;
      }
    });
  }

  // Field bertanda data-sync="<sumber>" otomatis mengikuti nilai Data Diri Pemohon
  // (nama_lengkap / alamat) dan dikunci (readonly) agar tidak bisa diubah sendiri.
  function wireTambahSync() { wireFormSync($('tambahBody'), 'tb_'); }

  function wireFormSync(root, prefix) {
    const syncFrom = (srcId) => {
      const src = $(`${prefix}${srcId}`);
      if (!src) return;
      root.querySelectorAll(`[data-sync="${srcId}"]`).forEach((el) => {
        el.value = src.value;
      });
    };
    ['nama_lengkap', 'alamat'].forEach((sid) => {
      const src = $(`${prefix}${sid}`);
      if (src) src.addEventListener('input', () => syncFrom(sid));
    });
    // Terapkan sekali agar nilai awal (mis. dari Cari Pemohon) tersinkron.
    ['nama_lengkap', 'alamat'].forEach(syncFrom);
  }

  // Nomor surat otomatis ala SPORADIK: pola 145-{urut}/Des.Bat/560/{bulan}/{tahun}.
  function wireTambahNomorSurat() { wireNomorSurat('tb_', $('tambahBody')); }

  function wireNomorSurat(prefix, root) {
    const noUrut = $(`${prefix}noUrut`);
    const tgl = $(`${prefix}tglSurat`);
    const hasil = $(`${prefix}nomorSurat`);
    if (!noUrut || !tgl || !hasil) return;
    // Input type=date menyimpan ISO (yyyy-MM-dd); input teks lama DD-MM-YYYY.
    const isDate = tgl.type === 'date';
    const rebuild = () => { hasil.value = buildNomorSurat(noUrut.value, isDate ? tgl.value : dmyToIso(tgl.value)); };
    const nextUrut = () => {
      let max = 0;
      rowsCache.forEach((c) => {
        const m = /145-(\d{3})\//.exec(String((c.info && c.info._nomorSuratTercetak) || ''));
        if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
      });
      return String(max + 1).padStart(3, '0');
    };
    if (!tgl.value) tgl.value = isDate ? todayISO() : isoToDmy(todayISO());
    if (!noUrut.value) noUrut.value = nextUrut();
    if (!isDate) maskDmyInput(tgl);
    noUrut.addEventListener('input', rebuild);
    tgl.addEventListener('input', rebuild);
    const btn = root.querySelector(`#${prefix}btnNoUrut`);
    if (btn) btn.addEventListener('click', () => { noUrut.value = nextUrut(); rebuild(); });
    rebuild();
  }

  function renderTambahBody() {
    const html = `
      <div class="form">
        <label>Jenis Surat <select id="tb_layanan">
          <option value="HIBAH"${tambahLayanan === 'HIBAH' ? ' selected' : ''}>HIBAH</option>
          <option value="JUALBELI"${tambahLayanan === 'JUALBELI' ? ' selected' : ''}>JUAL BELI</option>
          <option value="AHLIWARIS"${tambahLayanan === 'AHLIWARIS' ? ' selected' : ''}>AHLI WARIS</option>
        </select></label>

        <div class="form-box form-box-search">
          <h4>⚡ Cari Pemohon Sebelumnya</h4>
          <p>Ketik nama dan klik CARI untuk mengisi otomatis.</p>
          <div class="tambah-search-row">
            <input type="text" id="tb_cari" placeholder="🔍 Ketik nama pemohon…" autocomplete="off">
            <button id="tb_btnCari" class="btn" type="button">CARI</button>
          </div>
          <div id="tb_hasilCari" class="tambah-hasil"></div>
        </div>

        <div class="form-box form-box-nomor">
          <h4>📄 Nomor Surat (Otomatis)</h4>
          <p>Nomor urut diambil dari surat terakhir; bisa diubah manual. Kosongkan jika belum mau dicetak.</p>
          <div class="tambah-nomor-row">
            <div class="field"><label>Tanggal Surat</label><input type="text" id="tb_tglSurat" inputmode="numeric" maxlength="10" placeholder="DD-MM-YYYY"></div>
            <div class="field"><label>Nomor Urut (3 digit)</label><input type="text" id="tb_noUrut" inputmode="numeric" maxlength="3" placeholder="001"></div>
            <button id="tb_btnNoUrut" class="btn" type="button">🔄 Auto</button>
          </div>
          <div class="field"><label>Nomor Surat (hasil)</label>
            <input type="text" id="tb_nomorSurat" readonly></div>
        </div>

        <div class="form-box">
          <div class="field-grid">
            ${tambahSeksiHtml(TAMBAH_SECTIONS.pemohon)}
          </div>
        </div>

        <div class="form-box">
          <div class="field-grid">
            ${tambahSeksiHtml(TAMBAH_SECTIONS[tambahLayanan] || [])}
            <div id="tambahAnakWrap" class="field full"></div>
          </div>
        </div>

        <div class="form-box">
          <div class="field-grid">
            ${tambahSeksiHtml(TAMBAH_SECTIONS.tanah)}
          </div>
        </div>

        <div class="form-box form-box-upload">
          <h4>📎 Upload Dokumen (PDF / Gambar)</h4>
          <p>Maks 8 MB per file. Kosongkan jika belum ada.</p>
          ${(TAMBAH_UPLOADS[tambahLayanan] || []).map((s) =>
            `<div class="field full"><label>${esc(s.label)}</label><input type="file" data-jenis="${esc(s.key)}" accept="image/*,.pdf"></div>`
          ).join('')}
          <div class="field full"><label>Dokumen Tambahan (boleh lebih dari satu)</label><input type="file" data-jenis="DOKUMEN LAIN" accept="image/*,.pdf" multiple></div>
        </div>

        <div class="form-actions">
          <button id="btnSaveTambah" class="btn primary">💾 Simpan Data</button>
          <button id="btnBatalTambah" class="btn" type="button">Batal</button>
        </div>
      </div>`;
    $('tambahBody').innerHTML = html;
    tambahFilled = {};
    $('tb_layanan').addEventListener('change', () => { tambahLayanan = $('tb_layanan').value; renderTambahBody(); });
    $('tb_btnCari').addEventListener('click', cariPemohonTambah);
    $('tb_cari').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); cariPemohonTambah(); } });
    wireTambahSync();
    wireTambahNomorSurat();
    // NIK: hanya angka & maksimal 16 digit.
    const nik = $('tb_nik');
    if (nik) nik.addEventListener('input', () => { nik.value = nik.value.replace(/\D/g, '').slice(0, 16); });
    if (tambahLayanan === 'AHLIWARIS') {
      renderTambahAnak();
      $('tb_jumlah_anak').addEventListener('input', renderTambahAnak);
    }
    bindTambahUmurHints($('tambahBody'));
    if (tambahLayanan === 'JUALBELI') {
      const h = $('tb_harga_pembelian');
      if (h) h.addEventListener('input', () => { formatHargaInput(h); $('tb_harga_terbilang').value = terbilangHarga(h); });
    }
    $('btnSaveTambah').addEventListener('click', saveTambahData);
    $('btnBatalTambah').addEventListener('click', () => $('tambahModal').close());
  }

  function renderTambahAnak() {
    const wrap = $('tambahAnakWrap');
    if (!wrap) return;
    const n = Math.max(0, Math.min(20, parseInt($('tb_jumlah_anak')?.value || '0', 10) || 0));
    const t = $('tb_jumlah_anak_terbilang');
    if (t) t.value = n > 0 ? terbilang(n) + ' Orang' : '';
    let html = '';
    for (let i = 1; i <= n; i++) {
      html += `<div class="sec-title" style="margin-top:6px;">Anak ke-${i}</div>`;
      html += tambahFieldHtml({ id: `anak_${i}_nama`, label: 'Nama' });
      html += tambahFieldHtml({ id: `anak_${i}_tempat_lahir`, label: 'Tempat Lahir' });
      html += tambahFieldHtml({ id: `anak_${i}_tanggal_lahir`, label: 'Tanggal Lahir', type: 'date' });
      html += tambahFieldHtml({ id: `anak_${i}_pekerjaan`, label: 'Pekerjaan' });
      html += tambahFieldHtml({ id: `anak_${i}_alamat`, label: 'Alamat', full: true });
    }
    wrap.innerHTML = html;
    bindTambahUmurHints(wrap);
  }

  // ---- Cari Pemohon sebelumnya (dari rowsCache) ----
  function cariPemohonTambah() {
    const q = ($('tb_cari').value || '').trim().toLowerCase();
    const box = $('tb_hasilCari');
    if (q.length < 2) { box.innerHTML = '<p class="muted-line">Minimal 2 karakter.</p>'; return; }
    const hasil = rowsCache
      .map((e) => ({ r: e.r, info: e.info }))
      .filter((e) => {
        const nama = String(e.r.nama || '').toLowerCase();
        const hp = String(e.r.hp || '').toLowerCase();
        const nik = String(e.info.nik || '').toLowerCase();
        return nama.includes(q) || hp.includes(q) || nik.includes(q);
      })
      .slice(0, 8);
    if (!hasil.length) { box.innerHTML = '<p class="muted-line">Tidak ditemukan.</p>'; return; }
    box.innerHTML = hasil.map((e) => `
      <div class="tambah-item" data-id="${esc(e.r.id)}">
        <strong>${esc(e.r.nama)}</strong> — ${esc(layananLabel(e.r.layanan))}
        <small>${esc(e.r.id)} · 📱 ${esc(e.r.hp || '-')}${e.info.nik ? ' · 🆔 ' + esc(e.info.nik) : ''}</small>
      </div>`).join('');
    box.querySelectorAll('.tambah-item').forEach((el) =>
      el.addEventListener('click', () => isiDariPemohonTambah(el.dataset.id))
    );
  }

  function isiDariPemohonTambah(id) {
    const found = rowsCache.find((e) => e.r.id === id);
    if (!found) return;
    const info = found.info;
    // HANYA data pribadi Pemohon yang diisi ulang (Data Diri Pemohon).
    // Data tanah, saksi, dan pihak-pihak lain TIDAK ikut diisi agar tidak
    // merusak/campur data dari pendaftaran lama.
    tambahFilled = {
      nama_lengkap: info.nama_lengkap || found.r.nama,
      nik: info.nik || '',
      no_hp: info.no_hp || found.r.hp || '',
      alamat: info.alamat || ''
    };
    const set = (fid, val) => { const el = $('tb_' + fid); if (el && val != null && val !== '') el.value = val; };
    set('nama_lengkap', tambahFilled.nama_lengkap);
    set('nik', tambahFilled.nik);
    set('no_hp', tambahFilled.no_hp);
    set('alamat', tambahFilled.alamat);
    // Sinkronkan field kunci yang mengikuti Pemohon (Penerima/Penjual).
    ['nama_lengkap', 'alamat'].forEach((sid) => {
      const src = $('tb_' + sid);
      const body = $('tambahBody');
      if (src && body) body.querySelectorAll(`[data-sync="${sid}"]`).forEach((el) => { el.value = src.value; });
    });
    $('tb_hasilCari').innerHTML = `<p class="muted-line">✅ Data pribadi dari ${esc(id)} diisi. Lengkapi data lainnya.</p>`;
  }

  // ---- Format rupiah + terbilang harga ----
  function formatHargaInput(el) {
    let v = String(el.value || '').replace(/[^\d]/g, '');
    if (v) v = parseInt(v, 10).toLocaleString('id-ID');
    el.value = v;
  }
  function terbilangHarga(el) {
    const n = parseInt(String(el.value || '').replace(/\./g, ''), 10) || 0;
    if (!n) return '';
    return terbilang(n).replace(/\s*Rupiah\s*$/i, '').trim() + ' Rupiah';
  }

  async function saveTambahData() {
    const btn = $('btnSaveTambah');
    busyBtn(btn, true, 'Menyimpan…');
    try {
      const layanan = $('tb_layanan').value;
      const raw = {};

      const collect = (sections) => {
        sections.forEach((f) => {
          if (f.sec) return;
          const el = $(`tb_${f.id}`);
          if (el) raw[f.id] = el.value.trim();
        });
      };

      collect(TAMBAH_SECTIONS.pemohon);
      collect(TAMBAH_SECTIONS[layanan] || []);
      collect(TAMBAH_SECTIONS.tanah);
      const nomorSurat = $('tb_nomorSurat').value.trim();
      if (nomorSurat) {
        raw._nomorSuratTercetak = nomorSurat;
        const dupe = nomorSuratTerpakai(nomorSurat, null);
        if (dupe) throw new Error('Nomor surat ' + nomorSurat + ' sudah dipakai ' + dupe.r.id + '. Gunakan nomor lain.');
      }

      // Harga: simpan angka murni (tanpa titik ribuan).
      if (raw.harga_pembelian) raw.harga_pembelian = String(raw.harga_pembelian).replace(/\./g, '');

      if (layanan === 'AHLIWARIS') {
        const n = parseInt(raw.jumlah_anak || '0', 10) || 0;
        for (let i = 1; i <= n; i++) {
          ['nama', 'tempat_lahir', 'tanggal_lahir', 'pekerjaan', 'alamat'].forEach((k) => {
            const el = $(`tb_anak_${i}_${k}`);
            if (el) raw[`anak_${i}_${k}`] = el.value.trim();
          });
        }
      }

      const hp = raw.no_hp || '';
      if (hp && !/^08\d{8,11}$/.test(hp)) throw new Error('No. HP tidak valid (08…, 10-13 digit).');
      if (!raw.nama_lengkap) throw new Error('Nama lengkap wajib diisi.');
      const nik = (raw.nik || '').replace(/\D/g, '');
      if (nik.length !== 16) throw new Error('NIK wajib diisi tepat 16 digit angka.');
      raw.nik = nik;

      const nama = raw.nama_lengkap;
      const res = await fetch('/api/permohonan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layanan,
          nama,
          hp,
          pembayaran: raw.status_bayar || 'N/A',
          data_raw: raw,
          catatan_admin: ''
        })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Gagal menyimpan');

      const newId = json.data && json.data.id;
      // Upload lampiran per slot (jenis_upload = data-jenis).
      if (newId) {
        const slots = $('tambahBody').querySelectorAll('input[type="file"][data-jenis]');
        for (const inp of slots) {
          const jenis = inp.dataset.jenis;
          for (const f of inp.files) {
            if (f.size > 8 * 1024 * 1024) continue;
            const dataUrl = await readFileAsDataURL(f);
            await fetch(`/api/permohonan/${encodeURIComponent(newId)}/upload`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jenis_upload: jenis, fileName: f.name, fileData: dataUrl })
            });
          }
        }
      }

      $('tambahModal').close();
      await loadData();
      if (newId) switchTab('pendaftaran');
      alert('Pendaftaran berhasil disimpan. ID: ' + newId);
    } catch (e) {
      alert('Simpan gagal: ' + e.message);
    } finally {
      busyBtn(btn, false);
    }
  }

  function openTambahData() {
    tambahLayanan = 'HIBAH';
    renderTambahBody();
    $('tambahModal').showModal();
  }

  // ---- Laporan: Rekap Alamat (per dusun), Tabel Kosong, Group by NIK/Nama ----
  let rekapMode = 'alamat';
  let rekapItems = [];

  const REKAP_STATUS_LABEL = {
    PENDING: '⏳ Pending',
    DIPROSES: '🔄 Proses',
    SELESAI: '✅ Selesai',
    DITOLAK: '❌ Tolak',
    TMS: '🚫 TMS',
    SUDAH_DIUKUR: '📏 Diukur'
  };
  const REKAP_LAYANAN_LABEL = {
    HIBAH: 'Hibah',
    JUALBELI: 'Jual Beli',
    AHLIWARIS: 'Ahli Waris'
  };

  function rekapItem(r, info) {
    const dr = info;
    const dusun = (dr.dusun || '').trim() || 'Tidak Diketahui';
    const alamatTanah = dr.alamat_tanah || '-';
    const nik = dr.nik || dr.pemohon_nik || dr.nik_pihak_pertama || '-';
    const alamatPemohon = dr.alamat || dr.pemohon_alamat || dr.penerima_alamat || dr.pembeli_alamat || '-';
    const jenisTanah = dr.jenis_tanah || '-';
    const pihakPertama = dr.nama_pemberi || dr.nama_penjual || dr.almarhum_nama || dr.nama_pihak_pertama || '-';
    return {
      id: r.id,
      nama: r.nama,
      hp: r.hp,
      layanan: r.layanan,
      status: r.status_berkas,
      dusun,
      alamatTanah,
      nik,
      alamatPemohon,
      jenisTanah,
      pihakPertama
    };
  }

  function rekapSnapshot() {
    rekapItems = rowsCache.map((c) => rekapItem(c.r, c.info));
  }

  function rekapSelectDusun(selectEl, key) {
    const set = new Set();
    rekapItems.forEach((it) => set.add(it.dusun));
    const list = Array.from(set).sort();
    const opts = list.map((d) => `<option value="${esc(d)}">📍 ${esc(d)}</option>`).join('');
    selectEl.innerHTML = `<option value="all">📋 Semua Dusun</option>${opts}`;
    selectEl.addEventListener('change', () => { renderRekap(); });
  }

  function rekapFiltered() {
    const q = (($('rekapSearch') || {}).value || '').toLowerCase().trim();
    const dusun = (($('rekapFilterDusun') || {}).value || 'all');
    const jenis = (($('rekapFilterJenis') || {}).value || 'all');
    const status = (($('rekapFilterStatus') || {}).value || 'all');
    return rekapItems.filter((it) => {
      if (dusun !== 'all' && it.dusun !== dusun) return false;
      if (jenis !== 'all' && it.layanan !== jenis) return false;
      if (status !== 'all' && it.status !== status) return false;
      if (q) {
        const hay = (it.id + ' ' + it.nama + ' ' + it.hp + ' ' + it.alamatTanah + ' ' + it.alamatPemohon + ' ' + it.nik).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function statusTag(s) {
    return REKAP_STATUS_LABEL[s] || esc(s);
  }

  // Rekap Alamat: dikelompokkan per dusun (urutan terbanyak).
  function renderRekapAlamat(data) {
    const grouped = {};
    data.forEach((it) => {
      (grouped[it.dusun] = grouped[it.dusun] || []).push(it);
    });
    const sorted = Object.keys(grouped).sort((a, b) => grouped[b].length - grouped[a].length);
    const rows = sorted.map((dusun) => {
      const items = grouped[dusun];
      const rowsHtml = items.map((it, i) => `
        <tr${it.status === 'SUDAH_DIUKUR' ? ' class="rk-diukur"' : ''}>
          <td class="rk-no">${i + 1}</td>
          <td class="rk-mono"><strong>${esc(it.id)}</strong><br><small>${esc(formatHp(it.hp))}</small></td>
          <td><strong>${esc(it.nama)}</strong></td>
          <td>${esc(REKAP_LAYANAN_LABEL[it.layanan] || it.layanan)}</td>
          <td class="rk-small">${esc(it.alamatTanah)}</td>
          <td class="rk-small">${esc(it.alamatPemohon)}</td>
          <td class="rk-center">${statusTag(it.status)}</td>
        </tr>`).join('');
      return `
        <tr class="rk-group"><td colspan="7">📍 Dusun: ${esc(dusun)} (${items.length} data)</td></tr>
        ${rowsHtml}`;
    }).join('');
    $('rekapTotal').textContent = `${data.length} data • ${sorted.length} dusun`;
    return `
      <table class="rk-table">
        <thead><tr>
          <th class="rk-no">No</th><th>ID / HP</th><th>Nama Pemohon</th><th>Jenis</th>
          <th>Alamat Tanah</th><th>Alamat Pemohon</th><th class="rk-center">Status</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  // Tabel Kosong: daftar lengkap untuk pengukuran (tanpa pengelompokan).
  function renderTabelKosong(data) {
    const utama = [];
    const diukur = [];
    const ditolak = [];
    data.forEach((it) => {
      if (it.status === 'DITOLAK') ditolak.push(it);
      else if (it.status === 'SUDAH_DIUKUR') diukur.push(it);
      else utama.push(it);
    });
    const block = (items, title) => {
      if (!items.length) return '';
      const rowsHtml = items.map((it, i) => `
        <tr${it.status === 'SUDAH_DIUKUR' ? ' class="rk-diukur"' : it.status === 'DITOLAK' ? ' class="rk-tolak"' : ''}>
          <td class="rk-no">${i + 1}</td>
          <td class="rk-mono">${esc(it.id)}</td>
          <td>${esc(it.nama)}</td>
          <td>${esc(formatHp(it.hp))}</td>
          <td>${esc(it.pihakPertama)}</td>
          <td class="rk-small">${esc(it.alamatTanah)}</td>
          <td class="rk-mono">${esc(it.nik)}</td>
          <td class="rk-small">${esc(it.alamatPemohon)}</td>
          <td>${esc(it.jenisTanah)}</td>
          <td>${esc(REKAP_LAYANAN_LABEL[it.layanan] || it.layanan)}</td>
          <td class="rk-center">${statusTag(it.status)}</td>
        </tr>`).join('');
      return `<h4 class="rk-sub">${title}</h4>
        <table class="rk-table">
          <thead><tr>
            <th class="rk-no">No.</th><th>REG/ID</th><th>Nama</th><th>No. HP</th><th>Pihak Pertama</th>
            <th>Alamat Tanah</th><th>No. KTP</th><th>Alamat Pemohon</th><th>Jenis Tanah</th><th>Jenis Surat</th><th class="rk-center">Keterangan</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>`;
    };
    $('rekapTotal').textContent = `${data.length} data`;
    return block(utama, '📋 Data Aktif (Pending / Proses / Selesai)') +
           block(diukur, '📏 Sudah Diukur') +
           block(ditolak, '❌ Ditolak');
  }

  // Group by NIK/Nama: dikelompokkan berdasarkan NIK (atau nama) lalu alamat.
  function renderGroupBy(data, byNik) {
    const grouped = {};
    data.forEach((it) => {
      const key = byNik ? (it.nik && it.nik !== '-' ? it.nik : '(tanpa NIK)') : it.nama;
      (grouped[key] = grouped[key] || []).push(it);
    });
    const sortedKeys = Object.keys(grouped).sort();
    const rows = sortedKeys.map((key) => {
      const items = grouped[key];
      const rowsHtml = items.map((it, i) => `
        <tr${it.status === 'SUDAH_DIUKUR' ? ' class="rk-diukur"' : it.status === 'DITOLAK' ? ' class="rk-tolak"' : ''}>
          <td class="rk-no">${i + 1}</td>
          <td class="rk-mono">${esc(it.id)}</td>
          <td>${esc(it.nama)}</td>
          <td>${esc(formatHp(it.hp))}</td>
          <td class="rk-small">${esc(it.alamatTanah)}</td>
          <td class="rk-mono">${esc(it.nik)}</td>
          <td class="rk-small">${esc(it.alamatPemohon)}</td>
          <td>${esc(REKAP_LAYANAN_LABEL[it.layanan] || it.layanan)}</td>
          <td class="rk-center">${statusTag(it.status)}</td>
        </tr>`).join('');
      return `
        <tr class="rk-group"><td colspan="9">${byNik ? '🆔' : '🔤'} ${esc(key)} — ${items.length} data</td></tr>
        ${rowsHtml}`;
    }).join('');
    $('rekapTotal').textContent = `${data.length} data • ${sortedKeys.length} grup`;
    return `
      <table class="rk-table">
        <thead><tr>
          <th class="rk-no">No</th><th>REG/ID</th><th>Nama</th><th>No. HP</th><th>Alamat Tanah</th>
          <th>No. KTP</th><th>Alamat Pemohon</th><th>Jenis Surat</th><th class="rk-center">Status</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function renderRekap() {
    const data = rekapFiltered();
    const mode = rekapMode;
    if (!data.length) {
      $('rekapContent').innerHTML = '<p class="empty">Tidak ada data.</p>';
      $('rekapTotal').textContent = '0 data';
      return;
    }
    let html;
    if (mode === 'alamat') html = renderRekapAlamat(data);
    else if (mode === 'tabelKosong') html = renderTabelKosong(data);
    else html = renderGroupBy(data, mode === 'nik');
    $('rekapContent').innerHTML = html;
  }

  function buildRekapToolbar() {
    const t = $('rekapToolbar');
    const search = `<div class="rk-search"><i data-lucide="search" class="search-icon-inside"></i><input id="rekapSearch" type="search" placeholder="Cari nama / ID / alamat…" /></div>`;
    const dusunSel = `<select id="rekapFilterDusun"><option value="all">📋 Semua Dusun</option></select>`;
    const jenisSel = `<select id="rekapFilterJenis">
      <option value="all">Semua Jenis</option>
      <option value="HIBAH">Hibah</option>
      <option value="JUALBELI">Jual Beli</option>
      <option value="AHLIWARIS">Ahli Waris</option>
    </select>`;
    const statusSel = `<select id="rekapFilterStatus">
      <option value="all">Semua Status</option>
      ${Object.entries(REKAP_STATUS_LABEL).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
    </select>`;
    t.innerHTML = `${search}${dusunSel}${jenisSel}${statusSel}`;
    rekapSelectDusun($('rekapFilterDusun'));
    $('rekapSearch').addEventListener('input', renderRekap);
    $('rekapFilterJenis').addEventListener('change', renderRekap);
    $('rekapFilterStatus').addEventListener('change', renderRekap);
  }

  function openRekap(mode, title) {
    rekapMode = mode;
    $('rekapTitle').textContent = title;
    buildRekapToolbar();
    rekapSnapshot();
    renderRekap();
    $('rekapModal').showModal();
    if (window.lucide) window.lucide.createIcons();
  }

  function cetakRekap() {
    const content = $('rekapContent').innerHTML;
    const title = $('rekapTitle').textContent;
    const now = new Date().toLocaleString('id-ID');
    const w = window.open('', '_blank', 'width=1000,height=700');
    if (!w) { alert('Pop-up diblokir. Izinkan pop-up lalu coba lagi.'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; padding: 24px; color: #0f172a; }
        h2 { font-size: 18px; margin: 0 0 4px; }
        .rk-sub { font-size: 13px; margin: 16px 0 6px; }
        .rk-meta { font-size: 11px; color: #64748b; margin-bottom: 14px; }
        table { border-collapse: collapse; width: 100%; font-size: 11px; margin-bottom: 12px; }
        th { background: #1e293b; color: #fff; padding: 7px 6px; text-align: left; border: 1px solid #334155; }
        td { padding: 6px; border: 1px solid #cbd5e1; vertical-align: top; }
        .rk-no { width: 34px; text-align: center; }
        .rk-center { text-align: center; }
        .rk-mono { font-family: Consolas, monospace; font-size: 10.5px; }
        .rk-small { font-size: 10px; }
        tr.rk-group td { background: #eef2ff; font-weight: 700; color: #4338ca; font-size: 11.5px; }
        tr.rk-diukur td { background: #d1fae5; }
        tr.rk-tolak td { background: #fee2e2; }
        @media print { body { padding: 12px; } }
      </style></head><body>
      <h2>${esc(title)}</h2>
      <div class="rk-meta">Desa Batetangnga, Kec. Binuang, Kab. Polewali Mandar — Dicetak: ${esc(now)} · Total: ${$('rekapTotal').textContent}</div>
      ${content}
      </body></html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 300);
  }

  $('btnRefresh').addEventListener('click', loadData);
  const pageRenderers = { pendaftaran: render, sporadik: renderSporadik, uploads: renderUploads };
  const resetPage = (key) => { pageState[key].p = 1; };
  $('searchInput').addEventListener('input', () => { resetPage('pendaftaran'); render(); });
  $('filterLayanan').addEventListener('change', () => { resetPage('pendaftaran'); render(); });
  $('filterStatus').addEventListener('change', () => { resetPage('pendaftaran'); render(); });
  $('spSearch').addEventListener('input', () => { resetPage('sporadik'); renderSporadik(); });
  $('spFilterLayanan').addEventListener('change', () => { resetPage('sporadik'); renderSporadik(); });
  $('spFilterKelengkapan').addEventListener('change', () => { resetPage('sporadik'); renderSporadik(); });
  $('uploadSearch').addEventListener('input', () => { resetPage('uploads'); renderUploads(); });
  [['pagerPendaftaran', 'pendaftaran'], ['pagerSporadik', 'sporadik'], ['pagerUploads', 'uploads'], ['pagerKeuangan', 'keuangan']].forEach(([pid, key]) => {
    $(pid).addEventListener('click', (e) => {
      const btn = e.target.closest('.pg-btn');
      if (!btn || btn.disabled) return;
      const pg = parseInt(btn.dataset.pg, 10);
      if (!pg || pg < 1) return;
      pageState[key].p = pg;
      const renderer = key === 'keuangan' ? renderKeuanganTable : pageRenderers[key];
      if (renderer) renderer();
    });
  });
  $('topSearch').addEventListener('input', () => {
    const q = $('topSearch').value;
    let el = null;
    if (activeTab === 'pendaftaran') el = $('searchInput');
    else if (activeTab === 'sporadik') el = $('spSearch');
    else if (activeTab === 'uploads') el = $('uploadSearch');
    else if (activeTab === 'keuangan') el = $('keuSearchInput');
    if (!el) return;
    el.value = q;
    el.dispatchEvent(new Event('input'));
  });
  $('btnSpLoad').addEventListener('click', loadSpData);
  $('btnSpReset').addEventListener('click', resetSpForm);
  $('spLoadInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); loadSpData(); }
  });
  document.querySelectorAll('.tabbtn').forEach((b) =>
    b.addEventListener('click', () => switchTab(b.dataset.tab))
  );
  $('dataBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (action === 'view') showDetail(id);
    if (action === 'edit') openEdit(id);
  });
  $('sporadikBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (action === 'surat') cetakSporadik(id);
    else if (action === 'surat-sporadik') cetakSporadik(id, 'SPORADIK');
  });
  $('uploadBody').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del-up]');
    if (del) deleteUpload(del.dataset.delUp);
  });
  $('btnCloseModal').addEventListener('click', () => $('detailModal').close());
  $('btnCloseEdit').addEventListener('click', () => $('editModal').close());
  $('btnTambahData').addEventListener('click', openTambahData);
  $('btnCloseTambah').addEventListener('click', () => $('tambahModal').close());
  $('btnRekapAlamat').addEventListener('click', () => openRekap('alamat', 'REKAP DATA BERDASARKAN DUSUN'));
  $('btnTabelKosong').addEventListener('click', () => openRekap('tabelKosong', 'TABEL KOSONG / DAFTAR PENGUKURAN'));
  $('btnGroupByNIK').addEventListener('click', () => openRekap('nik', 'GROUP BY NIK / NAMA'));
  $('btnCloseRekap').addEventListener('click', () => $('rekapModal').close());
  $('btnCetakRekap').addEventListener('click', cetakRekap);
  $('btnBackSurat').addEventListener('click', backToSporadik);
  $('btnPrintSurat').addEventListener('click', handleCetak);
  $('btnSaveSuratEdit').addEventListener('click', handleSimpan);
  $('srTgl').addEventListener('input', renderSurat);
  maskDmyInput($('srTgl'));
  $('srNoUrut').addEventListener('input', renderSurat);
  document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => {
    if (e.target === d && d.id !== 'tambahModal') d.close();
  }));
  // Kunci pop-up Tambah Baru agar tidak tertutup oleh klik luar / tombol Esc
  // (hanya tombol Batal / ✕ yang boleh menutupnya).
  $('tambahModal').addEventListener('cancel', (e) => e.preventDefault());

  // Tutup semua dropdown autocomplete saat klik di luar field autocomplete.
  // Satu listener GLOBAL (bukan per-instance) agar tidak bocor saat editor
  // dirender ulang berkali-kali.
  document.addEventListener('mousedown', (ev) => {
    if (ev.target && ev.target.closest && ev.target.closest('.se-ac')) return;
    document.querySelectorAll('.ac-dd').forEach((el) => { if (!el.hidden) el.hidden = true; });
  });

  $('btnOpenLogin').addEventListener('click', openLogin);
  $('btnOpenLoginNotice').addEventListener('click', openLogin);
  $('btnCloseLogin').addEventListener('click', closeLogin);
  $('loginForm').addEventListener('submit', handleLogin);
  $('togglePassword').addEventListener('click', togglePassword);
  $('btnCloseChangePw').addEventListener('click', closeChangePw);
  $('changePwForm').addEventListener('submit', handleChangePw);
  $('toggleCpNew').addEventListener('click', () => {
    const inp = $('cpNew');
    if (!inp) return;
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    const btn = $('toggleCpNew');
    if (btn && window.lucide) {
      const ic = document.createElement('i');
      ic.setAttribute('data-lucide', show ? 'eye-off' : 'eye');
      ic.style.cssText = 'width:17px;height:17px;';
      btn.replaceChildren(ic);
      window.lucide.createIcons();
    }
  });

  initAuth();
  initKeuangan();
  setInterval(() => { if (isAuthed) loadData(); }, 30000);

})();