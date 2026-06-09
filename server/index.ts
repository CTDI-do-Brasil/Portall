import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDB } from './db.js';
import authRoutes from './auth/routes.js';
import companiesRoutes from './routes/companies.js';
import pessoasRoutes from './routes/pessoas.js';
import presencasRoutes from './routes/presencas.js';
import treinamentosRoutes from './routes/treinamentos.js';
import empresasTerceiroRoutes from './routes/empresasTerceiro.js';
import usersRoutes from './routes/users.js';
import uploadRoutes from './routes/upload.js';
import logsRoutes from './routes/logs.js';
import notificationsRoutes from './routes/notifications.js';
import patrimoniosRoutes from './routes/patrimonios.js';
import romaneiosRoutes from './routes/romaneios.js';
import { ensureBucket } from './minioClient.js';
import { initCronJobs } from './cron.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
const PORT = parseInt(process.env.PORT || '3000');
const APP_URL = process.env.APP_URL || 'https://portall.ctdibrasil.com.br';

// ============================================================
// Segurança: Helmet.js (headers HTTP)
// ============================================================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "blob:"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https://storage.googleapis.com"],
      connectSrc: ["'self'"],
      mediaSrc: ["'self'", "blob:"],
      workerSrc: ["'self'", "blob:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // necessário para camera API
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));

// ============================================================
// CORS — restrito ao domínio de produção
// ============================================================
const allowedOrigins = [
  'https://portall.ctdibrasil.com.br',
  'http://portall.ctdibrasil.com.br',
  'https://portall.ehspro.com.br',
  'http://portall.ehspro.com.br',
  'http://localhost:3000',
  'http://localhost:5173',
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origem não permitida pelo CORS: ${origin}`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ============================================================
// Rate Limiting
// ============================================================
// Limite global: 200 requests por 15 minutos por IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em alguns minutos.' },
});

// Limite de autenticação: 10 tentativas por 15 minutos por IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Aguarde 15 minutos.' },
  skipSuccessfulRequests: true,
});

app.use(globalLimiter);

// ============================================================
// Middleware básico
// ============================================================
app.use(compression() as any);
app.use(express.json({ limit: '10mb' })); // 10mb para suportar upload de fotos em base64
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Remove header que revela tecnologia
app.disable('x-powered-by');

// ============================================================
// Rotas da API
// ============================================================
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/companies', companiesRoutes);
app.use('/api/pessoas', pessoasRoutes);
app.use('/api/presencas', presencasRoutes);
app.use('/api/treinamentos', treinamentosRoutes);
app.use('/api/empresas-terceiro', empresasTerceiroRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/patrimonios', patrimoniosRoutes);
app.use('/api/romaneios', romaneiosRoutes);

// ============================================================
// Health check (para CapRover)
// ============================================================
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================
// Serve o frontend React (build estático)
// ============================================================
const distPath = path.join(process.cwd(), 'dist');
app.use(express.static(distPath, {
  maxAge: '1d',
  etag: true,
  lastModified: true,
}));

// SPA fallback — qualquer rota não-API serve o index.html
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'Endpoint não encontrado.' });
  } else {
    res.sendFile(path.join(distPath, 'index.html'));
  }
});

// ============================================================
// Error handler global
// ============================================================
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

// ============================================================
// Inicialização
// ============================================================
async function start() {
  try {
    await initDB();
    initCronJobs();
    try {
      await ensureBucket();
      console.log('✅ MinIO Bucket verificado com sucesso.');
    } catch (err: any) {
      console.warn('⚠️ Falha ao inicializar MinIO (fotos podem não funcionar):', err.message);
    }
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log('');
      console.log('🚀 ================================================');
      console.log(`   Gestão de Terceiros - Server iniciado!`);
      console.log(`   Porta: ${PORT}`);
      console.log(`   Ambiente: ${process.env.NODE_ENV || 'development'}`);
      console.log(`   URL: ${APP_URL}`);
      console.log('🚀 ================================================');
      console.log('');
    });
  } catch (err) {
    console.error('❌ Erro fatal ao iniciar servidor:', err);
    process.exit(1);
  }
}

start();
