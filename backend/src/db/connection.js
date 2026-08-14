// backend/src/db/connection.js
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || '3306'),
  user:               process.env.DB_USER     || 'backupvault',
  password:           process.env.DB_PASSWORD || 'backupvault@12',
  database:           process.env.DB_NAME     || 'backupvault',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  timezone:           '+05:30',
});

pool.getConnection()
  .then(c => { console.log(`[DB] Connected as '${process.env.DB_USER}' @ ${process.env.DB_HOST}/${process.env.DB_NAME}`); c.release(); })
  .catch(e => console.error('[DB] Connection FAILED:', e.message));

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}
async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

module.exports = { pool, query, queryOne };
