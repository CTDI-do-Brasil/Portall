import PDFDocument from 'pdfkit';
import path from 'path';

interface RomaneioData {
  id: string;
  solicitante_nome: string;
  empresa: string;
  motivo: string;
  itens: Array<{ descricao: string; quantidade: string | number }>;
  created_at: string;
  localizacao?: string;
  signature_hash?: string;
  tipo: string;
  // Dados do Aprovador
  aprovador_nome?: string;
  approved_at?: string;
  aprovador_localizacao?: string;
  aprovador_signature_hash?: string;
  // Dados do Vigilante
  vigilante_nome?: string;
  vigilante_at?: string;
  vigilante_localizacao?: string;
  vigilante_signature_hash?: string;
}

export async function generateRomaneioPDF(data: RomaneioData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Orientação Paisagem (Landscape) - Réplica do Modelo Qualidade
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));

    const pageWidth = 841.89 - 60; 

    // --- CABEÇALHO ---
    // Inserção do Logo Oficial CTDI (Tamanho reduzido para não sobrepor)
    try {
      const logoPath = path.join(process.cwd(), 'logoctdi.jpg');
      doc.image(logoPath, 40, 30, { width: 120 });
    } catch (e) {
      doc.fontSize(10).font('Helvetica-Bold').text('CTDI', 40, 40);
      doc.fontSize(7).font('Helvetica').text('Communications Test Design, Inc.', 40, 52);
    }

    doc.fontSize(18).font('Helvetica-Bold').text('ROMANEIO DE ENTRADA E SAÍDA DE MATERIAIS', 220, 40, { align: 'left', width: pageWidth - 220 });
    
    // --- DADOS DE IDENTIFICAÇÃO ---
    const infoY = 90; // Leve ajuste para garantir página única
    doc.fontSize(10).font('Helvetica-Bold');
    
    // Responsável
    doc.text('Responsável:', 40, infoY);
    doc.font('Helvetica').text(data.solicitante_nome, 120, infoY);
    doc.moveTo(120, infoY + 12).lineTo(300, infoY + 12).stroke();

    // Empresa
    doc.font('Helvetica-Bold').text('Empresa:', 450, infoY);
    doc.font('Helvetica').text('CTDI ( X )      Outros (   ): ________________', 520, infoY);

    // Data
    doc.font('Helvetica-Bold').text('Data:', 40, infoY + 30);
    const dateStr = new Date(data.created_at).toLocaleDateString('pt-BR');
    doc.font('Helvetica').text(dateStr, 120, infoY + 30);
    doc.moveTo(120, infoY + 42).lineTo(250, infoY + 42).stroke();

    // Motivo (Dinamismo com base no tipo)
    doc.font('Helvetica-Bold').text('Motivo:', 450, infoY + 30);
    const tipo = (data.tipo || '').toLowerCase();
    const entradaX = tipo === 'entrada' ? 'X' : ' ';
    const saidaX = tipo === 'saida' ? 'X' : ' ';
    doc.font('Helvetica').text(`Entrada (${entradaX})    Saída (${saidaX})`, 520, infoY + 30);

    // --- TABELA DE ITENS ---
    const tableTop = 160; 
    const colWidths = { id: 30, desc: pageWidth - 100, qtd: 70 };
    
    // Header Amarelo com Grade
    doc.rect(40, tableTop, pageWidth, 20).fill('#FFFF00').stroke('#000');
    doc.rect(40, tableTop, colWidths.id, 20).stroke();
    doc.rect(40 + colWidths.id, tableTop, colWidths.desc, 20).stroke();
    doc.rect(40 + colWidths.id + colWidths.desc, tableTop, colWidths.qtd, 20).stroke();

    doc.fillColor('#000').font('Helvetica-Bold').fontSize(9);
    doc.text('#', 40, tableTop + 6, { width: colWidths.id, align: 'center' });
    doc.text('DESCRIÇÃO DO ITEM', 40 + colWidths.id, tableTop + 6, { width: colWidths.desc, align: 'center' });
    doc.text('QTD', 40 + colWidths.id + colWidths.desc, tableTop + 6, { width: colWidths.qtd, align: 'center' });
    
    // Linhas da Tabela (Apenas itens preenchidos)
    let currentY = tableTop + 20;
    doc.font('Helvetica').fontSize(9);
    
    data.itens.forEach((item, i) => {
      if (currentY > 430) {
        doc.addPage({ layout: 'landscape' });
        currentY = 40;
      }
      
      doc.rect(40, currentY, colWidths.id, 20).stroke();
      doc.rect(40 + colWidths.id, currentY, colWidths.desc, 20).stroke();
      doc.rect(40 + colWidths.id + colWidths.desc, currentY, colWidths.qtd, 20).stroke();
      
      doc.text((i + 1).toString(), 40, currentY + 6, { width: colWidths.id, align: 'center' });
      doc.text(item.descricao, 40 + colWidths.id + 10, currentY + 6, { width: colWidths.desc - 20 });
      doc.text(item.quantidade.toString(), 40 + colWidths.id + colWidths.desc, currentY + 6, { width: colWidths.qtd, align: 'center' });
      
      currentY += 20;
    });

    // --- RODAPÉ DE ASSINATURAS (FIXO NO FINAL DA PÁGINA 1) ---
    const footerY = 465; 
    const boxWidth = pageWidth / 3;
    
    // Três Caixas Grandes (Altura fixa 80)
    doc.rect(40, footerY, boxWidth, 80).stroke();
    doc.rect(40 + boxWidth, footerY, boxWidth, 80).stroke();
    doc.rect(40 + 2 * boxWidth, footerY, boxWidth, 80).stroke();
    
    // 1. Assinatura Digital do Responsável (Solicitante)
    const sigDate = new Date(data.created_at).toLocaleString('pt-BR');
    doc.fontSize(6).fillColor('#1E40AF');
    const digitalSig = `ASSINATURA DIGITAL:\n${data.solicitante_nome}\nDATA/HORA: ${sigDate}\nLOC: ${data.localizacao || 'N/A'}\nHASH: ${data.signature_hash || 'N/A'}`;
    doc.text(digitalSig, 45, footerY + 15, { width: boxWidth - 10, align: 'center' });
    
    doc.fillColor('#000').fontSize(8);
    doc.moveTo(60, footerY + 60).lineTo(40 + boxWidth - 20, footerY + 60).stroke();
    doc.text('Assinatura do Responsável', 40, footerY + 65, { width: boxWidth, align: 'center' });

    // 2. Assinatura Digital do Aprovador (Se houver)
    if (data.aprovador_nome && data.aprovador_signature_hash) {
      const appDate = new Date(data.approved_at || '').toLocaleString('pt-BR');
      doc.fontSize(6).fillColor('#1E40AF');
      const approverSig = `APROVADO DIGITALMENTE POR:\n${data.aprovador_nome}\nDATA/HORA: ${appDate}\nLOC: ${data.aprovador_localizacao || 'N/A'}\nHASH: ${data.aprovador_signature_hash}`;
      doc.text(approverSig, 40 + boxWidth + 5, footerY + 15, { width: boxWidth - 10, align: 'center' });
    }

    doc.fillColor('#000').fontSize(8);
    doc.moveTo(40 + boxWidth + 20, footerY + 60).lineTo(40 + 2 * boxWidth - 20, footerY + 60).stroke();
    doc.text('Aprovado Por:', 40 + boxWidth, footerY + 65, { width: boxWidth, align: 'center' });

    // 3. Assinatura Digital do Vigilante (Se houver)
    if (data.vigilante_nome && data.vigilante_signature_hash) {
      const vigDate = new Date(data.vigilante_at || '').toLocaleString('pt-BR');
      doc.fontSize(6).fillColor('#1E40AF');
      const vigilanteSig = `COLETADO DIGITALMENTE POR:\n${data.vigilante_nome}\nDATA/HORA: ${vigDate}\nLOC: ${data.vigilante_localizacao || 'N/A'}\nHASH: ${data.vigilante_signature_hash}`;
      doc.text(vigilanteSig, 40 + 2 * boxWidth + 5, footerY + 15, { width: boxWidth - 10, align: 'center' });
    }

    doc.fillColor('#000').fontSize(8);
    doc.moveTo(40 + 2 * boxWidth + 20, footerY + 60).lineTo(40 + 3 * boxWidth - 20, footerY + 60).stroke();
    doc.text('Assinatura do Vigilante', 40 + 2 * boxWidth, footerY + 65, { width: boxWidth, align: 'center' });

    doc.fontSize(8).text('F-5000341 / 1', 40, 555, { align: 'right', width: pageWidth });

    doc.end();
  });
}

export async function generateTermoPDF(data: {
  id: string;
  pessoaNome: string;
  documento: string;
  company_name: string;
  assinadoEm: string;
  assinaturaBase64: string;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));

    const pageWidth = 595.28 - 80;

    // --- CABEÇALHO ---
    const logoColumnWidth = 140;
    const titleColumnWidth = pageWidth - logoColumnWidth;

    // Coluna 1: Logo (Centralizado na coluna da esquerda)
    try {
      const logoPath = path.join(process.cwd(), 'logoctdi.jpg');
      // Reposiciona o logo para não grudar no topo e centralizar na largura da coluna
      doc.image(logoPath, 40 + (logoColumnWidth - 110) / 2, 45, { width: 110 });
    } catch (e) {
      doc.fontSize(14).font('Helvetica-Bold').text('CTDI', 40, 60, { width: logoColumnWidth, align: 'center' });
    }

    // Coluna 2: Título (Centralizado na coluna da direita)
    doc.fontSize(16).font('Helvetica-Bold').text('TERMO DE COMPROMISSO E SEGURANÇA', 40 + logoColumnWidth, 55, { 
      align: 'center', 
      width: titleColumnWidth 
    });
    doc.fontSize(8).font('Helvetica').text(`Documento gerado digitalmente em ${new Date(data.assinadoEm).toLocaleString('pt-BR')}`, 40 + logoColumnWidth, 80, { 
      align: 'center', 
      width: titleColumnWidth 
    });

    doc.moveTo(40, 110).lineTo(40 + pageWidth, 110).stroke();

    // --- CONTEÚDO ---
    doc.x = 40; // Garante que o texto volte para a margem esquerda total
    doc.y = 150; // Espaçamento após o cabeçalho
    doc.fontSize(12).font('Helvetica').text('Eu, ', { continued: true });
    doc.font('Helvetica-Bold').text(data.pessoaNome, { continued: true });
    doc.font('Helvetica').text(', portador do documento ', { continued: true });
    doc.font('Helvetica-Bold').text(data.documento, { continued: true });
    doc.font('Helvetica').text(', declaro para os devidos fins que:', { continued: false });

    doc.moveDown(2);
    const bulletPoints = [
      `Fui devidamente informado sobre as regras de segurança vigentes nesta unidade.`,
      `Comprometo-me a cumprir todas as normas de segurança do trabalho e diretrizes da ${data.company_name}.`,
      `Estou ciente da obrigatoriedade do uso de todos os EPIs (Equipamentos de Proteção Individual) necessários para a minha atividade conforme orientações recebidas.`,
      `Portarei os EPIs do início ao fim da execução das atividades, respeitando a sinalização e zonas de risco.`
    ];

    bulletPoints.forEach(point => {
      doc.font('Helvetica').text(`• ${point}`, { indent: 20 });
      doc.moveDown(0.8);
    });

    doc.moveDown(2);
    doc.font('Helvetica-Bold').fillColor('#dc2626').text('⚠️ O não cumprimento de qualquer norma de segurança poderá resultar na suspensão imediata do acesso e das atividades.', { align: 'center', width: pageWidth });
    doc.fillColor('#000');

    // --- ASSINATURA ---
    const footerY = 550;
    doc.moveTo(150, footerY + 80).lineTo(450, footerY + 80).stroke();
    
    // Inserir a imagem da assinatura
    try {
      if (data.assinaturaBase64) {
        // Remover o prefixo data:image/png;base64,
        const base64Data = data.assinaturaBase64.replace(/^data:image\/\w+;base64,/, "");
        const signatureBuffer = Buffer.from(base64Data, 'base64');
        doc.image(signatureBuffer, 200, footerY, { width: 200, height: 80 });
      }
    } catch (e) {
      console.error('Erro ao inserir assinatura no PDF:', e);
    }

    doc.fontSize(10).font('Helvetica-Bold').text(data.pessoaNome, 40, footerY + 85, { align: 'center' });
    doc.fontSize(8).font('Helvetica').text(`Assinado Digitalmente em ${new Date(data.assinadoEm).toLocaleString('pt-BR')}`, 40, footerY + 98, { align: 'center' });
    doc.fontSize(7).text(`ID: ${data.id}`, 40, footerY + 110, { align: 'center', color: '#94a3b8' });

    doc.end();
  });
}
