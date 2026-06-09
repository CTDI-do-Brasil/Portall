import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { query, queryOne } from '../db.js';
import { 
  generateToken, 
  requireAuth, 
  blacklistToken,
  AuthRequest,
  JWT_SECRET
} from './middleware.js';
import jwt from 'jsonwebtoken';

const router = Router();

// ============================================================
// Configuração de email
// ============================================================
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'localhost',
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

// ============================================================
// POST /api/auth/login
// ============================================================
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email e senha são obrigatórios.' });
      return;
    }

    // Busca o usuário pelo email (case-insensitive)
    const user = await queryOne<{
      id: string;
      email: string;
      display_name: string;
      password_hash: string;
      role: 'master' | 'admin' | 'viewer';
      company_id: string;
      is_active: boolean;
      is_safety: boolean;
    }>(
      `SELECT id, email, display_name, password_hash, role, company_id, is_active, is_safety
       FROM users 
       WHERE LOWER(email) = LOWER($1)`,
      [email.trim()]
    );

    if (!user) {
      // Tempo constante para evitar user enumeration
      await bcrypt.compare('dummy', '$2a$12$dummyhashfordummycomparison00000000000000');
      res.status(401).json({ error: 'E-mail ou senha incorretos.' });
      return;
    }

    if (!user.is_active) {
      res.status(401).json({ error: 'Conta desativada. Contate o administrador.' });
      return;
    }

    const passwordValid = await bcrypt.compare(password, user.password_hash);

    if (!passwordValid) {
      res.status(401).json({ error: 'E-mail ou senha incorretos.' });
      return;
    }

    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      companyId: user.company_id,
      isSafety: user.is_safety
    });

    res.json({
      token,
      user: {
        uid: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        companyId: user.company_id,
        isSafety: user.is_safety,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// ============================================================
// POST /api/auth/logout
// ============================================================
router.post('/logout', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const authHeader = req.headers.authorization!;
    const token = authHeader.split(' ')[1];

    // Decodifica para pegar expiração
    const decoded = jwt.decode(token) as { exp: number };
    const expiresAt = new Date(decoded.exp * 1000);

    await blacklistToken(token, expiresAt);

    res.json({ success: true, message: 'Sessão encerrada com sucesso.' });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Erro ao encerrar sessão.' });
  }
});

// ============================================================
// GET /api/auth/me - Retorna perfil do usuário logado
// ============================================================
router.get('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await queryOne<{
      id: string;
      email: string;
      display_name: string;
      role: 'master' | 'admin' | 'viewer';
      company_id: string;
      company_name: string;
      is_safety: boolean;
      created_at: string;
    }>(
      `SELECT u.id, u.email, u.display_name, u.role, u.company_id, c.name as company_name, u.is_safety, u.created_at
       FROM users u
       LEFT JOIN companies c ON u.company_id = c.id
       WHERE u.id = $1 AND u.is_active = TRUE`,
      [req.user!.userId]
    );

    if (!user) {
      res.status(401).json({ error: 'Usuário não encontrado.' });
      return;
    }

    res.json({
      uid: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      companyId: user.company_id,
      companyName: user.company_name,
      isSafety: user.is_safety,
      createdAt: user.created_at,
    });
  } catch (err) {
    console.error('Auth/me error:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// ============================================================
// POST /api/auth/forgot-password
// ============================================================
router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ error: 'Email é obrigatório.' });
      return;
    }

    const user = await queryOne<{ id: string; email: string; display_name: string }>(
      `SELECT id, email, display_name FROM users WHERE LOWER(email) = LOWER($1) AND is_active = TRUE`,
      [email.trim()]
    );

    if (!user) {
      res.status(404).json({ error: 'E-mail não cadastrado em nosso sistema.' });
      return;
    }

    // Gera token seguro (64 bytes hex)
    const resetToken = crypto.randomBytes(64).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    await query(
      `UPDATE users 
       SET reset_token = $1, reset_token_expires = $2
       WHERE id = $3`,
      [resetTokenHash, expiresAt, user.id]
    );

    const appUrl = process.env.APP_URL || 'https://portall.ehspro.com.br';
    const resetUrl = `${appUrl}/?reset_token=${resetToken}`;

    // Envia email
    await mailer.sendMail({
      from: `"PortALL" <${process.env.SMTP_USER}>`,
      to: user.email,
      subject: 'Redefinição de Senha — PortALL',
      html: `
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head><meta charset="UTF-8"></head>
        <body style="font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 40px 20px;">
          <div style="max-width: 500px; margin: 0 auto; background: white; border-radius: 16px; padding: 40px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
            <div style="text-align: center; margin-bottom: 32px;">
              <img src="${process.env.APP_URL || 'https://portall.ehspro.com.br'}/LogoApenas.png" alt="PortALL" style="height: 48px; margin-bottom: 8px; object-fit: contain;">
              <p style="color: #6b7280; margin: 0;">Gestão de Acessos e Terceiros</p>
            </div>
            <h2 style="color: #1f2937; font-size: 18px;">Olá, ${user.display_name}!</h2>
            <p style="color: #4b5563; line-height: 1.6;">
              Recebemos uma solicitação para redefinir sua senha. Clique no botão abaixo para criar uma nova senha:
            </p>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${resetUrl}" 
                 style="background-color: #002b5c; color: white; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: bold; display: inline-block;">
                Redefinir Minha Senha
              </a>
            </div>
            <p style="color: #9ca3af; font-size: 13px; text-align: center;">
              Este link é válido por <strong>1 hora</strong>.<br>
              Se você não solicitou a redefinição, ignore este e-mail.
            </p>
            <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 24px 0;">
            <p style="color: #9ca3af; font-size: 11px; text-align: center;">
              PortALL &copy; ${new Date().getFullYear()} — Gestão de Acessos
            </p>
          </div>
        </body>
        </html>
      `,
    }).catch(err => console.error('Email send error:', err));

    res.json({ message: 'Link enviado! Verifique seu e-mail.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Erro interno ao processar solicitação.' });
  }
});

// ============================================================
// POST /api/auth/reset-password
// ============================================================
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      res.status(400).json({ error: 'Token e nova senha são obrigatórios.' });
      return;
    }

    if (newPassword.length < 8) {
      res.status(400).json({ error: 'A senha deve ter no mínimo 8 caracteres.' });
      return;
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const user = await queryOne<{ id: string }>(
      `SELECT id FROM users 
       WHERE reset_token = $1 
         AND reset_token_expires > NOW()
         AND is_active = TRUE`,
      [tokenHash]
    );

    if (!user) {
      res.status(400).json({ error: 'Token inválido ou expirado.' });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await query(
      `UPDATE users 
       SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL
       WHERE id = $2`,
      [passwordHash, user.id]
    );

    res.json({ message: 'Senha redefinida com sucesso. Faça login com sua nova senha.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// ============================================================
// POST /api/auth/change-password (usuário logado)
// ============================================================
router.post('/change-password', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
      return;
    }

    if (newPassword.length < 8) {
      res.status(400).json({ error: 'A nova senha deve ter no mínimo 8 caracteres.' });
      return;
    }

    const user = await queryOne<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user!.userId]
    );

    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Senha atual incorreta.' });
      return;
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [newHash, req.user!.userId]
    );

    res.json({ message: 'Senha alterada com sucesso.' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

export default router;
