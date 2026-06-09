import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

async function migrate() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log('✅ Conectado ao banco de dados.');

    console.log('🚀 Iniciando migração para Termo de Segurança...');

    // 1. Adicionar requires_safety_term em companies
    await client.query(`
      ALTER TABLE companies 
      ADD COLUMN IF NOT EXISTS requires_safety_term BOOLEAN DEFAULT FALSE;
    `);
    console.log('--- Coluna requires_safety_term adicionada em companies.');

    // 2. Adicionar campos de assinatura em pessoas
    await client.query(`
      ALTER TABLE pessoas 
      ADD COLUMN IF NOT EXISTS termo_assinado_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS termo_assinatura TEXT;
    `);
    console.log('--- Colunas termo_assinado_at e termo_assinatura adicionadas em pessoas.');

    console.log('✅ Migração concluída com sucesso!');
  } catch (err) {
    console.error('❌ Erro na migração:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
