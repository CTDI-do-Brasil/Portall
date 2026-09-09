# PortALL - NFC Bridge ACR122U (Segundo Plano)

Serviço local em segundo plano para capturar leituras do leitor **ACR122U (PC/SC)** e repassar instantaneamente via **WebSocket** e **Digitação Automática (Keyboard Wedge)** para o PortALL.

---

## 🚀 Arquivos de Execução

### 1. Iniciar em Segundo Plano (Sem tela de terminal)
👉 Dê um duplo clique em: **`iniciar-leitor.bat`**
* O serviço sobe em segundo plano e a janela fecha automaticamente em 3 segundos.
* Pode fechar qualquer CMD que ele continuará rodando.

### 2. Iniciar Automaticamente com o Windows
👉 Dê um duplo clique em: **`instalar-inicializacao-automatica.bat`**
* O serviço iniciará silenciosamente toda vez que o Windows for ligado.

### 3. Verificar se o Leitor está Rodando
👉 Dê um duplo clique em: **`verificar-status.bat`**
* Mostra se o processo está ativo, qual antena está conectada e o último cartão lido.

### 4. Parar o Serviço
👉 Dê um duplo clique em: **`parar-leitor.bat`**
* Encerra o serviço em segundo plano.

---

## 📡 Portas e Endpoints
* **WebSocket:** `ws://localhost:9191`
* **Status HTTP:** `http://localhost:9191/status`
