@echo off
title PortALL - Bridge NFC ACR122U
color 0A
cls
echo =========================================================
echo    PORTALL - SERVICO LOCAL DE LEITURA NFC ACR122U
echo =========================================================
echo.

cd /d "%~dp0"

if exist "%~dp0PortallNFCBridge.exe" (
    echo [INFO] Iniciando Bridge NFC Nativo...
    start "" "%~dp0PortallNFCBridge.exe"
    echo [SUCESSO] Servico iniciado em segundo plano!
    timeout /t 3 >nul
    exit
) else (
    echo [INFO] Executando server.py...
    python server.py
)
pause
