FROM node:22-alpine

WORKDIR /app

# Copia manifests de dependências
COPY package*.json ./

# Instala TODAS as dependências (incluindo devDependencies para o build do Vite)
# NODE_ENV ainda não é production aqui - garante que devDeps sejam instaladas
RUN npm ci

# Copia o restante do código-fonte
COPY . .

# Build do frontend React → dist/
# (usa @tailwindcss/vite e @vitejs/plugin-react que estão em devDependencies)
RUN npm run build

# Remove devDependencies após o build para reduzir tamanho da imagem final
RUN npm prune --production

# Variáveis de ambiente padrão (sobrescrever via CapRover env vars)
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Inicia o servidor Node/Express com suporte a TypeScript via tsx
CMD ["npx", "tsx", "server/index.ts"]
