import sys
import os
import time
import json
import socket
import select
import hashlib
import base64
import struct
import threading
import ctypes
from ctypes import byref, c_ulong, create_string_buffer, Structure, c_char_p, c_byte, c_void_p

PORT = 9191

# ============================================================
# PC/SC WinSCard Native Definitions
# ============================================================
winscard = ctypes.windll.winscard

SCARD_SCOPE_USER = 0
SCARD_SHARE_SHARED = 2
SCARD_PROTOCOL_T0 = 1
SCARD_PROTOCOL_T1 = 2
SCARD_LEAVE_CARD = 0
SCARD_STATE_UNAWARE = 0x0000
SCARD_STATE_CHANGED = 0x0002
SCARD_STATE_PRESENT = 0x0020
SCARD_STATE_EMPTY   = 0x0010

class SCARD_READERSTATEA(Structure):
    _fields_ = [
        ("szReader", c_char_p),
        ("pvUserData", c_void_p),
        ("dwCurrentState", c_ulong),
        ("dwEventState", c_ulong),
        ("cbAtr", c_ulong),
        ("rgbAtr", c_byte * 36),
    ]

class SCARD_IO_REQUEST(Structure):
    _fields_ = [
        ("dwProtocol", c_ulong),
        ("cbPciLength", c_ulong),
    ]

try:
    g_rgSCardT0Pci = SCARD_IO_REQUEST.in_dll(winscard, "g_rgSCardT0Pci")
    g_rgSCardT1Pci = SCARD_IO_REQUEST.in_dll(winscard, "g_rgSCardT1Pci")
except:
    g_rgSCardT0Pci = SCARD_IO_REQUEST(1, 8)
    g_rgSCardT1Pci = SCARD_IO_REQUEST(2, 8)

# ============================================================
# WebSocket Server (Pure Python RFC 6455)
# ============================================================
clients = set()
clients_lock = threading.Lock()
current_reader_name = None
last_read_tag = None

def broadcast(data):
    msg = json.dumps(data)
    payload = msg.encode('utf-8')
    length = len(payload)
    
    if length <= 125:
        header = bytes([0x81, length])
    elif length <= 65535:
        header = struct.pack("!BBH", 0x81, 126, length)
    else:
        header = struct.pack("!BBQ", 0x81, 127, length)
    
    frame = header + payload
    
    with clients_lock:
        to_remove = []
        for client in list(clients):
            try:
                client.sendall(frame)
            except Exception:
                to_remove.append(client)
        for client in to_remove:
            if client in clients:
                clients.remove(client)

def broadcast_tag(uid, standard="ISO 14443-3A", atr=""):
    global last_read_tag
    clean_uid = "".join(c for c in str(uid) if c.isalnum()).upper()
    if not clean_uid:
        return
    
    last_read_tag = {
        "uid": clean_uid,
        "standard": standard,
        "atr": atr,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }
    
    print("\n" + "="*45)
    print(f" [NFC] 🏷️  TAG DETECTADA!")
    print(f" [NFC] UID: {clean_uid}")
    print(f" [NFC] Padrão: {standard}")
    print("="*45 + "\n")
    
    broadcast({
        "type": "NFC_TAG_DETECTED",
        "uid": clean_uid,
        "standard": standard,
        "atr": atr,
        "timestamp": last_read_tag["timestamp"]
    })

def handle_client(sock, addr):
    global current_reader_name, last_read_tag
    try:
        req = sock.recv(4096).decode('latin-1', errors='ignore')
        if not req:
            sock.close()
            return
        
        # Check HTTP vs WebSocket
        if "Upgrade: websocket" in req or "Upgrade: WebSocket" in req:
            # WebSocket Handshake
            key = None
            for line in req.split("\r\n"):
                if line.lower().startswith("sec-websocket-key:"):
                    key = line.split(":", 1)[1].strip()
                    break
            
            if not key:
                sock.close()
                return
            
            magic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
            accept_key = base64.b64encode(hashlib.sha1((key + magic).encode('utf-8')).digest()).decode('ascii')
            
            response = (
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept_key}\r\n\r\n"
            )
            sock.sendall(response.encode('ascii'))
            
            with clients_lock:
                clients.add(sock)
            
            # Send initial status
            init_msg = json.dumps({
                "type": "BRIDGE_STATUS",
                "status": "online",
                "reader": current_reader_name,
                "lastTag": last_read_tag
            })
            sock.sendall(bytes([0x81, len(init_msg)]) + init_msg.encode('utf-8'))
            
            # Listen loop
            while True:
                head = sock.recv(2)
                if not head or len(head) < 2:
                    break
                b1, b2 = head[0], head[1]
                opcode = b1 & 0x0F
                if opcode == 0x08:  # Close
                    break
                
                is_masked = bool(b2 & 0x80)
                length = b2 & 0x7F
                if length == 126:
                    length = struct.unpack("!H", sock.recv(2))[0]
                elif length == 127:
                    length = struct.unpack("!Q", sock.recv(8))[0]
                
                mask = sock.recv(4) if is_masked else b""
                data = sock.recv(length) if length > 0 else b""
                
                if is_masked and mask:
                    data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
                
                # Handle client ping
                if opcode == 0x09:  # Ping
                    pong = bytes([0x8A, len(data)]) + data
                    sock.sendall(pong)
                    
        else:
            # Simple HTTP Response (Health check)
            body = json.dumps({
                "service": "PortALL NFC Bridge (Native Windows PC/SC)",
                "status": "online",
                "activeReader": current_reader_name,
                "clientsConnected": len(clients),
                "lastTag": last_read_tag
            }, indent=2)
            
            http_resp = (
                "HTTP/1.1 200 OK\r\n"
                "Content-Type: application/json; charset=utf-8\r\n"
                "Access-Control-Allow-Origin: *\r\n"
                f"Content-Length: {len(body.encode('utf-8'))}\r\n"
                "Connection: close\r\n\r\n" + body
            )
            sock.sendall(http_resp.encode('utf-8'))
            sock.close()
            
    except Exception as e:
        pass
    finally:
        with clients_lock:
            if sock in clients:
                clients.remove(sock)
        try:
            sock.close()
        except:
            pass

def run_ws_server():
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        server.bind(('0.0.0.0', PORT))
        server.listen(10)
        print(f"📡 Servidor WebSocket ativo em: ws://localhost:{PORT}")
        while True:
            client_sock, addr = server.accept()
            t = threading.Thread(target=handle_client, args=(client_sock, addr), daemon=True)
            t.start()
    except Exception as e:
        print(f"⚠️ Erro no servidor WebSocket: {e}")

# ============================================================
# PC/SC Background Reader Thread
# ============================================================
def run_pcsc_monitor():
    global current_reader_name
    hContext = c_ulong()
    res = winscard.SCardEstablishContext(SCARD_SCOPE_USER, 0, 0, byref(hContext))
    if res != 0:
        print(f"[NFC] ⚠️ Falha ao inicializar contexto PC/SC: {hex(res)}")
        return

    print("[NFC] 🔄 Monitor de leitor Smart Card / NFC iniciado.")
    
    last_card_present = False
    active_reader_name = None
    
    while True:
        try:
            readers_len = c_ulong(0)
            winscard.SCardListReadersA(hContext, None, None, byref(readers_len))
            
            if readers_len.value <= 1:
                if active_reader_name is not None:
                    print(f"[NFC] 🔴 Leitor desconectado: {active_reader_name}")
                    broadcast({"type": "READER_DISCONNECTED", "reader": active_reader_name})
                    active_reader_name = None
                    current_reader_name = None
                time.sleep(1)
                continue
            
            buf = create_string_buffer(readers_len.value)
            winscard.SCardListReadersA(hContext, None, buf, byref(readers_len))
            readers = [r.strip() for r in buf.raw.decode('latin-1').split('\x00') if r.strip()]
            
            if not readers:
                time.sleep(1)
                continue
            
            reader_str = readers[0]
            if active_reader_name != reader_str:
                active_reader_name = reader_str
                current_reader_name = reader_str
                print(f"[NFC] 🟢 Leitor conectado: {reader_str}")
                broadcast({"type": "READER_CONNECTED", "reader": reader_str})
            
            # Check Card State
            rs = SCARD_READERSTATEA()
            rs.szReader = reader_str.encode('latin-1')
            rs.dwCurrentState = SCARD_STATE_UNAWARE
            
            res = winscard.SCardGetStatusChangeA(hContext, 400, byref(rs), 1)
            
            is_present = bool(rs.dwEventState & SCARD_STATE_PRESENT)
            
            if is_present and not last_card_present:
                last_card_present = True
                # Card tapped! Connect and read UID
                hCard = c_ulong()
                active_proto = c_ulong()
                res = winscard.SCardConnectA(
                    hContext, 
                    rs.szReader, 
                    SCARD_SHARE_SHARED, 
                    SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1, 
                    byref(hCard), 
                    byref(active_proto)
                )
                
                if res == 0:
                    # Send APDU FF CA 00 00 00 (Get UID)
                    apdu = bytes([0xFF, 0xCA, 0x00, 0x00, 0x00])
                    recv_buf = create_string_buffer(258)
                    recv_len = c_ulong(258)
                    pci = byref(g_rgSCardT1Pci) if active_proto.value == 2 else byref(g_rgSCardT0Pci)
                    
                    res_tx = winscard.SCardTransmit(hCard, pci, apdu, len(apdu), None, recv_buf, byref(recv_len))
                    
                    if res_tx == 0 and recv_len.value >= 2:
                        resp = bytes(recv_buf.raw[:recv_len.value])
                        sw1, sw2 = resp[-2], resp[-1]
                        uid_bytes = resp[:-2]
                        if sw1 == 0x90 and sw2 == 0x00 and len(uid_bytes) > 0:
                            uid_hex = uid_bytes.hex().upper()
                            broadcast_tag(uid_hex, "Mifare / ISO 14443-3A")
                        else:
                            # Fallback to ATR
                            atr_hex = bytes(rs.rgbAtr[:rs.cbAtr]).hex().upper() if rs.cbAtr > 0 else "UNKNOWN"
                            broadcast_tag(atr_hex, "PICC Tag (ATR)", atr=atr_hex)
                    winscard.SCardDisconnect(hCard, SCARD_LEAVE_CARD)
                    
            elif not is_present and last_card_present:
                last_card_present = False
                print("[NFC] ⚪ Cartão removido do leitor")
                broadcast({"type": "NFC_TAG_REMOVED"})
                
            time.sleep(0.1)
            
        except Exception as e:
            time.sleep(1)

if __name__ == "__main__":
    print("""
=====================================================
🚀  PortALL - Bridge Local NFC ACR122U (Python PC/SC)
=====================================================
📡 Porta WebSocket: ws://localhost:9191
📌 Leitor suportado: ACS ACR122U / CCID PC/SC
⚡ Dependências:    100% Nativo Windows (winscard.dll)
=====================================================
""")
    
    t_pcsc = threading.Thread(target=run_pcsc_monitor, daemon=True)
    t_pcsc.start()
    
    run_ws_server()
