# 早八 zaoba · Windows 卸载脚本（只删定时任务，不动数据和登录态）
# 用法：powershell -ExecutionPolicy Bypass -File scripts\uninstall-service.ps1
$ErrorActionPreference = 'Continue'
$ProjectDir = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectDir
Write-Host "→ 移除 Windows 计划任务"
node src/index.js uninstall-service
Write-Host ""
Write-Host "· 登录态与日志都保留（profile/、data/）"
