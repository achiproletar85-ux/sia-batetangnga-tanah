// Entry serverless Vercel: seluruh request dialihkan (rewrite) ke fungsi ini,
// lalu diteruskan ke aplikasi Express yang menangani API + statis (public/).
const { app } = require('../server');
module.exports = app;
