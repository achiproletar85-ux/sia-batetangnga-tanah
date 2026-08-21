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
const TABLE_DOCS = 'surat_terbit';
// Tab transaksi keuangan (Google Sheet, publik "Anyone with link can view").
const KEUANGAN_SHEET_URL = process.env.KEUANGAN_SHEET_URL ||
  'https://docs.google.com/spreadsheets/d/1KK7EUwdZe7jRfuymJ43GLH3zf7uKoouQwJx2QSfxlwc/export?format=csv&gid=1798420765';
// Zona waktu spreadsheet (jam offset dari UTC). WITA (Sulawesi Barat) = UTC+8.
const SHEET_TZ_H = parseInt(process.env.SHEET_TZ_H || '8', 10);

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
// Mendukung banyak akun (bendahara = bisa input keuangan; user = hanya baca + cek).
async function getUserByUsername(username) {
  try {
    const { data, error } = await supabase.from(TABLE_USERS).select('*').eq('username', username).maybeSingle();
    if (error) return null;
    return data || null;
  } catch (_) { return null; }
}
async function upsertAdminRecord({ username, name, password_hash }) {
  const rec = { id: 1, username, name, password_hash, updated_at: new Date().toISOString() };
  const { error } = await supabase.from(TABLE_USERS).upsert(rec, { onConflict: 'id' });
  if (error) throw new Error(error.message);
}
// Simpan password untuk akun yang sudah login (cari by username). Bila akun
// belum ada di tabel (login via fallback env), semai sebagai bendahara (id=1).
async function saveUserPassword({ username, name, password_hash }) {
  const rec = await getUserByUsername(username);
  if (rec) {
    const { error } = await supabase
      .from(TABLE_USERS)
      .update({ password_hash, name: name || rec.name, updated_at: new Date().toISOString() })
      .eq('username', username);
    if (error) throw new Error(error.message);
    return;
  }
  await upsertAdminRecord({ username, name, password_hash });
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

// Batasi endpoint agar hanya boleh diakses oleh role tertentu (mis. 'bendahara').
// Admin selalu lolos (role 'admin' = akses penuh). Wajib dipakai SETELAH requireAuth
// agar req.auth terisi.
function requireRole(...roles) {
  return (req, res, next) => {
    const role = req.auth && req.auth.role;
    if (!role || (role !== 'admin' && !roles.includes(role))) {
      return res.status(403).json({ success: false, error: 'Anda tidak memiliki izin untuk tindakan ini.' });
    }
    next();
  };
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
  let matched = false, name = AUTH_NAME, role = 'bendahara';
  const rec = await getUserByUsername(u);
  if (rec && rec.password_hash) {
    const ok = await verifyPassword(p, rec.password_hash);
    if (ok) {
      matched = true;
      name = rec.name || u;
      // Bila kolom role belum dibuat (belum migration), akun admin fallback bendahara.
      const r = rec.role;
      role = (r === 'admin' || r === 'bendahara' || r === 'user') ? r : (u === AUTH_USER ? 'bendahara' : 'user');
    }
  } else if (u === AUTH_USER && p === AUTH_PASS) {
    matched = true;
    role = 'bendahara';
    // Migrasi awal: semai kredensial env ke tabel app_users (untuk fitur ubah sandi).
    hashPassword(p).then((h) => upsertAdminRecord({ username: u, name: AUTH_NAME, password_hash: h })).catch(() => {});
  }
  if (!matched) {
    return res.status(401).json({ success: false, error: 'Username atau kata sandi salah.' });
  }
  const token = signToken({ username: u, name, role, exp: Date.now() + SESSION_TTL_MS });
  res.json({ success: true, token, user: { username: u, name, role } });
});

app.get('/api/me', (req, res) => {
  const payload = verifyToken(authTokenFromReq(req));
  if (!payload) return res.status(401).json({ success: false, error: 'Sesi tidak valid.' });
  res.json({ success: true, user: { username: payload.username, name: payload.name, role: payload.role || 'bendahara' } });
});

app.post('/api/logout', (req, res) => {
  res.json({ success: true });
});

app.post('/api/change-password', requireAuth, requireRole('admin'), async (req, res) => {
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
    const rec = await getUserByUsername(req.auth.username);
    let ok = false;
    if (rec && rec.password_hash) {
      ok = await verifyPassword(current, rec.password_hash);
    } else if (current === AUTH_PASS) {
      ok = true;
    }
    if (!ok) return res.status(401).json({ success: false, error: 'Kata sandi lama salah.' });
    const hash = await hashPassword(next);
    await saveUserPassword({ username: req.auth.username || AUTH_USER, name: req.auth.name || AUTH_NAME, password_hash: hash });
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

// POST /api/permohonan -> Tambah pendaftaran baru langsung dari web (migrasi dari Apps Script).
// ID otomatis REG-XXXXXX (mengikuti urutan max yang ada), status awal PENDING.
app.post('/api/permohonan', requireAuth, requireRole('bendahara', 'user'), async (req, res) => {
  try {
    const body = req.body || {};
    const layanan = clean(String(body.layanan || '').toUpperCase());
    const nama = clean(body.nama);
    const hp = clean(body.hp);
    const pembayaran = clean(body.pembayaran) || 'N/A';
    const data_raw = (body.data_raw && typeof body.data_raw === 'object') ? body.data_raw : {};
    const catatan_admin = clean(body.catatan_admin) || '';

    const ALLOWED = ['HIBAH', 'JUALBELI', 'AHLIWARIS'];
    if (!ALLOWED.includes(layanan)) {
      return res.status(400).json({ success: false, error: 'Layanan tidak valid. Pilih HIBAH, JUALBELI, atau AHLIWARIS.' });
    }
    if (!nama) return res.status(400).json({ success: false, error: 'Nama wajib diisi.' });
    if (hp && !/^08\d{8,11}$/.test(hp)) {
      return res.status(400).json({ success: false, error: 'Nomor HP tidak valid (harus 08..., 10-13 digit).' });
    }
    const nik = String(clean(data_raw.nik) || '').replace(/\D/g, '');
    if (nik.length !== 16) {
      return res.status(400).json({ success: false, error: 'NIK wajib diisi tepat 16 digit angka.' });
    }
    data_raw.nik = nik;
    if (!data_raw.nama_lengkap) data_raw.nama_lengkap = nama;

    // Buat ID REG-XXXXXX: urutan lanjutan dari ID tertinggi yang ada di Supabase.
    const { data: existing, error: exErr } = await supabase
      .from(TABLE_DB)
      .select('id');
    if (exErr) throw exErr;
    let maxNum = 0;
    (existing || []).forEach((r) => {
      const m = /^REG-(\d+)$/.exec(String(r.id || '').trim());
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxNum) maxNum = n;
      }
    });
    let newId = 'REG-' + (maxNum + 1);
    let guard = 0;
    let conflict = true;
    while (conflict && guard < 20) {
      const { data: chk } = await supabase.from(TABLE_DB).select('id').eq('id', newId).maybeSingle();
      if (chk) {
        newId = 'REG-' + (++maxNum + 1);
        guard++;
      } else {
        conflict = false;
      }
    }
    if (conflict) return res.status(500).json({ success: false, error: 'Gagal menghasilkan ID unik.' });

    const now = new Date().toISOString();
    const rec = {
      id: newId,
      timestamp: body.timestamp || now,
      layanan,
      nama,
      hp,
      pembayaran,
      data_raw: JSON.stringify(data_raw),
      status_berkas: clean(body.status_berkas) || 'PENDING',
      catatan_admin,
      last_updated: now,
      updated_at: now,
      synced_at: now
    };

    const { data, error } = await supabase.from(TABLE_DB).insert(rec).select().single();
    if (error) throw error;

    res.json({ success: true, data: data || rec });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.patch('/api/permohonan/:id', requireAuth, requireRole('bendahara', 'user'), async (req, res) => {
  try {
    const { status_berkas, catatan_admin, layanan, data_raw } = req.body || {};
    const payload = { updated_at: new Date().toISOString() };
    if (status_berkas !== undefined) payload.status_berkas = status_berkas;
    if (catatan_admin !== undefined) payload.catatan_admin = catatan_admin;
    if (layanan !== undefined) {
      const l = clean(String(layanan).toUpperCase());
      if (!['HIBAH', 'JUALBELI', 'AHLIWARIS'].includes(l)) {
        return res.status(400).json({ success: false, error: 'Layanan tidak valid.' });
      }
      payload.layanan = l;
    }

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

app.delete('/api/permohonan/:id', requireAuth, requireRole('bendahara'), async (req, res) => {
  try {
    const { data, error } = await supabase.from(TABLE_DB).delete().eq('id', req.params.id).select();
    if (error) throw error;
    await addTombstone(TOMBSTONE_PENDAFTARAN, req.params.id);
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

app.delete('/api/uploads/:fileId', requireAuth, requireRole('bendahara'), async (req, res) => {
  try {
    const { data, error } = await supabase.from(TABLE_UP).delete().eq('file_id', req.params.fileId).select();
    if (error) throw error;
    await addTombstone(TOMBSTONE_UPLOAD, req.params.fileId);
    res.json({ success: true, data: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---------- Import manual dari spreadsheet (read-only via GAS web app) ----------
// Panggil GAS action=getRows, lalu upsert baris ke Supabase.
app.post('/api/import-from-sheet', requireAuth, requireRole('admin'), async (req, res) => {
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
    const tombPendaftaran = new Set(await getTombstone(TOMBSTONE_PENDAFTARAN));
    const tombUpload = new Set(await getTombstone(TOMBSTONE_UPLOAD));
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

      // KEBIJAKAN "INSERT-ONLY" (putuskan koneksi sheet -> timpa data):
      // baris yang SUDAH ADA di Supabase TIDAK PERNAH ditimpa oleh spreadsheet,
      // apa pun timestamp-nya. Edit lewat aplikasi (mis. jumlah anak) dijamin
      // aman dari balik-ke-nilai-lama. Spreadsheet hanya menambah data BARU.
      // (Sebelumnya memakai "latest-wins" berdasar timestamp sheet vs updated_at,
      //  yang masih bisa menimpa edit web bila timestamp sheet lebih baru.)
      const now = new Date().toISOString();
      let skipped = 0;

      if (s.toLowerCase().includes('upload')) {
        const { data: existing } = await supabase.from(TABLE_UP).select('file_id, updated_at');
        const exist = new Map((existing || []).map((e) => [e.file_id, e.updated_at]));
        const recs = [];
        for (const r of rows) {
          const file_id = clean(rowGet(r, 'FILE_ID', 'file_id', 'ID', 'id'));
          if (!file_id) continue;
          if (tombUpload.has(file_id)) { skipped++; continue; }
          const tsRaw = clean(rowGet(r, 'TIMESTAMP', 'timestamp'));
          const verMs = parseSheetTime(tsRaw);
          const verISO = verMs ? new Date(verMs).toISOString() : now;
          const cur = exist.get(file_id);
          if (!cur) {
            recs.push({
              id_registrasi: clean(rowGet(r, 'ID_REGISTRASI', 'id_registrasi')) || '',
              jenis_upload: clean(rowGet(r, 'JENIS_UPLOAD', 'jenis_upload')),
              file_name: clean(rowGet(r, 'FILE_NAME', 'file_name', 'NAMA_FILE', 'nama_file')),
              file_url: clean(rowGet(r, 'FILE_URL', 'file_url')),
              file_id: file_id,
              timestamp: tsRaw,
              updated_at: verISO,
              synced_at: now
            });
          } else if (verMs && new Date(cur).getTime() < verMs) {
            recs.push({
              id_registrasi: clean(rowGet(r, 'ID_REGISTRASI', 'id_registrasi')) || '',
              jenis_upload: clean(rowGet(r, 'JENIS_UPLOAD', 'jenis_upload')),
              file_name: clean(rowGet(r, 'FILE_NAME', 'file_name', 'NAMA_FILE', 'nama_file')),
              file_url: clean(rowGet(r, 'FILE_URL', 'file_url')),
              file_id: file_id,
              timestamp: tsRaw,
              updated_at: verISO,
              synced_at: now
            });
          } else {
            skipped++;
          }
        }
        upserted = await upsertChunks(TABLE_UP, recs, 'file_id');
      } else {
        const { data: existing } = await supabase.from(TABLE_DB).select('id, updated_at');
        const exist = new Map((existing || []).map((e) => [e.id, e.updated_at]));
        const recs = [];
        for (const r of rows) {
          const id = clean(rowGet(r, 'ID', 'id'));
          if (!id) continue;
          if (tombPendaftaran.has(id)) { skipped++; continue; }
          const lastUpdated = clean(rowGet(r, 'LAST_UPDATED', 'last_updated'));
          const tsRaw = clean(rowGet(r, 'TIMESTAMP', 'timestamp'));
          const verMs = parseSheetTime(lastUpdated) || parseSheetTime(tsRaw);
          const verISO = verMs ? new Date(verMs).toISOString() : now;
          const cur = exist.get(id);
          if (!cur) {
            // Record baru dari sheet -> INSERT.
            const data_raw = parseDataRaw(rowGet(r, 'DATA_RAW', 'data_raw')) || restToRaw(r);
            recs.push({
              id: id,
              timestamp: tsRaw,
              layanan: clean(rowGet(r, 'LAYANAN', 'layanan')),
              nama: clean(rowGet(r, 'NAMA', 'nama')),
              hp: clean(rowGet(r, 'HP', 'hp', 'NO_HP', 'no_hp')),
              pembayaran: clean(rowGet(r, 'PEMBAYARAN', 'pembayaran')),
              data_raw: data_raw,
              status_berkas: clean(rowGet(r, 'STATUS_BERKAS', 'status_berkas', 'STATUS', 'status')),
              catatan_admin: clean(rowGet(r, 'CATATAN_ADMIN', 'catatan_admin')),
              last_updated: lastUpdated,
              updated_at: verISO,
              synced_at: now
            });
          } else {
            // Sudah ada di Supabase -> TIDAK DITIMPA (insert-only).
            skipped++;
          }
        }
        upserted = await upsertChunks(TABLE_DB, recs, 'id');
      }
      results.push({ sheet: s, received: rows.length, upserted, skipped });
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

// ---------- Tombstone: daftar ID yang pernah dihapus ----------
// Agar data yang dihapus lewat aplikasi TIDAK muncul lagi setelah
// "Tarik dari Sheet" (import manual), ID yang dihapus dicatat di
// tabel pengaturan_app dan dilewati saat import.
const TOMBSTONE_PENDAFTARAN = 'tombstone_pendaftaran';
const TOMBSTONE_UPLOAD = 'tombstone_upload';
const TOMBSTONE_TRANSAKSI = 'tombstone_transaksi';

async function getTombstone(kunci) {
  const raw = await getPengaturan(kunci, '[]');
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

async function addTombstone(kunci, id) {
  const arr = await getTombstone(kunci);
  if (!arr.includes(id)) {
    arr.push(id);
    const { error } = await supabase.from(TABLE_SET).upsert(
      { kunci, nilai: JSON.stringify(arr), updated_at: new Date().toISOString() },
      { onConflict: 'kunci' }
    );
    if (error) throw error;
  }
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

// GET /api/keuangan/status-semua -> Status pembayaran LUNAS/BELUM LUNAS/BELUM BAYAR
// untuk SEMUA permohonan, dihitung dari transaksi_keuangan (Pemasukan Cicilan)
// dibandingkan biaya_total_sertifikat. Dipakai dashboard; aman dibuka semua role
// karena hanya mengembalikan status, bukan nominal detail.
app.get('/api/keuangan/status-semua', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from(TABLE_TRX)
      .select('id_permohonan, nominal')
      .eq('jenis_transaksi', 'Pemasukan Cicilan')
      .not('id_permohonan', 'is', null);

    if (error) throw error;

    const totals = {};
    (data || []).forEach((row) => {
      totals[row.id_permohonan] = (totals[row.id_permohonan] || 0) + row.nominal;
    });

    const biayaTotalStr = await getPengaturan('biaya_total_sertifikat', '250000');
    const biayaTotal = parseInt(biayaTotalStr, 10);

    const result = {};
    Object.keys(totals).forEach((id) => {
      const totalTerbayar = totals[id];
      result[id] = {
        total_terbayar: totalTerbayar,
        biaya_total: biayaTotal,
        status: totalTerbayar >= biayaTotal ? 'LUNAS' : (totalTerbayar > 0 ? 'BELUM LUNAS' : 'BELUM BAYAR'),
      };
    });

    res.json({ success: true, biaya_total: biayaTotal, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/pemohon/:id/tagihan-berkas -> Cek Tagihan & Berkas untuk satu pemohon
// Gabungan: data permohonan (permohonan_surat_tanah by id) + ringkasan tagihan +
// riwayat cicilan (transaksi_keuangan) + daftar berkas (permohonan_uploads).
app.get('/api/pemohon/:id/tagihan-berkas', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: permohonan, error: dbError } = await supabase
      .from(TABLE_DB)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (dbError) throw dbError;

    const { data: trxData, error: trxError } = await supabase
      .from(TABLE_TRX)
      .select('id, tanggal, jenis_transaksi, nominal, keterangan, url_bukti, updated_at')
      .eq('id_permohonan', id)
      .order('tanggal', { ascending: true });
    if (trxError) throw trxError;

    const riwayat = (trxData || []).map((t) => ({
      id: t.id,
      tanggal: t.tanggal,
      jenis_transaksi: t.jenis_transaksi,
      nominal: t.nominal,
      keterangan: t.keterangan,
      url_bukti: t.url_bukti
    }));

    const totalTerbayar = (trxData || [])
      .filter((t) => t.jenis_transaksi === 'Pemasukan Cicilan')
      .reduce((sum, t) => sum + t.nominal, 0);
    const biayaTotalStr = await getPengaturan('biaya_total_sertifikat', '250000');
    const biayaTotal = parseInt(biayaTotalStr, 10);
    const sisaTagihan = Math.max(0, biayaTotal - totalTerbayar);

    const { data: berkasData, error: upError } = await supabase
      .from(TABLE_UP)
      .select('*')
      .eq('id_registrasi', id)
      .order('timestamp', { ascending: true });
    if (upError) throw upError;

    const berkas = (berkasData || []).map((b) => ({
      file_id: b.file_id,
      jenis_upload: b.jenis_upload,
      file_name: b.file_name,
      file_url: b.file_url,
      timestamp: b.timestamp
    }));

    res.json({
      success: true,
      data: {
        permohonan: permohonan || null,
        tagihan: {
          id_permohonan: id,
          biaya_total: biayaTotal,
          total_terbayar: totalTerbayar,
          sisa_tagihan: sisaTagihan,
          status_lunas: sisaTagihan <= 0,
        },
        riwayat,
        berkas,
      }
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


// GET /api/keuangan/ringkasan -> Ringkasan total keuangan (khusus Bendahara/Admin)
app.get('/api/keuangan/ringkasan', requireAuth, requireRole('bendahara'), async (req, res) => {
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

// GET /api/keuangan/transaksi -> Daftar semua transaksi dengan filter (khusus Bendahara/Admin)
app.get('/api/keuangan/transaksi', requireAuth, requireRole('bendahara'), async (req, res) => {
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

// POST /api/keuangan/transaksi -> Tambah transaksi baru (KHUSUS BENDAHARA / ADMIN)
app.post('/api/keuangan/transaksi', requireAuth, requireRole('bendahara'), async (req, res) => {
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

    const cleanIdPerm = clean(id_permohonan);
    const { data, error } = await supabase
      .from(TABLE_TRX)
      .insert([{ tanggal, jenis_transaksi, id_permohonan: cleanIdPerm, nominal, keterangan, url_bukti, updated_at: new Date().toISOString() }])
      .select()
      .single();
    
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Helper untuk mendapatkan variabel Google OAuth (prioritas process.env, fallback ke Supabase pengaturan_app).
async function getGoogleEnv(key) {
  if (process.env[key]) return process.env[key];
  const val = await getPengaturan(key, '');
  return val ? String(val).trim() : null;
}

// ---------- Upload bukti ke Google Drive ----------
app.post('/api/keuangan/upload-bukti', requireAuth, requireRole('bendahara'), async (req, res) => {
  try {
    const { fileName, fileData } = req.body;
    if (!fileData || !/^data:/.test(String(fileData))) {
      return res.status(400).json({ success: false, error: 'fileData harus berupa base64 data-URL.' });
    }
    const mimeMatch = String(fileData).match(/^data:([^;]+);base64,(.+)$/s);
    if (!mimeMatch) return res.status(400).json({ success: false, error: 'Format data-URL tidak valid.' });
    const mime = mimeMatch[1];
    const bytes = Buffer.from(mimeMatch[2], 'base64');
    if (bytes.length > 8 * 1024 * 1024) {
      return res.status(413).json({ success: false, error: 'Ukuran file melebihi 8 MB.' });
    }

    const clientId = await getGoogleEnv('GOOGLE_CLIENT_ID');
    const refreshToken = await getGoogleEnv('GOOGLE_REFRESH_TOKEN');
    const folderId = await getGoogleEnv('GOOGLE_DRIVE_FOLDER_ID');
    if (!clientId || !refreshToken || !folderId) {
      return res.status(500).json({ success: false, error: 'Konfigurasi upload Google belum diatur di .env atau Supabase' });
    }
    const url = await uploadToDrive(fileName || 'bukti_' + Date.now() + '.jpg', mime, bytes);
    res.json({ success: true, url });
  } catch (e) {
    console.error('[upload-bukti] ERROR:', e && e.stack ? e.stack : e);
    res.status(500).json({ success: false, error: e.message });
  }
});

async function googleAccessToken() {
  const clientId = await getGoogleEnv('GOOGLE_CLIENT_ID');
  const clientSecret = await getGoogleEnv('GOOGLE_CLIENT_SECRET');
  const refreshToken = await getGoogleEnv('GOOGLE_REFRESH_TOKEN');

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Konfigurasi OAuth Google belum diatur di .env atau Supabase (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN)');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('Gagal refresh token Google: ' + (j.error_description || j.error));
  return j.access_token;
}

// POST /api/docs/google-config -> simpan/update kredensial Google OAuth ke Supabase (hanya Admin).
app.post('/api/docs/google-config', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { clientId, clientSecret, refreshToken, folderId } = req.body || {};
    const items = [];
    if (clientId) items.push({ kunci: 'GOOGLE_CLIENT_ID', nilai: String(clientId).trim(), updated_at: new Date().toISOString() });
    if (clientSecret) items.push({ kunci: 'GOOGLE_CLIENT_SECRET', nilai: String(clientSecret).trim(), updated_at: new Date().toISOString() });
    if (refreshToken) items.push({ kunci: 'GOOGLE_REFRESH_TOKEN', nilai: String(refreshToken).trim(), updated_at: new Date().toISOString() });
    if (folderId) items.push({ kunci: 'GOOGLE_DRIVE_FOLDER_ID', nilai: String(folderId).trim(), updated_at: new Date().toISOString() });

    if (items.length === 0) {
      return res.status(400).json({ success: false, error: 'Tidak ada data konfigurasi yang diisi.' });
    }

    const { error } = await supabase.from(TABLE_SET).upsert(items, { onConflict: 'kunci' });
    if (error) throw error;
    res.json({ success: true, message: 'Konfigurasi OAuth Google berhasil disimpan ke Supabase.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/docs/status -> Diagnostik konfigurasi Google (env/Supabase + scope refresh token + status Docs API).
app.get('/api/docs/status', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const clientId = await getGoogleEnv('GOOGLE_CLIENT_ID');
    const clientSecret = await getGoogleEnv('GOOGLE_CLIENT_SECRET');
    const refreshToken = await getGoogleEnv('GOOGLE_REFRESH_TOKEN');
    const folderId = await getGoogleEnv('GOOGLE_DRIVE_FOLDER_ID');

    const report = {
      success: true,
      env: {
        GOOGLE_CLIENT_ID: Boolean(clientId),
        GOOGLE_CLIENT_SECRET: Boolean(clientSecret),
        GOOGLE_REFRESH_TOKEN: Boolean(refreshToken),
        GOOGLE_DRIVE_FOLDER_ID: Boolean(folderId)
      },
      clientId: clientId ? String(clientId).slice(0, 12) + '…' : null,
      scopes: [],
      docsApi: null,
      docsApiError: null,
      note: ''
    };

    if (!report.env.GOOGLE_CLIENT_ID || !report.env.GOOGLE_CLIENT_SECRET || !report.env.GOOGLE_REFRESH_TOKEN) {
      report.note = 'Konfigurasi OAuth Google belum lengkap di .env atau tabel pengaturan Supabase.';
      return res.json(report);
    }

    // 1) Refresh token -> access token.
    const token = await googleAccessToken();

    // 2) Lihat scope access token (tokeninfo). Field scope = spasi-terpisah.
    const ti = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token));
    const tiJ = await ti.json();
    if (tiJ && tiJ.scope) {
      report.scopes = String(tiJ.scope).split(' ').filter(Boolean);
      report.note = 'Scope saat ini: ' + report.scopes.join(', ');
    } else {
      report.note = 'Tidak bisa membaca scope dari tokeninfo: ' + JSON.stringify(tiJ);
    }

    // 3) Uji Docs API dengan docId dummy (format ID valid). Error membedakan:
    //    - 403 "has not been used"/"disabled" -> API belum aktif / scope kurang
    //    - 404 -> API aktif & scope OK, tapi dokumen tidak ada (bukan masalah config)
    const dummyId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const docsRes = await fetch('https://docs.googleapis.com/v1/documents/' + dummyId, {
      headers: { Authorization: 'Bearer ' + token }
    });
    const docsJ = await docsRes.json();
    const msg = docsJ && docsJ.error ? docsJ.error.message : '';
    if (docsRes.status === 404) {
      report.docsApi = 'ACTIVE_OK'; // API aktif, scope cocok; dokumen dummy tidak ada.
      report.note += ' | Docs API AKTIF & scope documents OK (dummy doc 404 = wajar).';
    } else if (docsRes.status === 403) {
      report.docsApi = 'BLOCKED';
      report.docsApiError = msg;
      report.note += ' | Docs API/scope belum siap: ' + msg;
    } else {
      report.docsApi = 'UNKNOWN (' + docsRes.status + ')';
      report.docsApiError = msg;
      report.note += ' | Respon tak terduga dari Docs API: ' + msg;
    }

    // Scope documents wajib ada.
    report.hasDocumentsScope = report.scopes.some((s) =>
      s === 'https://www.googleapis.com/auth/documents' ||
      s === 'https://www.googleapis.com/auth/documents.readonly' ||
      s.endsWith('/auth/documents'));
    report.docsReady = report.docsApi === 'ACTIVE_OK' && report.hasDocumentsScope;

    res.json(report);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

async function uploadToDrive(fileName, mime, bytes) {
  const token = await googleAccessToken();
  const folderId = await getGoogleEnv('GOOGLE_DRIVE_FOLDER_ID');
  const boundary = 'sia_batetangnga_' + Date.now();

  const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
  const head = Buffer.from(
    '--' + boundary + '\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    metadata + '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: ' + mime + '\r\n\r\n'
  );
  const tail = Buffer.from('\r\n--' + boundary + '--\r\n');
  const body = Buffer.concat([head, bytes, tail]);

  const upRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'multipart/related; boundary=' + boundary
    },
    body: body
  });
  const up = await upRes.json();
  if (!upRes.ok || !up.id) {
    throw new Error('Gagal upload ke Drive: ' + JSON.stringify(up));
  }

  // Jadikan publik "siapapun dengan link bisa lihat" agar bisa dibuka dari aplikasi.
  await fetch('https://www.googleapis.com/drive/v3/files/' + up.id + '/permissions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ role: 'reader', type: 'anyone' })
  });

  return up.webViewLink || ('https://drive.google.com/file/d/' + up.id + '/view');
}

// ============================================================
// SURAT GOOGLE DOCS — render placeholder {{...}} dari Google Docs
// Sumber data: Google Docs API (refresh token yang sama dengan Drive).
// Placeholder otomatis terdeteksi dari isi dokumen: {{nama_field}}.
// ============================================================
function extractDocId(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  // https://docs.google.com/document/d/<ID>/edit
  let m = /\/document\/d\/([a-zA-Z0-9_-]+)/.exec(s);
  if (m) return m[1];
  // Hanya ID polos (panjang 25-80, tanpa spasi).
  if (/^[a-zA-Z0-9_-]{25,}$/.test(s)) return s;
  return null;
}

// Ekstrak ID pendaftaran REG-XXXXXX dari teks acak / pilihan datalist.
function extractRegId(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  const m = s.match(/REG-[A-Za-z0-9_-]+/i);
  if (m) return m[0].toUpperCase();
  if (/^\d+$/.test(s)) return 'REG-' + s;
  return s.toUpperCase();
}

async function findRecordByRegOrName(idRegRaw) {
  const s = String(idRegRaw || '').trim();
  if (!s) return null;
  const idReg = extractRegId(s);
  if (idReg) {
    const { data } = await supabase.from(TABLE_DB).select('*').eq('id', idReg).maybeSingle();
    if (data) return data;
  }
  const { data: byName } = await supabase.from(TABLE_DB).select('*').ilike('nama', `%${s}%`).limit(1).maybeSingle();
  return byName || null;
}

async function fetchDocContent(docId) {
  const token = await googleAccessToken();
  const res = await fetch('https://docs.googleapis.com/v1/documents/' + encodeURIComponent(docId), {
    headers: { Authorization: 'Bearer ' + token }
  });
  const j = await res.json();
  if (!res.ok) {
    const err = j && j.error && j.error.message ? j.error.message : (j.message || 'Gagal membaca dokumen');
    // Scope yang umum hilang saat refresh token dibuat hanya utk Drive.
    if (res.status === 403 || res.status === 401) {
      throw new Error('Akses dokumen ditolak. Pastikan refresh token memiliki scope https://www.googleapis.com/auth/documents dan dokumen boleh diakses akun tersebut. (' + err + ')');
    }
    throw new Error(err);
  }
  return j;
}

// Gabungkan textRun dalam satu paragraph menjadi satu teks (placeholder utuh).
function paragraphText(p) {
  if (!p || !p.elements) return '';
  const joined = p.elements.map((el) => (el.textRun ? (el.textRun.content || '') : '')).join('');
  // Bersihkan karakter kontrol Google Docs (penomoran otomatis, pemisah tab, dll).
  return joined.replace(/[\u000b\u0000\u0001-\u0008\u000e-\u001f\u007f]/g, '').replace(/\t/g, ' ');
}

// Salin dokumen Google Docs via Drive API (file asli digandakan, placeholder tetap utuh).
async function copyDriveDoc(docId, newName) {
  const token = await googleAccessToken();
  const res = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(docId) + '/copy', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName })
  });
  const j = await res.json();
  if (!res.ok) {
    const err = j && j.error && j.error.message ? j.error.message : 'Gagal menggandakan dokumen';
    throw new Error('Gagal menggandakan dokumen di Drive: ' + err);
  }
  return j.id;
}

// Isi placeholder langsung DI DALAM dokumen Google (batchUpdate replaceAllText).
// Format/layout asli tetap terjaga karena hanya teks diganti.
async function fillDocText(docId, replacements) {
  const token = await googleAccessToken();
  const requests = replacements.map((r) => ({
    replaceAllText: {
      containsText: { text: r.from, matchCase: false },
      replaceText: r.to
    }
  }));
  const res = await fetch('https://docs.googleapis.com/v1/documents/' + encodeURIComponent(docId) + ':batchUpdate', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests })
  });
  const j = await res.json();
  if (!res.ok) {
    const err = j && j.error && j.error.message ? j.error.message : 'Gagal mengisi dokumen';
    if (res.status === 403 || res.status === 401) {
      throw new Error('Akses dokumen ditolak. Pastikan refresh token memiliki scope https://www.googleapis.com/auth/documents dan dokumen boleh diakses akun tersebut. (' + err + ')');
    }
    throw new Error('Gagal mengisi placeholder di dokumen: ' + err);
  }
  return j;
}

// Ekstrak daftar placeholder unik (urutan kemunculan pertama).
function extractPlaceholders(text) {
  const seen = [];
  const re = /\{{1,2}\s*([^{}]+?)\s*\}\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = m[1].trim();
    if (!seen.includes(key)) seen.push(key);
  }
  return seen;
}

// Normalisasi nama field placeholder: huruf kecil, tanpa spasi/underscore/titik.
function normKey(k) {
  return String(k).trim().toLowerCase().replace(/[\s_\-./\\]+/g, '');
}

// Tanggal ISO -> "5 Februari 2026" (id-ID, tanpa hari).
function fmtIdDate(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v).trim();
  const bulan = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  return d.getDate() + ' ' + bulan[d.getMonth()] + ' ' + d.getFullYear();
}

function angkaKeTerbilang(n) {
  const num = Math.abs(parseInt(String(n || 0).replace(/[^0-9]/g, ''), 10));
  if (isNaN(num) || num === 0) return 'Nol Rupiah';
  const satuan = ['', 'Satu', 'Dua', 'Tiga', 'Empat', 'Lima', 'Enam', 'Tujuh', 'Delapan', 'Sembilan', 'Sepuluh', 'Sebelas'];
  const terbilang = (x) => {
    if (x < 12) return satuan[x];
    if (x < 20) return terbilang(x - 10) + ' Belas';
    if (x < 100) return terbilang(Math.floor(x / 10)) + ' Puluh ' + (x % 10 ? terbilang(x % 10) : '');
    if (x < 200) return 'Seratus ' + (x % 100 ? terbilang(x - 100) : '');
    if (x < 1000) return terbilang(Math.floor(x / 100)) + ' Ratus ' + (x % 100 ? terbilang(x % 100) : '');
    if (x < 2000) return 'Seribu ' + (x % 1000 ? terbilang(x - 1000) : '');
    if (x < 1000000) return terbilang(Math.floor(x / 1000)) + ' Ribu ' + (x % 1000 ? terbilang(x % 1000) : '');
    if (x < 1000000000) return terbilang(Math.floor(x / 1000000)) + ' Juta ' + (x % 1000000 ? terbilang(x % 1000000) : '');
    if (x < 1000000000000) return terbilang(Math.floor(x / 1000000000)) + ' Milyar ' + (x % 1000000000 ? terbilang(x % 1000000000) : '');
    return String(x);
  };
  return terbilang(num).replace(/\s+/g, ' ').trim() + ' Rupiah';
}

function formatRupiah(n) {
  const num = parseInt(String(n || 0).replace(/[^0-9]/g, ''), 10);
  if (isNaN(num) || num === 0) return String(n || '');
  return 'Rp ' + num.toLocaleString('id-ID') + ',-';
}

// Kumpulkan seluruh nilai yang bisa dipakai placeholder dari satu pendaftaran.
async function buildDocValues(record, extraValues) {
  let dr = {};
  try { dr = typeof record.data_raw === 'string' ? JSON.parse(record.data_raw || '{}') : (record.data_raw || {}); } catch (_) {}
  const values = {};
  const set = (k, v) => { if (v !== undefined && v !== null && String(v) !== '') values[normKey(k)] = String(v); };

  // Kolom top-level permohonan.
  set('id', record.id);
  set('id_registrasi', record.id);
  set('id_pendaftaran', record.id);
  set('reg', record.id);
  set('nama', record.nama);
  set('nama_pemohon', record.nama);
  set('layanan', record.layanan);
  set('jenis_layanan', record.layanan);
  set('status_berkas', record.status_berkas);
  set('pembayaran', record.pembayaran);
  set('hp', record.hp);
  set('no_hp', record.hp);

  // Semua field dari data_raw.
  Object.keys(dr).forEach((k) => {
    let v = dr[k];
    if (typeof v === 'object') { try { v = JSON.stringify(v); } catch (_) {} }
    set(k, v);
  });

  // Nilai dinamis tanggal cetak, hari, dan bulan Indonesia.
  const now = new Date();
  const namaHari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][now.getDay()];
  const namaBulan = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'][now.getMonth()];
  set('hari', namaHari);
  set('hari_ini', namaHari);
  set('bulan', namaBulan);
  set('bulan_angka', String(now.getMonth() + 1));
  set('tanggal', now.toISOString());
  set('tanggal_cetak', now.toISOString());
  set('tanggal_sekarang', now.toISOString());
  set('tanggal_ini', now.toISOString());
  set('tahun', String(now.getFullYear()));

  // Hitung umur pemohon dari tanggal lahir (HIBAH: penerima, JUALBELI: pembeli).
  // Utamakan umur yang tersimpan dari tab Surat Sporadik (penerima_umur dsb.).
  const ageFrom = (tglISO) => {
    if (!tglISO) return '';
    const b = new Date(String(tglISO).slice(0, 10) + 'T00:00:00');
    if (isNaN(b.getTime())) return '';
    let age = now.getFullYear() - b.getFullYear();
    const m = now.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
    return age >= 0 ? String(age) : '';
  };
  const umurTersimpan = dr.pemohon_umur || dr.penerima_umur || dr.pembeli_umur || dr.pemberi_umur || dr.penjual_umur;
  const umurPemohon = umurTersimpan ? String(umurTersimpan).trim() : ageFrom(dr.penerima_tanggal_lahir || dr.pembeli_tanggal_lahir || dr.tanggal_lahir || dr.pemberi_tanggal_lahir);
  if (umurPemohon) set('umur_pemohon', umurPemohon);

  // Umur saksi: utamakan nilai tersimpan (tab Surat Sporadik / input manual),
  // lalu hitung dari TTL yang diisi (data_raw maupun extraValues panel manual).
  const umurSaksi = (s) => {
    const saved = (extraValues && (extraValues[s + '_umur'] || extraValues[s + '_ttl'])) || dr[s + '_umur'];
    if (saved) return String(saved).trim();
    const ttl = (extraValues && extraValues[s + '_tanggal_lahir']) || dr[s + '_ttl'] || dr[s + '_tanggal_lahir'] || dr[s + '_tanggallahir'] || dr[s + '_tgl'];
    return ageFrom(ttl);
  };
  [['umur_saksi1', 'saksi1'], ['umur_saksi2', 'saksi2']].forEach(([ph, s]) => {
    const u = umurSaksi(s);
    if (u) set(ph, u);
  });

  // Konfigurasi desa (nama_desa, kecamatan, kabupaten, kepala_desa, jabatan).
  const cfgKeys = ['nama_desa', 'kecamatan', 'kabupaten', 'provinsi', 'kepala_desa', 'jabatan_kepala_desa', 'alamat_kantor_desa'];
  for (const k of cfgKeys) {
    const raw = await getPengaturan(k, '');
    if (raw) set(k, raw);
  }

  // Penggabungan TTL jika tempat & tanggal lahir tersedia
  const tmpt = values[normKey('tempat_lahir')] || dr.tempat_lahir || dr.penerima_tempat_lahir || dr.pembeli_tempat_lahir;
  const tglLhr = values[normKey('tanggal_lahir')] || dr.tanggal_lahir || dr.penerima_tanggal_lahir || dr.pembeli_tanggal_lahir;
  const ttlCombined = (tmpt && tglLhr) ? (tmpt + ', ' + fmtIdDate(tglLhr)) : '';

  // Alias umum agar placeholder fleksibel (mis. {{nama}} / {{nama_lengkap}}).
  const alias = {
    nama_lengkap: values[normKey('nama')],
    nama_pemohon: values[normKey('nama')] || dr.nama_pemohon || dr.penerima_nama,
    nik: values[normKey('nik')] || dr.nik,
    nokk: values[normKey('no_kk')] || dr.no_kk || dr.nokk,
    dusun: values[normKey('dusun')] || dr.dusun,
    alamat: values[normKey('alamat')] || dr.alamat,
    alamat_pemohon: values[normKey('alamat')] || dr.alamat || dr.penerima_alamat,
    tempat_lahir: tmpt || '',
    tanggal_lahir: tglLhr || '',
    ttl: ttlCombined || values[normKey('ttl')] || dr.ttl,
    tempat_tanggal_lahir: ttlCombined || values[normKey('tempat_tanggal_lahir')] || dr.tempat_tanggal_lahir,
    pekerjaan: values[normKey('pekerjaan')] || dr.pekerjaan || dr.penerima_pekerjaan,
    pekerjaan_pemohon: values[normKey('pekerjaan')] || dr.penerima_pekerjaan || dr.pekerjaan,
    status_bayar: values[normKey('status_bayar')] || dr.status_bayar || record.pembayaran,
    luas_tanah: values[normKey('luas_tanah')] || dr.luas_tanah || dr.luas,
    luas: values[normKey('luas_tanah')] || dr.luas_tanah || dr.luas,
    jenis_tanah: values[normKey('jenis_tanah')] || dr.jenis_tanah,
    alamat_tanah: values[normKey('alamat_tanah')] || dr.alamat_tanah,
    asal_tanah: values[normKey('asal_tanah')] || dr.asal_tanah || dr.alamat_tanah,
    // Batas tanah: placeholder pendek -> kolom batas_*.
    utara: values[normKey('batas_utara')] || dr.batas_utara,
    timur: values[normKey('batas_timur')] || dr.batas_timur,
    selatan: values[normKey('batas_selatan')] || dr.batas_selatan,
    barat: values[normKey('batas_barat')] || dr.batas_barat,
    batas_utara: values[normKey('batas_utara')] || dr.batas_utara,
    batas_timur: values[normKey('batas_timur')] || dr.batas_timur,
    batas_selatan: values[normKey('batas_selatan')] || dr.batas_selatan,
    batas_barat: values[normKey('batas_barat')] || dr.batas_barat,
    // Agama
    agama: values[normKey('agama')] || dr.agama || 'Islam',
    // Saksi.
    nama_saksi1: values[normKey('saksi1_nama')] || dr.saksi1_nama,
    saksi1_nama: values[normKey('saksi1_nama')] || dr.saksi1_nama,
    saksi1_nik: values[normKey('saksi1_nik')] || dr.saksi1_nik,
    saksi1_pekerjaan: values[normKey('saksi1_pekerjaan')] || dr.saksi1_pekerjaan || dr.perkejaan_saksi1,
    saksi1_alamat: values[normKey('saksi1_alamat')] || dr.saksi1_alamat,
    saksi1_umur: values[normKey('umur_saksi1')] || values[normKey('saksi1_umur')] || dr.saksi1_umur,
    umur_saksi1: values[normKey('umur_saksi1')] || values[normKey('saksi1_umur')] || dr.saksi1_umur,
    alamat_saksi1: values[normKey('saksi1_alamat')] || dr.saksi1_alamat,
    pekerjaan_saksi1: values[normKey('saksi1_pekerjaan')] || dr.saksi1_pekerjaan,
    perkejaan_saksi1: values[normKey('saksi1_pekerjaan')] || dr.saksi1_pekerjaan,

    nama_saksi2: values[normKey('saksi2_nama')] || dr.saksi2_nama,
    saksi2_nama: values[normKey('saksi2_nama')] || dr.saksi2_nama,
    saksi2_nik: values[normKey('saksi2_nik')] || dr.saksi2_nik,
    saksi2_pekerjaan: values[normKey('saksi2_pekerjaan')] || dr.saksi2_pekerjaan || dr.perkejaan_saksi2,
    saksi2_alamat: values[normKey('saksi2_alamat')] || dr.saksi2_alamat,
    saksi2_umur: values[normKey('umur_saksi2')] || values[normKey('saksi2_umur')] || dr.saksi2_umur,
    umur_saksi2: values[normKey('umur_saksi2')] || values[normKey('saksi2_umur')] || dr.saksi2_umur,
    alamat_saksi2: values[normKey('saksi2_alamat')] || dr.saksi2_alamat,
    pekerjaan_saksi2: values[normKey('saksi2_pekerjaan')] || dr.saksi2_pekerjaan,
    perkejaan_saksi2: values[normKey('saksi2_pekerjaan')] || dr.saksi2_pekerjaan,

    // Khusus Surat Jual Beli / Pengoperan / Pengalihan Hak (Sesuai Rumus Presisi Pengguna)
    nama_pihak_pertama: dr.penjual_nama || dr.pemberi_nama || dr.pihak1_nama || dr.nama_penjual || '',
    nama_pihak_1: dr.penjual_nama || dr.pemberi_nama || dr.pihak1_nama || dr.nama_penjual || '',
    umur_pihak_pertama: dr.penjual_umur || dr.pemberi_umur || ageFrom(dr.pembeli_tanggal_lahir || dr.penjual_tanggal_lahir || dr.pemberi_tanggal_lahir || dr.tanggal_lahir) || '',
    umur_pihak_1: dr.penjual_umur || dr.pemberi_umur || ageFrom(dr.pembeli_tanggal_lahir || dr.penjual_tanggal_lahir || dr.pemberi_tanggal_lahir || dr.tanggal_lahir) || '',
    pekerjaan: dr.penjual_pekerjaan || dr.pemberi_pekerjaan || dr.pekerjaan || '',
    pekerjaan_pihak_pertama: dr.penjual_pekerjaan || dr.pemberi_pekerjaan || dr.pekerjaan || '',
    alamat_pihak_pertama: dr.penjual_alamat || dr.pemberi_alamat || dr.alamat || '',

    nama_lengkap_pihak_kedua: dr.pembeli_nama || dr.penerima_nama || dr.pihak2_nama || record.nama,
    nama_pihak_kedua: dr.pembeli_nama || dr.penerima_nama || dr.pihak2_nama || record.nama,
    nama_pihak_2: dr.pembeli_nama || dr.penerima_nama || dr.pihak2_nama || record.nama,
    umur_pihak_kedua: dr.pembeli_umur || dr.penerima_umur || ageFrom(dr.pemberi_tanggal_lahir || dr.penerima_tanggal_lahir || dr.pembeli_tanggal_lahir) || '',
    umur_pihak_2: dr.pembeli_umur || dr.penerima_umur || ageFrom(dr.pemberi_tanggal_lahir || dr.penerima_tanggal_lahir || dr.pembeli_tanggal_lahir) || '',
    pekerjaan_pihak_kedua: dr.pembeli_pekerjaan || dr.penerima_pekerjaan || '',
    alamat_pihak_kedua: dr.pembeli_alamat || dr.penerima_alamat || dr.alamat || '',

    alamat_lokasi_tanah: dr.alamat_tanah || dr.jalan || '',
    pemilik_tanah_sebelah_utara: dr.batas_utara || dr.batas_barat || '',
    pemilik_tanah_sebelah_timur: dr.batas_timur || '',
    pemilik_tanah_sebelah_selatan: dr.batas_selatan || '',
    pemilik_tanah_sebelah_barat: dr.batas_barat || '',

    rp_harga_jual: formatRupiah(dr.harga_jual || dr.harga || dr.biaya || '0'),
    harga_jual: formatRupiah(dr.harga_jual || dr.harga || dr.biaya || '0'),
    terbilang_harga_jual: angkaKeTerbilang(dr.harga_jual || dr.harga || dr.biaya || '0'),
    terbilang_harga: angkaKeTerbilang(dr.harga_jual || dr.harga || dr.biaya || '0'),

    nama_saksi_pertama: dr.saksi1_nama || '',
    nama_saksi_kedua: dr.saksi2_nama || '',
    no_surat: values[normKey('nomor_surat')] || dr.nomor_surat || record.id,

    // Nomor surat & register tercetak.
    nomor_surat: values[normKey('nomor_surat')] || values[normKey('_nomorSuratTercetak')] || dr._nomorSuratTercetak || dr.nomor_surat || record.id,
    nomor_register: values[normKey('nomor_register')] || record.id,
    // Tahun pembelian/pemberian (tergantung layanan).
    tahun_pembelian: dr.tahun_pemberian || dr.tahun_pembelian || dr.tahun_penguasaan || '',
    tahun_pemberian: dr.tahun_pemberian || dr.tahun_pembelian || dr.tahun_penguasaan || '',
    tanggal_surat: fmtIdDate(now),
    tanggal: fmtIdDate(now),
    nama_desa: values[normKey('nama_desa')] || '',
    kecamatan: values[normKey('kecamatan')] || '',
    kabupaten: values[normKey('kabupaten')] || '',
    provinsi: values[normKey('provinsi')] || ''
  };
  Object.keys(alias).forEach((k) => { if (alias[k]) values[normKey(k)] = alias[k]; });

  // Pihak konteks berdasarkan jenis layanan (Hibah / Jual Beli / Ahli Waris)
  const lay = String(record.layanan || '').toLowerCase();
  if (lay.includes('hibah')) {
    if (!values[normKey('nama_penerima')]) set('nama_penerima', record.nama);
    if (!values[normKey('penerima_nama')]) set('penerima_nama', record.nama);
  } else if (lay.includes('jual') || lay.includes('beli')) {
    if (!values[normKey('nama_pembeli')]) set('nama_pembeli', record.nama);
    if (!values[normKey('pembeli_nama')]) set('pembeli_nama', record.nama);
  }

  // Nilai manual dari input pengguna (panel "field kosong") — menang atas alias.
  if (extraValues && typeof extraValues === 'object') {
    Object.keys(extraValues).forEach((k) => {
      const v = extraValues[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') values[normKey(k)] = String(v);
    });
  }

  // Format seluruh nama orang menjadi HURUF BESAR SEMUA (UPPERCASE).
  const nameKeys = [
    'nama', 'namapemohon', 'namalengkap', 'pemohon',
    'penerimanama', 'namapenerima', 'penerima',
    'pemberinama', 'namapemberi', 'pemberi',
    'pembelinama', 'namapembeli', 'pembeli',
    'penjualnama', 'namapenjual', 'penjual',
    'ahliwarisnama', 'namaahliwaris', 'ahliwaris',
    'saksi1nama', 'namasaksi1', 'saksi1',
    'saksi2nama', 'namasaksi2', 'saksi2',
    'kepaladesa', 'namakepaladesa', 'lurah', 'lurahnama',
    'pihak1', 'pihak2', 'namapihak1', 'namapihak2'
  ];

  Object.keys(values).forEach((k) => {
    const isNameField = nameKeys.includes(k) || k.includes('nama') || k.includes('saksi');
    const isPlaceField = k.includes('desa') || k.includes('jalan') || k.includes('kecamatan') || k.includes('kabupaten') || k.includes('provinsi');
    
    if (isNameField && !isPlaceField && typeof values[k] === 'string') {
      values[k] = values[k].toUpperCase();
    }
  });

  return values;
}

// Ganti placeholder {{key}} di dalam teks menggunakan nilai yang tersedia.
// Kembalikan { text, filled: [keys], missing: [keys] }.
function fillPlaceholders(text, values) {
  let out = text;
  const found = extractPlaceholders(text);
  const filled = [];
  const missing = [];
  found.forEach((key) => {
    const k = normKey(key);
    let val = values[k];
    // Beberapa alias: tanggal_lahir dsb. Bisa berformat ISO -> ubah ke id-ID.
    if (val !== undefined && val !== null && val !== '') {
      if (key.toLowerCase().includes('tanggal') && /^\d{4}-\d{2}-\d{2}(T|$)/.test(String(val))) {
        val = fmtIdDate(val);
      }
      // Ganti placeholder walau ada spasi di dalam kurung: {{nama}} / {{ nama }}.
      const escKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('\\{\\{\\s*' + escKey + '\\s*\\}\\}', 'g');
      out = out.replace(re, val);
      filled.push(key);
    } else {
      missing.push(key);
    }
  });
  return { text: out, filled, missing };
}

// Ubah struktur Google Docs (paragraph + tabel) menjadi HTML sederhana.
function paragraphToHtmlObj(p, values) {
  if (!p || !p.elements) return { html: '', filled: [], missing: [] };
  
  const alignMap = { CENTER: 'center', JUSTIFY: 'justify', RIGHT: 'right', LEFT: 'left' };
  const align = (p.paragraphStyle && p.paragraphStyle.alignment) ? alignMap[p.paragraphStyle.alignment] || 'left' : 'left';
  const styleAttr = ` style="text-align:${align}; margin:4px 0; line-height:1.55;"`;

  let inner = '';
  const allFilled = [];
  const allMissing = [];

  for (const elem of p.elements) {
    if (elem.textRun && elem.textRun.content) {
      const raw = elem.textRun.content;
      const { text, filled, missing } = fillPlaceholders(raw, values);
      allFilled.push(...filled);
      allMissing.push(...missing);

      let formatted = escHtml(text).replace(/\n/g, '<br/>');
      const ts = elem.textRun.textStyle || {};
      if (ts.bold) formatted = `<strong>${formatted}</strong>`;
      if (ts.underline) formatted = `<u>${formatted}</u>`;
      if (ts.italic) formatted = `<em>${formatted}</em>`;
      inner += formatted;
    }
  }

  if (!inner.trim() || inner === '<br/>') {
    return { html: `<p${styleAttr}>&nbsp;</p>`, filled: allFilled, missing: allMissing };
  }

  return { html: `<p${styleAttr}>${inner}</p>`, filled: allFilled, missing: allMissing };
}

function docToHtml(doc, values) {
  const parts = [];
  const content = doc.body && doc.body.content ? doc.body.content : [];
  for (const el of content) {
    if (el.paragraph) {
      const res = paragraphToHtmlObj(el.paragraph, values);
      parts.push(res);
    } else if (el.table) {
      const rows = el.table.tableRows || [];
      let tbl = '<table class="doc-layout-table" style="width:100%; border-collapse:collapse; margin:8px 0; border:none;">';
      const tblFilled = [];
      const tblMissing = [];

      rows.forEach((r) => {
        tbl += '<tr>';
        (r.tableCells || []).forEach((c) => {
          let cellHtml = '';
          (c.content || []).forEach((x) => {
            if (x.paragraph) {
              const res = paragraphToHtmlObj(x.paragraph, values);
              cellHtml += res.html;
              tblFilled.push(...res.filled);
              tblMissing.push(...res.missing);
            }
          });
          tbl += `<td style="padding:3px 6px; vertical-align:top; border:none;">${cellHtml || '&nbsp;'}</td>`;
        });
        tbl += '</tr>';
      });
      tbl += '</table>';
      parts.push({ filled: tblFilled, missing: tblMissing, html: tbl });
    }
  }
  const filled = [...new Set(parts.flatMap((p) => p.filled))];
  const missing = [...new Set(parts.flatMap((p) => p.missing))];
  return { html: parts.map((p) => p.html).join('\n'), filled, missing, title: doc.title || '' };
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Kunci pengaturan untuk menyimpan link/ID template Google Docs & Daftar Jenis Surat (disimpan sekali, bisa diubah).
const TEMPLATE_DOCS_KEY = 'google_docs_template_link';
const JENIS_DOCS_KEY = 'google_docs_jenis_list';

const DEFAULT_DOC_TYPES = [
  { id: 'SPORADIK', nama: 'SPORADIK', icon: '📜' },
  { id: 'HIBAH', nama: 'Surat Hibah', icon: '🎁' },
  { id: 'JUALBELI', nama: 'Jual Beli', icon: '🤝' },
  { id: 'AHLIWARIS', nama: 'Ahli Waris', icon: '👨‍👩‍👧' },
  { id: 'LAINNYA', nama: 'Lainnya', icon: '📄' }
];

// GET /api/docs/jenis-list -> daftar jenis surat dinamis
app.get('/api/docs/jenis-list', requireAuth, async (req, res) => {
  try {
    const raw = await getPengaturan(JENIS_DOCS_KEY, null);
    let list = raw ? JSON.parse(raw) : DEFAULT_DOC_TYPES;
    res.json({ success: true, data: list });
  } catch (e) {
    res.json({ success: true, data: DEFAULT_DOC_TYPES });
  }
});

// POST /api/docs/jenis -> tambah/update jenis surat
app.post('/api/docs/jenis', requireAuth, requireRole('bendahara'), async (req, res) => {
  try {
    const { id, nama, icon } = req.body || {};
    if (!nama || !String(nama).trim()) return res.status(400).json({ success: false, error: 'Nama jenis surat harus diisi.' });

    const raw = await getPengaturan(JENIS_DOCS_KEY, null);
    let list = raw ? JSON.parse(raw) : [...DEFAULT_DOC_TYPES];

    const cleanId = String(id || nama).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
    const existingIndex = list.findIndex((item) => item.id === cleanId);

    const newItem = {
      id: cleanId,
      nama: String(nama).trim(),
      icon: String(icon || '📄').trim()
    };

    if (existingIndex >= 0) {
      list[existingIndex] = newItem;
    } else {
      list.push(newItem);
    }

    const { error } = await supabase.from(TABLE_SET).upsert(
      { kunci: JENIS_DOCS_KEY, nilai: JSON.stringify(list), updated_at: new Date().toISOString() },
      { onConflict: 'kunci' }
    );
    if (error) throw error;
    res.json({ success: true, data: list, item: newItem });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/docs/jenis/:id -> hapus jenis surat
app.delete('/api/docs/jenis/:id', requireAuth, requireRole('bendahara'), async (req, res) => {
  try {
    const targetId = String(req.params.id || '').trim().toUpperCase();
    const raw = await getPengaturan(JENIS_DOCS_KEY, null);
    let list = raw ? JSON.parse(raw) : [...DEFAULT_DOC_TYPES];

    list = list.filter((item) => item.id !== targetId);

    const { error } = await supabase.from(TABLE_SET).upsert(
      { kunci: JENIS_DOCS_KEY, nilai: JSON.stringify(list), updated_at: new Date().toISOString() },
      { onConflict: 'kunci' }
    );
    if (error) throw error;

    // Hapus juga template link yang tersimpan untuk jenis ini
    await supabase.from(TABLE_SET).delete().eq('kunci', `${TEMPLATE_DOCS_KEY}_${targetId}`);

    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/docs/template -> hapus link template jenis surat
app.delete('/api/docs/template', requireAuth, requireRole('bendahara'), async (req, res) => {
  try {
    const jenis = String(req.query.jenis || '').trim();
    const key = (jenis && jenis !== 'default') ? `${TEMPLATE_DOCS_KEY}_${jenis}` : TEMPLATE_DOCS_KEY;
    const { error } = await supabase.from(TABLE_SET).delete().eq('kunci', key);
    if (error) throw error;
    res.json({ success: true, jenis });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/docs/template -> ambil link template Google Docs yang tersimpan (dukung per jenis dokumen).
app.get('/api/docs/template', requireAuth, async (req, res) => {
  try {
    const jenis = String(req.query.jenis || '').trim();
    const key = (jenis && jenis !== 'default') ? `${TEMPLATE_DOCS_KEY}_${jenis}` : TEMPLATE_DOCS_KEY;
    let link = await getPengaturan(key, '');
    // Fallback ke template default jika per jenis belum diset
    if (!link && key !== TEMPLATE_DOCS_KEY) {
      link = await getPengaturan(TEMPLATE_DOCS_KEY, '');
    }
    res.json({ success: true, link: String(link || ''), jenis: jenis || 'default' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// PUT /api/docs/template -> simpan / ubah link template Google Docs (dukung per jenis dokumen).
app.put('/api/docs/template', requireAuth, requireRole('bendahara'), async (req, res) => {
  try {
    const link = String((req.body && (req.body.link || req.body.url)) || '').trim();
    const jenis = String((req.body && req.body.jenis) || '').trim();
    if (!link) return res.status(400).json({ success: false, error: 'Link/ID Google Docs tidak valid.' });
    const key = (jenis && jenis !== 'default') ? `${TEMPLATE_DOCS_KEY}_${jenis}` : TEMPLATE_DOCS_KEY;
    const { error } = await supabase.from(TABLE_SET).upsert(
      { kunci: key, nilai: link, updated_at: new Date().toISOString() },
      { onConflict: 'kunci' }
    );
    if (error) throw error;
    res.json({ success: true, link, jenis: jenis || 'default' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/docs/detect -> deteksi placeholder dari link/ID Google Docs (tanpa data pendaftaran).
app.post('/api/docs/detect', requireAuth, async (req, res) => {
  try {
    const docId = extractDocId(req.body && (req.body.link || req.body.docId || req.body.url));
    if (!docId) return res.status(400).json({ success: false, error: 'Link/ID Google Docs tidak valid.' });
    const doc = await fetchDocContent(docId);
    const fullText = (doc.body.content || []).map((el) => {
      if (el.paragraph) return paragraphText(el.paragraph);
      return '';
    }).join('\n');
    const placeholders = extractAllPlaceholders(doc);
    res.json({ success: true, docId, title: doc.title || '', placeholders, preview: fullText.slice(0, 1500) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/docs/render -> isi placeholder dari data pendaftaran terpilih.
app.post('/api/docs/render', requireAuth, async (req, res) => {
  try {
    let docId = extractDocId(req.body && (req.body.link || req.body.docId || req.body.url));
    const idRegRaw = String((req.body && req.body.idReg) || '').trim();
    const idReg = extractRegId(idRegRaw);
    if (!idRegRaw) return res.status(400).json({ success: false, error: 'ID atau Nama pendaftaran wajib diisi.' });

    const record = await findRecordByRegOrName(idRegRaw);
    if (!record) return res.status(404).json({ success: false, error: 'Pendaftaran tidak ditemukan untuk: ' + idRegRaw });

    const recLayanan = String(record.layanan || '').toUpperCase();
    const requestedJenis = String(req.body && (req.body.jenis || req.body.jenisSurat) || '').trim().toUpperCase() || recLayanan || 'SPORADIK';
    const serviceTypes = ['HIBAH', 'JUALBELI', 'AHLIWARIS'];
    if (requestedJenis && serviceTypes.includes(requestedJenis) && recLayanan && requestedJenis !== recLayanan) {
      return res.status(400).json({
        success: false,
        error: `Layanan pendaftaran ${record.id} adalah ${recLayanan}. Hanya dokumen ${recLayanan} dan SPORADIK yang diperbolehkan untuk ID ini.`
      });
    }

    if (!docId) {
      const key = (requestedJenis && requestedJenis !== 'default') ? `${TEMPLATE_DOCS_KEY}_${requestedJenis}` : TEMPLATE_DOCS_KEY;
      let link = await getPengaturan(key, '');
      if (!link && key !== TEMPLATE_DOCS_KEY) {
        link = await getPengaturan(TEMPLATE_DOCS_KEY, '');
      }
      if (link) docId = extractDocId(link);
    }
    if (!docId) return res.status(400).json({ success: false, error: 'Link/ID Google Docs untuk jenis "' + requestedJenis + '" belum tersimpan di Supabase. Silakan atur link template di Tabel Master terlebih dahulu.' });

    const doc = await fetchDocContent(docId);
    const values = await buildDocValues(record, req.body && req.body.extraValues);
    const result = docToHtml(doc, values);

    // Tanggal lahir saksi dari data_raw / extraValues (untuk input date di panel kiri).
    let dr = {};
    try { dr = typeof record.data_raw === 'string' ? JSON.parse(record.data_raw || '{}') : (record.data_raw || {}); } catch (_) {}
    const ex = (req.body && req.body.extraValues) || {};
    const saksiDates = {
      saksi1_tanggal_lahir: ex.saksi1_tanggal_lahir || dr.saksi1_tanggal_lahir || dr.saksi1_ttl || dr.saksi1_tanggallahir || '',
      saksi2_tanggal_lahir: ex.saksi2_tanggal_lahir || dr.saksi2_tanggal_lahir || dr.saksi2_ttl || dr.saksi2_tanggallahir || ''
    };

    // Daftar SEMUA placeholder + nilai aktualnya (untuk panel input kiri).
    const fields = extractAllPlaceholders(doc).map((k) => {
      const nk = normKey(k);
      let v = values[nk];
      if (v !== undefined && v !== null) {
        if (k.toLowerCase().includes('tanggal') && /^\d{4}-\d{2}-\d{2}(T|$)/.test(String(v))) v = fmtIdDate(v);
        const s = String(v).trim();
        return { key: k, value: s, status: s ? 'filled' : 'missing' };
      }
      return { key: k, value: '', status: 'missing' };
    });

    res.json({ success: true, docId, idReg, title: result.title, html: result.html, filled: result.filled, missing: result.missing, fields, saksiDates });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Ekstrak SEMUA placeholder dari seluruh dokumen (termasuk di dalam tabel, header, footer, & footnote).
function extractAllPlaceholders(doc) {
  const found = [];
  const walk = (el) => {
    if (!el || typeof el !== 'object') return;
    if (el.paragraph) {
      extractPlaceholders(paragraphText(el.paragraph)).forEach((k) => { if (!found.includes(k)) found.push(k); });
    }
    if (el.table) {
      (el.table.tableRows || []).forEach((row) => {
        (row.tableCells || []).forEach((cell) => {
          (cell.content || []).forEach(walk);
        });
      });
    }
    if (Array.isArray(el)) el.forEach(walk);
  };
  (doc.body && doc.body.content || []).forEach(walk);
  if (doc.headers) Object.values(doc.headers).forEach((h) => (h.content || []).forEach(walk));
  if (doc.footers) Object.values(doc.footers).forEach((f) => (f.content || []).forEach(walk));
  if (doc.footnotes) Object.values(doc.footnotes).forEach((fn) => (fn.content || []).forEach(walk));
  return found;
}

// POST /api/docs/generate -> salin dokumen Google asli + isi placeholder LANGSUNG
// di dalam dokumen Google (bukan HTML). Format/layout asli terjaga, hasilnya
// berupa dokumen Google Docs yang bisa dibuka & dicetak langsung dari Google.
app.post('/api/docs/generate', requireAuth, async (req, res) => {
  try {
    let docId = extractDocId(req.body && (req.body.link || req.body.docId || req.body.url));
    const idRegRaw = String((req.body && req.body.idReg) || '').trim();
    const idReg = extractRegId(idRegRaw);
    if (!idRegRaw) return res.status(400).json({ success: false, error: 'ID atau Nama pendaftaran wajib diisi.' });

    let record = await findRecordByRegOrName(idRegRaw);
    if (!record) {
      const ev = (req.body && req.body.extraValues) || {};
      if (ev && typeof ev === 'object' && Object.keys(ev).length > 0) {
        record = {
          id: idRegRaw,
          nama: ev.nama || ev.nama_pihak_pertama || ev.nama_lengkap_pihak_kedua || idRegRaw,
          layanan: requestedJenis || 'SPORADIK',
          data_raw: ev
        };
      } else {
        return res.status(400).json({
          success: false,
          error: 'Pendaftaran "' + idRegRaw + '" tidak ditemukan di database. Silakan pilih ID Pendaftaran dari daftar pilihan.'
        });
      }
    }

    const requestedJenis = String(req.body && (req.body.jenis || req.body.jenisSurat) || '').trim().toUpperCase();
    const serviceTypes = ['HIBAH', 'JUALBELI', 'AHLIWARIS'];
    const recLayanan = String(record.layanan || '').toUpperCase();
    if (requestedJenis && serviceTypes.includes(requestedJenis) && recLayanan && requestedJenis !== recLayanan) {
      return res.status(400).json({
        success: false,
        error: `Layanan pendaftaran ${record.id} adalah ${recLayanan}. Hanya dokumen ${recLayanan} dan SPORADIK yang diperbolehkan untuk ID ini.`
      });
    }

    if (!docId) {
      const key = (requestedJenis && requestedJenis !== 'default') ? `${TEMPLATE_DOCS_KEY}_${requestedJenis}` : TEMPLATE_DOCS_KEY;
      let link = await getPengaturan(key, '');
      if (!link && key !== TEMPLATE_DOCS_KEY) {
        link = await getPengaturan(TEMPLATE_DOCS_KEY, '');
      }
      if (link) docId = extractDocId(link);
    }
    if (!docId) return res.status(400).json({ success: false, error: 'Link/ID Google Docs untuk jenis "' + requestedJenis + '" belum tersimpan di Supabase. Silakan atur link template di Tabel Master terlebih dahulu.' });

    const doc = await fetchDocContent(docId);
    const values = await buildDocValues(record, req.body && req.body.extraValues);

    // 1) Salin dokumen asli -> file baru di Drive (placeholder masih utuh).
    const newName = ((doc.title || 'Surat') + ' - ' + idReg).slice(0, 150);
    const newId = await copyDriveDoc(docId, newName);

    // 2) Kumpulkan daftar placeholder (dari dokumen asli, termasuk tabel, header, footer).
    const placeholders = extractAllPlaceholders(doc);

    // 3) Siapkan penggantian: value yang ada diganti; yang kosong dibiarkan
    //    tetap {{...}} agar terlihat belum diisi (bukan dihapus diam-diam).
    const replacements = [];
    const filled = [];
    const missing = [];
    placeholders.forEach((key) => {
      const k = normKey(key);
      let val = values[k];
      if (val !== undefined && val !== null && val !== '') {
        if (key.toLowerCase().includes('tanggal') && /^\d{4}-\d{2}-\d{2}(T|$)/.test(String(val))) {
          val = fmtIdDate(val);
        }
        replacements.push({ from: '{{' + key + '}}', to: String(val) });
        replacements.push({ from: '{' + key + '}}', to: String(val) });
        replacements.push({ from: '{{' + key + '}', to: String(val) });
        filled.push(key);
      } else {
        missing.push(key);
      }
    });

    // 4) Tulis nilai ke dokumen hasil salinan.
    if (replacements.length) await fillDocText(newId, replacements);

    const resultUrl = 'https://docs.google.com/document/d/' + newId + '/edit';
    const fields = placeholders.map((key) => {
      const nk = normKey(key);
      let v = values[nk];
      if (v !== undefined && v !== null) {
        if (key.toLowerCase().includes('tanggal') && /^\d{4}-\d{2}-\d{2}(T|$)/.test(String(v))) v = fmtIdDate(v);
        const s = String(v).trim();
        return { key, value: s, status: s ? 'filled' : 'missing' };
      }
      return { key, value: '', status: 'missing' };
    });
    res.json({ success: true, docId: newId, sourceDocId: docId, idReg, title: doc.title || '', url: resultUrl, filled, missing, placeholders, fields });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/docs/save -> simpan hasil render ke tabel surat_terbit (riwayat).
app.post('/api/docs/save', requireAuth, requireRole('bendahara'), async (req, res) => {
  try {
    const b = req.body || {};
    const idRegRaw = String(b.idReg || '').trim();
    const idReg = extractRegId(idRegRaw);
    const html = String(b.html || '');
    const title = String(b.title || '').trim() || 'Surat';
    if (!idReg) return res.status(400).json({ success: false, error: 'idReg wajib diisi.' });
    const docId = extractDocId(b.link || b.docId || b.url) || '';
    const generatedDocId = extractDocId(b.url || '') || '';
    // html boleh kosong bila ada dokumen Google hasil generate (dibuka via Google Docs).

    const { data, error } = await supabase.from(TABLE_DOCS).insert({
      id_registrasi: idReg,
      doc_id: docId,
      generated_doc_id: generatedDocId || null,
      judul: title,
      html_content: html,
      filled: b.filled || [],
      missing: b.missing || [],
      created_by: (req.auth && (req.auth.username || req.auth.name)) || null,
      created_at: new Date().toISOString()
    }).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/docs/history?reg=REG-xxx -> riwayat surat per pendaftaran.
app.get('/api/docs/history', requireAuth, async (req, res) => {
  try {
    const reg = String(req.query.reg || '').trim();
    let query = supabase.from(TABLE_DOCS).select('*').order('created_at', { ascending: false });
    if (reg) query = query.eq('id_registrasi', reg);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/docs/history/:id -> hapus riwayat surat.
app.delete('/api/docs/history/:id', requireAuth, requireRole('bendahara'), async (req, res) => {
  try {
    const { data, error } = await supabase.from(TABLE_DOCS).delete().eq('id', req.params.id).select();
    if (error) throw error;
    res.json({ success: true, data: (data && data[0]) || null });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---------- Upload KK/KTP/dokumen per pendaftaran ----------
// Terima file dari form Edit pendaftaran -> upload ke Google Drive -> simpan
// LINK-nya di permohonan_uploads (konsisten: file biner tidak di database).
app.post('/api/permohonan/:id/upload', requireAuth, requireRole('bendahara', 'user'), async (req, res) => {
  try {
    const idReg = String(req.params.id || '').trim();
    const { jenis_upload, fileName, fileData } = req.body;
    if (!idReg) return res.status(400).json({ success: false, error: 'ID pendaftaran kosong.' });
    const jenis = String(jenis_upload || 'DOKUMEN').trim();
    if (!fileData || !/^data:/.test(String(fileData))) {
      return res.status(400).json({ success: false, error: 'fileData harus berupa base64 data-URL.' });
    }
    const mimeMatch = String(fileData).match(/^data:([^;]+);base64,(.+)$/s);
    if (!mimeMatch) return res.status(400).json({ success: false, error: 'Format data-URL tidak valid.' });
    const bytes = Buffer.from(mimeMatch[2], 'base64');
    if (bytes.length > 8 * 1024 * 1024) {
      return res.status(413).json({ success: false, error: 'Ukuran file melebihi 8 MB.' });
    }

    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REFRESH_TOKEN || !process.env.GOOGLE_DRIVE_FOLDER_ID) {
      return res.status(500).json({ success: false, error: 'Konfigurasi upload Google belum diatur di .env' });
    }

    const safeName = String(fileName || jenis + '_' + Date.now() + '.jpg').replace(/[\\/:*?"<>|]/g, '_');
    const url = await uploadToDrive(safeName, mimeMatch[1], bytes);
    const fileId = String(url).match(/\/d\/([^/?]+)/)?.[1] || safeName;

    // Hindari duplikat per (id_registrasi, jenis_upload): hapus yang lama dulu.
    await supabase.from(TABLE_UP).delete().eq('id_registrasi', idReg).eq('jenis_upload', jenis);

    const d = new Date();
    const ts = d.toLocaleString('id-ID', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const { data, error } = await supabase.from(TABLE_UP).insert({
      id_registrasi: idReg,
      jenis_upload: jenis,
      file_name: safeName,
      file_url: url,
      file_id: fileId,
      timestamp: ts,
      updated_at: d.toISOString(),
      synced_at: d.toISOString()
    }).select().single();
    if (error) throw error;

    res.json({ success: true, data, url });
  } catch (e) {
    console.error('[permohonan-upload] ERROR:', e && e.stack ? e.stack : e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// PATCH /api/keuangan/transaksi/:id -> Update transaksi (KHUSUS BENDAHARA / ADMIN)
app.patch('/api/keuangan/transaksi/:id', requireAuth, requireRole('bendahara'), async (req, res) => {
    try {
        const { id } = req.params;
        const { tanggal, jenis_transaksi, id_permohonan, nominal, keterangan, url_bukti } = req.body;

        const cleanIdPerm = clean(id_permohonan);
        const { data, error } = await supabase
            .from(TABLE_TRX)
            .update({ tanggal, jenis_transaksi, id_permohonan: cleanIdPerm, nominal, keterangan, url_bukti, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        res.json({ success: true, data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});


// DELETE /api/keuangan/transaksi/:id -> Hapus transaksi (KHUSUS BENDAHARA / ADMIN)
app.delete('/api/keuangan/transaksi/:id', requireAuth, requireRole('bendahara'), async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from(TABLE_TRX).delete().eq('id', id);
    if (error) throw error;
    await addTombstone(TOMBSTONE_TRANSAKSI, id);
    res.json({ success: true, message: 'Transaksi berhasil dihapus' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---------- Import manual transaksi keuangan dari Google Sheet (CSV publik) ----------
function parseCSV(text) {
  const rows = [];
  let cur = '', row = [], inQ = false;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function parseKeuTanggal(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s).toISOString();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!m) return null;
  const [, d, mo, y, hh, mm, ss] = m;
  // Waktu pada spreadsheet adalah waktu lokal (WITA); gunakan Date.UTC agar
  // hasilnya sama di mesin mana pun (Vercel berjalan pada UTC).
  const dt = new Date(Date.UTC(+y, +mo - 1, +d, +(hh || 0) - SHEET_TZ_H, +(mm || 0), +(ss || 0)));
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

// Parse waktu terakhir diubah pada spreadsheet (nilai tampilan seperti
// "29/6/2026, 20.50.56"). Mengembalikan epoch ms, atau null bila tidak dikenal.
function parseSheetTime(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const dt = new Date(s);
    return isNaN(dt.getTime()) ? null : dt.getTime();
  }
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[, ]\s*(\d{1,2})[.:](\d{1,2})(?:[.:](\d{1,2}))?)?/);
  if (!m) return null;
  const [, d, mo, y, hh, mm, ss] = m;
  const dt = new Date(Date.UTC(+y, +mo - 1, +d, +(hh || 0) - SHEET_TZ_H, +(mm || 0), +(ss || 0)));
  return isNaN(dt.getTime()) ? null : dt.getTime();
}

// POST /api/keuangan/import-from-sheet -> Tarik semua transaksi dari tab TRANSAKSI (upsert).
app.post('/api/keuangan/import-from-sheet', requireAuth, requireRole('bendahara'), async (req, res) => {
  try {
    const gasRes = await fetch(KEUANGAN_SHEET_URL, { redirect: 'follow' });
    if (!gasRes.ok) {
      return res.status(502).json({ success: false, error: 'Gagal mengambil spreadsheet (HTTP ' + gasRes.status + '). Pastikan tab dibagikan sebagai "Anyone with link" (viewer).' });
    }
    const csv = await gasRes.text();
    const rows = parseCSV(csv);
    if (rows.length < 2) {
      return res.status(400).json({ success: false, error: 'Spreadsheet kosong atau format CSV tidak dikenali.' });
    }
    const headers = rows[0].map((h) => String(h || '').trim().toUpperCase());
    const iId = headers.indexOf('ID_TRANSAKSI');
    const iTgl = headers.indexOf('TANGGAL');
    const iJenis = headers.indexOf('JENIS');
    const iNom = headers.indexOf('NOMINAL');
    const iPem = headers.indexOf('ID_PEMOHON');
    const iKet = headers.indexOf('KETERANGAN');
    const iUrl = headers.indexOf('URL_BUKTI');
    const iMod = headers.indexOf('MODIFIED_AT');
    if (iId < 0 || iTgl < 0 || iJenis < 0 || iNom < 0) {
      return res.status(400).json({ success: false, error: 'Kolom wajib (ID_TRANSAKSI / TANGGAL / JENIS / NOMINAL) tidak ditemukan di spreadsheet.' });
    }

    // Hanya tautkan id_permohonan yang benar-benar ada (hindari pelanggaran foreign key).
    const { data: permData } = await supabase.from(TABLE_DB).select('id');
    const permSet = new Set((permData || []).map((p) => p.id));

    // "Latest-wins": baris baru di-insert; baris lama hanya ditimpa bila waktu
    // MODIFIED_AT di sheet LEBIH BARU daripada updated_at di Supabase. Dengan
    // begitu edit transaksi di aplikasi (yang menaikkan updated_at) tidak akan
    // tertimpa, sedangkan transaksi baru/diubah lewat Apps Script (yang
    // menaikkan MODIFIED_AT) tetap tersinkron.
    const { data: trxExisting } = await supabase.from(TABLE_TRX).select('id, tanggal, updated_at');
    const exist = new Map((trxExisting || []).map((e) => [e.id, e]));

    const recs = [];
    let skipped = 0;
    const tombTransaksi = new Set(await getTombstone(TOMBSTONE_TRANSAKSI));
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const g = (n) => (n >= 0 && r[n] !== undefined) ? String(r[n]).trim() : '';
      const id = g(iId);
      if (!id) { skipped++; continue; }
      if (tombTransaksi.has(id)) { skipped++; continue; }
      const tanggal = parseKeuTanggal(g(iTgl));
      if (!tanggal) { skipped++; continue; }
      const sheetModMs = parseSheetTime(g(iMod));
      const cur = exist.get(id);
      if (cur) {
        const appMs = cur.updated_at ? new Date(cur.updated_at).getTime() : new Date(cur.tanggal).getTime();
        if (!sheetModMs || !(sheetModMs > appMs)) {
          // Belum pernah ada stempel, atau data di aplikasi sama/lebih baru -> pertahankan.
          skipped++;
          continue;
        }
      }
      const nominal = parseInt(g(iNom).replace(/[^0-9]/g, ''), 10) || 0;
      const pemohon = g(iPem);
      recs.push({
        id,
        tanggal,
        jenis_transaksi: g(iJenis) || 'Pemasukan Lainnya',
        id_permohonan: permSet.has(pemohon) ? pemohon : null,
        nominal,
        keterangan: g(iKet) || null,
        url_bukti: g(iUrl) || null,
        updated_at: sheetModMs ? new Date(sheetModMs).toISOString() : new Date().toISOString()
      });
    }

    const CHUNK = 200;
    let upserted = 0;
    for (let i = 0; i < recs.length; i += CHUNK) {
      const slice = recs.slice(i, i + CHUNK);
      const { error } = await supabase.from(TABLE_TRX).upsert(slice, { onConflict: 'id' });
      if (error) throw error;
      upserted += slice.length;
    }

    res.json({ success: true, table: TABLE_TRX, inserted: upserted, skipped, totalUpserted: upserted });
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