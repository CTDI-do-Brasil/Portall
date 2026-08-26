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
set "TARGET_EXE=%SCRIPT_DIR%PortallNFCBridge.exe"

echo [1/2] Configurando atalho na pasta Inicializar do Windows...

if exist "%TARGET_EXE%" (
    powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = '%TARGET_EXE%'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.Save()"
) else (
    powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = 'pythonw.exe'; $s.Arguments = '\"%SCRIPT_DIR%server.py\"'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.Save()"
)

if exist "%SHORTCUT_PATH%" (
    echo.
    echo =========================================================
    echo [SUCESSO] O servico NFC agora iniciara automaticamente
    echo           junto com o Windows em segundo plano!
    echo =========================================================
    echo.
    echo Iniciando o servico agora para uso imediato...
    if exist "%TARGET_EXE%" (
        start "" "%TARGET_EXE%"
    ) else (
        start "" pythonw.exe "%SCRIPT_DIR%server.py"
    )
) else (
    echo.
    echo [AVISO] Nao foi possivel criar o atalho automaticamente.
)

echo.
pause
