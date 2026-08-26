@echo off
title PortALL - Bridge Leitor NFC ACR122U
color 0A
cls
cd /d "%~dp0"

if exist "%~dp0PortallNFCBridge.exe" (
    "%~dp0PortallNFCBridge.exe"
) else (
    python server.py
)
echo.
pause
