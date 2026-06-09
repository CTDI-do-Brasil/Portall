import cron from 'node-cron';
import { query } from './db.js';
import { sendMail } from './mailer.js';
import { format, addDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import fs from 'fs';
import path from 'path';

/**
 * Módulo de Tarefas Agendadas (Cron) — PortALL
 * Responsável pelo envio semanal de relatórios de vencimento.
 */

export function initCronJobs() {
  // 1. Relatório Semanal para a Segurança (Mandantes) — Segundas às 08:30
  cron.schedule('30 8 * * 1', async () => {
    console.log('⏰ [CRON] Iniciando varredura semanal de vencimentos (Segurança)...');
    await runExpirationAudit();
  });

  // 2. Relatório Diário Direto para Terceiros (Provedores) — Diariamente às 09:00
  cron.schedule('0 9 * * *', async () => {
    console.log('⏰ [CRON] Iniciando varredura diária de vencimentos para Provedores (15 dias)...');
    await runDirectVendorAudit();
  });

  console.log('✅ [CRON] Agendamento de notificações ativado.');
}

/**
 * Auditoria Diária focada nos provedores (15 dias de antecedência)
 */
export async function runDirectVendorAudit() {
  try {
    // Busca empresas de terceiro que possuem e-mail cadastrado
    const vendors = await query<{ id: string, name: string, email: string }>(
      'SELECT id, name, email FROM empresas_terceiro WHERE email IS NOT NULL AND email != \'\''
    );

    for (const vendor of vendors) {
      const deadline = addDays(new Date(), 15);
      
      // Busca pendências apenas desta empresa
      const asoAlerts = await query<any>(
        `SELECT p.nome_completo, p.documento, p.aso_data_realizacao
         FROM pessoas p
         WHERE p.empresa_origem_id = $1 
           AND p.is_active = TRUE 
           AND p.aso_data_realizacao IS NOT NULL
           AND (p.aso_data_realizacao + interval '1 year' <= $2)`,
        [vendor.id, deadline]
      );

      const trainingAlerts = await query<any>(
        `SELECT p.nome_completo, p.documento, t.nome as treinamento_nome, tp.data_vencimento
         FROM treinamentos_pessoa tp
         JOIN pessoas p ON tp.pessoa_id = p.id
         JOIN tipos_treinamento t ON tp.treinamento_id = t.id
         WHERE p.empresa_origem_id = $1
           AND p.is_active = TRUE
           AND tp.data_vencimento <= $2`,
        [vendor.id, deadline]
      );

      if (asoAlerts.length > 0 || trainingAlerts.length > 0) {
        const reportHtml = generateHtmlReport(vendor.name, asoAlerts, trainingAlerts, true);
        await sendMail({
          to: [vendor.email],
          subject: `🚨 [PortALL] Alerta de Vencimento de Documentos - ${vendor.name}`,
          html: reportHtml
        });
        console.log(`[CRON] E-mail de 15 dias enviado para o provedor: ${vendor.name} (${vendor.email})`);
      }
    }
  } catch (err) {
    console.error('❌ [CRON] Erro na auditoria direta para provedores:', err);
  }
}

/**
 * Executa a auditoria de vencimentos para todas as empresas configuradas.
 * Focado na Segurança/Mandante da Unidade.
 */
export async function runExpirationAudit() {
  try {
    const companies = await query<{ id: string, name: string }>(
      'SELECT DISTINCT c.id, c.name FROM companies c JOIN notification_emails n ON c.id = n.company_id WHERE c.is_active = TRUE'
    );

    for (const company of companies) {
      await processCompanyComplianceReport(company.id, company.name);
    }
  } catch (err) {
    console.error('❌ [CRON] Erro durante auditoria de vencimentos:', err);
  }
}

/**
 * Processa e envia o relatório de conformidade para uma empresa específica.
 * Pode ser chamado via CRON ou manualmente via API.
 */
export async function processCompanyComplianceReport(companyId: string, companyName: string) {
  // 1. Buscar e-mails de destino para esta empresa
  const emailRows = await query<{ email: string }>(
    'SELECT email FROM notification_emails WHERE company_id = $1',
    [companyId]
  );
  const recipients = emailRows.map(r => r.email);
  if (recipients.length === 0) return { success: false, message: 'Nenhum e-mail de notificação configurado.' };

  // 2. Buscar pessoas (prestadores) ativos com documentos vencendo em 45 dias
  const deadline = addDays(new Date(), 45);

  // Busca Pessoas com ASO vencido ou a vencer + Empresa Terceira
  const asoAlerts = await query<any>(
    `SELECT p.nome_completo, p.documento, p.aso_data_realizacao, et.name as empresa_nome
     FROM pessoas p
     LEFT JOIN empresas_terceiro et ON p.empresa_origem_id = et.id
     WHERE p.company_id = $1 
       AND p.is_active = TRUE 
       AND p.tipo_acesso = 'prestador'
       AND p.aso_data_realizacao IS NOT NULL
       AND (p.aso_data_realizacao + interval '1 year' <= $2)`,
    [companyId, deadline]
  );

  // Busca Treinamentos vencidos ou a vencer + Empresa Terceira
  const trainingAlerts = await query<any>(
    `SELECT p.nome_completo, p.documento, t.nome as treinamento_nome, tp.data_vencimento, et.name as empresa_nome
     FROM treinamentos_pessoa tp
     JOIN pessoas p ON tp.pessoa_id = p.id
     JOIN tipos_treinamento t ON tp.treinamento_id = t.id
     LEFT JOIN empresas_terceiro et ON p.empresa_origem_id = et.id
     WHERE p.company_id = $1
       AND p.is_active = TRUE
       AND tp.data_vencimento <= $2`,
    [companyId, deadline]
  );

  if (asoAlerts.length === 0 && trainingAlerts.length === 0) {
    console.log(`[CRON/API] Empresa ${companyName}: Nada a reportar.`);
    return { success: true, message: 'Nada a reportar para esta empresa.', sent: false };
  }

  // 3. Formatar Relatório HTML
  const reportHtml = generateHtmlReport(companyName, asoAlerts, trainingAlerts);

  // 4. Enviar E-mail
  await sendMail({
    to: recipients,
    subject: `🚨 [PortALL] Relatório de Vencimentos - ${companyName}`,
    html: reportHtml
  });

  return { success: true, message: 'Relatório enviado com sucesso.', sent: true };
}

function generateHtmlReport(companyName: string, asoAlerts: any[], trainingAlerts: any[], isDirectToVendor = false) {
  const appUrl = process.env.APP_URL || 'https://portall.ctdibrasil.com.br';
  const today = format(new Date(), "dd 'de' MMMM 'de' yyyy", { locale: ptBR });

  // Embutir Logo em Base64
  let logoBase64 = '';
  try {
    const logoPath = path.join(process.cwd(), 'public', 'LogoCompleto.png');
    if (fs.existsSync(logoPath)) {
      const bitmap = fs.readFileSync(logoPath);
      logoBase64 = `data:image/png;base64,${bitmap.toString('base64')}`;
    }
  } catch (err) {
    console.error('Erro ao ler logo para e-mail:', err);
  }

  // Agrupar pendências por pessoa (usando documento como chave)
  const peopleMap: Record<string, { name: string; empresa: string; docs: { type: string; venc: Date; isVencido: boolean }[] }> = {};

  asoAlerts.forEach(a => {
    const doc = a.documento;
    if (!peopleMap[doc]) peopleMap[doc] = { name: a.nome_completo, empresa: a.empresa_nome || companyName, docs: [] };
    const venc = addDays(new Date(a.aso_data_realizacao), 365);
    peopleMap[doc].docs.push({ type: 'ASO', venc, isVencido: venc < new Date() });
  });

  trainingAlerts.forEach(t => {
    const doc = t.documento;
    if (!peopleMap[doc]) peopleMap[doc] = { name: t.nome_completo, empresa: t.empresa_nome || companyName, docs: [] };
    const venc = new Date(t.data_vencimento);
    peopleMap[doc].docs.push({ type: t.treinamento_nome, venc, isVencido: venc < new Date() });
  });

  const rowsHtml = Object.values(peopleMap).map((p, idx) => {
    const docList = p.docs.map(d => {
      const color = d.isVencido ? '#d91e18' : '#e67e22';
      const statusText = d.isVencido ? 'VENCIDO' : 'A VENCER';
      return `<div style="margin-bottom: 2px;">• <span style="color: ${color}; font-weight: bold;">[${statusText}]</span> ${d.type} (${format(d.venc, 'dd/MM/yyyy')})</div>`;
    }).join('');

    return `
      <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#f9f9f9'};">
        <td style="padding: 12px; border: 1px solid #d1d5db; font-size: 13px; color: #111827; font-weight: 600;">${p.name}</td>
        <td style="padding: 12px; border: 1px solid #d1d5db; font-size: 13px; color: #374151;">${p.empresa}</td>
        <td style="padding: 12px; border: 1px solid #d1d5db; font-size: 12px; color: #4b5563; line-height: 1.4;">
          ${docList}
        </td>
      </tr>
    `;
  }).join('');

  const introText = isDirectToVendor 
    ? `Como parte dos processos de segurança e controle de acessos da <strong>CTDI</strong>, identificamos que alguns colaboradores da sua empresa possuem documentos próximos ao prazo de expiração (janela de 15 dias). 
       A regularização tempestiva é essencial para garantir a continuidade das atividades e evitar bloqueios automáticos no sistema de controle de acesso físico de nossas dependências. Por favor, providencie a atualização dos itens listados abaixo através do portal.`
    : `Prezados, segue a listagem detalhada de colaboradores externos com pendências de documentação identificadas pelo sistema de controle da <strong>CTDI</strong>. Solicitamos a regularização imediata da documentação citada abaixo para assegurar a conformidade operacional e evitar o bloqueio preventivo de acesso à unidade.`;

  return `
    <div style="font-family: Arial, sans-serif; background-color: #f3f4f6; padding: 30px 10px;">
      <div style="max-width: 800px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); overflow: hidden; border: 1px solid #e5e7eb;">
        
        <!-- Header -->
        <div style="background-color: #ffffff; padding: 20px; border-bottom: 3px solid #001A33; text-align: left;">
           ${logoBase64 ? `<img src="${logoBase64}" alt="PortALL" style="height: 50px; margin-bottom: 15px; display: block;" />` : ''}
           <div>
             <h1 style="color: #001A33; margin: 0; font-size: 18px; font-weight: bold;">RELATÓRIO DE CONFORMIDADE DE TERCEIROS</h1>
             <p style="color: #6b7280; margin: 2px 0 0; font-size: 12px;">UNIDADE/PROVEDOR: <strong>${companyName.toUpperCase()}</strong> | DATA: ${today}</p>
           </div>
        </div>

        <div style="padding: 25px;">
          <p style="color: #1f2937; font-size: 14px; line-height: 1.5; margin-bottom: 20px;">
            Prezados,<br><br>
            ${introText}
          </p>

          <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px; border: 1px solid #d1d5db;">
            <thead style="background-color: #f3f4f6;">
              <tr>
                <th style="padding: 12px; text-align: left; font-size: 12px; font-weight: bold; color: #374151; border: 1px solid #d1d5db; text-transform: uppercase;">Colaborador</th>
                <th style="padding: 12px; text-align: left; font-size: 12px; font-weight: bold; color: #374151; border: 1px solid #d1d5db; text-transform: uppercase;">Empresa Terceira</th>
                <th style="padding: 12px; text-align: left; font-size: 12px; font-weight: bold; color: #374151; border: 1px solid #d1d5db; text-transform: uppercase;">Pendências e Vencimentos</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>

          ${!isDirectToVendor ? `
          <div style="text-align: center; margin-bottom: 25px;">
            <a href="${appUrl}/terceiros" style="display: inline-block; background-color: #001A33; color: #ffffff; padding: 12px 25px; border-radius: 4px; text-decoration: none; font-weight: bold; font-size: 14px; text-transform: uppercase;">
              Acessar Portal de Gestão
            </a>
          </div>
          ` : `
          <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; text-align: center; margin-bottom: 25px; border: 1px solid #e2e8f0;">
            <p style="margin: 0; color: #475569; font-size: 14px; line-height: 1.6;">
              <strong>Atenção:</strong> Por favor, encaminhe os comprovantes de atualização (ASO e certificados de treinamento) digitalizados para o time de <strong>Segurança do Trabalho da CTDI</strong> para que possamos processar a atualização em nosso sistema.
            </p>
          </div>
          `}

          <div style="background-color: #fffbeb; border: 1px solid #fde68a; padding: 15px; border-radius: 4px;">
            <p style="margin: 0; font-size: 12px; color: #92400e; font-weight: bold;">
              ⚠️ IMPORTANTE: Documentos vencidos bloqueiam o acesso automaticamente. Por favor, regularize com antecedência.
            </p>
          </div>
        </div>

        <div style="background-color: #f9fafb; padding: 15px; text-align: center; border-top: 1px solid #e5e7eb;">
          <p style="margin: 0; font-size: 11px; color: #9ca3af;">
            PortALL &bull; Sistema de Gestão de Acessos e Conformidade<br>
            Este é um e-mail automático gerado pelo sistema.
          </p>
        </div>
      </div>
    </div>
  `;
}
