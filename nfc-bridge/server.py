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
from ctypes import byref, c_size_t, create_string_buffer, Structure, c_char_p, c_byte, c_void_p, c_ulong, POINTER, c_long

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

PORT = 9191

winscard = ctypes.windll.winscard
user32 = ctypes.windll.user32

SCARDCONTEXT = c_size_t
SCARDHANDLE = c_size_t
DWORD = c_ulong
LONG = c_long

SCARD_SCOPE_USER = 0
SCARD_SHARE_SHARED = 2
SCARD_PROTOCOL_T0 = 1
SCARD_PROTOCOL_T1 = 2
SCARD_LEAVE_CARD = 0
SCARD_STATE_UNAWARE = 0x0000
SCARD_STATE_PRESENT = 0x0020
SCARD_STATE_EMPTY   = 0x0010

class SCARD_READERSTATEA(Structure):
    _fields_ = [
        ("szReader", c_char_p),
        ("pvUserData", c_void_p),
        ("dwCurrentState", DWORD),
        ("dwEventState", DWORD),
        ("cbAtr", DWORD),
        ("rgbAtr", c_byte * 36),
    ]

class SCARD_IO_REQUEST(Structure):
    _fields_ = [
        ("dwProtocol", DWORD),
        ("cbPciLength", DWORD),
    ]

g_rgSCardT0Pci = SCARD_IO_REQUEST(1, 8)
g_rgSCardT1Pci = SCARD_IO_REQUEST(2, 8)

winscard.SCardEstablishContext.argtypes = [DWORD, c_void_p, c_void_p, POINTER(SCARDCONTEXT)]
winscard.SCardEstablishContext.restype = LONG
winscard.SCardListReadersA.argtypes = [SCARDCONTEXT, c_char_p, c_char_p, POINTER(DWORD)]
winscard.SCardListReadersA.restype = LONG
winscard.SCardGetStatusChangeA.argtypes = [SCARDCONTEXT, DWORD, POINTER(SCARD_READERSTATEA), DWORD]
winscard.SCardGetStatusChangeA.restype = LONG
winscard.SCardConnectA.argtypes = [SCARDCONTEXT, c_char_p, DWORD, DWORD, POINTER(SCARDHANDLE), POINTER(DWORD)]
winscard.SCardConnectA.restype = LONG
winscard.SCardTransmit.argtypes = [SCARDHANDLE, POINTER(SCARD_IO_REQUEST), c_char_p, DWORD, POINTER(SCARD_IO_REQUEST), c_char_p, POINTER(DWORD)]
winscard.SCardTransmit.restype = LONG
winscard.SCardDisconnect.argtypes = [SCARDHANDLE, DWORD]
winscard.SCardDisconnect.restype = LONG
winscard.SCardReleaseContext.argtypes = [SCARDCONTEXT]
winscard.SCardReleaseContext.restype = LONG

def type_text(text, press_enter=True):
    try:
        time.sleep(0.05)
        for char in str(text):
            vk = user32.VkKeyScanA(ord(char))
            if vk == -1:
                continue
            key_code = vk & 0xFF
            shift = (vk >> 8) & 1
            if shift:
                user32.keybd_event(0x10, 0, 0, 0)
            user32.keybd_event(key_code, 0, 0, 0)
            user32.keybd_event(key_code, 0, 2, 0)
            if shift:
                user32.keybd_event(0x10, 0, 2, 0)
            time.sleep(0.015)
            
        if press_enter:
            time.sleep(0.05)
            user32.keybd_event(0x0D, 0, 0, 0)
            user32.keybd_event(0x0D, 0, 2, 0)
    except Exception as e:
        print(f"[Wedge] Erro ao digitar: {e}")

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
    
    print("="*55)
    print(f" >>> CARTAO BIPADO COM SUCESSO! <<<")
    print(f" NUMERO / UID: {clean_uid}")
    print(f" HORA:         {time.strftime('%H:%M:%S')}")
    print("="*55)
    
    # WebSocket
    broadcast({
        "type": "NFC_TAG_DETECTED",
        "uid": clean_uid,
        "standard": standard,
        "atr": atr,
        "timestamp": last_read_tag["timestamp"]
    })
    
    # Keyboard Wedge
    threading.Thread(target=type_text, args=(clean_uid, True), daemon=True).start()

def handle_client(sock, addr):
    global current_reader_name, last_read_tag
    try:
        req = sock.recv(4096).decode('latin-1', errors='ignore')
        if not req:
            sock.close()
            return
        
        if "Upgrade: websocket" in req or "Upgrade: WebSocket" in req:
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
            
            init_msg = json.dumps({
                "type": "BRIDGE_STATUS",
                "status": "online",
                "reader": current_reader_name,
                "lastTag": last_read_tag
            })
            sock.sendall(bytes([0x81, len(init_msg)]) + init_msg.encode('utf-8'))
            
            while True:
                head = sock.recv(2)
                if not head or len(head) < 2:
                    break
                b1, b2 = head[0], head[1]
                opcode = b1 & 0x0F
                if opcode == 0x08:
                    break
                is_masked = bool(b2 & 0x80)
                length = b2 & 0x7F
                if length == 126:
                    length = struct.unpack("!H", sock.recv(2))[0]
                elif length == 127:
                    length = struct.unpack("!Q", sock.recv(8))[0]
                
                mask = sock.recv(4) if is_masked else b""
                data = sock.recv(length) if length > 0 else b""
                
                if opcode == 0x09:
                    pong = bytes([0x8A, len(data)]) + data
                    sock.sendall(pong)
        else:
            body = json.dumps({
                "service": "PortALL NFC Bridge (PC/SC + Keyboard Wedge)",
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
    except Exception:
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
        print(f"[*] Servidor WebSocket e HTTP ativo na porta {PORT}")
        while True:
            client_sock, addr = server.accept()
            t = threading.Thread(target=handle_client, args=(client_sock, addr), daemon=True)
            t.start()
    except Exception as e:
        print(f"[ERRO] Falha no servidor: {e}")

def run_pcsc_monitor():
    global current_reader_name
    hCtx = SCARDCONTEXT()
    res = winscard.SCardEstablishContext(SCARD_SCOPE_USER, None, None, byref(hCtx))
    if res != 0:
        print(f"[ERRO] Falha ao inicializar contexto PC/SC: {hex(res & 0xFFFFFFFF)}")
        return

    was_present = False
    
    while True:
        try:
            rlen = DWORD(1024)
            buf = create_string_buffer(1024)
            res = winscard.SCardListReadersA(hCtx, None, buf, byref(rlen))
            readers = []
            if res == 0 and rlen.value > 0:
                readers = [r.strip() for r in buf.raw[:rlen.value].decode('latin-1').split('\x00') if r.strip()]
            
            if not readers:
                if current_reader_name is not None:
                    print(f"[*] Leitor desconectado: {current_reader_name}")
                    broadcast({"type": "READER_DISCONNECTED", "reader": current_reader_name})
                    current_reader_name = None
                time.sleep(1)
                continue
            
            picc_readers = [r for r in readers if 'PICC' in r.upper()]
            target_reader = picc_readers[0] if picc_readers else readers[0]
            
            if current_reader_name != target_reader:
                current_reader_name = target_reader
                print(f"[*] Leitor conectado e pronto: {current_reader_name}")
                broadcast({"type": "READER_CONNECTED", "reader": current_reader_name})
            
            name_bytes = target_reader.encode('latin-1')
            rs = SCARD_READERSTATEA()
            rs.szReader = name_bytes
            rs.dwCurrentState = SCARD_STATE_UNAWARE
            
            res_sc = winscard.SCardGetStatusChangeA(hCtx, 200, byref(rs), 1)
            ev = rs.dwEventState
            is_present = bool(ev & SCARD_STATE_PRESENT)
            
            if is_present and not was_present:
                was_present = True
                hCard = SCARDHANDLE()
                active_proto = DWORD()
                c_res = winscard.SCardConnectA(hCtx, name_bytes, SCARD_SHARE_SHARED, SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1, byref(hCard), byref(active_proto))
                
                uid_found = None
                if c_res == 0:
                    pci = byref(g_rgSCardT1Pci) if active_proto.value == 2 else byref(g_rgSCardT0Pci)
                    apdu1 = bytes([0xFF, 0xCA, 0x00, 0x00, 0x00])
                    recv_buf = create_string_buffer(258)
                    recv_len = DWORD(258)
                    tx1 = winscard.SCardTransmit(hCard, pci, apdu1, len(apdu1), None, recv_buf, byref(recv_len))
                    
                    if tx1 == 0 and recv_len.value >= 2:
                        resp = bytes(recv_buf.raw[:recv_len.value])
                        sw1, sw2 = resp[-2], resp[-1]
                        data = resp[:-2]
                        if sw1 == 0x90 and sw2 == 0x00 and len(data) > 0:
                            uid_found = data.hex().upper()
                    
                    winscard.SCardDisconnect(hCard, SCARD_LEAVE_CARD)
                    
                if not uid_found and rs.cbAtr > 0:
                    uid_found = bytes(rs.rgbAtr[:rs.cbAtr]).hex().upper()
                    
                if uid_found:
                    broadcast_tag(uid_found, "Mifare / ISO 14443-3A")
                    
            elif not is_present and was_present:
                was_present = False
                print(" [i] Cartao retirado do leitor. Aguardando proximo...")
                broadcast({"type": "NFC_TAG_REMOVED"})
                
            time.sleep(0.05)
            
        except Exception as e:
            time.sleep(0.5)

if __name__ == "__main__":
    print("="*60)
    print("     PortALL - Bridge Local NFC ACR122U (Dual Mode)")
    print("="*60)
    print(" [OK] Modo 1: WebSocket (ws://localhost:9191)")
    print(" [OK] Modo 2: Emulacao de Teclado Automatica (Wedge)")
    print("="*60)
    
    t_pcsc = threading.Thread(target=run_pcsc_monitor, daemon=True)
    t_pcsc.start()
    
    run_ws_server()
