import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../auth/middleware.js';
import { query, queryOne } from '../db.js';

const router = Router();

// Todas as rotas de patrimônios exigem autenticação
router.use(requireAuth);

// GET /api/patrimonios - Lista todos os patrimônios
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const patrimonios = await query(
      `SELECT p.*, c.name as company_name,
        (SELECT acao FROM patrimonio_logs pl WHERE pl.patrimonio_id = p.id AND acao IN ('entrada', 'saida') ORDER BY timestamp DESC LIMIT 1) as ultimo_estado
       FROM patrimonios p
       LEFT JOIN companies c ON p.company_id = c.id
       ORDER BY p.created_at DESC`
    );
    res.json(patrimonios);
  } catch (err) {
    console.error('GET /api/patrimonios error:', err);
    res.status(500).json({ error: 'Erro ao buscar patrimônios.' });
  }
});

// GET /api/patrimonios/logs - Lista histórico geral
router.get('/logs', async (req: AuthRequest, res: Response) => {
  try {
    const logs = await query(
      `SELECT pl.*, p.descricao, p.proprietario, u.display_name as porteiro_nome
       FROM patrimonio_logs pl
       LEFT JOIN patrimonios p ON pl.patrimonio_id = p.id
       LEFT JOIN users u ON pl.porteiro_id = u.id
       ORDER BY pl.timestamp DESC
       LIMIT 200`
    );
    res.json(logs);
  } catch (err) {
    console.error('GET /api/patrimonios/logs error:', err);
    res.status(500).json({ error: 'Erro ao buscar logs de patrimônios.' });
  }
});

// GET /api/patrimonios/tag/:tag - Identificar patrimônio sem registrar log
router.get('/tag/:tag', async (req: AuthRequest, res: Response) => {
  try {
    const { tag } = req.params;
    
    const patrimonio = await queryOne<{ 
      id: string, 
      status_acesso: string, 
      descricao: string, 
      proprietario: string,
      setor: string,
      marca: string,
      serial_number: string,
      liberado_ate: string
    }>(
      'SELECT id, status_acesso, descricao, proprietario, setor, marca, serial_number, liberado_ate FROM patrimonios WHERE nfc_tag = $1',
      [tag]
    );

    if (!patrimonio) {
      res.status(404).json({ error: 'Dispositivo / Tag não encontrado no sistema.' });
      return;
    }

    let statusFinal = patrimonio.status_acesso;
    let motivoBloqueio = '';

    if (statusFinal === 'bloqueado') {
      motivoBloqueio = 'Patrimônio Bloqueado Administrativamente.';
    } else if (patrimonio.liberado_ate && new Date(patrimonio.liberado_ate) < new Date()) {
      statusFinal = 'bloqueado';
      motivoBloqueio = 'Prazo de liberação expirado.';
    }

    if (statusFinal === 'bloqueado') {
      await query(
        `INSERT INTO patrimonio_logs (patrimonio_id, porteiro_id, acao) VALUES ($1, $2, $3)`,
        [patrimonio.id, req.user?.userId || null, 'bloqueado']
      );
      res.status(403).json({ error: `Acesso Negado: ${motivoBloqueio}`, patrimonio });
      return;
    }

    // Busca o último log de entrada/saida para determinar o estado atual
    const lastLog = await queryOne<{ acao: string, timestamp: string }>(
      `SELECT acao, timestamp FROM patrimonio_logs WHERE patrimonio_id = $1 AND acao IN ('entrada', 'saida') ORDER BY timestamp DESC LIMIT 1`,
      [patrimonio.id]
    );

    res.json({
      patrimonio,
      ultimoEstado: lastLog?.acao || 'saida',
      ultimaData: lastLog?.timestamp || null
    });

  } catch (err) {
    console.error('GET /api/patrimonios/tag error:', err);
    res.status(500).json({ error: 'Erro ao identificar patrimônio.' });
  }
});


// Apenas Admin e Master podem cadastrar, editar ou deletar patrimônios
const requireAdmin = (req: AuthRequest, res: Response, next: any) => {
  if (req.user?.role === 'viewer') {
    res.status(403).json({ error: 'Acesso negado.' });
    return;
  }
  next();
};

// POST /api/patrimonios - Adicionar patrimônio (Admin/Master)
router.post('/', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { companyId, nfcTag, descricao, proprietario, setor, marca, serialNumber, liberadoAte, statusAcesso } = req.body;

    if (!nfcTag || !descricao || !proprietario) {
      res.status(400).json({ error: 'Tag NFC, descrição e proprietário são obrigatórios.' });
      return;
    }

    // Verifica se a tag já existe
    const exists = await queryOne('SELECT id FROM patrimonios WHERE nfc_tag = $1', [nfcTag]);
    if (exists) {
      res.status(400).json({ error: 'Esta Tag NFC já está cadastrada.' });
      return;
    }

    const patrimonio = await queryOne(
      `INSERT INTO patrimonios (company_id, nfc_tag, descricao, proprietario, setor, marca, serial_number, liberado_ate, status_acesso)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        companyId || null, nfcTag, descricao, proprietario, 
        setor || null, marca || null, serialNumber || null, liberadoAte || null,
        statusAcesso || 'liberado'
      ]
    );

    res.status(201).json(patrimonio);

  } catch (err) {
    console.error('POST /api/patrimonios error:', err);
    res.status(500).json({ error: 'Erro ao cadastrar patrimônio.' });
  }
});

// PUT /api/patrimonios/:id - Editar patrimônio (Admin/Master)
router.put('/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { companyId, nfcTag, descricao, proprietario, setor, marca, serialNumber, liberadoAte, statusAcesso } = req.body;

    const patrimonio = await queryOne(
      `UPDATE patrimonios 
       SET company_id = $1, nfc_tag = $2, descricao = $3, proprietario = $4, setor = $5, marca = $6, serial_number = $7, liberado_ate = $8, status_acesso = $9, updated_at = NOW()
       WHERE id = $10 RETURNING *`,
      [
        companyId || null, nfcTag, descricao, proprietario, 
        setor || null, marca || null, serialNumber || null, liberadoAte || null,
        statusAcesso, id
      ]
    );


    if (!patrimonio) {
      res.status(404).json({ error: 'Patrimônio não encontrado.' });
      return;
    }

    res.json(patrimonio);
  } catch (err: any) {
    console.error('PUT /api/patrimonios error:', err);
    if (err.code === '23505') { // unique_violation
       res.status(400).json({ error: 'Esta Tag NFC já está sedo usada por outro patrimônio.' });
       return;
    }
    res.status(500).json({ error: 'Erro ao atualizar patrimônio.' });
  }
});

// DELETE /api/patrimonios/:id
router.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM patrimonios WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/patrimonios error:', err);
    res.status(500).json({ error: 'Erro ao excluir patrimônio.' });
  }
});

// ============================================================
// POST /api/patrimonios/scan - Confirmação de Leitura da Tag (Operacional)
// ============================================================
router.post('/scan', async (req: AuthRequest, res: Response) => {
  try {
    const { nfcTag, acao } = req.body;
    if (!nfcTag || !acao || !['entrada', 'saida'].includes(acao)) {
      res.status(400).json({ error: 'Tag NFC ou ação (entrada/saida) inválida.' });
      return;
    }

    const patrimonio = await queryOne<{ id: string }>(
      'SELECT id FROM patrimonios WHERE nfc_tag = $1',
      [nfcTag]
    );

    if (!patrimonio) {
      res.status(404).json({ error: 'Patrimônio não encontrado.' });
      return;
    }

    let duracaoStr: string | null = null;

    if (acao === 'saida') {
      const lastEntrada = await queryOne<{ timestamp: Date }>(
        `SELECT timestamp FROM patrimonio_logs WHERE patrimonio_id = $1 AND acao = 'entrada' ORDER BY timestamp DESC LIMIT 1`,
        [patrimonio.id]
      );
      if (lastEntrada) {
        const diffMs = new Date().getTime() - new Date(lastEntrada.timestamp).getTime();
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        duracaoStr = `${diffHours}h ${diffMinutes}m`;
      }
    }

    await query(
      `INSERT INTO patrimonio_logs (patrimonio_id, porteiro_id, acao, duracao) VALUES ($1, $2, $3, $4)`,
      [patrimonio.id, req.user?.userId || null, acao, duracaoStr]
    );

    res.json({
      success: true,
      acao,
      duracao: duracaoStr
    });

  } catch (err) {
    console.error('POST /api/patrimonios/scan error:', err);
    res.status(500).json({ error: 'Erro interno ao processar a Tag NFC.' });
  }
});

export default router;
