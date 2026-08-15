// Entry serverless Vercel: seluruh request API dialihkan (rewrite) ke fungsi ini.
const { app } = require('../server');

module.exports = app;
