import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { requireAuth, requireAdmin, requireMaster, AuthRequest } from '../auth/middleware.js';
import { query, queryOne } from '../db.js';

const router = Router();

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

router.use(requireAuth);
router.use(requireAdmin); // Apenas master e admin entram nas rotas de usuário

// ============================================================
// GET /api/users - Lista usuários
// ============================================================
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    let users;
    
    if (req.user?.role === 'master') {
      // Master vê todos
      users = await query<{
        id: string;
        email: string;
        display_name: string;
        role: string;
        company_id: string;
        company_name: string;
        is_active: boolean;
        is_safety: boolean;
        created_at: string;
      }>(
        `SELECT u.id, u.email, u.display_name, u.role, u.company_id, c.name as company_name, u.is_active, u.is_safety, u.created_at
         FROM users u
         LEFT JOIN companies c ON u.company_id = c.id
         WHERE (u.role != 'master' OR $1 = 'master')
         ORDER BY u.display_name ASC`,
        [req.user?.role]
      );
    } else {
      // Admin vê usuários de TODAS as empresas vinculadas (e suas filiais)
      users = await query<{
        id: string;
        email: string;
        display_name: string;
        role: string;
        company_id: string;
        company_name: string;
        is_active: boolean;
        is_safety: boolean;
        created_at: string;
      }>(
        `SELECT DISTINCT u.id, u.email, u.display_name, u.role, u.company_id, c.name as company_name, u.is_active, u.is_safety, u.created_at
         FROM users u
         LEFT JOIN companies c ON u.company_id = c.id
         WHERE u.role != 'master' AND u.company_id IN (
           SELECT company_id FROM user_companies WHERE user_id = $1
           UNION
           SELECT c2.id FROM companies c2
           WHERE c2.parent_id IN (SELECT company_id FROM user_companies WHERE user_id = $1)
         )
         ORDER BY u.display_name ASC`,
        [req.user?.userId]
      );
    }

    res.json(users.map(u => ({
      uid: u.id,
      email: u.email,
      displayName: u.display_name,
      role: u.role,
      companyId: u.company_id,
      companyName: u.company_name,
      isSafety: u.is_safety,
      isActive: u.is_active,
      createdAt: u.created_at,
    })));
  } catch (err) {
    console.error('GET /users error:', err);
    res.status(500).json({ error: 'Erro ao buscar usuários.' });
  }
});

// ============================================================
// POST /api/users - Cria novo usuário
// ============================================================
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { email, displayName, role, companyId, isSafety } = req.body;

    if (!email || !displayName) {
      res.status(400).json({ error: 'Email e nome são obrigatórios.' });
      return;
    }

    const validRoles = ['master', 'admin', 'viewer'];
    const userRole = validRoles.includes(role) ? role : 'viewer';

    // Regras de hierarquia:
    // Admin não pode criar roles 'master' nem de outra 'company'
    let targetCompanyId = companyId;

    if (req.user?.role === 'admin') {
      if (userRole === 'master') {
         res.status(403).json({ error: 'Administradores não podem criar contas master.' });
         return;
      }
      // Admin usa a primeira empresa vinculada a ele (ou a que veio no body se válida)
      const linkedCompanies = await query<{ company_id: string }>(
        'SELECT company_id FROM user_companies WHERE user_id = $1 LIMIT 1',
        [req.user.userId]
      );
      targetCompanyId = (companyId && linkedCompanies.some(lc => lc.company_id === companyId))
        ? companyId
        : (linkedCompanies[0]?.company_id || req.user.companyId);
    }

    // Verifica se email já existe
    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      [email.trim()]
    );

    if (existing) {
      res.status(409).json({ error: 'Já existe um usuário com este e-mail.' });
      return;
    }

    const randomPassword = crypto.randomBytes(32).toString('hex');
    const passwordHash = await bcrypt.hash(randomPassword, 12);

    const user = await queryOne<{
      id: string;
      email: string;
      display_name: string;
      role: string;
      company_id: string;
      is_active: boolean;
      is_safety: boolean;
      created_at: string;
    }>(
      `INSERT INTO users (email, display_name, password_hash, role, company_id, is_safety)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, display_name, role, company_id, is_active, is_safety, created_at`,
      [email.trim().toLowerCase(), displayName.trim(), passwordHash, userRole, targetCompanyId || null, !!isSafety]
    );

    if (!user) {
      res.status(500).json({ error: 'Erro ao criar usuário.' });
      return;
    }

    // Insere automaticamente o vínculo em user_companies
    if (targetCompanyId && userRole !== 'master') {
      await query(
        `INSERT INTO user_companies (user_id, company_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [user.id, targetCompanyId]
      );
    }

    // Gera token construtivo de senha (1 hora)
    const resetToken = crypto.randomBytes(64).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); 

    await query(
      `UPDATE users 
       SET reset_token = $1, reset_token_expires = $2
       WHERE id = $3`,
      [resetTokenHash, expiresAt, user.id]
    );

    const appUrl = process.env.APP_URL || 'https://portall.ehspro.com.br';
    const resetUrl = `${appUrl}/?reset_token=${resetToken}`;

    await mailer.sendMail({
      from: `"PortALL" <${process.env.SMTP_USER}>`,
      to: user.email,
      subject: 'Convite para o Sistema PortALL',
      html: `
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head><meta charset="UTF-8"></head>
        <body style="font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 40px 20px;">
          <div style="max-width: 500px; margin: 0 auto; background: white; border-radius: 16px; padding: 40px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
            <div style="text-align: center; margin-bottom: 32px;">
              <img src="${appUrl}/LogoApenas.png" alt="PortALL" style="height: 48px; margin-bottom: 8px; object-fit: contain;">
              <p style="color: #6b7280; margin: 0;">Gestão de Acessos e Terceiros</p>
            </div>
            <h2 style="color: #1f2937; font-size: 18px;">Olá, ${user.display_name}!</h2>
            <p style="color: #4b5563; line-height: 1.6;">
              Você foi convidado para acessar e utilizar o **PortALL**, o sistema de controle de acesso e terceiros. 
              Clique no botão abaixo para concluir o seu cadastro definindo a sua senha inicial de acesso:
            </p>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${resetUrl}" 
                 style="background-color: #002b5c; color: white; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: bold; display: inline-block;">
                Cadastrar Minha Senha
              </a>
            </div>
            <p style="color: #9ca3af; font-size: 13px; text-align: center;">
              Este link de cadastro inicial é válido por <strong>1 hora</strong>.<br>
            </p>
            <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 24px 0;">
            <p style="color: #9ca3af; font-size: 11px; text-align: center;">
              PortALL &copy; ${new Date().getFullYear()} — Gestão de Acessos
            </p>
          </div>
        </body>
        </html>
      `,
    }).catch(err => console.error('Invite email send error:', err));

    res.status(201).json({
      uid: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      companyId: user.company_id,
      isSafety: user.is_safety,
      isActive: user.is_active,
      createdAt: user.created_at,
    });
  } catch (err) {
    console.error('POST /users error:', err);
    res.status(500).json({ error: 'Erro ao criar usuário.' });
  }
});

// ============================================================
// Helper para checar hierarquia e permissão
// ============================================================
async function canUpdateUser(reqUserId: string, reqUserRole: string, reqUserCompany: string | undefined, targetUserId: string) {
  if (reqUserRole === 'master') return true;

  const target = await queryOne<{ role: string; company_id: string }>(
    'SELECT role, company_id FROM users WHERE id = $1', [targetUserId]
  );
  
  if (!target) return false;

  // Admin não afeta pessoas de fora da cia e não afeta master
  if (target.company_id !== reqUserCompany || target.role === 'master') {
    return false;
  }

  // NOVO: Admin não pode editar outros Admins (apenas Master pode, ou o próprio user se implementado)
  // Mas o admin PODE editar viewers da sua própria empresa.
  if (reqUserRole === 'admin' && target.role === 'admin' && targetUserId !== reqUserId) {
    return false;
  }

  return true;
}

// ============================================================
// PUT /api/users/:id - Atualiza usuário (Nome, Email, Role, Company)
// ============================================================
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { displayName, email, role, companyId, isSafety } = req.body;

    const canEdit = await canUpdateUser(req.user!.userId, req.user!.role, req.user!.companyId, id);
    if (!canEdit) {
      res.status(403).json({ error: 'Permissão negada para editar este usuário.' });
      return;
    }

    // Validações de roteamento/role
    if (req.user?.role === 'admin' && role === 'master') {
      res.status(403).json({ error: 'Admin não pode promover a master.' });
      return;
    }

    const user = await queryOne<{
      id: string; email: string; display_name: string; role: string; company_id: string; is_safety: boolean;
    }>(
      `UPDATE users 
       SET display_name = COALESCE($1, display_name),
           email = COALESCE($2, email),
           role = COALESCE($3, role),
           company_id = COALESCE($4, company_id),
           is_safety = COALESCE($5, is_safety)
       WHERE id = $6
       RETURNING id, email, display_name, role, company_id, is_safety`,
      [displayName?.trim(), email?.trim()?.toLowerCase(), role, companyId || null, isSafety !== undefined ? !!isSafety : null, id]
    );

    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }

    // Se mudou a empresa, atualiza o vínculo no user_companies
    if (companyId) {
      await query(`DELETE FROM user_companies WHERE user_id = $1`, [id]);
      await query(`INSERT INTO user_companies (user_id, company_id) VALUES ($1, $2)`, [id, companyId]);
    }

    res.json({
      uid: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      companyId: user.company_id,
      isSafety: user.is_safety
    });
  } catch (err) {
    console.error('PUT /users/:id error:', err);
    res.status(500).json({ error: 'Erro ao atualizar usuário.' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    if (id === req.user?.userId) {
      res.status(400).json({ error: 'Você não pode excluir sua própria conta.' });
      return;
    }

    const canEdit = await canUpdateUser(req.user!.userId, req.user!.role, req.user!.companyId, id);
    if (!canEdit) {
      res.status(403).json({ error: 'Permissão negada para excluir este usuário.' });
      return;
    }

    const deleted = await queryOne<{ id: string }>(
      'DELETE FROM users WHERE id = $1 RETURNING id',
      [id]
    );

    if (!deleted) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }

    res.json({ message: 'Usuário excluído com sucesso.' });
  } catch (err) {
    console.error('DELETE /users/:id error:', err);
    res.status(500).json({ error: 'Erro ao excluir usuário.' });
  }
});

router.post('/:id/resend-invite', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const user = await queryOne<{ id: string; email: string; display_name: string; role: string }>(
      'SELECT id, email, display_name, role FROM users WHERE id = $1',
      [id]
    );

    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }

    const resetToken = crypto.randomBytes(64).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); 

    await query(
      `UPDATE users 
       SET reset_token = $1, reset_token_expires = $2
       WHERE id = $3`,
      [resetTokenHash, expiresAt, user.id]
    );

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const resetUrl = `${appUrl}/?reset_token=${resetToken}`;

    await mailer.sendMail({
      from: `"Controle de Terceiros" <${process.env.SMTP_USER}>`,
      to: user.email,
      subject: 'Recuperação/Convite para Terceirização',
      html: `
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head><meta charset="UTF-8"></head>
        <body style="font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 40px 20px;">
          <div style="max-width: 500px; margin: 0 auto; background: white; border-radius: 16px; padding: 40px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
            <h2 style="color: #1f2937; font-size: 18px;">Olá, ${user.display_name}!</h2>
            <p style="color: #4b5563; line-height: 1.6;">
              Foi solicitado um novo link para você acessar o sistema de Terceirização. 
              Clique no botão abaixo para definir sua senha de acesso inicial ou acompanhá-la:
            </p>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${resetUrl}" 
                 style="background-color: #002b5c; color: white; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: bold; display: inline-block;">
                Cadastrar Nova Senha
              </a>
            </div>
            <p style="color: #9ca3af; font-size: 13px; text-align: center;">
              Este link é válido por <strong>1 hora</strong>.<br>
            </p>
          </div>
        </body>
        </html>
      `,
    }).catch(err => console.error('Invite email send error:', err));

    res.json({ message: 'E-mail enviado com sucesso.' });
  } catch (err) {
    console.error('POST /users/:id/resend-invite error:', err);
    res.status(500).json({ error: 'Erro ao reenviar link.' });
  }
});

export default router;
