import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../auth/middleware.js';
import { query, queryOne } from '../db.js';

const router = Router();

router.use(requireAuth);

// ============================================================
// GET /api/terceiros - Lista terceiros
// ============================================================
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    let terceiros;
    if (req.user?.role === 'master') {
      terceiros = await query<{
        id: string;
        name: string;
        cpf: string;
        status: string;
        company_id: string;
        company_name: string;
        created_at: string;
      }>(
        `SELECT t.id, t.name, t.cpf, t.status, t.company_id, c.name as company_name, t.created_at
         FROM terceiros t
         LEFT JOIN companies c ON t.company_id = c.id
         ORDER BY t.name ASC`
      );
    } else {
      if (!req.user?.companyId) {
        res.json([]);
        return;
      }
      terceiros = await query<{
        id: string;
        name: string;
        cpf: string;
        status: string;
        company_id: string;
        company_name: string;
        created_at: string;
      }>(
        `SELECT t.id, t.name, t.cpf, t.status, t.company_id, c.name as company_name, t.created_at
         FROM terceiros t
         LEFT JOIN companies c ON t.company_id = c.id
         WHERE t.company_id = $1
         ORDER BY t.name ASC`,
        [req.user.companyId]
      );
    }
    
    res.json(terceiros);
  } catch (err) {
    console.error('GET /terceiros error:', err);
    res.status(500).json({ error: 'Erro ao buscar terceiros.' });
  }
});

// A partir daqui, apenas Master/Admin podem modificar
router.use((req: AuthRequest, res: Response, next) => {
  if (req.user?.role === 'viewer') {
    res.status(403).json({ error: 'Você não tem permissão para esta ação.' });
    return;
  }
  next();
});

// ============================================================
// POST /api/terceiros
// ============================================================
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { name, cpf, companyId } = req.body;

    if (!name || !cpf) {
      res.status(400).json({ error: 'Nome e CPF são obrigatórios.' });
      return;
    }

    let targetCompany = companyId;
    if (req.user?.role === 'admin') {
      targetCompany = req.user.companyId; // Força a companhia do admin
    }

    if (!targetCompany) {
      res.status(400).json({ error: 'É necessário informar uma companhia.' });
      return;
    }

    const terceiro = await queryOne<{ id: string }>(
      `INSERT INTO terceiros (name, cpf, company_id, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, cpf, status, company_id, created_at`,
      [name.trim(), cpf.trim(), targetCompany, req.user!.userId]
    );

    res.status(201).json(terceiro);
  } catch (err: any) {
    console.error('POST /terceiros error:', err);
    if (err.code === '23505') {
      res.status(409).json({ error: 'Já existe um terceiro cadastrado com este CPF.' });
    } else {
      res.status(500).json({ error: 'Erro ao criar terceiro.' });
    }
  }
});

// ============================================================
// PUT /api/terceiros/:id
// ============================================================
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, cpf, status } = req.body;

    // Se for admin, precisa garantir que o terceiro é da sua company
    if (req.user?.role === 'admin') {
      const authCheck = await queryOne('SELECT id FROM terceiros WHERE id = $1 AND company_id = $2', [id, req.user.companyId]);
      if (!authCheck) {
        res.status(403).json({ error: 'Permissão negada ou terceiro não encontrado.' });
        return;
      }
    }

    const terceiro = await queryOne(
      `UPDATE terceiros SET name = $1, cpf = $2, status = COALESCE($3, status)
       WHERE id = $4
       RETURNING id, name, cpf, status, company_id, created_at`,
      [name?.trim(), cpf?.trim(), status, id]
    );

    if (!terceiro) {
      res.status(404).json({ error: 'Terceiro não encontrado.' });
      return;
    }

    res.json(terceiro);
  } catch (err: any) {
    console.error('PUT /terceiros/:id error:', err);
    if (err.code === '23505') {
      res.status(409).json({ error: 'Já existe outro terceiro com este CPF.' });
    } else {
      res.status(500).json({ error: 'Erro ao atualizar terceiro.' });
    }
  }
});

// ============================================================
// DELETE /api/terceiros/:id
// ============================================================
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    if (req.user?.role === 'admin') {
      const authCheck = await queryOne('SELECT id FROM terceiros WHERE id = $1 AND company_id = $2', [id, req.user.companyId]);
      if (!authCheck) {
        res.status(403).json({ error: 'Permissão negada ou terceiro não encontrado.' });
        return;
      }
    }

    const deleted = await queryOne<{ id: string }>(
      'DELETE FROM terceiros WHERE id = $1 RETURNING id',
      [id]
    );

    if (!deleted) {
      res.status(404).json({ error: 'Terceiro não encontrado.' });
      return;
    }

    res.json({ message: 'Terceiro excluído com sucesso.' });
  } catch (err) {
    console.error('DELETE /terceiros/:id error:', err);
    res.status(500).json({ error: 'Erro ao excluir terceiro.' });
  }
});

export default router;
