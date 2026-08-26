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
SCARD_SHARE_DIRECT = 3
SCARD_PROTOCOL_T0 = 1
SCARD_PROTOCOL_T1 = 2
SCARD_PROTOCOL_RAW = 4
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

print("="*60)
print("     DIAGNOSTICO COMPLETO DO LEITOR NFC ACR122U")
print("="*60)

hCtx = SCARDCONTEXT()
res = winscard.SCardEstablishContext(SCARD_SCOPE_USER, None, None, byref(hCtx))
print(f"[1/4] Contexto PC/SC: {'OK (0x0)' if res == 0 else f'FALHA ({hex(res & 0xFFFFFFFF)})'}")

rlen = DWORD(1024)
buf = create_string_buffer(1024)
res = winscard.SCardListReadersA(hCtx, None, buf, byref(rlen))
readers = []
if res == 0 and rlen.value > 0:
    readers = [r.strip() for r in buf.raw[:rlen.value].decode('latin-1').split('\x00') if r.strip()]

print(f"[2/4] Leitores encontrados no Windows ({len(readers)}):")
for r in readers:
    print(f"      -> {r}")

if not readers:
    print("\n[AVISO] Nenhum leitor encontrado pelo Windows!")
    print("        Verifique se o cabo USB esta plugado e o driver ACS instalado.")
    sys.exit(0)

# Seleciona o melhor leitor
picc_readers = [r for r in readers if 'PICC' in r.upper()]
target_reader = picc_readers[0] if picc_readers else readers[0]
print(f"\n[3/4] Monitorando leitor: {target_reader}")
print("      >>> APROXIME O CARTAO / CRACHA NO LEITOR AGORA! <<<")
print("      (Aguardando leitura por 30 segundos...)\n")

name_bytes = target_reader.encode('latin-1')
rs = SCARD_READERSTATEA()
rs.szReader = name_bytes
rs.dwCurrentState = SCARD_STATE_UNAWARE

start_time = time.time()
detected = False

while time.time() - start_time < 30:
    res = winscard.SCardGetStatusChangeA(hCtx, 400, byref(rs), 1)
    ev = rs.dwEventState
    
    if ev & SCARD_STATE_PRESENT:
        print(f"\n[!] CARTAO DETECTADO! (Estado: {hex(ev)})")
        detected = True
        
        # Tenta conectar
        hCard = SCARDHANDLE()
        active_proto = DWORD()
        c_res = winscard.SCardConnectA(hCtx, name_bytes, SCARD_SHARE_SHARED, SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1, byref(hCard), byref(active_proto))
        print(f"    -> Conexao com cartao: {'OK' if c_res == 0 else f'Erro {hex(c_res & 0xFFFFFFFF)}'}")
        
        if c_res == 0:
            pci = byref(g_rgSCardT1Pci) if active_proto.value == 2 else byref(g_rgSCardT0Pci)
            
            # APDU 1: Get UID
            apdu1 = bytes([0xFF, 0xCA, 0x00, 0x00, 0x00])
            recv_buf = create_string_buffer(258)
            recv_len = DWORD(258)
            tx1 = winscard.SCardTransmit(hCard, pci, apdu1, len(apdu1), None, recv_buf, byref(recv_len))
            
            uid_found = None
            if tx1 == 0 and recv_len.value >= 2:
                resp = bytes(recv_buf.raw[:recv_len.value])
                sw1, sw2 = resp[-2], resp[-1]
                data = resp[:-2]
                print(f"    -> APDU Get UID (FF CA 00 00 00): SW={hex(sw1)} {hex(sw2)} Dados={data.hex().upper()}")
                if sw1 == 0x90 and sw2 == 0x00 and len(data) > 0:
                    uid_found = data.hex().upper()
            else:
                print(f"    -> APDU Get UID falhou: {hex(tx1 & 0xFFFFFFFF)}")
            
            # ATR do cartao
            if rs.cbAtr > 0:
                atr_hex = bytes(rs.rgbAtr[:rs.cbAtr]).hex().upper()
                print(f"    -> ATR do Cartao: {atr_hex}")
                if not uid_found:
                    uid_found = atr_hex
            
            winscard.SCardDisconnect(hCard, SCARD_LEAVE_CARD)
            
            if uid_found:
                print("\n" + "="*50)
                print(f" [SUCESSO TOTAL] NUMERO DO CARTAO: {uid_found}")
                print("="*50)
                
                # Testa digitacao
                print(" Testando digitacao no Windows (Wedge)...")
                for char in uid_found:
                    vk = user32.VkKeyScanA(ord(char))
                    if vk != -1:
                        kc = vk & 0xFF
                        user32.keybd_event(kc, 0, 0, 0)
                        user32.keybd_event(kc, 0, 2, 0)
                        time.sleep(0.01)
                print(" Digitado com sucesso!")
                break
        else:
            # Mostra ATR mesmo se connect falhar
            if rs.cbAtr > 0:
                atr_hex = bytes(rs.rgbAtr[:rs.cbAtr]).hex().upper()
                print(f"    -> ATR detectado: {atr_hex}")
                break
    else:
        print(".", end="", flush=True)
    
    rs.dwCurrentState = rs.dwEventState
    time.sleep(0.2)

if not detected:
    print("\n\n[INFO] Tempo esgotado (30s). O leitor nao detectou nenhum cartao.")
    print("       Dica: Verifique se o cartao e compativel (NFC/Mifare 13.56 MHz).")

print("\n" + "="*60)
winscard.SCardReleaseContext(hCtx)
