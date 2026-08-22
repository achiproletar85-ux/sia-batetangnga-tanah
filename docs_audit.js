const { JSDOM } = require('jsdom');
const fs = require('fs');

let html = fs.readFileSync('public/index.html', 'utf8')
  .replace(/<script[\s\S]*?<\/script>/g, ''); // strip ALL scripts (incl. tailwind)
const appjs = fs.readFileSync('public/app.js', 'utf8');

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(window) {
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes('/api/permohonan/')) {
        const id = u.split('/api/permohonan/')[1].split('?')[0];
        return { ok: true, json: async () => ({ success: true, data: { id, nama: 'Budi', layanan: 'SPORADIK', data_raw: JSON.stringify({ nama_pemohon: 'Budi', luas_tanah: '100' }) } }) };
      }
      if (u.includes('/api/permohonan')) return { ok: true, json: async () => ({ success: true, data: [ { id: 'REG-123', nama: 'Budi', layanan: 'SPORADIK', data_raw: JSON.stringify({ nama_pemohon: 'Budi', luas_tanah: '100' }) } ] }) };
      if (u.includes('/api/uploads')) return { ok: true, json: async () => ({ success: true, data: [] }) };
      if (u.includes('/api/keuangan/status-semua')) return { ok: true, json: async () => ({ success: true, data: {} }) };
      if (u.includes('/api/docs/template')) return { ok: true, json: async () => ({ success: true, link: '' }) };
      if (u.includes('/api/docs/jenis-list')) return { ok: true, json: async () => ({ success: true, data: [] }) };
      if (u.includes('/api/docs/history')) return { ok: true, json: async () => ({ success: true, data: [] }) };
      if (u.includes('/api/docs/status')) return { ok: true, json: async () => ({ success: true, jsEnabled: false }) };
      return { ok: true, json: async () => ({ success: true, data: [] }) };
    };
    window.alert = (m) => console.log('[alert]', m);
    window.lucide = { createIcons() {} };
    window.tailwind = { config: {} };
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    try { window.localStorage.setItem('sta_auth_session', JSON.stringify({ token: 'test', role: 'admin', user: 'admin' })); } catch (e) {}
    window.addEventListener('error', (e) => console.log('[window error]', e.error && (e.error.stack || e.error.message)));
  }
});

const { window } = dom;
const { document } = window;

const script = document.createElement('script');
script.textContent = appjs;
try { document.body.appendChild(script); console.log('app.js injected OK'); }
catch (e) { console.log('[inject error]', e.stack || e.message); }

setTimeout(async () => {
  try {
    console.log('typeof openDocsForId =', typeof window.openDocsForId);
    console.log('typeof docsRenderAllLeftFields =', typeof window.docsRenderAllLeftFields);
    const el = document.getElementById('docsIdReg');
    console.log('docsIdReg exists =', !!el, 'value BEFORE =', JSON.stringify(el && el.value));
    await window.openDocsForId('REG-123');
    const after = document.getElementById('docsIdReg').value;
    console.log('docsIdReg.value AFTER =', JSON.stringify(after));
    const mf = document.getElementById('docsManualFields');
    console.log('manualFields children =', mf ? mf.children.length : 'NO EL');
    console.log('RESULT:', after === 'REG-123' ? 'PASS - ID filled' : 'FAIL - ID empty');
  } catch (e) {
    console.log('ERROR during openDocsForId:', e && e.stack ? e.stack : e);
  }
  process.exit(0);
}, 600);
