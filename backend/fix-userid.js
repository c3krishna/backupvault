const fs = require('fs');
const OLD = "const id = u.id ?? u.userId ?? u.user_id ?? u.uid ?? u.sub ?? null;";
const NEW = 'const id = u.id ?? u.userId ?? u.user_id ?? u.uid ?? u.sub ?? (function () {\n' +
  '    for (const k of Object.keys(u)) {\n' +
  '      if (/(^|_)id$|Id$|ID$/.test(k)) {\n' +
  '        const v = u[k];\n' +
  '        if (typeof v === "number" || /^\\d+$/.test(String(v))) return Number(v);\n' +
  '      }\n' +
  '    }\n' +
  '    return null;\n' +
  '  })();\n' +
  '  if (process.env.DEBUG_USER) console.log("[req.user keys]", Object.keys(u), JSON.stringify(u));';

let n = 0;
for (const f of ['src/controllers/queryController.js', 'src/controllers/reportController.js']) {
  if (!fs.existsSync(f)) { console.log(f + ' - missing'); continue; }
  const s = fs.readFileSync(f, 'utf8');
  if (s.indexOf('id-ish') !== -1 || s.indexOf('DEBUG_USER') !== -1) { console.log(f + ' - already patched'); continue; }
  if (s.indexOf(OLD) === -1) { console.log(f + ' - currentUser not in expected form'); continue; }
  fs.writeFileSync(f, s.replace(OLD, NEW));
  console.log(f + ' - id resolution widened');
  n++;
}
console.log(n ? 'done' : 'nothing changed');
