#!/usr/bin/env node
'use strict';
/**
 * CLI runner for cron — the direct replacement for the shell script.
 *
 *   node bin/run-report.js daily-call-report --email
 *   node bin/run-report.js daily-call-report --date=2026-08-24 --email
 *   node bin/run-report.js daily-call-report --to=ops@company.com,noc@company.com --email
 *   node bin/run-report.js daily-call-report --save=/opt/report/reports
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const reportService = require('../src/services/reportService');
const queryService = require('../src/services/queryService');

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

(async () => {
  const key = process.argv[2];
  if (!key) {
    console.error('Usage: run-report.js <report-key> [--date=YYYY-MM-DD] [--domain=ID] [--email] [--to=a@b,c@d] [--save=DIR]');
    process.exit(2);
  }

  const params = {};
  if (arg('date')) params.reportDate = arg('date');
  if (arg('domain')) params.domainId = arg('domain');

  const started = Date.now();
  console.log(`[${new Date().toISOString()}] Started : ${key}`);

  const run = await reportService.runReport({
    key,
    params,
    user: { id: 0, username: 'cron' },
    trigger: 'schedule',
  });

  for (const s of run.steps || []) {
    console.log(`  step ${s.id} @ ${s.connection}: ${s.rows} rows in ${s.durationMs} ms`);
  }
  console.log(`  merged: ${run.totalRows} rows in ${run.durationMs} ms`);

  const payload = await queryService.readCache(run.executionId);

  const saveDir = arg('save');
  if (saveDir) {
    const def = await reportService.loadDefinition(key);
   // const stamp = (params.reportDate || run.params.reportDate || '').replace(/-/g, '');
  //  const file = path.join(saveDir, (def.email?.attachAs || `${key}-{{d}}.csv`).replace(/\{\{[^}]+\}\}/g, stamp));
	  const reportDate =
    params.reportDate ||
    run.params.reportDate ||
    new Date().toISOString().slice(0, 10);   // YYYY-MM-DD

const file = path.join(
    saveDir,
    (def.email?.attachAs || `${key}.csv`)
        .replace(/\{\{today\}\}/g, reportDate)
        .replace(/\{\{reportDate\}\}/g, reportDate)
        .replace(/\{\{todayCompact\}\}/g, reportDate.replace(/-/g, ''))
);
    fs.mkdirSync(saveDir, { recursive: true });
    fs.writeFileSync(file, reportService.buildCsv(payload.columns, payload.rows));
    console.log(`  saved  : ${file}`);
  }

  if (flag('email')) {
    const recipients = arg('to') ? arg('to').split(',').map((s) => s.trim()).filter(Boolean) : null;
    const out = await reportService.emailReport({
      executionId: run.executionId,
      key,
      recipients,
      user: { id: 0, username: 'cron', isAdmin: true },
      trigger: 'schedule',
    });
    console.log(`  mailed : ${out.filename} (${(out.bytes / 1024).toFixed(1)} KB) -> ${out.to.join(', ')}`);
  }

  console.log(`[${new Date().toISOString()}] Finished in ${Date.now() - started} ms`);
  process.exit(0);
})().catch((err) => {
  console.error(`[${new Date().toISOString()}] FAILED :`, err.message);
  process.exit(1);
});
