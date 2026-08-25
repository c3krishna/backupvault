const fs = require('fs');
let changed = 0;
for (const f of ['src/services/queryService.js', 'src/services/reportService.js']) {
  if (!fs.existsSync(f)) continue;
  let s = fs.readFileSync(f, 'utf8');
  if (s.includes('__bvNormalise')) { console.log(`${f} — already adapted`); continue; }
  const m = s.match(/const appDb = require\('([^']+)'\)([^;]*);/);
  if (!m) { console.log(`${f} — appDb import not found`); continue; }
  const adapter =
`const __bvPool = require('${m[1]}')${m[2]};
// BackupVault's pool wrapper resolves to rows directly; mysql2 resolves to
// [rows, fields]. Normalise so this service can destructure either shape.
const __bvNormalise = (r) => (Array.isArray(r) && Array.isArray(r[0]) ? r : [r || [], []]);
const appDb = { query: async (sql, params) => __bvNormalise(await __bvPool.query(sql, params)) };`;
  fs.writeFileSync(f, s.replace(m[0], adapter));
  console.log(`${f} — adapter installed`);
  changed++;
}
console.log(changed ? 'done' : 'nothing changed');
