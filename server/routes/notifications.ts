import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../auth/middleware.js';
import { query, queryOne } from '../db.js';

const router = Router();

router.use(requireAuth);

// ============================================================
// GET /api/notifications - Lista e-mails configurados
// ============================================================
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { companyId } = req.query;

    if (!companyId) {
      if (req.user?.role !== 'master') {
         // Se não for master e não mandar company, retorna da própria
         const rows = await query(
           'SELECT id, company_id, email, created_at FROM notification_emails WHERE company_id = $1 ORDER BY created_at DESC',
           [req.user!.companyId]
         );
         res.json(rows.map((r: any) => ({
           id: r.id, companyId: r.company_id, email: r.email, createdAt: r.created_at
         })));
         return;
      } else {
         // Master sem company retorna todos
         const rows = await query(
           'SELECT id, company_id, email, created_at FROM notification_emails ORDER BY created_at DESC'
         );
         res.json(rows.map((r: any) => ({
           id: r.id, companyId: r.company_id, email: r.email, createdAt: r.created_at
         })));
         return;
      }
    }

    // Se informou companyId, verifica permissão
    if (req.user?.role !== 'master' && req.user?.companyId !== companyId) {
       res.status(403).json({ error: 'Acesso negado para consultar alertas de outra empresa.' });
       return;
    }

    const rows = await query(
      'SELECT id, company_id, email, created_at FROM notification_emails WHERE company_id = $1 ORDER BY created_at DESC',
      [companyId]
    );

    res.json(rows.map((r: any) => ({
       id: r.id, companyId: r.company_id, email: r.email, createdAt: r.created_at
    })));
  } catch (err) {
    console.error('GET /notifications error:', err);
    res.status(500).json({ error: 'Erro ao buscar configurações de e-mail.' });
  }
});

// ============================================================
// POST /api/notifications - Adiciona novo e-mail
// ============================================================
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { companyId, email } = req.body;

    if (!companyId || !email) {
      res.status(400).json({ error: 'CompanyId e Email são obrigatórios.' });
      return;
    }

    if (req.user?.role !== 'master' && req.user?.companyId !== companyId) {
       res.status(403).json({ error: 'Acesso negado para configurar alertas em outra empresa.' });
       return;
    }

    // Verifica duplicação
    const exists = await queryOne(
      'SELECT id FROM notification_emails WHERE company_id = $1 AND email = $2',
      [companyId, email]
    );
    if (exists) {
       res.status(400).json({ error: 'Este e-mail já está cadastrado para esta filial/empresa.' });
       return;
    }

    const created = await queryOne<{ id: string, created_at: string }>(
      'INSERT INTO notification_emails (company_id, email) VALUES ($1, $2) RETURNING id, created_at',
      [companyId, email]
    );

    res.status(201).json({
      id: created?.id,
      companyId,
      email,
      createdAt: created?.created_at
    });
  } catch (err) {
    console.error('POST /notifications error:', err);
    res.status(500).json({ error: 'Erro ao cadastrar e-mail.' });
  }
});

// ============================================================
// DELETE /api/notifications/:id - Remove e-mail
// ============================================================
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const emailReg = await queryOne<{ company_id: string }>(
      'SELECT company_id FROM notification_emails WHERE id = $1',
      [id]
    );

    if (!emailReg) {
      res.status(404).json({ error: 'Registro não encontrado.' });
      return;
    }

    if (req.user?.role !== 'master' && req.user?.companyId !== emailReg.company_id) {
       res.status(403).json({ error: 'Acesso negado para remover alerta de outra empresa.' });
       return;
    }

    await query('DELETE FROM notification_emails WHERE id = $1', [id]);
    res.json({ success: true, message: 'E-mail removido das notificações.' });
  } catch (err) {
    console.error('DELETE /notifications error:', err);
    res.status(500).json({ error: 'Erro ao remover e-mail.' });
  }
});

export default router;
