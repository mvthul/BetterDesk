const db = require('better-sqlite3')('test.db');
db.prepare('SELECT 1').get();
process.exit(1);
