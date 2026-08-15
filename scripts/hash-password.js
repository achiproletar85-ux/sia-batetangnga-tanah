// Alat bantu membuat password hash untuk akun petugas di tabel app_users.
// Penggunaan:
//   node scripts/hash-password.js "sandiPetugas"
// Output (tempel ke kolom password_hash saat INSERT akun baru):
//   salt:hash_base64url
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1;

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const buf = await scrypt(String(pw), salt, 32, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return salt + ':' + buf.toString('base64url');
}

(async () => {
  const pw = process.argv[2] || '';
  if (!pw) {
    console.error('Contoh: node scripts/hash-password.js "sandiPetugas"');
    process.exit(1);
  }
  if (pw.length < 6) {
    console.error('Password minimal 6 karakter.');
    process.exit(1);
  }
  console.log(await hashPassword(pw));
})().catch((e) => { console.error(e); process.exit(1); });
