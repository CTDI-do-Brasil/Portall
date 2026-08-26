import sys
import os
import time
import ctypes
from ctypes import byref, c_size_t, create_string_buffer, Structure, c_char_p, c_byte, c_void_p, c_ulong, POINTER, c_long

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

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

def type_text(text):
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
        time.sleep(0.05)
        user32.keybd_event(0x0D, 0, 0, 0)
        user32.keybd_event(0x0D, 0, 2, 0)
    except Exception:
        pass

print("="*60)
print("     MONITOR EM TEMPO REAL - LEITOR NFC ACR122U")
print("="*60)
print(" (Esta janela NUNCA fecha sozinha. Aproxime os cartoes.)\n")

hCtx = SCARDCONTEXT()
res = winscard.SCardEstablishContext(SCARD_SCOPE_USER, None, None, byref(hCtx))

rlen = DWORD(1024)
buf = create_string_buffer(1024)
res = winscard.SCardListReadersA(hCtx, None, buf, byref(rlen))
readers = []
if res == 0 and rlen.value > 0:
    readers = [r.strip() for r in buf.raw[:rlen.value].decode('latin-1').split('\x00') if r.strip()]

print(f"[*] Leitores detectados pelo Windows:")
for r in readers:
    print(f"    -> {r}")

if not readers:
    print("\n[ERRO] Nenhum leitor encontrado!")
    print("Pressione ENTER para fechar...")
    input()
    sys.exit(0)

picc_readers = [r for r in readers if 'PICC' in r.upper()]
target_reader = picc_readers[0] if picc_readers else readers[0]
print(f"\n[*] Conectado na antena: {target_reader}")
print("[*] Status: PRONTO! Aproxime qualquer cartao/cracha no leitor...\n")

name_bytes = target_reader.encode('latin-1')
rs = SCARD_READERSTATEA()
rs.szReader = name_bytes
rs.dwCurrentState = SCARD_STATE_UNAWARE

was_present = False

try:
    while True:
        res = winscard.SCardGetStatusChangeA(hCtx, 200, byref(rs), 1)
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
                print("="*55)
                print(f" >>> CARTAO BIPADO COM SUCESSO! <<<")
                print(f" NUMERO / UID: {uid_found}")
                print(f" HORA:         {time.strftime('%H:%M:%S')}")
                print("="*55)
                type_text(uid_found)
                print(" [OK] Digitado automaticamente no cursor ativo!\n")
            else:
                print(" [!] Cartao detectado, mas nao foi possivel extrair UID.")
                
        elif not is_present and was_present:
            was_present = False
            print(" [i] Cartao retirado do leitor. Aguardando proximo...")
            
        rs.dwCurrentState = rs.dwEventState
        time.sleep(0.05)
        
except KeyboardInterrupt:
    print("\nEncerrado pelo usuario.")

winscard.SCardReleaseContext(hCtx)
