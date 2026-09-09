@echo off
title PortALL - Status do Leitor NFC
color 0B
cls
echo =========================================================
echo       STATUS DO SERVICO LEITOR NFC PORTALL
echo =========================================================
echo.

tasklist /fi "imagename eq PortallNFCBridge.exe" | find /i "PortallNFCBridge.exe" >nul
if %errorlevel% equ 0 (
    echo [STATUS] O servico esta RODANDO em segundo plano!
    echo.
    powershell -NoProfile -Command "try { $res = Invoke-RestMethod -Uri 'http://localhost:9191/status' -TimeoutSec 2; Write-Host ('   -> Antena Ativa:       ' + $res.activeReader); Write-Host ('   -> Ultimo Cartao Lido: ' + $res.lastTag.uid); Write-Host ('   -> Conexao PortALL:    ' + $res.clientsConnected + ' tela(s) conectada(s)') } catch { Write-Host 'Aguardando inicializacao da porta 9191...' }"
) else (
    echo [STATUS] O servico NAO esta rodando no momento.
    echo          Para iniciar, execute: iniciar-leitor.bat
)

echo.
echo =========================================================
pause
