import { Router } from 'express';
import multer from 'multer';
import { minioClient, MINIO_BUCKET } from '../minioClient.js';
import { requireAuth } from '../auth/middleware.js';
import path from 'path';
import crypto from 'crypto';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Rota de Upload - Agora retorna apenas o nome do arquivo
router.post('/', requireAuth, upload.single('foto'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }

    const file = req.file;
    const ext = path.extname(file.originalname) || '.jpg';
    const filename = `${crypto.randomUUID()}${ext}`;

    await minioClient.putObject(
      MINIO_BUCKET,
      filename,
      file.buffer,
      file.size,
      { 'Content-Type': file.mimetype }
    );

    console.log(`📸 [UPLOAD] Foto salva no MinIO: ${filename}`);

    // Importante: Retornamos apenas o filename. 
    // O backend transformará isso na URL do proxy ao listar pessoas.
    res.json({ url: filename, filename: filename });
  } catch (err: any) {
    console.error('Erro no upload para MinIO:', err);
    res.status(500).json({ error: `Erro no upload: ${err.message}` });
  }
});

// Proxy para visualizar fotos - Resolve problemas de CORS, domínios e portas
// Acessível via /api/upload/foto/:filename
router.get('/foto/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    
    // Busca o stream diretamente do MinIO
    const stream = await minioClient.getObject(MINIO_BUCKET, filename);
    
    // Define o Content-Type baseado na extensão
    const ext = path.extname(filename).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };
    
    res.setHeader('Content-Type', mimeMap[ext] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache de 24h para performance
    
    stream.pipe(res);
  } catch (err: any) {
    console.error(`[PROXY] Erro ao buscar foto ${req.params.filename}:`, err.message);
    res.status(404).send('Foto não encontrada.');
  }
});

export default router;
