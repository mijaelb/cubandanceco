@echo off
title ICCD - preparing videos
cd /d "%~dp0..\.."
echo Progress page: http://localhost:7777  (close this window to pause; start again to continue)
start "" http://localhost:7777
node tools\youtube-prep\prepare.mjs "G:/ICCD Media" "F:/ICCD YouTube"
pause
