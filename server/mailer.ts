import nodemailer from 'nodemailer';

// ============================================================
// Módulo compartilhado de E-mail — PortALL
// Verifica se as variáveis SMTP estão configuradas antes de enviar.
// ============================================================

function createMailer() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: parseInt(process.env.SMTP_PORT || '587') === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });
}

export function isMailConfigured(): boolean {
  const hasHost = !!process.env.SMTP_HOST && process.env.SMTP_HOST !== 'smtp.seuservidor.com.br';
  const hasUser = !!process.env.SMTP_USER && !process.env.SMTP_USER.includes('seudomain');
  const hasPass = !!process.env.SMTP_PASS && process.env.SMTP_PASS !== 'SUA_SENHA_SMTP';
  return hasHost && hasUser && hasPass;
}

export async function sendMail(options: {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
  attachments?: any[];
}): Promise<{ success: boolean; error?: string }> {
  if (!isMailConfigured()) {
    console.warn('⚠️  [MAILER] Envio de e-mail ignorado: variáveis SMTP não configuradas (SMTP_HOST, SMTP_USER, SMTP_PASS).');
    console.warn('    Configure essas variáveis no painel do CapRover → App Configs → Environment Variables.');
    return { success: false, error: 'SMTP não configurado' };
  }

  const mailer = createMailer();
  const from = options.from || `"PortALL" <${process.env.SMTP_USER}>`;

  try {
    await mailer.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      attachments: options.attachments,
    });
    console.log(`✅ [MAILER] E-mail enviado para: ${Array.isArray(options.to) ? options.to.join(', ') : options.to}`);
    return { success: true };
  } catch (err: any) {
    console.error('❌ [MAILER] Falha ao enviar e-mail:', err.message || err);
    return { success: false, error: err.message || String(err) };
  }
}
