import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../auth/middleware.js';
import { query } from '../db.js';

const router = Router();

router.use(requireAuth);

// Apenas masters podem ver logs
router.use((req: AuthRequest, res: Response, next) => {
  if (req.user?.role !== 'master') {
    res.status(403).json({ error: 'Apenas usuários MASTER podem acessar os logs do sistema.' });
    return;
  }
  next();
});

// GET /api/logs - Lista histórico de ações
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    
    // Busca logs com JOIN no nome do usuário que executou a ação
    const logs = await query(`
      SELECT l.*, u.display_name as user_name
      FROM system_logs l
      LEFT JOIN users u ON l.user_id = u.id
      ORDER BY l.timestamp DESC
      LIMIT $1
    `, [limit]);

    res.json(logs);
  } catch (err) {
    console.error('GET /logs error:', err);
    res.status(500).json({ error: 'Erro ao buscar registros de auditoria.' });
  }
});

export default router;
