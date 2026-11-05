'use strict';

const nodemailer = require('nodemailer');

// Short limits: a caller waits on the first attempt, and retries run in the background.
const TIMEOUTS = { connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 };

/** SMTP settings come from the environment and must never be logged. */
function isConfigured(env = process.env) {
  return Boolean(String(env.SMTP_HOST || '').trim() && String(env.MAIL_FROM || '').trim());
}

/** Rejects when the mail is not accepted. TLS is required and its certificate checks stay on. */
async function sendMail({ to, subject, text, html }, env = process.env) {
  const port = Number(env.SMTP_PORT) || 587;
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } } : {}),
    ...TIMEOUTS,
  });
  try {
    await transport.sendMail({ from: env.MAIL_FROM, to, subject, text, html });
  } finally {
    transport.close();
  }
}

module.exports = { isConfigured, sendMail };
