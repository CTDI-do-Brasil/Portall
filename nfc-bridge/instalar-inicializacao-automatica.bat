@echo off
title Configurar Inicializacao Automatica - PortALL NFC Bridge
color 0A
cls
echo =========================================================
echo    CONFIGURAR INICIALIZACAO COM O WINDOWS (PORTALL NFC)
echo =========================================================
echo.

set "SCRIPT_DIR=%~dp0"
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_PATH=%STARTUP_FOLDER%\PortallNFCBridge.lnk"
set "TARGET_VBS=%SCRIPT_DIR%iniciar-silencioso.vbs"

echo [1/2] Verificando dependencias...
if not exist "%SCRIPT_DIR%node_modules" (
    echo Instalando dependencias do leitor...
    cd /d "%SCRIPT_DIR%"
    call npm.cmd install
)

echo [2/2] Criando atalho na pasta Inicializar do Windows...
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%TARGET_VBS%\"'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.Save()"

if exist "%SHORTCUT_PATH%" (
    echo.
    echo =========================================================
    echo [SUCESSO] O servico NFC agora iniciara automaticamente
    echo           junto com o Windows em segundo plano!
    echo =========================================================
) else (
    echo.
    echo [AVISO] Nao foi possivel criar o atalho automaticamente.
)

echo.
pause
