@echo off
title PortALL - Iniciar Leitor NFC (Segundo Plano)
color 0A
cls
echo =========================================================
echo    PORTALL - INICIANDO LEITOR NFC EM SEGUNDO PLANO
echo =========================================================
echo.

cd /d "%~dp0"

echo [1/2] Encerrando instancias antigas se houver...
taskkill /f /im PortallNFCBridge.exe >nul 2>&1
ping 127.0.0.1 -n 2 >nul

echo [2/2] Iniciando servico em segundo plano...
start "" "%~dp0PortallNFCBridge.exe"

echo.
echo =========================================================
echo  [SUCESSO] O servico esta rodando em SEGUNDO PLANO!
echo            Nao ha nenhuma janela para manter aberta.
echo            Esta janela sera fechada automaticamente...
echo =========================================================
ping 127.0.0.1 -n 3 >nul
exit
