import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../auth/middleware.js';
import { query, queryOne } from '../db.js';

const router = Router();

router.use(requireAuth);

// ============================================================
// GET /api/treinamentos/tipos
// ============================================================
router.get('/tipos', async (req: AuthRequest, res: Response) => {
  try {
    let tipos;
    if (req.user?.role === 'master') {
       // Master vê globais e personalizados
       tipos = await query(`SELECT * FROM tipos_treinamento ORDER BY nome ASC`);
    } else {
       // Admin/Viewer vê globais e os das suas companhias vinculadas
       tipos = await query(
         `SELECT * FROM tipos_treinamento 
          WHERE escopo = 'global' OR company_id IN (
            SELECT company_id FROM user_companies WHERE user_id = $1
            UNION
            SELECT id FROM companies WHERE parent_id IN (SELECT company_id FROM user_companies WHERE user_id = $1)
          )
          ORDER BY nome ASC`, [req.user?.userId]
       );
    }
    
    res.json(tipos.map((t: any) => ({
      id: t.id,
      nome: t.nome,
      codigo: t.codigo,
      validadeMeses: t.validade_meses,
      escopo: t.escopo,
      companyId: t.company_id
    })));
  } catch (err) {
    console.error('GET tipos error:', err);
    res.status(500).json({ error: 'Erro ao buscar treinamentos.' });
  }
});

// A partir daqui, views de criação exigem Master ou Admin
router.use((req: AuthRequest, res: Response, next) => {
  if (req.user?.role === 'viewer') {
    res.status(403).json({ error: 'Permissão negada.' });
    return;
  }
  next();
});

// ============================================================
// POST /api/treinamentos/tipos
// ============================================================
router.post('/tipos', async (req: AuthRequest, res: Response) => {
  try {
    const { nome, validadeMeses, escopo, companyId } = req.body;

    if (!nome) {
      res.status(400).json({ error: 'Nome é obrigatório.' });
      return;
    }

    // Se admin, só pode criar para empresas que ele gerencia
    if (req.user?.role === 'admin') {
      const isAuthorized = await queryOne(
        `SELECT 1 FROM user_companies WHERE user_id = $1 AND company_id = $2
         UNION
         SELECT 1 FROM companies WHERE parent_id IN (SELECT company_id FROM user_companies WHERE user_id = $1) AND id = $2`,
        [req.user.userId, companyId]
      );
      if (!isAuthorized && escopo !== 'global') {
        res.status(403).json({ error: 'Você não tem permissão para esta empresa.' });
        return;
      }
    }

    // Apenas master cria global
    const finalEscopo = req.user?.role === 'master' ? (escopo || 'personalizado') : 'personalizado';

    // Gera código sequencial 001, 002, 003...
    const countRes = await queryOne<{ count: string }>('SELECT COUNT(*) as count FROM tipos_treinamento');
    const nextNum = parseInt(countRes?.count || '0') + 1;
    const autoCodigo = nextNum.toString().padStart(3, '0');

    const doc = await queryOne(
      `INSERT INTO tipos_treinamento (nome, codigo, validade_meses, escopo, company_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [nome.trim(), autoCodigo, parseInt(validadeMeses || '12'), finalEscopo, companyId || null]
    );

    res.status(201).json(doc);
  } catch (err) {
    console.error('POST tipos error:', err);
    res.status(500).json({ error: 'Erro ao criar treinamento.' });
  }
});

// ============================================================
// GET /api/treinamentos/atividades
// ============================================================
router.get('/atividades', async (req: AuthRequest, res: Response) => {
  try {
    let atividades;
    if (req.user?.role === 'master') {
      atividades = await query(`SELECT * FROM tipos_atividade ORDER BY nome ASC`);
    } else {
      atividades = await query(
        `SELECT * FROM tipos_atividade 
         WHERE company_id IN (
           SELECT company_id FROM user_companies WHERE user_id = $1
           UNION
           SELECT id FROM companies WHERE parent_id IN (SELECT company_id FROM user_companies WHERE user_id = $1)
         )
         ORDER BY nome ASC`,
        [req.user?.userId]
      );
    }
    
    // Agora busca os treinamentos atrelados para cada atividade
    const atividadesIds = atividades.map((a: any) => a.id);
    let mapping: Record<string, string[]> = {};
    
    if (atividadesIds.length > 0) {
       const links = await query(
         `SELECT atividade_id, treinamento_id FROM atividade_treinamentos 
          WHERE atividade_id = ANY($1)`, [atividadesIds]
       );
       
       links.forEach((link: any) => {
          if (!mapping[link.atividade_id]) mapping[link.atividade_id] = [];
          mapping[link.atividade_id].push(link.treinamento_id);
       });
    }

    res.json(atividades.map((a: any) => ({
      id: a.id,
      companyId: a.company_id,
      nome: a.nome,
      treinamentosObrigatorios: mapping[a.id] || []
    })));
  } catch (err) {
     console.error('GET atividades error:', err);
     res.status(500).json({ error: 'Erro ao buscar atividades.' });
  }
});

// ============================================================
// POST /api/treinamentos/atividades
// ============================================================
router.post('/atividades', async (req: AuthRequest, res: Response) => {
  try {
    let { nome, companyId, treinamentosObrigatorios } = req.body;
    
    if (!nome || !companyId) {
      res.status(400).json({ error: 'Nome e Empresa são obrigatórios.' });
      return;
    }
    
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
        res.status(403).json({ error: 'Sem permissão para criar atividades nesta unidade.' });
        return;
      }
    }

    const doc = await queryOne<{ id: string }>(
      `INSERT INTO tipos_atividade (company_id, nome) VALUES ($1, $2) RETURNING id`,
      [companyId, nome.trim()]
    );
    
    if (doc && Array.isArray(treinamentosObrigatorios) && treinamentosObrigatorios.length > 0) {
      for (const tId of treinamentosObrigatorios) {
         await query('INSERT INTO atividade_treinamentos (atividade_id, treinamento_id) VALUES ($1, $2)', [doc.id, tId]);
      }
    }

    res.status(201).json({ id: doc?.id });
  } catch (err) {
    console.error('POST atividades error:', err);
    res.status(500).json({ error: 'Erro ao criar atividade.' });
  }
});


// ============================================================
// PUT /api/treinamentos/atividades/:id
// ============================================================
router.put('/atividades/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { nome, treinamentosObrigatorios } = req.body;
    
    if (req.user?.role === 'admin') {
       const authCheck = await queryOne('SELECT id FROM tipos_atividade WHERE id = $1 AND company_id = $2', [id, req.user.companyId]);
       if (!authCheck) {
         res.status(403).json({ error: 'Sem permissão.' }); return;
       }
    }

    await query(`UPDATE tipos_atividade SET nome = $1 WHERE id = $2`, [nome.trim(), id]);
    
    if (Array.isArray(treinamentosObrigatorios)) {
       // Recria as relacoes
       await query('DELETE FROM atividade_treinamentos WHERE atividade_id = $1', [id]);
       for (const tId of treinamentosObrigatorios) {
          await query('INSERT INTO atividade_treinamentos (atividade_id, treinamento_id) VALUES ($1, $2)', [id, tId]);
       }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('PUT atividades error:', err);
    res.status(500).json({ error: 'Erro.' });
  }
});

router.delete('/tipos/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const tipo = await queryOne<{ company_id: string; escopo: string }>(
      'SELECT company_id, escopo FROM tipos_treinamento WHERE id = $1',
      [id]
    );

    if (!tipo) {
      res.status(404).json({ error: 'Treinamento não encontrado.' });
      return;
    }

    // Apenas master pode excluir globais
    if (tipo.escopo === 'global' && req.user?.role !== 'master') {
      res.status(403).json({ error: 'Somente o master pode excluir treinamentos globais.' });
      return;
    }

    await query('DELETE FROM tipos_treinamento WHERE id = $1', [id]);
    res.json({ success: true, message: 'Treinamento excluído.' });
  } catch (err) {
    console.error('DELETE tipos error:', err);
    res.status(500).json({ error: 'Erro ao excluir treinamento.' });
  }
});

// ============================================================
// PUT /api/treinamentos/tipos/:id
// ============================================================
router.put('/tipos/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { nome, validadeMeses, escopo, companyId } = req.body;

    if (!nome) {
      res.status(400).json({ error: 'Nome é obrigatório.' });
      return;
    }

    const tipo = await queryOne<{ company_id: string; escopo: string }>(
      'SELECT company_id, escopo FROM tipos_treinamento WHERE id = $1',
      [id]
    );

    if (!tipo) {
      res.status(404).json({ error: 'Treinamento não encontrado.' });
      return;
    }

    // Apenas master pode editar globais
    if (tipo.escopo === 'global' && req.user?.role !== 'master') {
      res.status(403).json({ error: 'Somente o master pode editar treinamentos globais.' });
      return;
    }

    const finalEscopo = req.user?.role === 'master' ? (escopo || tipo.escopo) : 'personalizado';

    await query(
      `UPDATE tipos_treinamento 
       SET nome = $1, validade_meses = $2, escopo = $3, company_id = $4
       WHERE id = $5`,
      [nome.trim(), parseInt(validadeMeses || '12'), finalEscopo, companyId || tipo.company_id, id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('PUT tipos error:', err);
    res.status(500).json({ error: 'Erro ao atualizar treinamento.' });
  }
});

export default router;
