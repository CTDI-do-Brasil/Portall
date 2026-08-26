@echo off
title Desativar Inicializacao Automatica - PortALL NFC Bridge
color 0C
cls
echo =========================================================
echo    DESATIVAR INICIALIZACAO COM O WINDOWS (PORTALL NFC)
echo =========================================================
echo.

set "SHORTCUT_PATH=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\PortallNFCBridge.lnk"

if exist "%SHORTCUT_PATH%" (
    del /f /q "%SHORTCUT_PATH%"
    echo [SUCESSO] Inicializacao automatica removida com sucesso.
) else (
    echo [INFO] O servico nao estava configurado para inicializar com o Windows.
)

echo.
pause
