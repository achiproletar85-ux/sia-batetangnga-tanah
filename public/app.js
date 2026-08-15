(() => {
  let allData = [];
  let uploads = [];
  let keuState = [];
  let pemohonCache = [];
  let currentEditId = null;
  let rowsCache = [];
  let activeTab = 'dashboard';
  let curFp = '0';
  const renderedFp = {};
  let supabaseClient = null;

  const $ = (id) => document.getElementById(id);

  async function initAppConfig() {
    try {
      const res = await fetch('/api/config');
      const config = await res.json();
      if (config.success && config.supabaseUrl && config.supabaseAnonKey) {
        supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
        console.log('Supabase client initialized for frontend.');
      } else {
        console.error('Failed to get frontend Supabase config:', config.error);
      }
    } catch (e) {
      console.error('Error fetching app config:', e);
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
      try {
        const res = await fetch(`/api/keuangan/transaksi/${id}`, { method: 'DELETE' });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        closeTrxModal();
        await Promise.all([fetchKeuanganSummary(), fetchKeuanganTransaksi()]);
        renderKeuanganTable();
      } catch(e) {
        alert(`Gagal menghapus: ${e.message}`);
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
        <td><button class="btn" data-id="${esc(t.id)}">✏️ Edit</button></td>
      `;
      frag.appendChild(tr);
    });
    body.appendChild(frag);
    drawPager('pagerKeuangan', 'keuangan', filtered.length);
  }

  function openTrxModal(trx) {
    const m = $('trxModal');
    $('trxForm').reset();
    $('trxId').value = '';
    $('trxBuktiPreview').innerHTML = '';
    $('trxUploadProgress').style.display = 'none';
    $('btnDeleteTrx').style.display = 'none';

    if (trx) {
      $('trxModalTitle').textContent = 'Edit Transaksi';
      $('trxId').value = trx.id;
      $('trxTanggal').value = new Date(trx.tanggal).toISOString().split('T')[0];
      $('trxJenis').value = trx.jenis_transaksi;
      $('trxIdPemohon').value = trx.id_permohonan || '';
      $('trxNominal').value = trx.nominal;
      $('trxKeterangan').value = trx.keterangan || '';
      if (trx.url_bukti) {
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
    if (!supabaseClient) {
      alert('Klien Supabase belum siap. Coba lagi sebentar.');
      return;
    }

    const btn = $('btnSaveTrx');
    btn.disabled = true;
    btn.textContent = 'Menyimpan...';

    try {
      const id = $('trxId').value;
      const fileInput = $('trxBukti');
      const file = fileInput.files[0];
      let fileUrl = null;

      if (file) {
        const progress = $('trxUploadProgress');
        progress.style.display = 'block';
        progress.value = 0;
        
        const fileName = `public/${Date.now()}-${file.name}`;
        const { data, error } = await supabaseClient.storage
          .from('bukti_transaksi')
          .upload(fileName, file, {
            cacheControl: '3600',
            upsert: false
          });

        if (error) throw new Error(`Gagal upload bukti: ${error.message}`);
        
        const { data: { publicUrl } } = supabaseClient.storage.from('bukti_transaksi').getPublicUrl(data.path);
        fileUrl = publicUrl;
        progress.value = 100;
      }

      const payload = {
        tanggal: $('trxTanggal').value,
        jenis_transaksi: $('trxJenis').value,
        id_permohonan: $('trxJenis').value === 'Pemasukan Cicilan' ? $('trxIdPemohon').value : null,
        nominal: parseInt($('trxNominal').value, 10),
        keterangan: $('trxKeterangan').value,
        url_bukti: fileUrl,
      };
      
      // If we have a file, we overwrite the old url. If not, we need to preserve it on edit.
      if (!fileUrl && id) {
        const oldTrx = keuState.find(t => t.id === id);
        payload.url_bukti = oldTrx ? oldTrx.url_bukti : null;
      }

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
      btn.disabled = false;
      btn.textContent = 'Simpan';
      $('trxUploadProgress').style.display = 'none';
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
    if ($('displayUserName')) $('displayUserName').textContent = (user && user.name) || 'Admin Desa';
    if ($('btnOpenLogin')) $('btnOpenLogin').style.display = 'none';
    if ($('btnOpenLoginNotice')) $('btnOpenLoginNotice').style.display = 'none';
    if ($('userProfileNav')) $('userProfileNav').style.display = 'flex';
    if ($('authGuestNotice')) $('authGuestNotice').style.display = 'none';
    if ($('appWorkspace')) $('appWorkspace').style.display = '';
    document.body.classList.remove('guest-mode');
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
    if (btn) btn.disabled = true;
    try {
      const res = await fetch('/api/import-from-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheet: 'ALL' })
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error((j && j.error) || 'Gagal import dari spreadsheet.');
      const parts = (j.tables || []).map((t) => t.sheet + ': ' + t.upserted + '/' + t.received + ' baris');
      alert('Import selesai.\n' + parts.join('\n') + '\nTotal tersimpan: ' + j.totalUpserted + ' baris.');
      await loadData();
    } catch (e) {
      alert('Import gagal: ' + (e && e.message));
    } finally {
      if (btn) btn.disabled = false;
    }
  }
  window.importFromSheet = importFromSheet;

  async function initAuth() {
    const sess = getSession();
    await initAppConfig(); // Panggil konfigurasi dulu
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
      // Sidik data murah (hash isi id+updated_at) agar render ulang tab bisa
      // di-skip saat data tidak berubah — kunci untuk mencegah "berat".
      let h = 2166136261;
      allData.forEach((r) => {
        h ^= String(r.id || '');
        h = (h * 16777619) | 0;
        h ^= String(r.updated_at || r.last_updated || '');
        h = (h * 16777619) | 0;
        h |= 0;
      });
      curFp = allData.length + ':' + uploads.length + ':' + (h >>> 0);
      renderCurrent();
    } catch (e) {
      setConn(false, '❌ Gagal ambil data: ' + e.message);
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
    const fill = fillSporadik(r, info);
    return Object.keys(SPORADIK_CORE)
      .filter((k) => !String(fill[k] ?? '').trim())
      .map((k) => SPORADIK_CORE[k]);
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
    const fill = fillSporadik(r, info);
    return Object.keys(SPORADIK_REQUIRED)
      .map((k) => ({ key: k, label: SPORADIK_REQUIRED[k] }))
      .filter((f) => !String(fill[f.key] ?? '').trim())
      .map((f) => f.label);
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
        <td><strong>${esc(r.id)}</strong> ${upCount ? `<span class="tag status-s" title="${upCount} upload">📎${upCount}</span>` : ''}</td>
        <td><span class="tag ${esc(r.layanan)}">${esc(r.layanan)}</span></td>
        <td><strong>${esc(r.nama)}</strong></td>
        <td>${esc(formatHp(r.hp))}</td>
        <td>${esc(r.pembayaran)}</td>
        <td>${esc(info.jenis_tanah || info.luas_tanah || '')}</td>
        <td><span class="tag status-s">${esc(r.status_berkas)}</span></td>
        <td>${esc(info._adminLast)}</td>
        <td>
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
        <td><strong>${esc(r.id)}</strong></td>
        <td><span class="tag ${esc(r.layanan)}">${esc(r.layanan)}</span></td>
        <td><strong>${esc(r.nama)}</strong></td>
        <td>${esc(info.jenis_tanah || info.luas_tanah || '')}</td>
        <td>${badgeHtml}</td>
        <td>${statusBadge(r.status_berkas)}</td>
        <td class="sp-catatan">${esc(r.catatan_admin || '')}</td>
        <td>
          <button class="btn primary" data-action="surat" data-id="${esc(r.id)}">🖨 SPORADIK</button>
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
        <td><strong>${esc(u.id_registrasi)}</strong></td>
        <td><span class="tag status-s">${esc(u.jenis_upload)}</span></td>
        <td class="wrap">${esc(u.file_name)}</td>
        <td>${esc(u.timestamp)}</td>
        <td>
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
    $('editStatus').value = r.status_berkas || '';
    $('editCatatan').value = r.catatan_admin || '';
    $('editModal').showModal();
  }

  async function saveEdit() {
    if (!currentEditId) return;
    const btn = $('btnSaveEdit');
    btn.disabled = true;
    try {
      const res = await fetch('/api/permohonan/' + encodeURIComponent(currentEditId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status_berkas: $('editStatus').value,
          catatan_admin: $('editCatatan').value
        })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Gagal simpan');
      $('editModal').close();
      await loadData();
    } catch (e) {
      alert('Simpan gagal: ' + e.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function deleteRow() {
    if (!currentEditId) return;
    if (!confirm('Hapus pendaftaran ' + currentEditId + ' dari Supabase?')) return;
    const res = await fetch('/api/permohonan/' + encodeURIComponent(currentEditId), { method: 'DELETE' });
    const json = await res.json();
    if (!json.success) {
      alert('Hapus gagal: ' + (json.error || ''));
      return;
    }
    $('editModal').close();
    await loadData();
  }

  let currentSurat = null;

  async function cetakSporadik(id) {
    const c = rowsCache.find((x) => x.r.id === id);
    if (!c) return;
    const { r, info } = c;
    currentSurat = {
      r, info,
      fill: fillSporadik(r, info),
      missing: sporadikMissing(info, r)
    };

    $('suratIdLine').innerHTML = 'ID: ' + escFill(id) + ' | Layanan: ' + escFill(r.layanan) + ' | Nama: <b>' + escFill(r.nama || '') + '</b>';
    // Isi kontrol manual tanggal & nomor urut dari data tersimpan bila ada.
    $('srTgl').value = toISODate(info._tglCetakSurat || info._tglSurat);
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

    if (!skipStatus) {
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

    const reqKeys = Object.keys(SPORADIK_REQUIRED);
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
    const role = AC_ROLES[roleKey] || {};
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
    let editableCount = 0;
    const rows = SPORADIK_FIELD_LABELS.map(([key, label]) => {
      if (key === 'tgl_surat') return ''; // diatur lewat kontrol Tanggal Surat.
      const val = String(st.fill[key] ?? '');
      // Nama & Umur Saksi serta Tempat Lahir selalu bisa diisi/diedit (tidak terkunci).
      const forceEditable = key === 'saksi1_nama' || key === 'saksi2_nama' ||
                            key === 'saksi1_umur' || key === 'saksi2_umur' ||
                            key === 'saksi1_tmpl' || key === 'saksi2_tmpl';
      const locked = SURAT_LOCKED.has(key) || (!forceEditable && val.trim() !== '');
      const rawKey = locked ? '' : (SURAT_RAW[key] ? SURAT_RAW[key](P) : key);
      if (!locked) editableCount++;
      // Klasifikasi visual field (hanya tampilan — logika & cetak tidak berubah):
      //  - se-ac    : field nama dengan autocomplete (🔍 Cari Data)
      //  - se-auto  : field otomatis / auto-fill (⚡ Otomatis)
      //  - se-manual: field isian manual standar (putih, placeholder bantuan)
      const isAcName = key === 'nama_pihak_pertama' || key === 'pihak_kedua' ||
                       key === 'saksi1_nama' || key === 'saksi2_nama';
      const isAutoField = key === 'saksi1_ttl' || key === 'saksi2_ttl' ||
                          key === 'saksi1_umur' || key === 'saksi2_umur' ||
                          key === 'saksi1_tmpl' || key === 'saksi2_tmpl';
      const isManualField = key === 'pekerjaan_pihak_pertama' || key === 'alamat_pihak_pertama' ||
                            key === 'saksi1_pekerjaan' || key === 'saksi2_pekerjaan' ||
                            key === 'saksi1_alamat' || key === 'saksi2_alamat';
      const variant = isAcName ? 'ac' : (isAutoField ? 'auto' : (isManualField ? 'manual' : ''));
      const chip = isAcName ? '🔍 Cari Data' : (isAutoField ? '⚡ Otomatis' : '');
      const placeholder = isAcName ? 'Ketik Nama untuk Cari Data Warga...' : (isManualField ? 'Isi manual...' : '');
      // TTL Saksi diperlakukan sebagai input tanggal agar Umur bisa dihitung otomatis.
      const isSaksiTtl = key === 'saksi1_ttl' || key === 'saksi2_ttl';
      const autoAge = key === 'saksi1_ttl' ? 'saksi1_umur' : (key === 'saksi2_ttl' ? 'saksi2_umur' : '');
      const isAlamatSaksi = key === 'saksi1_alamat' || key === 'saksi2_alamat';
      const isTextarea = isAlamatSaksi;
      return `
        <label class="se-field${locked ? ' locked' : ''}${variant ? ' se-' + variant : ''}">
          <span>${chip ? chip + ' · ' : ''}${esc(label)}</span>
          ${isTextarea
            ? `<textarea data-fill-key="${key}" data-raw-key="${rawKey}" rows="3" ${placeholder && !locked ? 'placeholder="' + placeholder + '"' : ''} ${locked ? 'readonly title="Terkunci (sudah terisi / otomatis)"' : ''}>${esc(val)}</textarea>`
            : `<input type="${isSaksiTtl ? 'date' : 'text'}" data-fill-key="${key}" data-raw-key="${rawKey}"
             ${autoAge ? 'data-auto-age="' + autoAge + '"' : ''}
             ${placeholder && !locked ? 'placeholder="' + placeholder + '"' : ''}
             value="${esc(val)}" ${locked ? 'readonly title="Terkunci (sudah terisi / otomatis)"' : ''} />`}
        </label>`;
    }).join('');
    fieldsEl.innerHTML = rows;
    fieldsEl.querySelectorAll('input, textarea').forEach((inp) => {
      inp.addEventListener('input', () => {
        const fk = inp.dataset.fillKey;
        currentSurat.fill[fk] = inp.value;
        if (inp.dataset.rawKey) currentSurat.info[inp.dataset.rawKey] = inp.value;
        // Tanggal lahir Saksi terisi → Umur dihitung & diisi otomatis.
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
        renderSurat();
      });
    });
    // Autocomplete Master Warga pada field nama (hanya yang masih bisa diketik).
    Object.keys(AC_ROLES).forEach((key) => {
      const nameInp = fieldsEl.querySelector('input[data-fill-key="' + key + '"]');
      if (nameInp) attachCitizenAc(nameInp, key);
    });
    // Bila TTL Saksi sudah berisi tanggal tapi Umur masih kosong, isi otomatis.
    ['saksi1', 'saksi2'].forEach((p) => {
      const ttlInp = fieldsEl.querySelector('input[data-fill-key="' + p + '_ttl"]');
      const umrInp = fieldsEl.querySelector('input[data-fill-key="' + p + '_umur"]');
      if (ttlInp && umrInp && !String(umrInp.value).trim() && umrInp.dataset.rawKey) {
        const age = umurFromTgl(ttlInp.value);
        if (age) {
          umrInp.value = age;
          currentSurat.fill[p + '_umur'] = age;
          currentSurat.info[umrInp.dataset.rawKey] = age;
        }
      }
    });
    $('btnSaveSuratEdit').hidden = editableCount === 0;
  }

  // Simpan perubahan data surat (semua input yang tidak terkunci).
  async function saveSuratEdit() {
    const id = currentSurat && currentSurat.r && currentSurat.r.id;
    if (!id) return;
    const btn = $('btnSaveSuratEdit');
    btn.disabled = true;
    // Kumpulkan nilai dari semua input editor yang BISA diisi (tidak readonly).
    const raw = {};
    $('suratEditFields').querySelectorAll('input:not([readonly]), textarea:not([readonly])').forEach((inp) => {
      const rk = inp.dataset.rawKey;
      if (rk && String(inp.value).trim()) raw[rk] = inp.value;
    });
    // Nomor surat & tanggal ikut tersimpan agar bisa dipulihkan di lain hari.
    const noSurat = $('srNoSurat').value;
    if (noSurat) raw._nomorSuratTercetak = noSurat;
    const tgl = $('srTgl').value;
    if (tgl) raw._tglCetakSurat = tgl;
    try {
      const res = await fetch('/api/permohonan/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data_raw: raw })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Gagal simpan');
      // Data yang baru disimpan otomatis masuk ke "Master Warga" (dipakai ulang).
      if (currentSurat && currentSurat.fill) {
        registerCitizens(currentSurat.fill);
        saveManualCitizens();
      }
      await loadData();
      // Muat ulang data surat yang baru disimpan agar editor & pratinjau sinkron.
      const c2 = rowsCache.find((x) => x.r.id === id);
      if (c2) {
        currentSurat = {
          r: c2.r, info: c2.info,
          fill: fillSporadik(c2.r, c2.info),
          missing: sporadikMissing(c2.info, c2.r)
        };
        $('srTgl').value = toISODate(c2.info._tglCetakSurat || c2.info._tglSurat);
        $('srNoUrut').value = (String(c2.info._nomorSuratTercetak || '').match(/145-(\d{3})\//) || [])[1] || '';
        $('srNoSurat').value = '';
        renderSuratEditor();
        renderSurat();
      }
    } catch (e) {
      alert('Simpan gagal: ' + e.message);
    } finally {
      btn.disabled = false;
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
    const tglISO = $('srTgl').value;
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
    $('suratEditFields').querySelectorAll('input').forEach((inp) => {
      const key = inp.dataset.fillKey;
      if (key && inp.value !== String(f[key] ?? '')) inp.value = String(f[key] ?? '');
    });

    // Status kelengkapan field wajib.
    const reqKeys = Object.keys(SPORADIK_REQUIRED);
    const missing = reqKeys.filter((k) => !String(f[k] ?? '').trim());
    const filledCnt = reqKeys.length - missing.length;
    $('seStatus').textContent = missing.length
      ? `⚠️ ${filledCnt} dari ${reqKeys.length} field wajib terisi. Isi field yang masih kosong di kiri, lalu klik "💾 Simpan Data".`
      : `✅ Semua ${reqKeys.length} field wajib terisi — surat siap dicetak.`;

    renderSporadikPreview(f);
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
        // Fetch and render, but don't use showTab memoization for finance data
        // to ensure it's always fresh when tab is opened.
        Promise.all([fetchKeuanganSummary(), fetchKeuanganTransaksi()]).then(() => {
            renderKeuanganTable();
        });
    }
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
  });
  $('uploadBody').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del-up]');
    if (del) deleteUpload(del.dataset.delUp);
  });
  $('btnSaveEdit').addEventListener('click', saveEdit);
  $('btnDelete').addEventListener('click', deleteRow);
  $('btnCloseModal').addEventListener('click', () => $('detailModal').close());
  $('btnCloseEdit').addEventListener('click', () => $('editModal').close());
  $('btnBackSurat').addEventListener('click', backToSporadik);
  $('btnPrintSurat').addEventListener('click', handleCetak);
  $('btnSaveSuratEdit').addEventListener('click', handleSimpan);
  $('srTgl').addEventListener('input', renderSurat);
  $('srNoUrut').addEventListener('input', renderSurat);
  document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  }));

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