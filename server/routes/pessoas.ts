import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../auth/middleware.js';
import { query, queryOne } from '../db.js';
import { sendMail } from '../mailer.js';
import { generateTermoPDF } from '../utils/pdf.js';
import { minioClient } from '../minioClient.js';

// Roteador de pessoas
const router = Router();

// ============================================================
// ROTAS PÚBLICAS (NÃO EXIGEM LOGIN)
// ============================================================

// Busca dados básicos para exibição do termo
router.get('/public/termo/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pessoa = await queryOne<{ nome_completo: string, company_name: string }>(
      `SELECT p.nome_completo, c.name as company_name 
       FROM pessoas p
       JOIN companies c ON p.company_id = c.id
       WHERE p.id = $1`,
      [id]
    );

    if (!pessoa) {
      res.status(404).json({ error: 'Cadastro não encontrado.' });
      return;
    }

    res.json(pessoa);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar termo.' });
  }
});

// Salva a assinatura do termo
router.post('/public/termo/:id/assinar', async (req, res) => {
  try {
    const { id } = req.params;
    const { assinatura } = req.body; // Base64 image

    if (!assinatura) {
      res.status(400).json({ error: 'Assinatura é obrigatória.' });
      return;
    }

    await query(
      `UPDATE pessoas 
       SET termo_assinado_at = NOW(), 
           termo_assinatura = $1 
       WHERE id = $2`,
      [assinatura, id]
    );

    // Gerar PDF e salvar no MinIO (Bucket: termo-portall)
    try {
      const p = await queryOne<any>(
        `SELECT p.nome_completo, p.documento, c.name as company_name 
         FROM pessoas p
         JOIN companies c ON p.company_id = c.id
         WHERE p.id = $1`, [id]
      );

      if (p) {
        const pdfBuffer = await generateTermoPDF({
          id,
          pessoaNome: p.nome_completo,
          documento: p.documento,
          company_name: p.company_name,
          assinadoEm: new Date().toISOString(),
          assinaturaBase64: assinatura
        });

        const bucket = 'termo-portall';
        const fileName = `${id}/${new Date().getTime()}.pdf`;

        const exists = await minioClient.bucketExists(bucket).catch(() => false);
        if (!exists) await minioClient.makeBucket(bucket, 'us-east-1');

        await minioClient.putObject(bucket, fileName, pdfBuffer, pdfBuffer.length, {
          'Content-Type': 'application/pdf'
        });
      }
    } catch (err) {
      console.error('Erro ao gerar/enviar PDF do termo:', err);
    }

    res.json({ success: true, message: 'Termo assinado com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao salvar assinatura.' });
  }
});

// Download de termo (Acesso via link direto do histórico)
router.get('/:id/termos/:filename/download', async (req, res) => {
  try {
    const { id, filename } = req.params;
    const bucket = 'termo-portall';
    const objectName = `${id}/${filename}`;

    const stream = await minioClient.getObject(bucket, objectName);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Termo_${filename}"`);
    stream.pipe(res);
  } catch (err) {
    console.error('Erro ao baixar termo:', err);
    res.status(404).send('Documento não encontrado.');
  }
});

// ============================================================
// ROTAS PRIVADAS (EXIGEM LOGIN)
// ============================================================
router.use(requireAuth);

// Helper para calcular o status geral e verificar vencimentos
function calculateStatus(liberadoAte: Date | null, asoVencimento: Date | null, treinamentos: { vencimento: Date }[], isApproved: boolean = true): 'liberado' | 'a_vencer' | 'bloqueado' {
  const now = new Date();
  
  // Se não estiver aprovado pela segurança (para prestadores), está bloqueado independente do resto
  if (!isApproved) return 'bloqueado';

  if (liberadoAte && liberadoAte < now) return 'bloqueado';
  if (asoVencimento && asoVencimento < now) return 'bloqueado';
  
  // Se algum treinamento obrigatório venceu
  const hasVencido = treinamentos.some(t => t.vencimento < now);
  if (hasVencido) return 'bloqueado';

  // Verifica "A Vencer" (90 dias)
  const in90Days = new Date();
  in90Days.setDate(in90Days.getDate() + 90);

  const hasAVencer = treinamentos.some(t => t.vencimento <= in90Days);
  if (hasAVencer) return 'a_vencer';
  
  // ASO ou Liberação vencendo em 90 dias
  if (asoVencimento && asoVencimento <= in90Days) return 'a_vencer';
  if (liberadoAte && liberadoAte <= in90Days) return 'a_vencer';

  return 'liberado';
}

function mapFotoUrl(rawPath: string | null): string | null {
  if (!rawPath) return null;
  if (rawPath.startsWith('/api/upload/foto/')) return rawPath;
  
  // Se for um link do browser do MinIO, o filename vem em base64 no final
  // Ex: .../browser/fotos-portall/YWM5MT...==
  if (rawPath.includes('/browser/')) {
    const parts = rawPath.split('/');
    let last = parts[parts.length - 1].split('?')[0];
    try {
      // Tenta decodificar de base64 (o MinIO usa isso no link do browser)
      const decoded = Buffer.from(last, 'base64').toString('utf-8');
      if (decoded.includes('.') && decoded.length > 5) {
        return `/api/upload/foto/${decoded}`;
      }
    } catch (e) {
      // Se falhar a decodificação, segue o fluxo normal
    }
  }

  // Se for link direto do MinIO mas não browser
  if (rawPath.includes('/fotos-portall/')) {
    const parts = rawPath.split('/');
    let filename = parts[parts.length - 1].split('?')[0];
    return `/api/upload/foto/${filename}`;
  }

  if (!rawPath.includes('/')) {
    return `/api/upload/foto/${rawPath}`;
  }

  return rawPath;
}

// ============================================================
// GET /api/pessoas - Lista visitantes e prestadores
// Master vê todas. Admin vê de todas as suas unidades vinculadas.
// ============================================================
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { includeInactive } = req.query;
    const filterActive = includeInactive !== 'true';

    let pessoasData;
    const baseFields = `
      p.*, p.is_active as "isActive", e.name as empresa_origem_nome, t.nome as atividade_nome,
      pl.status as last_presence_status, pl.timestamp as last_presence_timestamp,
      pl.armario as current_armario
    `;
    const fromClause = `
      FROM pessoas p
      LEFT JOIN empresas_terceiro e ON p.empresa_origem_id = e.id
      LEFT JOIN tipos_atividade t ON p.atividade_id = t.id
      LEFT JOIN LATERAL (
        SELECT status, timestamp, armario
        FROM presenca_logs 
        WHERE pessoa_id = p.id 
        ORDER BY timestamp DESC 
        LIMIT 1
      ) pl ON true
    `;

    const activeFilter = filterActive ? 'AND p.is_active = TRUE' : '';

    if (req.user?.role === 'master') {
      pessoasData = await query(
        `SELECT ${baseFields} ${fromClause} 
         WHERE 1=1 ${activeFilter}
         ORDER BY p.nome_completo ASC`
      );
    } else {
      pessoasData = await query(
        `SELECT ${baseFields} ${fromClause}
         WHERE p.company_id IN (
           SELECT company_id FROM user_companies WHERE user_id = $1
           UNION
           SELECT id FROM companies WHERE parent_id IN (
             SELECT company_id FROM user_companies WHERE user_id = $1
           )
         )
         ${activeFilter}
         ORDER BY p.nome_completo ASC`,
        [req.user!.userId]
      );
    }

    // Busca os treinamentos atrelados para calcular os vencimentos reais
    const pessoasIds = pessoasData.map((p: any) => p.id);
    let treinamentosPorPessoa: Record<string, any[]> = {};

    if (pessoasIds.length > 0) {
      const links = await query(
        `SELECT tp.*, t.nome, t.codigo 
         FROM treinamentos_pessoa tp
         JOIN tipos_treinamento t ON tp.treinamento_id = t.id
         WHERE tp.pessoa_id = ANY($1)`,
        [pessoasIds]
      );

      links.forEach((l: any) => {
        if (!treinamentosPorPessoa[l.pessoa_id]) treinamentosPorPessoa[l.pessoa_id] = [];
        const dataVenc = new Date(l.data_vencimento);
        const now = new Date();
        const in90Days = new Date();
        in90Days.setDate(in90Days.getDate() + 90);

        let statusTreinamento: 'Vencido' | 'A Vencer' | 'Válido';
        if (dataVenc < now) {
          statusTreinamento = 'Vencido';
        } else if (dataVenc <= in90Days) {
          statusTreinamento = 'A Vencer';
        } else {
          statusTreinamento = 'Válido';
        }

        treinamentosPorPessoa[l.pessoa_id].push({
           treinamentoId: l.treinamento_id,
           treinamentoNome: l.nome,
           treinamentoCodigo: l.codigo,
           dataRealizacao: l.data_realizacao,
           dataVencimento: l.data_vencimento,
           statusTreinamento
        });
      });
    }

    const payload = pessoasData.map((p: any) => {
      // 1 ano para ASO via genérico, se o escopo for esse, senão usa lógica custom
      let asoVencimento = null;
      if (p.aso_data_realizacao) {
         asoVencimento = new Date(p.aso_data_realizacao);
         asoVencimento.setFullYear(asoVencimento.getFullYear() + 1); // Exemplo ASO = 12 meses
      }
      
      const liberadoAteDate = p.liberado_ate ? new Date(p.liberado_ate) : null;
      const tpps = treinamentosPorPessoa[p.id] || [];
      const vencimentos = tpps.map(t => ({ vencimento: new Date(t.dataVencimento) }));

      const isApproved = !!p.is_approved;
      const statusAcesso = calculateStatus(liberadoAteDate, asoVencimento, vencimentos, isApproved);

      return {
        id: p.id,
        companyId: p.company_id,
        tipoAcesso: p.tipo_acesso,
        foto: mapFotoUrl(p.foto),
        nomeCompleto: p.nome_completo,
        documento: p.documento,
        empresaOrigemId: p.empresa_origem_id,
        empresaOrigemNome: p.empresa_origem_nome,
        responsavelInterno: p.responsavel_interno,
        celularAutorizado: p.celular_autorizado,
        notebookAutorizado: p.notebook_autorizado,
        liberadoAte: p.liberado_ate,
        descricaoAtividade: p.descricao_atividade,
        atividadeId: p.atividade_id,
        atividadeNome: p.atividade_nome,
        asoDataRealizacao: p.aso_data_realizacao,
        epiObrigatorio: p.epi_obrigatorio,
        epiDescricao: p.epi_descricao,
        isApproved,
        statusAcesso,
        treinamentos: tpps,
        lastPresenceStatus: p.last_presence_status,
        lastPresenceTimestamp: p.last_presence_timestamp,
        armario: p.last_presence_status === 'entrada' ? p.current_armario : null,
        isActive: !!p.is_active
      };
    });
    
    res.json(payload);
  } catch (err) {
    console.error('GET /pessoas error:', err);
    res.status(500).json({ error: 'Erro ao buscar pessoas.' });
  }
});

// ============================================================
// GET /api/pessoas/:id - Busca uma pessoa específica
// ============================================================
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    
    const baseFields = `
      p.*, p.is_active as "isActive", e.name as empresa_origem_nome, t.nome as atividade_nome,
      pl.status as last_presence_status, pl.timestamp as last_presence_timestamp,
      pl.armario as current_armario
    `;
    const fromClause = `
      FROM pessoas p
      LEFT JOIN empresas_terceiro e ON p.empresa_origem_id = e.id
      LEFT JOIN tipos_atividade t ON p.atividade_id = t.id
      LEFT JOIN LATERAL (
        SELECT status, timestamp, armario
        FROM presenca_logs 
        WHERE pessoa_id = p.id 
        ORDER BY timestamp DESC 
        LIMIT 1
      ) pl ON true
    `;

    const p = await queryOne<any>(
      `SELECT ${baseFields} ${fromClause} WHERE p.id = $1`, [id]
    );

    if (!p) {
       res.status(404).json({ error: 'Pessoa não encontrada.' });
       return;
    }

    // Validação de acesso para Admin
    if (req.user?.role === 'admin') {
       const isAuthorized = await queryOne(
         `SELECT 1 FROM user_companies WHERE user_id = $1 AND company_id = $2
          UNION
          SELECT 1 FROM companies WHERE parent_id IN (SELECT company_id FROM user_companies WHERE user_id = $1) AND id = $2`,
         [req.user.userId, p.company_id]
       );
       if (!isAuthorized) {
         res.status(403).json({ error: 'Sem permissão para este registro.' });
         return;
       }
    }

    // Busca treinamentos
    const treinamentos = await query(
      `SELECT tp.*, t.nome, t.codigo 
       FROM treinamentos_pessoa tp
       JOIN tipos_treinamento t ON tp.treinamento_id = t.id
       WHERE tp.pessoa_id = $1`,
      [id]
    );

    const now = new Date();
    const in90Days = new Date();
    in90Days.setDate(in90Days.getDate() + 90);

    const mappedTreinamentos = treinamentos.map((l: any) => {
      const dataVenc = new Date(l.data_vencimento);
      let statusTreinamento: 'Vencido' | 'A Vencer' | 'Válido';
      if (dataVenc < now) statusTreinamento = 'Vencido';
      else if (dataVenc <= in90Days) statusTreinamento = 'A Vencer';
      else statusTreinamento = 'Válido';

      return {
        treinamentoId: l.treinamento_id,
        treinamentoNome: l.nome,
        treinamentoCodigo: l.codigo,
        dataRealizacao: l.data_realizacao,
        dataVencimento: l.data_vencimento,
        statusTreinamento
      };
    });

    let asoVencimento = null;
    if (p.aso_data_realizacao) {
       asoVencimento = new Date(p.aso_data_realizacao);
       asoVencimento.setFullYear(asoVencimento.getFullYear() + 1);
    }
    
    const liberadoAteDate = p.liberado_ate ? new Date(p.liberado_ate) : null;
    const isApproved = !!p.is_approved;
    const vencimentos = mappedTreinamentos.map(t => ({ vencimento: new Date(t.dataVencimento) }));
    const statusAcesso = calculateStatus(liberadoAteDate, asoVencimento, vencimentos, isApproved);

    res.json({
      id: p.id,
      companyId: p.company_id,
      tipoAcesso: p.tipo_acesso,
      foto: mapFotoUrl(p.foto),
      nomeCompleto: p.nome_completo,
      documento: p.documento,
      empresaOrigemId: p.empresa_origem_id,
      empresaOrigemNome: p.empresa_origem_nome,
      responsavelInterno: p.responsavel_interno,
      celularAutorizado: p.celular_autorizado,
      notebookAutorizado: p.notebook_autorizado,
      liberadoAte: p.liberado_ate,
      descricaoAtividade: p.descricao_atividade,
      atividadeId: p.atividade_id,
      atividadeNome: p.atividade_nome,
      asoDataRealizacao: p.aso_data_realizacao,
      epiObrigatorio: p.epi_obrigatorio,
      epiDescricao: p.epi_descricao,
      isApproved,
      statusAcesso,
      treinamentos: mappedTreinamentos,
      lastPresenceStatus: p.last_presence_status,
      lastPresenceTimestamp: p.last_presence_timestamp,
      armario: p.last_presence_status === 'entrada' ? p.current_armario : null,
      isActive: !!p.is_active,
      termoAssinadoEm: p.termo_assinado_at
    });
  } catch (err) {
    console.error('GET /pessoas/:id error:', err);
    res.status(500).json({ error: 'Erro ao buscar pessoa.' });
  }
});

// Listar termos (PDFs) no MinIO
router.get('/:id/termos', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const bucket = 'termo-portall';
    
    const exists = await minioClient.bucketExists(bucket).catch(() => false);
    if (!exists) return res.json([]);

    const stream = minioClient.listObjectsV2(bucket, `${id}/`, true);
    const objects: any[] = [];

    stream.on('data', obj => objects.push(obj));
    stream.on('error', err => { throw err; });
    stream.on('end', () => {
      res.json(objects.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime()));
    });
  } catch (err) {
    console.error('Erro ao listar termos:', err);
    res.status(500).json({ error: 'Erro ao listar termos.' });
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
// POST /api/pessoas
// ============================================================
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const {
      companyId, tipoAcesso, foto, nomeCompleto, documento, empresaOrigemId, responsavelInterno,
      celularAutorizado, celularImei, notebookAutorizado, notebookMarca, notebookPatrimonio,
      liberadoAte, descricaoAtividade,
      atividadeId, asoDataRealizacao, epiObrigatorio, epiDescricao,
      treinamentos // ARRAY de treinamentos [{ treinamentoId, dataRealizacao }]
    } = req.body;

    if (!companyId || !nomeCompleto || !documento || !responsavelInterno) {
      res.status(400).json({ error: 'Dados obrigatórios ausentes.' }); return;
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
        res.status(403).json({ error: 'Você não tem permissão para cadastrar pessoas nesta unidade.' });
        return;
      }
    }

    // Lógica de Aprovação da Segurança
    let isApproved = true;
    if (tipoAcesso === 'prestador' && !req.user!.isSafety) {
      isApproved = false;
    }

    // Insere a pessoa
    const pessoa = await queryOne<{ id: string }>(
      `INSERT INTO pessoas (
        company_id, tipo_acesso, foto, nome_completo, documento, empresa_origem_id, responsavel_interno,
        celular_autorizado, celular_imei, notebook_autorizado, notebook_marca, notebook_patrimonio, 
        liberado_ate, descricao_atividade, atividade_id, aso_data_realizacao, epi_obrigatorio, 
        epi_descricao, created_by, is_approved
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING id`,
      [
        companyId, tipoAcesso, foto, nomeCompleto, documento, empresaOrigemId || null, responsavelInterno,
        celularAutorizado, celularImei || null, notebookAutorizado, notebookMarca || null, 
        notebookPatrimonio || null, liberadoAte || null, descricaoAtividade,
        tipoAcesso === 'prestador' ? (atividadeId || null) : null,
        asoDataRealizacao || null,
        tipoAcesso === 'prestador' ? epiObrigatorio : false,
        tipoAcesso === 'prestador' ? epiDescricao : null,
        req.user!.userId,
        isApproved
      ]
    );

    // Salva LOG de sistema
    await query(
      `INSERT INTO system_logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user!.userId,
        'PESSOA_CRIADA',
        'pessoa',
        pessoa?.id,
        JSON.stringify({ nome_completo: nomeCompleto, documento, tipo_acesso: tipoAcesso, is_approved: isApproved })
      ]
    );

    // NOTIFICAÇÃO POR E-MAIL PARA A SEGURANÇA
    if (pessoa) {
      const { sendMail } = await import('../mailer.js');
      const emails = await query<{ email: string }>('SELECT email FROM notification_emails WHERE company_id = $1', [companyId]);
      
      if (emails.length > 0) {
        const recipients = emails.map(e => e.email);
        const appUrl = process.env.APP_URL || 'https://portall.ctdibrasil.com.br';
        const isPendingApprove = tipoAcesso === 'prestador' && !isApproved;
        
        const subject = isPendingApprove 
          ? `⚠️ [APROVAÇÃO] Novo Prestador: ${nomeCompleto}` 
          : `✅ [AVISO] Novo ${tipoAcesso === 'visitante' ? 'Visitante' : 'Prestador'}: ${nomeCompleto}`;

        const html = `
          <div style="font-family: sans-serif; background: #f9fafb; padding: 40px 20px;">
            <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
              <h2 style="color: #111827; margin-top: 0;">Novo Cadastro Portal PortALL</h2>
              <p style="color: #4b5563;">Olá, equipe de segurança.</p>
              <p style="color: #4b5563;">Um novo <strong>${tipoAcesso}</strong> foi cadastrado no sistema por <strong>${req.user!.email}</strong>.</p>
              
              <div style="background: #f3f4f6; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <p style="margin: 0; font-size: 14px; color: #6b7280;">Nome Completo:</p>
                <p style="margin: 4px 0 16px; font-weight: bold; color: #111827; font-size: 18px;">${nomeCompleto}</p>
                
                <p style="margin: 0; font-size: 14px; color: #6b7280;">Documento:</p>
                <p style="margin: 4px 0 0; font-weight: bold; color: #111827;">${documento}</p>

                ${isPendingApprove ? `
                  <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #d1d5db;">
                    <p style="color: #991b1b; font-weight: bold; margin: 0;">⚠️ AGUARDANDO APROVAÇÃO</p>
                    <p style="color: #7f1d1d; font-size: 13px; margin-top: 4px;">Este prestador está BLOQUEADO na portaria até que um administrador da segurança realize a aprovação no sistema.</p>
                  </div>
                ` : ''}
              </div>

              <div style="text-align: center; margin-top: 32px;">
                <a href="${appUrl}/portaria" style="background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">
                  Ver no PortALL
                </a>
              </div>
            </div>
          </div>
        `;

        await sendMail({ to: recipients, subject, html });
      }
    }

    // Salva os treinamentos e calcula datas de vencimento automaticamente baseada na validade!
    if (pessoa && tipoAcesso === 'prestador' && Array.isArray(treinamentos)) {
      for (const tr of treinamentos) {
         if (!tr.treinamentoId || !tr.dataRealizacao) continue;
         
         const tipo = await queryOne<{ validade_meses: number }>('SELECT validade_meses FROM tipos_treinamento WHERE id = $1', [tr.treinamentoId]);
         if (!tipo) continue;

         const dateR = new Date(tr.dataRealizacao);
         const dateV = new Date(dateR);
         dateV.setMonth(dateV.getMonth() + tipo.validade_meses);

         await query(
           `INSERT INTO treinamentos_pessoa (pessoa_id, treinamento_id, data_realizacao, data_vencimento) 
            VALUES ($1, $2, $3, $4)`,
           [pessoa.id, tr.treinamentoId, tr.dataRealizacao, dateV.toISOString().split('T')[0]]
         );
      }
    }

    await query(
      `INSERT INTO system_logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user!.userId,
        'PESSOA_CRIADA',
        'pessoa',
        pessoa.id,
        JSON.stringify({ nome_completo: nomeCompleto, documento })
      ]
    );

    // ============================================
    // Disparo de E-mails (Notificações)
    // ============================================
    try {
      const emailList = await query<{ email: string }>(
        'SELECT email FROM notification_emails WHERE company_id = $1',
        [companyId]
      );

      if (emailList.length > 0) {
        let empresaNomeTx = 'Empresa não informada';
        if (empresaOrigemId) {
          const emp = await queryOne<{ name: string }>('SELECT name FROM empresas_terceiro WHERE id = $1', [empresaOrigemId]);
          if (emp) empresaNomeTx = emp.name;
        }

        const appUrl = process.env.APP_URL || 'https://portall.ctdibrasil.com.br';
        const subject = `[PortALL] Novo Cadastro: ${nomeCompleto}`;
        const bodyHtml = `
          <!DOCTYPE html>
          <html lang="pt-BR">
          <head><meta charset="UTF-8"></head>
          <body style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 32px 16px;">
            <div style="max-width: 540px; margin: 0 auto; background: white; border-radius: 16px; padding: 36px; box-shadow: 0 4px 20px rgba(0,0,0,0.07);">
              <div style="text-align:center; margin-bottom: 28px;">
                <img src="${appUrl}/LogoCompleto.png" alt="PortALL" style="height: 42px; object-fit: contain;" />
              </div>
              <h2 style="color: #1e3a5f; font-size: 17px; margin-bottom: 4px;">Novo Cadastro Registrado</h2>
              <p style="color: #6b7280; font-size: 13px; margin-top: 0;">Um novo registro foi inserido na sua base de controle de acesso.</p>
              <table style="width:100%; border-collapse: collapse; margin-top: 20px; font-size: 14px;">
                <tr style="background: #f8faff;"><td style="padding: 10px 14px; font-weight: bold; color: #374151; width: 40%;">Nome</td><td style="padding: 10px 14px; color: #111827;">${nomeCompleto}</td></tr>
                <tr><td style="padding: 10px 14px; font-weight: bold; color: #374151;">Documento</td><td style="padding: 10px 14px; color: #111827;">${documento}</td></tr>
                <tr style="background: #f8faff;"><td style="padding: 10px 14px; font-weight: bold; color: #374151;">Categoria</td><td style="padding: 10px 14px; color: #111827;">${tipoAcesso === 'visitante' ? 'Visitante' : 'Prestador de Serviço'}</td></tr>
                <tr><td style="padding: 10px 14px; font-weight: bold; color: #374151;">Empresa de Origem</td><td style="padding: 10px 14px; color: #111827;">${empresaNomeTx}</td></tr>
                <tr style="background: #f8faff;"><td style="padding: 10px 14px; font-weight: bold; color: #374151;">Responsável Interno</td><td style="padding: 10px 14px; color: #111827;">${responsavelInterno}</td></tr>
                <tr><td style="padding: 10px 14px; font-weight: bold; color: #374151;">Acesso Liberado Até</td><td style="padding: 10px 14px; color: ${liberadoAte ? '#059669' : '#dc2626'}; font-weight: bold;">${liberadoAte || 'Não definido'}</td></tr>
              </table>
              <p style="color: #9ca3af; font-size: 11px; text-align: center; margin-top: 28px; border-top: 1px solid #f3f4f6; padding-top: 16px;">
                PortALL &copy; ${new Date().getFullYear()} &mdash; E-mail automático, não responda.
              </p>
            </div>
          </body></html>
        `;

        await sendMail({
          to: emailList.map(e => e.email),
          subject,
          html: bodyHtml,
        });
      } else {
        console.log(`[MAILER] Nenhum e-mail configurado para a empresa ${companyId}. Nenhum alerta enviado.`);
      }
    } catch (emailErr) {
      console.error('[MAILER] Falha ao disparar e-mail de notificação:', emailErr);
      // Não trava a criação da pessoa se o e-mail falhar.
    }

    res.status(201).json(pessoa);
  } catch (err: any) {
    console.error('POST /pessoas error:', err);
    res.status(500).json({ error: 'Erro ao salvar pessoa.' });
  }
});

// Helper para validar propriedade (Multi-tenant check)
async function canAccessPessoa(req: AuthRequest, pessoaId: string): Promise<boolean> {
  if (req.user?.role === 'master') return true;
  
  const pessoa = await queryOne<{ company_id: string }>(
    'SELECT company_id FROM pessoas WHERE id = $1', [pessoaId]
  );
  if (!pessoa) return false;

  const userCompanies = await query<{ company_id: string }>(
    `SELECT company_id FROM user_companies WHERE user_id = $1
     UNION
     SELECT id FROM companies WHERE parent_id IN (SELECT company_id FROM user_companies WHERE user_id = $1)`,
    [req.user!.userId]
  );
  
  return userCompanies.some(uc => uc.company_id === pessoa.company_id);
}

// ============================================================
// PUT /api/pessoas/:id
// ============================================================
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Validação Multi-tenant
    const hasAccess = await canAccessPessoa(req, id);
    if (!hasAccess) {
      res.status(403).json({ error: 'Você não tem permissão para editar este cadastro.' });
      return;
    }
    const {
      companyId, tipoAcesso, foto, nomeCompleto, documento, empresaOrigemId, responsavelInterno,
      celularAutorizado, celularImei, notebookAutorizado, notebookMarca, notebookPatrimonio,
      liberadoAte, descricaoAtividade,
      atividadeId, asoDataRealizacao, epiObrigatorio, epiDescricao,
      treinamentos
    } = req.body;

    // Atualiza dados da pessoa
    await query(
      `UPDATE pessoas SET 
        company_id = $1, tipo_acesso = $2, foto = $3, nome_completo = $4, documento = $5, 
        empresa_origem_id = $6, responsavel_interno = $7, celular_autorizado = $8, 
        celular_imei = $9, notebook_autorizado = $10, notebook_marca = $11, 
        notebook_patrimonio = $12, liberado_ate = $13, descricao_atividade = $14, 
        atividade_id = $15, aso_data_realizacao = $16, epi_obrigatorio = $17, 
        epi_descricao = $18, updated_at = NOW()
       WHERE id = $19`,
      [
        companyId, tipoAcesso, foto, nomeCompleto, documento, empresaOrigemId || null, responsavelInterno,
        celularAutorizado, celularImei || null, notebookAutorizado, notebookMarca || null, 
        notebookPatrimonio || null, liberadoAte || null, descricaoAtividade,
        tipoAcesso === 'prestador' ? (atividadeId || null) : null,
        asoDataRealizacao || null, 
        tipoAcesso === 'prestador' ? epiObrigatorio : false,
        tipoAcesso === 'prestador' ? epiDescricao : null,
        id
      ]
    );

    // Atualiza treinamentos (Remove antigos e insere novos)
    if (tipoAcesso === 'prestador' && Array.isArray(treinamentos)) {
      await query('DELETE FROM treinamentos_pessoa WHERE pessoa_id = $1', [id]);
      for (const tr of treinamentos) {
        if (!tr.treinamentoId || !tr.dataRealizacao) continue;
        
        const tipo = await queryOne<{ validade_meses: number }>('SELECT validade_meses FROM tipos_treinamento WHERE id = $1', [tr.treinamentoId]);
        if (!tipo) continue;

        const dateR = new Date(tr.dataRealizacao);
        const dateV = new Date(dateR);
        dateV.setMonth(dateV.getMonth() + tipo.validade_meses);

        await query(
          `INSERT INTO treinamentos_pessoa (pessoa_id, treinamento_id, data_realizacao, data_vencimento) 
           VALUES ($1, $2, $3, $4)`,
          [id, tr.treinamentoId, tr.dataRealizacao, dateV.toISOString().split('T')[0]]
        );
      }
    }

    await query(
      `INSERT INTO system_logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user!.userId,
        'PESSOA_ATUALIZADA',
        'pessoa',
        id,
        JSON.stringify({ nome_completo: nomeCompleto, documento })
      ]
    );

    res.json({ success: true });
  } catch (err: any) {
    console.error('PUT /pessoas error:', err);
    res.status(500).json({ error: 'Erro ao atualizar pessoa.' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Validação Multi-tenant
    const hasAccess = await canAccessPessoa(req, id);
    if (!hasAccess) {
      res.status(403).json({ error: 'Você não tem permissão para excluir este cadastro.' });
      return;
    }
    
    // Busca dados antes de deletar para o log
    const pessoa = await queryOne<{ nome_completo: string, documento: string }>(
      'SELECT nome_completo, documento FROM pessoas WHERE id = $1', [id]
    );

    if (!pessoa) {
      res.status(404).json({ error: 'Pessoa não encontrada.' });
      return;
    }

    await query('DELETE FROM pessoas WHERE id = $1', [id]);

    await query(
      `INSERT INTO system_logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user!.userId,
        'PESSOA_EXCLUIDA',
        'pessoa',
        id,
        JSON.stringify({ nome_completo: pessoa.nome_completo, documento: pessoa.documento })
      ]
    );

    res.json({ success: true });
  } catch (err: any) {
    console.error('DELETE /pessoas error:', err);
    res.status(500).json({ error: 'Erro ao excluir pessoa.' });
  }
});

router.post('/:id/approve', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Apenas Administradores da Segurança podem aprovar
    if (!req.user?.isSafety && req.user?.role !== 'master') {
      res.status(403).json({ error: 'Apenas a Segurança do Trabalho pode aprovar este cadastro.' });
      return;
    }

    // Validação Multi-tenant
    const hasAccess = await canAccessPessoa(req, id);
    if (!hasAccess) {
      res.status(403).json({ error: 'Você não tem permissão para aprovar este cadastro.' });
      return;
    }

    const updated = await queryOne<{ id: string }>(
      `UPDATE pessoas 
       SET is_approved = TRUE, 
           approved_by = $1, 
           approved_at = NOW() 
       WHERE id = $2 
       RETURNING id`,
      [req.user.userId, id]
    );

    if (!updated) {
      res.status(404).json({ error: 'Cadastro não encontrado.' });
      return;
    }

    await query(
      `INSERT INTO system_logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.userId, 'PESSOA_APROVADA', 'pessoa', id, JSON.stringify({ approved_by: req.user.email })]
    );

    res.json({ success: true, message: 'Cadastro aprovado com sucesso.' });
  } catch (err: any) {
    console.error('Approve person error:', err);
    res.status(500).json({ error: 'Erro ao aprovar cadastro.' });
  }
});

router.patch('/:id/status', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (isActive === undefined) {
      res.status(400).json({ error: 'Status isActive é obrigatório.' });
      return;
    }

    // Validação Multi-tenant
    const hasAccess = await canAccessPessoa(req, id);
    if (!hasAccess) {
      res.status(403).json({ error: 'Você não tem permissão para alterar o status deste cadastro.' });
      return;
    }

    const updated = await queryOne<{ id: string, nome_completo: string, documento: string }>(
      `UPDATE pessoas SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING id, nome_completo, documento`,
      [isActive, id]
    );

    if (!updated) {
      res.status(404).json({ error: 'Cadastro não encontrado.' });
      return;
    }

    await query(
      `INSERT INTO system_logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user!.userId,
        isActive ? 'PESSOA_REATIVADA' : 'PESSOA_DESATIVADA',
        'pessoa',
        id,
        JSON.stringify({ nome_completo: updated.nome_completo, documento: updated.documento })
      ]
    );

    res.json({ success: true, isActive });
  } catch (err: any) {
    console.error('PATCH /pessoas/:id/status error:', err);
    res.status(500).json({ error: 'Erro ao alterar status da pessoa.' });
  }
});

export default router;
