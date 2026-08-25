import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';

const WS_PORT = process.env.PORT || 9191;

// Criando servidor HTTP para health-check e WebSocket
const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/status' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      service: 'Portall NFC Bridge',
      status: 'online',
      connectedClients: wss.clients.size,
      activeReader: currentReaderName || null,
      lastTag: lastReadTag || null,
      timestamp: new Date().toISOString()
    }, null, 2));
    return;
  }

  // Endpoint para testes manuais/simulação via HTTP POST
  if (req.url === '/simulate' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const simulatedUid = parsed.uid || 'SIM-' + Math.random().toString(16).substring(2, 10).toUpperCase();
        broadcastTag(simulatedUid, 'Mifare Classic (Simulado)', 'SIMULATED');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, uid: simulatedUid }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'JSON inválido' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

let currentReaderName = null;
let lastReadTag = null;

function broadcast(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function broadcastTag(uid, standard, atr) {
  const cleanUid = String(uid).replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  lastReadTag = {
    uid: cleanUid,
    standard: standard || 'ISO 14443-3A',
    atr: atr || '',
    timestamp: new Date().toISOString()
  };

  console.log(`\n========================================`);
  console.log(`[NFC] 🏷️  TAG DETECTADA!`);
  console.log(`[NFC] UID: ${cleanUid}`);
  if (standard) console.log(`[NFC] Padrão: ${standard}`);
  console.log(`[NFC] Notificando ${wss.clients.size} cliente(s) conectado(s)...`);
  console.log(`========================================\n`);

  broadcast({
    type: 'NFC_TAG_DETECTED',
    uid: cleanUid,
    standard: standard || 'ISO 14443-3A',
    atr: atr || '',
    timestamp: lastReadTag.timestamp
  });
}

wss.on('connection', (ws, req) => {
  console.log(`[WebSocket] Cliente conectado (${req.socket.remoteAddress}). Total: ${wss.clients.size}`);
  
  // Envia status inicial para o cliente que acabou de conectar
  ws.send(JSON.stringify({
    type: 'BRIDGE_STATUS',
    status: 'online',
    reader: currentReaderName,
    lastTag: lastReadTag
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG', timestamp: new Date().toISOString() }));
      } else if (data.type === 'SIMULATE_SCAN') {
        const uid = data.uid || 'SIM-' + Date.now().toString(16).toUpperCase();
        broadcastTag(uid, 'Simulador Frontend', '');
      }
    } catch (e) {
      // Ignora mensagens com formato inválido
    }
  });

  ws.on('close', () => {
    console.log(`[WebSocket] Cliente desconectado. Restantes: ${wss.clients.size}`);
  });
});

// Inicialização do leitor PC/SC
async function initNFC() {
  try {
    const { NFC } = await import('nfc-pcsc');
    const nfc = new NFC();

    nfc.on('reader', reader => {
      currentReaderName = reader.reader.name;
      console.log(`\n[NFC] 🟢 Leitor conectado: ${currentReaderName}`);
      
      broadcast({
        type: 'READER_CONNECTED',
        reader: currentReaderName
      });

      // Trata detecção de cartão
      reader.on('card', card => {
        const rawUid = card.uid || (card.atr ? card.atr.toString('hex') : '');
        broadcastTag(rawUid, card.standard, card.atr ? card.atr.toString('hex').toUpperCase() : '');
      });

      reader.on('card.off', card => {
        console.log(`[NFC] ⚪ Cartão removido do leitor`);
        broadcast({ type: 'NFC_TAG_REMOVED' });
      });

      reader.on('error', err => {
        console.error(`[NFC] ⚠️ Erro no leitor ${reader.reader.name}:`, err.message || err);
      });

      reader.on('end', () => {
        console.log(`[NFC] 🔴 Leitor desconectado: ${reader.reader.name}`);
        if (currentReaderName === reader.reader.name) {
          currentReaderName = null;
        }
        broadcast({
          type: 'READER_DISCONNECTED',
          reader: reader.reader.name
        });
      });
    });

    nfc.on('error', err => {
      console.error(`[NFC] ⚠️ Erro no subsistema PC/SC (WinSCard):`, err.message || err);
      console.log(`[NFC] Verifique se o serviço 'Smart Card' do Windows está em execução.`);
    });

  } catch (err) {
    console.warn(`\n[NFC] ⚠️ Não foi possível carregar a biblioteca nativa nfc-pcsc: ${err.message}`);
    console.log(`[NFC] Modo de simulação e WebSocket permanecem ativos na porta ${WS_PORT}.`);
    console.log(`[NFC] Para habilitar leitura física ACR122U, instale as dependências com: npm install na pasta nfc-bridge\n`);
  }
}

server.listen(WS_PORT, () => {
  console.log(`
=====================================================
🚀  PortALL - Bridge Local NFC ACR122U Iniciado!
=====================================================
📡 Servidor WebSocket: ws://localhost:${WS_PORT}
🌐 Status HTTP:        http://localhost:${WS_PORT}/status
📌 Leitor suportado:   ACS ACR122U / CCID PC/SC
=====================================================
Aguardando conexões do Portall Web e leitura de cartões...
`);
  initNFC();
});
