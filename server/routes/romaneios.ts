import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db.js';
import { requireAuth, AuthRequest } from '../auth/middleware.js';

const router = Router();

// ============================================================
// PUBLIC ROUTES - ACESSO PÚBLICO
// ============================================================

// Verificar senha de acesso ao formulário
router.post('/verify-password', (req: Request, res: Response) => {
  const { senha } = req.body;
  const SENHA_CORRETA = process.env.SENHA_ROMANEIO;
  
  if (SENHA_CORRETA && senha === SENHA_CORRETA) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Senha de acesso incorreta ou não configurada.' });
  }
});

router.post('/public', async (req: Request, res: Response) => {
  const { senha, empresa, motivo, solicitante_nome, itens, localizacao } = req.body;
  
  const SENHA_CORRETA = process.env.SENHA_ROMANEIO;
  if (!SENHA_CORRETA || senha !== SENHA_CORRETA) {
    res.status(401).json({ error: 'Senha incorreta ou acesso não autorizado.' });
    return;
  }

  if (!empresa || !solicitante_nome || !itens || !Array.isArray(itens) || itens.length === 0) {
    res.status(400).json({ error: 'Dados incompletos.' });
    return;
  }

  try {
    const { createHash } = await import('crypto');
    const signatureHash = createHash('sha256').update(`${solicitante_nome}-${Date.now()}-${localizacao}`).digest('hex').slice(0, 16).toUpperCase();

    const romaneio = await queryOne<{ id: string, created_at: string }>(
      `INSERT INTO romaneios (empresa, motivo, solicitante_nome, status, localizacao, signature_hash)
       VALUES ($1, $2, $3, 'pendente', $4, $5)
       RETURNING id, created_at`,
      [empresa, motivo || '', solicitante_nome, localizacao || 'Não fornecida', signatureHash]
    );

    if (romaneio) {
      for (const item of itens) {
        if (item.descricao && item.quantidade) {
          await query(
            `INSERT INTO romaneio_items (romaneio_id, descricao, quantidade) VALUES ($1, $2, $3)`,
            [romaneio.id, item.descricao, parseInt(item.quantidade)]
          );
        }
      }

      // NOTIFICAÇÃO POR E-MAIL PARA OS APROVADORES DESIGNADOS
      const { sendMail } = await import('../mailer.js');
      const { generateRomaneioPDF } = await import('../utils/pdf.js');
      
      // Busca apenas usuários que podem aprovar romaneio
      const approvers = await query<{ id: string, email: string, display_name: string }>(
        'SELECT id, email, display_name FROM users WHERE can_approve_romaneio = true'
      );
      
      if (approvers.length > 0) {
        // Gerar o PDF inicial (apenas com assinatura do solicitante)
        const pdfBuffer = await generateRomaneioPDF({
          id: romaneio.id,
          solicitante_nome,
          empresa,
          motivo,
          itens,
          created_at: romaneio.created_at,
          localizacao: localizacao || 'Não fornecida',
          signature_hash: signatureHash
        });

        const appUrl = process.env.APP_URL || 'https://portall.ehspro.com.br';
        const subject = `Novo Romaneio de Materiais - ${empresa}`;

        // Envia e-mail individual para cada aprovador com link direto
        for (const admin of approvers) {
          const directLink = `${appUrl}/approve-romaneio?id=${romaneio.id}&approver=${admin.id}`;
          
          const html = `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
              <div style="background-color: #2563eb; padding: 24px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 20px;">Solicitação de Romaneio</h1>
              </div>
              <div style="padding: 24px; color: #334155;">
                <p>Olá <b>${admin.display_name}</b>, uma nova solicitação de romaneio foi gerada por <b>${solicitante_nome}</b> e aguarda sua aprovação.</p>
                <div style="background-color: #f8fafc; padding: 16px; border-radius: 8px; margin: 16px 0; border: 1px solid #e2e8f0;">
                  <p style="margin: 4px 0;"><strong>Empresa:</strong> ${empresa}</p>
                  <p style="margin: 4px 0;"><strong>Motivo:</strong> ${motivo || 'Não informado'}</p>
                  <p style="margin: 4px 0;"><strong>Itens:</strong> ${itens.length} itens cadastrados</p>
                </div>
                <p>Você pode aprovar este romaneio instantaneamente clicando no botão abaixo:</p>
                <div style="text-align: center; margin-top: 24px; margin-bottom: 24px;">
                  <a href="${directLink}" style="background-color: #16a34a; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; font-size: 16px; box-shadow: 0 4px 6px rgba(22, 163, 74, 0.2);">Aprovar Agora</a>
                </div>
                <p style="font-size: 12px; color: #64748b;">Ao clicar em aprovar, sua assinatura digital (nome, data, localização e hash) será vinculada ao documento oficial F-5000341.</p>
              </div>
              <div style="background-color: #f1f5f9; padding: 12px; text-align: center; font-size: 10px; color: #64748b;">
                Sistema de Gestão de Portaria - PortALL
              </div>
            </div>
          `;

          await sendMail({ 
            to: admin.email, 
            subject, 
            html,
            attachments: [{
              filename: `Romaneio_${romaneio.id.slice(0, 8)}.pdf`,
              content: pdfBuffer
            }]
          }).catch(err => console.error(`Error sending email to ${admin.email}:`, err));
        }
      }
    }

    res.status(201).json({ success: true, id: romaneio?.id });
  } catch (e: any) {
    console.error('Error creating public romaneio:', e);
    res.status(500).json({ error: 'Erro ao criar romaneio.' });
  }
});

// FUNÇÃO AUXILIAR PARA PROCESSAR APROVAÇÃO E UPLOAD
async function processApproval(id: string, approverId: string, localizacao?: string) {
  const { createHash } = await import('crypto');
  const { generateRomaneioPDF } = await import('../utils/pdf.js');
  const { minioClient, MINIO_PUBLIC_BASE } = await import('../minioClient.js');
  
  const now = new Date();
  const loc = localizacao || 'Não fornecida';

  // 1. Busca dados do romaneio e do aprovador
  const rom = await queryOne<any>('SELECT * FROM romaneios WHERE id = $1', [id]);
  const approver = await queryOne<any>('SELECT display_name FROM users WHERE id = $1', [approverId]);
  
  if (!rom || !approver) throw new Error('Romaneio ou Aprovador não encontrado.');

  // 2. Gera Hash de Aprovação
  const approverHash = createHash('sha256')
    .update(`${approver.display_name}-${now.toISOString()}-${loc}`)
    .digest('hex').slice(0, 16).toUpperCase();

  // 3. Busca itens para o PDF
  const items = await query('SELECT descricao, quantidade FROM romaneio_items WHERE romaneio_id = $1', [id]);

  // 4. Gera PDF Final assinado
  const pdfBuffer = await generateRomaneioPDF({
    id: rom.id,
    solicitante_nome: rom.solicitante_nome,
    empresa: rom.empresa,
    motivo: rom.motivo,
    itens: items as any,
    created_at: rom.created_at,
    localizacao: rom.localizacao,
    signature_hash: rom.signature_hash,
    tipo: rom.tipo || 'entrada',
    aprovador_nome: approver.display_name,
    approved_at: now.toISOString(),
    aprovador_localizacao: loc,
    aprovador_signature_hash: approverHash
  });

  // 5. Upload para MinIO (Bucket: romaneio-portall)
  const bucket = 'romaneio-portall';
  const fileName = `finalizados/Romaneio_${id}_${now.getTime()}.pdf`;

  try {
    const exists = await minioClient.bucketExists(bucket).catch(() => false);
    if (!exists) await minioClient.makeBucket(bucket, 'us-east-1');

    await minioClient.putObject(bucket, fileName, pdfBuffer, pdfBuffer.length, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Romaneio_${id}.pdf"`
    });
    console.log(`[ROMANEIO] PDF Assinado enviado para MinIO: ${fileName}`);
  } catch (err) {
    console.error(`[ROMANEIO] Erro ao enviar para MinIO:`, err);
    // Continuamos para salvar no banco mesmo se o upload falhar, 
    // mas o log registrará o erro.
  }

  const pdfUrl = `${MINIO_PUBLIC_BASE}/${bucket}/${fileName}`;

  // 6. Atualiza Banco
  await query(`
    UPDATE romaneios 
    SET status = 'aprovado', 
        aprovador_id = $1, 
        approved_at = $2, 
        aprovador_localizacao = $3, 
        aprovador_signature_hash = $4,
        pdf_url = $5
    WHERE id = $6
  `, [approverId, now, loc, approverHash, pdfUrl, id]);

  return { approvedBy: approver.display_name, approvedAt: now };
}

// APROVAÇÃO DIRETA VIA LINK (SEM LOGIN)
router.post('/approve-direct', async (req: Request, res: Response) => {
  const { id, approverId, localizacao } = req.body;

  if (!id || !approverId) {
    res.status(400).json({ error: 'Parâmetros inválidos.' });
    return;
  }

  try {
    const rom = await queryOne<any>(`
      SELECT r.*, u.display_name as ja_aprovado_por 
      FROM romaneios r 
      LEFT JOIN users u ON r.aprovador_id = u.id 
      WHERE r.id = $1
    `, [id]);

    if (!rom) return res.status(404).json({ error: 'Romaneio não encontrado.' });

    if (rom.status === 'aprovado' || rom.status === 'concluido') {
      return res.json({ 
        alreadyApproved: true, 
        approvedBy: rom.ja_aprovado_por, 
        approvedAt: rom.approved_at 
      });
    }

    const result = await processApproval(id, approverId, localizacao);
    res.json({ success: true, ...result });
  } catch (e: any) {
    console.error('Error in direct approval:', e);
    res.status(500).json({ error: 'Erro ao processar aprovação.' });
  }
});

// Rota de Proxy para Download de PDF (Redirecionamento para URL Assinada)
// Colocada aqui para ser pública, permitindo download direto pelo navegador via link <a>
router.get('/:id/pdf', async (req: Request, res: Response) => {
  try {
    const rom = await queryOne<any>('SELECT pdf_url, codigo_sequencial FROM romaneios WHERE id = $1', [req.params.id]);
    if (!rom || !rom.pdf_url) return res.status(404).json({ error: 'PDF não encontrado no banco.' });

    const bucket = 'romaneio-portall';
    let objectName = '';
    
    if (rom.pdf_url.includes(bucket)) {
      objectName = rom.pdf_url.split(`${bucket}/`)[1];
    } else {
      const parts = rom.pdf_url.split('/');
      objectName = parts.slice(3).join('/');
    }

    if (!objectName) return res.status(404).json({ error: 'Caminho do objeto inválido.' });
    const { minioClient } = await import('../minioClient.js');

    const presignedUrl = await minioClient.presignedUrl('GET', bucket, objectName, 3600, {
      'response-content-disposition': `attachment; filename="Romaneio_${rom.codigo_sequencial || rom.id}.pdf"`,
      'response-content-type': 'application/pdf'
    });
    
    res.redirect(presignedUrl);
  } catch (e: any) {
    console.error('Error in PDF redirect:', e);
    res.status(500).json({ error: 'Erro ao gerar link de download.' });
  }
});

// ============================================================
// PRIVATE ROUTES - PROTEGIDAS POR AUTH
// ============================================================

router.use(requireAuth);

// Listar romaneios com seus itens
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const romaneios = await query(`
      SELECT r.*, 
        u1.display_name as aprovador_nome,
        u2.display_name as vigilante_nome
      FROM romaneios r
      LEFT JOIN users u1 ON r.aprovador_id = u1.id
      LEFT JOIN users u2 ON r.vigilante_id = u2.id
      ORDER BY r.created_at DESC
    `);

    // Busca os itens para cada romaneio
    for (const r of romaneios) {
      const items = await query('SELECT * FROM romaneio_items WHERE romaneio_id = $1 ORDER BY created_at ASC', [r.id]);
      r.items = items;
    }

    res.json(romaneios);
  } catch (e: any) {
    console.error('Error fetching romaneios:', e);
    res.status(500).json({ error: 'Erro ao buscar romaneios.' });
  }
});

// Aprovar Romaneio (Gestor no Sistema)
router.put('/:id/approve', async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'master' && req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Acesso negado.' });
    return;
  }
  
  try {
    const result = await processApproval(req.params.id, req.user.userId, 'Dashboard Interno');
    res.json({ success: true, ...result });
  } catch (e: any) {
    console.error('Error in system approval:', e);
    res.status(500).json({ error: 'Erro ao aprovar.' });
  }
});

// Rejeitar Romaneio (Gestor)
router.put('/:id/reject', async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'master' && req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Acesso negado.' });
    return;
  }
  
  try {
    await query(
      `UPDATE romaneios 
       SET status = 'rejeitado', aprovador_id = $1, approved_at = NOW() 
       WHERE id = $2`,
      [req.user.userId, req.params.id]
    );
    res.json({ success: true });
  } catch (e: any) {
    console.error('Error rejecting romaneio:', e);
    res.status(500).json({ error: 'Erro ao rejeitar.' });
  }
});

// FUNÇÃO AUXILIAR PARA MOVIMENTAÇÃO NA PORTARIA
async function processPortariaStep(id: string, vigilanteId: string, vigilanteNome?: string, localizacao?: string) {
  const { createHash } = await import('crypto');
  const { generateRomaneioPDF } = await import('../utils/pdf.js');
  const { minioClient, MINIO_PUBLIC_BASE } = await import('../minioClient.js');
  
  const now = new Date();
  const loc = localizacao || 'PORTARIA CTDI';

  // 1. Busca dados do romaneio e do aprovador para compor o PDF final
  const rom = await queryOne<any>(`
    SELECT r.*, u.display_name as aprovador_nome_real 
    FROM romaneios r 
    LEFT JOIN users u ON r.aprovador_id = u.id 
    WHERE r.id = $1
  `, [id]);
  
  if (!rom) throw new Error('Romaneio não encontrado.');

  let newStatus = '';
  let targetTipo = '';
  let updateField = '';

  if (rom.status === 'aprovado') {
    newStatus = 'na_operacao';
    targetTipo = 'entrada';
    updateField = 'entrada_at = NOW()';
  } else if (rom.status === 'na_operacao') {
    newStatus = 'concluido';
    targetTipo = 'saida';
    updateField = 'completed_at = NOW()';
  } else {
    throw new Error('Este romaneio não está em um estado que permita movimentação na portaria.');
  }

  // Determina o nome do vigilante (usa o do banco se for saída e não foi enviado um novo)
  const finalVigilanteNome = vigilanteNome?.trim() || rom.vigilante_nome_registro || 'Vigilante';

  // 2. Gera Hash do Vigilante
  const vigilanteHash = rom.vigilante_signature_hash && !vigilanteNome 
    ? rom.vigilante_signature_hash 
    : createHash('sha256')
        .update(`${finalVigilanteNome}-${now.toISOString()}-${loc}`)
        .digest('hex').slice(0, 16).toUpperCase();

  // 3. Busca itens
  const items = await query('SELECT descricao, quantidade FROM romaneio_items WHERE romaneio_id = $1', [id]);

  // 4. Gera PDF Final com TODAS as assinaturas
  const pdfBuffer = await generateRomaneioPDF({
    id: rom.id,
    solicitante_nome: rom.solicitante_nome,
    empresa: rom.empresa,
    motivo: rom.motivo,
    itens: items as any,
    created_at: rom.created_at,
    localizacao: rom.localizacao,
    signature_hash: rom.signature_hash,
    tipo: targetTipo, // Garantir que seja 'entrada' ou 'saida' explicitamente
    aprovador_nome: rom.aprovador_nome_real,
    approved_at: rom.approved_at,
    aprovador_localizacao: rom.aprovador_localizacao,
    aprovador_signature_hash: rom.aprovador_signature_hash,
    vigilante_nome: finalVigilanteNome,
    vigilante_at: now.toISOString(),
    vigilante_localizacao: loc,
    vigilante_signature_hash: vigilanteHash
  });

  // 5. Upload para MinIO
  const bucket = 'romaneio-portall';
  const fileName = `finalizados/Romaneio_${id}_${newStatus}_${now.getTime()}.pdf`;

  try {
    const exists = await minioClient.bucketExists(bucket).catch(() => false);
    if (!exists) await minioClient.makeBucket(bucket, 'us-east-1');
    await minioClient.putObject(bucket, fileName, pdfBuffer, pdfBuffer.length, { 
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Romaneio_${id}_Final.pdf"`
    });
  } catch (err) {
    console.error(`[ROMANEIO] Erro ao enviar para MinIO (Vigilante):`, err);
  }

  const pdfUrl = `${MINIO_PUBLIC_BASE}/${bucket}/${fileName}`;

  // 6. Atualiza Banco
  await query(`
    UPDATE romaneios 
    SET status = $1, 
        vigilante_id = $2, 
        vigilante_nome_registro = $3, 
        vigilante_signature_hash = $4,
        pdf_url = $5,
        vigilante_localizacao = $6,
        ${updateField}
    WHERE id = $7
  `, [newStatus, vigilanteId, finalVigilanteNome, vigilanteHash, pdfUrl, loc, id]);

  return { status: newStatus, vigilanteNome: finalVigilanteNome };
}

// Confirmar Movimentação na Portaria (Vigilante)
router.put('/:id/complete', async (req: AuthRequest, res: Response) => {
  const { vigilanteNome, localizacao } = req.body;
  
  try {
    const result = await processPortariaStep(req.params.id, req.user?.userId || '', vigilanteNome, localizacao);
    res.json({ success: true, ...result });
  } catch (e: any) {
    console.error('Error completing romaneio:', e);
    res.status(500).json({ error: e.message || 'Erro ao processar movimentação.' });
  }
});

export default router;
