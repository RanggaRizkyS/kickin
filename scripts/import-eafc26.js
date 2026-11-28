'use strict';

require('dotenv').config();
const { connect, close } = require('../src/db');

(async () => {
  try {
    await connect();
    console.log('[IMPORT] EAFC26 catalog is available in MariaDB.');
  } catch (error) {
    console.error('[IMPORT ERROR]', error.stack || error.message);
    process.exitCode = 1;
  } finally {
    await close().catch(() => {});
  }
})();
