# Gestão de Terceiros e Visitantes

Sistema web completo de controle de acesso para ambientes industriais e corporativos. Gerencia visitantes e prestadores de serviço com controle de treinamentos, ASO, EPI e status de acesso em tempo real.

## Funcionalidades

- **Multi-empresa** com isolamento total de dados
- **3 níveis de acesso**: Master, Administrador e Visualizador (Portaria)
- **Visitantes**: controle por data de validade
- **Prestadores**: controle de ASO, EPI, treinamentos obrigatórios (NRs) com vencimento automático
- **Status automático**: Liberado 🟢, A Vencer 🟡, Bloqueado 🔴
- **Convite por e-mail** para novos usuários
- **Portaria simplificada** para registro de entrada/saída

## Stack

- **Frontend**: React 19 + Vite + Tailwind CSS v4
- **Backend**: Node.js + Express + TypeScript (TSX)
- **Banco de Dados**: PostgreSQL
- **Auth**: JWT + bcrypt
- **Deploy**: Docker + CapRover

## Configuração

```bash
# 1. Clone o repositório
git clone https://github.com/dtdevs25/terceirosv2.git
cd terceirosv2

# 2. Instale as dependências
npm install

# 3. Configure as variáveis de ambiente
cp .env.example .env
# Edite o .env com suas configurações reais

# 4. Aplique o schema no banco (opcional - o servidor aplica automaticamente no start)
psql $DATABASE_URL -f database/schema.sql

# 5. Inicie em desenvolvimento
npm run dev        # Frontend (porta 5173)
npx tsx server/index.ts  # Backend (porta 3000)
```

## Deploy CapRover

O projeto está configurado com `Dockerfile` e `captain-definition` para deploy automático via CapRover.

Configure as seguintes variáveis de ambiente no painel do CapRover:

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | String de conexão PostgreSQL |
| `DB_SSL` | `true` para conexões SSL |
| `JWT_SECRET` | Segredo JWT (mínimo 64 chars aleatórios) |
| `APP_URL` | URL pública do sistema |
| `SMTP_HOST` | Servidor de e-mail |
| `SMTP_PORT` | Porta SMTP (587 ou 465) |
| `SMTP_USER` | Usuário SMTP |
| `SMTP_PASS` | Senha SMTP |
| `ADMIN_EMAIL` | E-mail do admin inicial |
| `ADMIN_PASSWORD` | Senha do admin inicial |

## Primeiro Acesso

O sistema cria automaticamente um usuário Master no primeiro start. As credenciais são definidas pelas variáveis `ADMIN_EMAIL` e `ADMIN_PASSWORD` no `.env`.

> ⚠️ Altere a senha imediatamente após o primeiro login.
