'use strict';
/**
 * BackupVault :: Mail service
 *
 * Replaces the `mailx -a` call in the shell script. mailx depends on a local
 * MTA being configured and gives no delivery feedback; SMTP returns a message
 * id and a real error when a send fails, which is what the run log needs.
 *
 *   npm install nodemailer
 */

const nodemailer = require('nodemailer');

let transport = null;

function getTransport() {
  if (transport) return transport;

  const host = process.env.SMTP_HOST;
  if (!host) throw new Error('SMTP_HOST is not set in .env — cannot send report mail.');

  transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',   // true for 465
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
    tls: { rejectUnauthorized: String(process.env.SMTP_TLS_STRICT || 'true') === 'true' },
    pool: true,
    maxConnections: 2,
  });

  return transport;
}

/**
 * @param {{to:string[], cc?:string[], subject:string, text:string,
 *          attachment:{filename:string, content:Buffer}}} opts
 */
async function sendReport(opts) {
  // BackupVault's existing .env uses FROM_USER; SMTP_FROM is honoured too.
  //const from = process.env.SMTP_FROM || process.env.FROM_USER_FOR_SALES || process.env.SMTP_USER;
  const from = process.env.FROM_USER_FOR_SALES || "sales_call_report@worktual.tech";
  if (!from) throw new Error('No sender configured — set FROM_USER or SMTP_FROM in .env.');
  const maxBytes = Number(process.env.MAIL_MAX_ATTACHMENT_MB || 15) * 1024 * 1024;

  if (opts.attachment.content.length > maxBytes) {
    throw new Error(
      `CSV is ${(opts.attachment.content.length / 1048576).toFixed(1)} MB, over the ` +
      `${maxBytes / 1048576} MB attachment limit. Narrow the report range or enable gzip.`
    );
  }

  const info = await getTransport().sendMail({
    from,
    to: opts.to.join(', '),
    cc: opts.cc && opts.cc.length ? opts.cc.join(', ') : undefined,
    subject: opts.subject,
    text: opts.text,
    attachments: [{
      filename: opts.attachment.filename,
      content: opts.attachment.content,
      contentType: 'text/csv; charset=utf-8',
    }],
  });

  console.log(`[mailService] sent "${opts.subject}" to ${opts.to.join(', ')} (${info.messageId})`);
  return info;
}

async function verify() {
  await getTransport().verify();
  return true;
}

module.exports = { sendReport, verify };
