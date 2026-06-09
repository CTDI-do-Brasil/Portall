import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { queryOne } from '../db.js';
import crypto from 'crypto';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role: 'master' | 'admin' | 'viewer';
    companyId?: string;
    isSafety: boolean;
  };
}

const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION_USE_64_CHARS_RANDOM_STRING';

// ============================================================
// Gera token JWT (8 horas de validade)
// ============================================================
export function generateToken(payload: {
  userId: string;
  email: string;
  role: string;
  companyId?: string;
  isSafety: boolean;
}): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
}

// ============================================================
// Middleware de autenticação JWT
// ============================================================
export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token de autenticação não fornecido.' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    // Verifica se token está na blacklist
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const blacklisted = await queryOne(
      'SELECT id FROM token_blacklist WHERE token_hash = $1 AND expires_at > NOW()',
      [tokenHash]
    );

    if (blacklisted) {
      res.status(401).json({ error: 'Token inválido (sessão encerrada).' });
      return;
    }

    // Verifica assinatura e expiração
    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: string;
      email: string;
      role: 'master' | 'admin' | 'viewer';
      companyId?: string;
      isSafety: boolean;
      exp: number;
    };

    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      companyId: decoded.companyId,
      isSafety: !!decoded.isSafety,
    };

    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
    } else {
      res.status(401).json({ error: 'Token inválido.' });
    }
  }
}

// ============================================================
// Middleware: exige role admin ou master
// ============================================================
export function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (req.user?.role !== 'admin' && req.user?.role !== 'master') {
    res.status(403).json({ error: 'Acesso restrito a administradores ou master.' });
    return;
  }
  next();
}

// ============================================================
// Middleware: exige role master
// ============================================================
export function requireMaster(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (req.user?.role !== 'master') {
    res.status(403).json({ error: 'Acesso restrito apenas ao nível master.' });
    return;
  }
  next();
}

// ============================================================
// Adiciona token à blacklist (logout)
// ============================================================
export async function blacklistToken(token: string, expiresAt: Date): Promise<void> {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await queryOne(
    `INSERT INTO token_blacklist (token_hash, expires_at)
     VALUES ($1, $2)
     ON CONFLICT (token_hash) DO NOTHING`,
    [tokenHash, expiresAt]
  );
}

export { JWT_SECRET };
