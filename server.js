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

app.patch('/api/permohonan/:id', requireAuth, requireRole('bendahara'), async (req, res) => {
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


// GET /api/keuangan/ringkasan -> Ringkasan total keuangan (khusus Bendahara)
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

// GET /api/keuangan/transaksi -> Daftar semua transaksi dengan filter (khusus Bendahara)
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

// POST /api/keuangan/transaksi -> Tambah transaksi baru
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

    const { data, error } = await supabase
      .from(TABLE_TRX)
      .insert([{ tanggal, jenis_transaksi, id_permohonan, nominal, keterangan, url_bukti, updated_at: new Date().toISOString() }])
      .select()
      .single();
    
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---------- Upload bukti ke Google Drive ----------
// File biner TIDAK disimpan di Supabase. Jalur: OAuth pribadi (refresh token)
// dari akun Google pemilik folder -> upload langsung ke Google Drive API v3.
// Env yang dibutuhkan:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_DRIVE_FOLDER_ID
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

    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REFRESH_TOKEN || !process.env.GOOGLE_DRIVE_FOLDER_ID) {
      return res.status(500).json({ success: false, error: 'Konfigurasi upload Google belum diatur di .env' });
    }
    const url = await uploadToDrive(fileName || 'bukti_' + Date.now() + '.jpg', mime, bytes);
    res.json({ success: true, url });
  } catch (e) {
    console.error('[upload-bukti] ERROR:', e && e.stack ? e.stack : e);
    res.status(500).json({ success: false, error: e.message });
  }
});

async function googleAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('Gagal refresh token Google: ' + (j.error_description || j.error));
  return j.access_token;
}

async function uploadToDrive(fileName, mime, bytes) {
  const token = await googleAccessToken();
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
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

// PATCH /api/keuangan/transaksi/:id -> Update transaksi
app.patch('/api/keuangan/transaksi/:id', requireAuth, requireRole('bendahara'), async (req, res) => {
    try {
        const { id } = req.params;
        const { tanggal, jenis_transaksi, id_permohonan, nominal, keterangan, url_bukti } = req.body;

        const { data, error } = await supabase
            .from(TABLE_TRX)
            .update({ tanggal, jenis_transaksi, id_permohonan, nominal, keterangan, url_bukti, updated_at: new Date().toISOString() })
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