@echo off
title PortALL - Bridge NFC ACR122U
color 0A
cls
echo =========================================================
echo    PORTALL - SERVICO LOCAL DE LEITURA NFC ACR122U
echo =========================================================
echo.

cd /d "%~dp0"

if not exist node_modules (
    echo [INFO] Instalando dependencias necessarias para o leitor...
    call npm.cmd install
    if errorlevel 1 (
        echo.
        echo [AVISO] Falha ao executar npm install. Certifique-se de que o Node.js esta instalado.
        pause
    )
)

echo.
echo [INFO] Iniciando Bridge NFC...
echo.
node server.js
if errorlevel 1 (
    echo.
    echo [ERRO] O servico foi encerrado com erro.
    pause
)
