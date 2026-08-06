const db = require('./services/database');
const rows = db.db.prepare('SELECT id, config_id, target, status FROM real_client_builds ORDER BY created_at DESC LIMIT 10').all();
console.log(JSON.stringify(rows, null, 2));
