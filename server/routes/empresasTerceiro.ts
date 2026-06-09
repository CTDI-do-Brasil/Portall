import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../auth/middleware.js';
import { query, queryOne } from '../db.js';

const router = Router();

router.use(requireAuth);

// ============================================================
// GET /api/empresas-terceiro
// Master vê todas. Admin vê de todas as suas unidades vinculadas.
// ============================================================
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    let empresas;
    if (req.user?.role === 'master') {
      empresas = await query<{
        id: string; company_id: string; name: string; cnpj: string; email: string; created_at: string;
      }>(
        `SELECT id, company_id, name, cnpj, email, created_at 
         FROM empresas_terceiro 
         ORDER BY name ASC`
      );
    } else {
      empresas = await query<{
        id: string; company_id: string; name: string; cnpj: string; email: string; created_at: string;
      }>(
        `SELECT id, company_id, name, cnpj, email, created_at 
         FROM empresas_terceiro 
         WHERE company_id IN (
           -- Unidades vinculadas diretamente
           SELECT company_id FROM user_companies WHERE user_id = $1
           UNION
           -- Filiais das unidades vinculadas
           SELECT id FROM companies WHERE parent_id IN (
             SELECT company_id FROM user_companies WHERE user_id = $1
           )
         )
         ORDER BY name ASC`,
        [req.user!.userId]
      );
    }
    
    res.json(empresas.map(e => ({
      id: e.id,
      companyId: e.company_id,
      name: e.name,
      cnpj: e.cnpj,
      email: e.email,
      createdAt: e.created_at
    })));
  } catch (err) {
    console.error('GET /empresas-terceiro error:', err);
    res.status(500).json({ error: 'Erro ao buscar empresas de terceiro.' });
  }
});

// A partir daqui, apenas Master/Admin podem modificar
router.use((req: AuthRequest, res: Response, next) => {
  if (req.user?.role === 'viewer') {
    res.status(403).json({ error: 'Permissão negada.' });
    return;
  }
  next();
});

// ============================================================
// POST /api/empresas-terceiro
// Master cria em qualquer uma. Admin cria apenas nas suas vinculadas/filiais.
// ============================================================
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { name, cnpj, email, companyId } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Nome é obrigatório.' });
      return;
    }

    if (!companyId) {
      res.status(400).json({ error: 'ID da companhia mandante é obrigatório.' });
      return;
    }

    // Validação de acesso para Admin
    if (req.user?.role === 'admin') {
      const hasAccess = await queryOne(
        `SELECT id FROM companies 
         WHERE id = $1 AND (
           id IN (SELECT company_id FROM user_companies WHERE user_id = $2)
           OR 
           parent_id IN (SELECT company_id FROM user_companies WHERE user_id = $2)
         )`,
        [companyId, req.user.userId]
      );
      if (!hasAccess) {
        res.status(403).json({ error: 'Você não tem permissão para cadastrar provedores nesta unidade.' });
        return;
      }
    }

    const doc = await queryOne<{ id: string; name: string; email: string }>(
      `INSERT INTO empresas_terceiro (company_id, name, cnpj, email)
       VALUES ($1, $2, $3, $4)
       RETURNING id, company_id, name, cnpj, email, created_at`,
      [companyId, name.trim(), cnpj ? cnpj.trim() : null, email ? email.trim().toLowerCase() : null]
    );

    res.status(201).json(doc);
  } catch (err: any) {
    console.error('POST /empresas-terceiro error:', err);
    if (err.code === '23505') {
       res.status(409).json({ error: 'Já existe uma empresa com esse nome cadastrada para a contratante atual.' });
    } else {
       res.status(500).json({ error: 'Erro ao criar empresa.' });
    }
  }
});

// ============================================================
// PUT /api/empresas-terceiro/:id
// ============================================================
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, cnpj, email } = req.body;

    if (req.user?.role === 'admin') {
       const authCheck = await queryOne(
         `SELECT id FROM empresas_terceiro 
          WHERE id = $1 AND company_id IN (
            SELECT company_id FROM user_companies WHERE user_id = $2
            UNION
            SELECT id FROM companies WHERE parent_id IN (SELECT company_id FROM user_companies WHERE user_id = $2)
          )`,
         [id, req.user.userId]
       );
       if (!authCheck) {
         res.status(403).json({ error: 'Sem permissão para editar provedores desta unidade.' }); return;
       }
    }

    const doc = await queryOne(
      `UPDATE empresas_terceiro SET name = $1, cnpj = $2, email = $3
       WHERE id = $4
       RETURNING id, company_id, name, cnpj, email, created_at`,
      [name?.trim(), cnpj?.trim() || null, email?.trim().toLowerCase() || null, id]
    );

    if (!doc) {
      res.status(404).json({ error: 'Empresa não encontrada.' });
      return;
    }

    res.json(doc);
  } catch (err: any) {
    console.error('PUT error:', err);
    res.status(500).json({ error: 'Erro ao atualizar.' });
  }
});

// ============================================================
// DELETE /api/empresas-terceiro/:id
// ============================================================
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    if (req.user?.role === 'admin') {
      const authCheck = await queryOne(
        `SELECT id FROM empresas_terceiro 
         WHERE id = $1 AND company_id IN (
           SELECT company_id FROM user_companies WHERE user_id = $2
           UNION
           SELECT id FROM companies WHERE parent_id IN (SELECT company_id FROM user_companies WHERE user_id = $2)
         )`,
        [id, req.user.userId]
      );
      if (!authCheck) {
        res.status(403).json({ error: 'Sem permissão para remover provedores desta unidade.' }); return;
      }
    }

    await query('DELETE FROM empresas_terceiro WHERE id = $1', [id]);
    res.json({ message: 'Excluído com sucesso.' });
  } catch (err) {
    console.error('DELETE error:', err);
    res.status(500).json({ error: 'Erro ao excluir.' });
  }
});

export default router;
