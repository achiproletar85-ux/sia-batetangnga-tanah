const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  // Throw (bukan process.exit) agar aman di serverless (Vercel) — modul gagal dimuat
  // dengan pesan jelas tanpa mematikan runtime.
  throw new Error('❌ ERROR: SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY tidak ditemukan di .env');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { params: { eventsPerSecond: 10 } }
});

console.log('✅ Supabase connected (sync-surat-tanah)');
module.exports = supabase;