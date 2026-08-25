# PortALL - NFC Bridge ACR122U

Este módulo é um serviço local em segundo plano para capturar leituras do **ACR122U (PC/SC)** e repassar instantaneamente via **WebSocket** para o frontend Web do PortALL.

---

## 🔌 Requisitos
1. **Leitor Conectado:** ACS ACR122U USB plugado no computador da portaria.
2. **Driver do Windows:** Driver oficial da ACS instalado (no Gerenciador de Dispositivos deve aparecer em *Leitores de Cartão Inteligente* -> *ACS ACR122U PICC Interface*).
3. **Node.js:** Versão 18 ou superior instalada na máquina.

---

## 🚀 Como Executar

Basta dar um duplo clique no arquivo:
👉 **`iniciar-leitor.bat`**

Ou via terminal dentro da pasta `nfc-bridge`:
```bash
npm install
node server.js
```

---

## 📡 Comunicação
* **Porta WebSocket:** `ws://localhost:9191`
* **Status HTTP:** `http://localhost:9191/status`

### Eventos transmitidos para a aplicação web:
* `READER_CONNECTED`: Disparado quando o leitor ACR122U é plugado.
* `READER_DISCONNECTED`: Disparado quando o leitor é removido.
* `NFC_TAG_DETECTED`: `{ type: "NFC_TAG_DETECTED", uid: "04A1B2C3D4E5F6", standard: "ISO 14443-3A" }`
* `NFC_TAG_REMOVED`: Disparado ao retirar a tag de cima do leitor.
