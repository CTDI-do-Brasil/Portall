import { Router, Response } from 'express';
import { requireAuth, requireMaster, AuthRequest } from '../auth/middleware.js';
import { query, queryOne } from '../db.js';
import { processCompanyComplianceReport } from '../cron.js';

const router = Router();

router.use(requireAuth);

// ============================================================
// GET /api/companies
// Master: retorna todas. Admin/Viewer: apenas empresas vinculadas + filiais.
// ============================================================
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role === 'master') {
      const companies = await query(
        `SELECT id, parent_id, name, cnpj, is_active, requires_safety_term, created_at
         FROM companies
         ORDER BY name ASC`
      );
      res.json((companies as any[]).map(c => ({
        id: c.id, parentId: c.parent_id, name: c.name,
        cnpj: c.cnpj, isActive: c.is_active, 
        requiresSafetyTerm: !!c.requires_safety_term,
        createdAt: c.created_at
      })));
    } else {
      // Admin/Viewer: pega matrizes vinculadas diretamente + suas filiais
      const companies = await query(
        `SELECT DISTINCT c.id, c.parent_id, c.name, c.cnpj, c.is_active, c.requires_safety_term, c.created_at
         FROM companies c
         WHERE c.id IN (
           -- Empresas diretamente vinculadas ao usuário
           SELECT company_id FROM user_companies WHERE user_id = $1
           UNION
           -- Filiais das empresas vinculadas
           SELECT c2.id FROM companies c2
           WHERE c2.parent_id IN (
             SELECT company_id FROM user_companies WHERE user_id = $1
           )
         )
         ORDER BY name ASC`,
        [req.user!.userId]
      );
      res.json((companies as any[]).map(c => ({
        id: c.id, parentId: c.parent_id, name: c.name,
        cnpj: c.cnpj, isActive: c.is_active, 
        requiresSafetyTerm: !!c.requires_safety_term,
        createdAt: c.created_at
      })));
    }
  } catch (err) {
    console.error('GET /companies error:', err);
    res.status(500).json({ error: 'Erro ao buscar companhias.' });
  }
});

// ============================================================
// POST /api/companies
// Master cria empresa-matriz. Admin cria filial (parentId obrigatório)
// ============================================================
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { name, cnpj, parentId } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Nome é obrigatório.' });
      return;
    }

    // Admin só pode criar filiais de empresas que ele gerencia
    if (req.user?.role !== 'master') {
      if (!parentId) {
        res.status(403).json({ error: 'Administradores só podem criar filiais dentro de suas empresas.' });
        return;
      }
      // Verifica se o admin tem acesso à empresa-matriz
      const hasAccess = await queryOne<{ user_id: string }>(
        `SELECT user_id FROM user_companies WHERE user_id = $1 AND company_id = $2`,
        [req.user!.userId, parentId]
      );
      if (!hasAccess) {
        res.status(403).json({ error: 'Você não tem permissão para criar filiais nesta empresa.' });
        return;
      }
    }

    const company = await queryOne(
      `INSERT INTO companies (name, cnpj, parent_id, requires_safety_term)
       VALUES ($1, $2, $3, $4)
       RETURNING id, parent_id, name, cnpj, is_active, requires_safety_term, created_at`,
      [name.trim(), cnpj ? cnpj.trim() : null, parentId || null, !!req.body.requiresSafetyTerm]
    );

    res.status(201).json({
      id: company!.id, parentId: company!.parent_id, name: company!.name,
      cnpj: company!.cnpj, isActive: company!.is_active, 
      requiresSafetyTerm: (company as any).requires_safety_term,
      createdAt: company!.created_at
    });
  } catch (err: any) {
    console.error('POST /companies error:', err);
    if (err.code === '23505') {
      res.status(409).json({ error: 'Já existe uma companhia com esse Nome ou CNPJ.' });
    } else {
      res.status(500).json({ error: 'Erro ao criar companhia.' });
    }
  }
});

// ============================================================
// PUT /api/companies/:id
// ============================================================
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, cnpj, is_active } = req.body;

    if (req.user?.role !== 'master') {
      // Admin só edita se for uma das que ele gere
      const hasAccess = await queryOne(
        `SELECT id FROM companies 
         WHERE id = $1 AND (
           id IN (SELECT company_id FROM user_companies WHERE user_id = $2)
           OR 
           parent_id IN (SELECT company_id FROM user_companies WHERE user_id = $2)
         )`,
        [id, req.user!.userId]
      );
      if (!hasAccess) {
        res.status(403).json({ error: 'Permissão negada para editar esta empresa.' });
        return;
      }
    }

    const company = await queryOne(
      `UPDATE companies 
       SET name = COALESCE($1, name), 
           cnpj = COALESCE($2, cnpj), 
           is_active = COALESCE($3, is_active),
           requires_safety_term = COALESCE($4, requires_safety_term)
       WHERE id = $5
       RETURNING id, parent_id, name, cnpj, is_active, requires_safety_term, created_at`,
      [name?.trim(), cnpj?.trim() || null, is_active, req.body.requiresSafetyTerm !== undefined ? !!req.body.requiresSafetyTerm : null, id]
    );

    if (!company) {
      res.status(404).json({ error: 'Companhia não encontrada.' });
      return;
    }

    res.json({
      id: company.id, parentId: (company as any).parent_id, name: (company as any).name,
      cnpj: (company as any).cnpj, isActive: (company as any).is_active, 
      requiresSafetyTerm: (company as any).requires_safety_term,
      createdAt: (company as any).created_at
    });
  } catch (err: any) {
    console.error('PUT /companies/:id error:', err);
    res.status(500).json({ error: 'Erro ao atualizar companhia.' });
  }
});

// ============================================================
// DELETE /api/companies/:id
// ============================================================
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    if (req.user?.role !== 'master') {
      const hasAccess = await queryOne(
        `SELECT id FROM companies 
         WHERE id = $1 AND (
           id IN (SELECT company_id FROM user_companies WHERE user_id = $2)
           OR 
           parent_id IN (SELECT company_id FROM user_companies WHERE user_id = $2)
         )`,
        [id, req.user!.userId]
      );
      if (!hasAccess) {
        res.status(403).json({ error: 'Permissão negada para excluir esta empresa.' });
        return;
      }
    }

    const deleted = await queryOne<{ id: string }>(
      'DELETE FROM companies WHERE id = $1 RETURNING id', [id]
    );

    if (!deleted) {
      res.status(404).json({ error: 'Companhia não encontrada.' });
      return;
    }

    res.json({ message: 'Companhia excluída com sucesso.' });
  } catch (err) {
    console.error('DELETE /companies/:id error:', err);
    res.status(500).json({ error: 'Erro ao excluir companhia.' });
  }
});

// ============================================================
// GET /api/companies/:id/admins — Lista admins vinculados (Master only)
// ============================================================
router.get('/:id/admins', requireMaster, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const admins = await query<{
      id: string; email: string; display_name: string; role: string; is_active: boolean;
    }>(
      `SELECT u.id, u.email, u.display_name, u.role, u.is_active
       FROM users u
       INNER JOIN user_companies uc ON uc.user_id = u.id
       WHERE uc.company_id = $1
       AND u.role IN ('admin', 'viewer')
       ORDER BY u.display_name ASC`,
      [id]
    );

    res.json(admins.map(u => ({
      uid: u.id, email: u.email, displayName: u.display_name,
      role: u.role, isActive: u.is_active
    })));
  } catch (err) {
    console.error('GET /companies/:id/admins error:', err);
    res.status(500).json({ error: 'Erro ao buscar administradores.' });
  }
});

// ============================================================
// POST /api/companies/:id/admins — Vincula admin à empresa (Master only)
// Body: { userId: string }
// ============================================================
router.post('/:id/admins', requireMaster, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    if (!userId) {
      res.status(400).json({ error: 'userId é obrigatório.' });
      return;
    }

    // Verifica se o usuário existe e não é master
    const user = await queryOne<{ id: string; role: string }>(
      'SELECT id, role FROM users WHERE id = $1', [userId]
    );

    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }

    if (user.role === 'master') {
      res.status(400).json({ error: 'Usuários master não precisam ser vinculados a empresas.' });
      return;
    }

    await query(
      `INSERT INTO user_companies (user_id, company_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, id]
    );

    // Atualiza company_id no usuário se ele ainda não tiver um
    await query(
      `UPDATE users SET company_id = $1 WHERE id = $2 AND company_id IS NULL`,
      [id, userId]
    );

    res.status(201).json({ message: 'Administrador vinculado com sucesso.' });
  } catch (err) {
    console.error('POST /companies/:id/admins error:', err);
    res.status(500).json({ error: 'Erro ao vincular administrador.' });
  }
});

// ============================================================
// POST /api/companies/:id/send-report — Disparo manual do relatório de conformidade
// ============================================================
router.post('/:id/send-report', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // 1. Verificar permissão (Master ou Admin vinculado)
    if (req.user?.role !== 'master') {
      const hasAccess = await queryOne(
        `SELECT id FROM companies 
         WHERE id = $1 AND (
           id IN (SELECT company_id FROM user_companies WHERE user_id = $2)
           OR 
           parent_id IN (SELECT company_id FROM user_companies WHERE user_id = $2)
         )`,
        [id, req.user!.userId]
      );
      if (!hasAccess) {
        res.status(403).json({ error: 'Permissão negada para solicitar relatório desta empresa.' });
        return;
      }
    }

    // 2. Buscar dados básicos da empresa
    const company = await queryOne<{ name: string }>(
      'SELECT name FROM companies WHERE id = $1', [id]
    );

    if (!company) {
      res.status(404).json({ error: 'Empresa não encontrada.' });
      return;
    }

    // 3. Processar e enviar o relatório
    const result = await processCompanyComplianceReport(id, company.name);

    if (!result.success) {
      res.status(400).json({ error: result.message });
      return;
    }

    res.json(result);
  } catch (err) {
    console.error('POST /companies/:id/send-report error:', err);
    res.status(500).json({ error: 'Erro interno ao processar relatório.' });
  }
});

export default router;
