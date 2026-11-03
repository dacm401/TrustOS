# TrustOS 无人值守周期校验（由 Windows 任务计划程序每 N 小时调用）
# 只做机械检查，不修改代码、不提交；结果追加到 docs/strategy/AUTO-LOG.md
# 智能总结 / 代码推进由 IDE 会话里的 agent 基于本日志完成。
$ErrorActionPreference = 'Continue'
$repo = "c:\Users\ligua\Documents\WorkBuddy\trustos"
$log  = Join-Path $repo "docs\strategy\AUTO-LOG.md"
$timestamp = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")

function Log($msg) {
  "$timestamp | $msg" | Tee-Object -Append -FilePath $log | Write-Output
}

Log "===== AUTO-CHECK START ====="
Set-Location $repo

# 1) 工作区状态（有无未提交改动 / 冲突）
$gs = (git status --short | Out-String).Trim()
Log "git status: $(if($gs){$gs}else{'(clean)'})"

# 2) 前端 tsc
Push-Location frontend
$fe = (npx tsc --noEmit 2>&1 | Out-String).Trim()
Pop-Location
Log "frontend tsc: $(if($fe){$fe}else{'OK (0 errors)'})"

# 3) 后端 tsc
$be = (npx tsc --noEmit 2>&1 | Out-String).Trim()
Log "backend tsc: $(if($be){$be}else{'OK (0 errors)'})"

# 4) 真机 / 容器健康（docker 在跑时才有输出）
try {
  $h = (curl.exe -s --max-time 3 http://localhost:8787/health)
  Log "gateway health: $h"
} catch {
  Log "gateway health: (no response — docker/gateway not running)"
}

# 5) 最近提交（便于回溯）
$lr = (git --no-pager log --oneline -3 | Out-String).Trim()
Log "recent commits:`n$lr"

Log "===== AUTO-CHECK END ====="
