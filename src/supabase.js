const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

let supabase;

const missingErr = {
  message: 'Konfigurasi Database Belum Lengkap: SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum diatur dengan benar di Vercel Environment Variables.'
};

const makeChain = () => ({
  select: () => makeChain(),
  insert: () => makeChain(),
  update: () => makeChain(),
  upsert: () => makeChain(),
  delete: () => makeChain(),
  eq: () => makeChain(),
  order: () => makeChain(),
  maybeSingle: () => Promise.resolve({ data: null, error: missingErr }),
  single: () => Promise.resolve({ data: null, error: missingErr }),
  then: (resolve) => resolve({ data: null, error: missingErr })
});

if (!supabaseUrl || !supabaseKey) {
  console.warn('⚠️ WARNING: SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY tidak ditemukan di environment variables.');
  supabase = { from: () => makeChain() };
} else {
  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 10 } }
    });
    console.log('✅ Supabase connected (sync-surat-tanah)');
  } catch (err) {
    console.error('❌ Gagal membuat Supabase client:', err.message);
    supabase = { from: () => makeChain() };
  }
}

module.exports = supabase;