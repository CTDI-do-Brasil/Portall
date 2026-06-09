import * as Minio from 'minio';
import dotenv from 'dotenv';
dotenv.config();

let endPoint = process.env.MINIO_ENDPOINT || 'minio.ctdibrasil.com.br';
// Remove protocolo se o usuário tiver colocado por engano
endPoint = endPoint.replace(/^https?:\/\//, '').split('/')[0];

const port = process.env.MINIO_PORT ? parseInt(process.env.MINIO_PORT) : undefined;
const accessKey = process.env.MINIO_ACCESS_KEY || '';
const secretKey = process.env.MINIO_SECRET_KEY || '';
const bucketName = process.env.MINIO_BUCKET || 'fotos-portall';
const useSSL = process.env.MINIO_USE_SSL === 'true' || endPoint === 'minio.ctdibrasil.com.br';
const publicUrl = process.env.MINIO_PUBLIC_URL || (useSSL ? `https://${endPoint}` : `http://${endPoint}`);

export const minioClient = new Minio.Client({
  endPoint,
  port,
  useSSL,
  accessKey,
  secretKey,
});

export const MINIO_BUCKET = bucketName;
const base = publicUrl.replace(/\/$/, '');
// Sanitização extrema: Se o usuário colocou o link do browser/console, nós limpamos
export const MINIO_PUBLIC_BASE = base.replace(/\/browser\/?$/, '').replace(/\/minio\/?$/, '');

export async function ensureBucket(name: string = MINIO_BUCKET) {
  console.log(`🔍 [MINIO] Verificando Bucket: ${name}`);
  const exists = await minioClient.bucketExists(name).catch(() => false);
  if (!exists) {
    await minioClient.makeBucket(name, 'us-east-1');
    console.log(`✅ [MINIO] Bucket ${name} criado.`);
  }

  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { AWS: ["*"] },
        Action: ["s3:GetBucketLocation", "s3:ListBucket"],
        Resource: [`arn:aws:s3:::${name}`],
      },
      {
        Effect: "Allow",
        Principal: { AWS: ["*"] },
        Action: ["s3:GetObject"],
        Resource: [`arn:aws:s3:::${name}/*`],
      },
    ],
  };
  await minioClient.setBucketPolicy(name, JSON.stringify(policy));
  console.log(`✅ [MINIO] Política pública aplicada ao bucket ${name}.`);
}

// Inicializa buckets principais
ensureBucket(MINIO_BUCKET);
ensureBucket('romaneio-portall');
