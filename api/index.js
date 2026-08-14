// Entry serverless Vercel: seluruh request API dialihkan (rewrite) ke fungsi ini,
// lalu diteruskan ke aplikasi Express yang menangani API.
const { app } = require('../server');

module.exports = app;
