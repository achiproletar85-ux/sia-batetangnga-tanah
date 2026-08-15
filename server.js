// Aplikasi sync-surat-tanah — server Express (Supabase sebagai sumber data).
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const supabase = require('./src/supabase');

const app = express();
const PORT = parseInt(process.env.PORT || '3344', 10);
const TABLE_DB = 'permohonan_surat_tanah';
const TABLE_UP = 'permohonan_uploads';
const TABLE_TRX = 'transaksi_keuangan';
const TABLE_SET = 'pengaturan_app';

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res) {
    // Jangan simpan aset di cache agar tiap edit CSS/JS langsung terlihat (termasuk hasil cetak PDF).
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  },
}));

// ---------- Autentikasi User (session token) ----------
const AUTH_USER = process.env.ADMIN_USER || 'admin';
const AUTH_PASS = process.env.ADMIN_PASS || 'admin123';
const AUTH_NAME = process.env.ADMIN_NAME || 'Admin Desa';
const AUTH_SECRET = process.env.SESSION_SECRET || 'sia-batetangnga-session-secret';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 jam
const TABLE_USERS = 'app_users';
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);
const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1;

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const buf = await scrypt(String(pw), salt, 32, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return salt + ':' + buf.toString('base64url');
}
async function verifyPassword(pw, stored) {
  try {
    const parts = String(stored || '').split(':');
    if (parts.length !== 2) return false;
    const buf = await scrypt(String(pw), parts[0], 32, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
    return parts[1] === buf.toString('base64url');
  } catch (_) { return false; }
}

// Sumber kebenaran kredensial: tabel app_users di Supabase (persisten utk hosting),
// dengan fallback ke variabel env bila tabel belum dibuat.
async function getAdminRecord() {
  try {
    const { data, error } = await supabase.from(TABLE_USERS).select('*').eq('id', 1).maybeSingle();
    if (error) return null;
    return data || null;
  } catch (_) { return null; }
}
async function upsertAdminRecord({ username, name, password_hash }) {
  const rec = { id: 1, username, name, password_hash, updated_at: new Date().toISOString() };
  const { error } = await supabase.from(TABLE_USERS).upsert(rec, { onConflict: 'id' });
  if (error) throw new Error(error.message);
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function verifyToken(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) return null;
    const expect = crypto.createHmac('sha256', AUTH_SECRET).update(parts[0]).digest('base64url');
    if (parts[1] !== expect) return null;
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch (_) { return null; }
}
function authTokenFromReq(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}
function requireAuth(req, res, next) {
  const payload = verifyToken(authTokenFromReq(req));
  if (!payload) {
    return res.status(401).json({ success: false, error: 'Unauthorized — silakan login terlebih dahulu.' });
  }
  req.auth = payload;
  next();
}

// ---------- Helper import dari spreadsheet (manual, read-only via GAS) ----------
function rowGet(row, ...names) {
  const lk = {};
  for (const k of Object.keys(row)) lk[String(k).trim().toLowerCase()] = row[k];
  for (const n of names) {
    if (lk[String(n).toLowerCase()] !== undefined) return lk[String(n).toLowerCase()];
  }
  return undefined;
}
function clean(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}
function parseDataRaw(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch (_) { return { __raw: s }; }
}
const RAW_KNOWN = ['ID', 'TIMESTAMP', 'LAYANAN', 'NAMA', 'HP', 'PEMBAYARAN', 'STATUS_BERKAS', 'CATATAN_ADMIN', 'LAST_UPDATED', 'DATA_RAW'];
function restToRaw(row) {
  const o = {};
  for (const k of Object.keys(row)) {
    if (RAW_KNOWN.includes(String(k).trim().toUpperCase())) continue;
    const v = row[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') o[k] = v;
  }
  return Object.keys(o).length ? o : null;
}

app.post('/api/login', async (req, res) => {
  const u = String(req.body && req.body.username || '').trim();
  const p = String(req.body && req.body.password || '');
  let matched = false, name = AUTH_NAME;
  const rec = await getAdminRecord();
  if (rec && rec.password_hash) {
    const ok = await verifyPassword(p, rec.password_hash);
    if (ok && u === (rec.username || AUTH_USER)) { matched = true; name = rec.name || AUTH_NAME; }
  } else if (u === AUTH_USER && p === AUTH_PASS) {
    matched = true;
    // Migrasi awal: semai kredensial env ke tabel app_users (untuk fitur ubah sandi).
    hashPassword(p).then((h) => upsertAdminRecord({ username: u, name: AUTH_NAME, password_hash: h })).catch(() => {});
  }
  if (!matched) {
    return res.status(401).json({ success: false, error: 'Username atau kata sandi salah.' });
  }
  const token = signToken({ username: u, name, exp: Date.now() + SESSION_TTL_MS });
  res.json({ success: true, token, user: { username: u, name } });
});

app.get('/api/me', (req, res) => {
  const payload = verifyToken(authTokenFromReq(req));
  if (!payload) return res.status(401).json({ success: false, error: 'Sesi tidak valid.' });
  res.json({ success: true, user: { username: payload.username, name: payload.name } });
});

app.get('/api/config', (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ success: false, error: 'Konfigurasi Supabase (URL atau Anon Key) tidak ditemukan di server.' });
  }
  res.json({ success: true, supabaseUrl, supabaseAnonKey });
});

app.post('/api/logout', (req, res) => {
  res.json({ success: true });
});

app.post('/api/change-password', requireAuth, async (req, res) => {
  try {
    const current = String(req.body && req.body.current_password || '');
    const next = String(req.body && req.body.new_password || '');
    if (!current) return res.status(400).json({ success: false, error: 'Kata sandi lama wajib diisi.' });
    if (String(next).length < 6) {
      return res.status(400).json({ success: false, error: 'Kata sandi baru minimal 6 karakter.' });
    }
    if (next === current) {
      return res.status(400).json({ success: false, error: 'Kata sandi baru tidak boleh sama dengan kata sandi lama.' });
    }
    const rec = await getAdminRecord();
    let ok = false;
    if (rec && rec.password_hash) {
      ok = await verifyPassword(current, rec.password_hash);
    } else if (current === AUTH_PASS) {
      ok = true;
    }
    if (!ok) return res.status(401).json({ success: false, error: 'Kata sandi lama salah.' });
    const hash = await hashPassword(next);
    await upsertAdminRecord({ username: req.auth.username || AUTH_USER, name: req.auth.name || AUTH_NAME, password_hash: hash });
    res.json({ success: true, message: 'Kata sandi berhasil diperbarui.' });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: 'Gagal menyimpan kata sandi. Pastikan tabel app_users sudah dibuat di Supabase (' + TABLE_USERS + ').'
    });
  }
});

// ---------- API: Database_Pendaftaran ----------

app.get('/api/permohonan', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from(TABLE_DB)
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/permohonan/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from(TABLE_DB)
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Tidak ditemukan.' });
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.patch('/api/permohonan/:id', requireAuth, async (req, res) => {
  try {
    const { status_berkas, catatan_admin, data_raw } = req.body || {};
    const payload = { updated_at: new Date().toISOString() };
    if (status_berkas !== undefined) payload.status_berkas = status_berkas;
    if (catatan_admin !== undefined) payload.catatan_admin = catatan_admin;

    // Merge data_raw: ambil yang sudah ada lalu gabung field baru yang dikirim.
    if (data_raw && typeof data_raw === 'object') {
      const { data: cur } = await supabase
        .from(TABLE_DB)
        .select('data_raw')
        .eq('id', req.params.id)
        .maybeSingle();
      let base = {};
      if (cur && cur.data_raw) {
        try { base = typeof cur.data_raw === 'string' ? JSON.parse(cur.data_raw) : cur.data_raw; } catch (_) {}
      }
      payload.data_raw = JSON.stringify(Object.assign({}, base, data_raw));
    }

    const { data, error } = await supabase
      .from(TABLE_DB)
      .update(payload)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/permohonan/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from(TABLE_DB).delete().eq('id', req.params.id).select();
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---------- API: Uploads ----------

app.get('/api/uploads', requireAuth, async (req, res) => {
  try {
    const { id_registrasi } = req.query;
    let query = supabase.from(TABLE_UP).select('*').order('timestamp', { ascending: true });
    if (id_registrasi) query = query.eq('id_registrasi', id_registrasi);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/uploads/:fileId', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from(TABLE_UP)
      .select('*')
      .eq('file_id', req.params.fileId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Tidak ditemukan.' });
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/uploads/:fileId', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from(TABLE_UP).delete().eq('file_id', req.params.fileId).select();
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---------- Import manual dari spreadsheet (read-only via GAS web app) ----------
// Panggil GAS action=getRows, lalu upsert baris ke Supabase.
app.post('/api/import-from-sheet', requireAuth, async (req, res) => {
  try {
    const gasUrl = process.env.GAS_SYNC_WEB_APP_URL;
    if (!gasUrl) {
      return res.status(500).json({ success: false, error: 'GAS_SYNC_WEB_APP_URL belum diatur di .env' });
    }
    const sheet = String((req.body && req.body.sheet) || 'ALL');
    const sheets = sheet === 'ALL' ? ['Database_Pendaftaran', 'Uploads'] : [sheet];

    // Upsert dalam potongan besar (bukan baris per baris) agar cepat &
    // tidak melewati batas waktu fungsi di Vercel.
    const CHUNK = 200;
    async function upsertChunks(table, recs, onConflict) {
      let n = 0;
      for (let i = 0; i < recs.length; i += CHUNK) {
        const slice = recs.slice(i, i + CHUNK);
        const { error } = await supabase.from(table).upsert(slice, { onConflict });
        if (error) throw error;
        n += slice.length;
      }
      return n;
    }

    const results = [];
    for (const s of sheets) {
      const gasRes = await fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getRows', sheet: s, token: process.env.GAS_SYNC_TOKEN || '' })
      });
      const j = await gasRes.json();
      if (!j || !j.success) {
        throw new Error('GAS menolak tab "' + s + '": ' + ((j && j.error) || 'unknown error'));
      }
      const rows = Array.isArray(j.rows) ? j.rows : [];
      let upserted = 0;

      if (s.toLowerCase().includes('upload')) {
        const recs = [];
        for (const r of rows) {
          const file_id = clean(rowGet(r, 'FILE_ID', 'file_id', 'ID', 'id'));
          if (!file_id) continue;
          recs.push({
            id_registrasi: clean(rowGet(r, 'ID_REGISTRASI', 'id_registrasi')) || '',
            jenis_upload: clean(rowGet(r, 'JENIS_UPLOAD', 'jenis_upload')),
            file_name: clean(rowGet(r, 'FILE_NAME', 'file_name', 'NAMA_FILE', 'nama_file')),
            file_url: clean(rowGet(r, 'FILE_URL', 'file_url')),
            file_id: file_id,
            timestamp: clean(rowGet(r, 'TIMESTAMP', 'timestamp')),
            updated_at: new Date().toISOString()
          });
        }
        upserted = await upsertChunks(TABLE_UP, recs, 'file_id');
      } else {
        const recs = [];
        for (const r of rows) {
          const id = clean(rowGet(r, 'ID', 'id'));
          if (!id) continue;
          const data_raw = parseDataRaw(rowGet(r, 'DATA_RAW', 'data_raw')) || restToRaw(r);
          recs.push({
            id: id,
            timestamp: clean(rowGet(r, 'TIMESTAMP', 'timestamp')),
            layanan: clean(rowGet(r, 'LAYANAN', 'layanan')),
            nama: clean(rowGet(r, 'NAMA', 'nama')),
            hp: clean(rowGet(r, 'HP', 'hp', 'NO_HP', 'no_hp')),
            pembayaran: clean(rowGet(r, 'PEMBAYARAN', 'pembayaran')),
            data_raw: data_raw,
            status_berkas: clean(rowGet(r, 'STATUS_BERKAS', 'status_berkas', 'STATUS', 'status')),
            catatan_admin: clean(rowGet(r, 'CATATAN_ADMIN', 'catatan_admin')),
            last_updated: clean(rowGet(r, 'LAST_UPDATED', 'last_updated')),
            updated_at: new Date().toISOString()
          });
        }
        upserted = await upsertChunks(TABLE_DB, recs, 'id');
      }
      results.push({ sheet: s, received: rows.length, upserted });
    }

    res.json({
      success: true,
      tables: results,
      totalUpserted: results.reduce((a, b) => a + b.upserted, 0)
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---------- API: Keuangan ----------

// Helper untuk mengambil pengaturan dari tabel pengaturan_app
async function getPengaturan(kunci, nilaiDefault = null) {
  const { data, error } = await supabase.from(TABLE_SET).select('nilai').eq('kunci', kunci).maybeSingle();
  if (error || !data) return nilaiDefault;
  return data.nilai;
}

// GET /api/pemohon/:id/keuangan -> Rincian keuangan untuk satu pemohon
app.get('/api/pemohon/:id/keuangan', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: trxData, error: trxError } = await supabase
      .from(TABLE_TRX)
      .select('nominal')
      .eq('id_permohonan', id)
      .eq('jenis_transaksi', 'Pemasukan Cicilan');

    if (trxError) throw trxError;

    const totalTerbayar = trxData.reduce((sum, row) => sum + row.nominal, 0);
    const biayaTotalStr = await getPengaturan('biaya_total_sertifikat', '250000');
    const biayaTotal = parseInt(biayaTotalStr, 10);
    const sisaTagihan = Math.max(0, biayaTotal - totalTerbayar);

    res.json({
      success: true,
      data: {
        id_permohonan: id,
        biaya_total: biayaTotal,
        total_terbayar: totalTerbayar,
        sisa_tagihan: sisaTagihan,
        status_lunas: sisaTagihan <= 0,
      }
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


// GET /api/keuangan/ringkasan -> Ringkasan total keuangan
app.get('/api/keuangan/ringkasan', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from(TABLE_TRX).select('jenis_transaksi, nominal');
    if (error) throw error;

    let totalPemasukan = 0;
    let totalPengeluaran = 0;

    for (const row of data) {
      if (row.jenis_transaksi.includes('Pemasukan')) {
        totalPemasukan += row.nominal;
      } else if (row.jenis_transaksi === 'Pengeluaran') {
        totalPengeluaran += row.nominal;
      }
    }

    res.json({
      success: true,
      data: {
        total_pemasukan: totalPemasukan,
        total_pengeluaran: totalPengeluaran,
        saldo_akhir: totalPemasukan - totalPengeluaran,
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/keuangan/transaksi -> Daftar semua transaksi dengan filter
app.get('/api/keuangan/transaksi', requireAuth, async (req, res) => {
  try {
    const { order = 'desc', id_permohonan } = req.query;
    let query = supabase.from(TABLE_TRX)
      .select('*, permohonan_surat_tanah(nama)')
      .order('tanggal', { ascending: order === 'asc' });

    if (id_permohonan) {
      query = query.eq('id_permohonan', id_permohonan);
    }
    
    const { data, error } = await query;
    if (error) throw error;

    res.json({ success: true, data: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/keuangan/transaksi -> Tambah transaksi baru
app.post('/api/keuangan/transaksi', requireAuth, async (req, res) => {
  try {
    const {
      tanggal,
      jenis_transaksi,
      id_permohonan,
      nominal,
      keterangan,
      url_bukti
    } = req.body;

    if (!tanggal || !jenis_transaksi || !nominal) {
      return res.status(400).json({ success: false, error: 'Tanggal, jenis transaksi, and nominal are required.' });
    }

    const { data, error } = await supabase
      .from(TABLE_TRX)
      .insert([{ tanggal, jenis_transaksi, id_permohonan, nominal, keterangan, url_bukti }])
      .select()
      .single();
    
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// PATCH /api/keuangan/transaksi/:id -> Update transaksi
app.patch('/api/keuangan/transaksi/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { tanggal, jenis_transaksi, id_permohonan, nominal, keterangan, url_bukti } = req.body;

        const { data, error } = await supabase
            .from(TABLE_TRX)
            .update({ tanggal, jenis_transaksi, id_permohonan, nominal, keterangan, url_bukti, updated_at: new Date() })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        res.json({ success: true, data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});


// DELETE /api/keuangan/transaksi/:id -> Hapus transaksi
app.delete('/api/keuangan/transaksi/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from(TABLE_TRX).delete().eq('id', id);
    if (error) throw error;
    res.json({ success: true, message: 'Transaksi berhasil dihapus' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


// ---------- Health ----------
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    tables: [TABLE_DB, TABLE_UP],
    timestamp: new Date().toISOString()
  });
});

// ---------- Aplikasi standalone SPORADIK ----------
app.get(['/sporadik', '/sporadik-executive.html'], (req, res) => {
  const pubFile = path.join(__dirname, 'public', 'sporadik-executive.html');
  if (fs.existsSync(pubFile)) {
    return res.sendFile(pubFile);
  }
  res.sendFile(path.join(__dirname, 'sporadik-executive.html'));
});

// ---------- Catch-all & Error Handler ----------
app.use((req, res, next) => {
  res.status(404).json({ success: false, error: 'Endpoint API tidak ditemukan.' });
});

app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
});

// ---------- Start ----------
// Saat dijalankan langsung (npm start) -> listen seperti biasa.
// Saat di-deploy ke Vercel -> app di-export sebagai handler serverless
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 sync-surat-tanah (Supabase-only) running at http://localhost:${PORT}`);
  });
}

module.exports = app;