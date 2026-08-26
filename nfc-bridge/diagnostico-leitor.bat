@echo off
title Diagnostico do Leitor NFC ACR122U
color 0B
cls
cd /d "%~dp0"
if exist "%~dp0diagnostico.exe" (
    "%~dp0diagnostico.exe"
) else (
    python diagnostico.py
)
echo.
echo Pressione qualquer tecla para fechar...
pause >nul
