const fs = require('fs');
const f = 'src/services/queryService.js';
const s = fs.readFileSync(f, 'utf8');
const i = s.indexOf('const REGISTRY_SQL = `');
const j = s.indexOf('`;', i) + 2;
if (i === -1) { console.error('REGISTRY_SQL not found'); process.exit(1); }
const block = `const REGISTRY_SQL = \`
  SELECT bt.id                                       AS id,
         bt.name                                     AS name,
         CASE WHEN bt.environment IN ('live','pre_production')
              THEN 'LIVE' ELSE 'QA' END              AS environment,
         bt.environment                              AS env_label,
         bt.db_type                                  AS db_engine,
         COALESCE(bt.query_host, bt.host)            AS host,
         COALESCE(bt.query_port, bt.port)            AS port,
         bt.database_name                            AS db_name,
         bt.query_enabled                            AS query_enabled,
         COALESCE(bt.query_user, bt.username)        AS query_user,
         COALESCE(bt.query_pass_enc, bt.password)    AS query_pass_enc
    FROM backup_targets bt
   WHERE bt.is_active = 1
     AND bt.db_type IN ('mysql','postgresql')
\`;`;
fs.writeFileSync(f, s.slice(0, i) + block + s.slice(j));
console.log('REGISTRY_SQL updated');
