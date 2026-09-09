@echo off
title PortALL - Parar Leitor NFC
color 0C
cls
echo =========================================================
echo       ENCERRANDO O SERVICO DO LEITOR NFC PORTALL
echo =========================================================
echo.
taskkill /f /im PortallNFCBridge.exe >nul 2>&1
echo [OK] O servico em segundo plano foi finalizado com sucesso.
echo.
timeout /t 2 >nul
exit
