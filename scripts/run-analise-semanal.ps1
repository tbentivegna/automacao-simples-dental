# Roda a análise semanal de "lições aprendidas" via Claude Code headless
# (-p / print mode). Chamado pelo Windows Task Scheduler 1x/semana -- ver
# scripts/analise-semanal-prompt.md pro que exatamente é analisado e
# gravado (nunca aplica nada sozinha, só grava sugestões em
# public.licoes_aprendidas pra revisão no painel administrativo).
#
# --dangerously-skip-permissions: mesmo racional do run-health-check.ps1 --
# roda local, com a conta do próprio usuário, sobre um prompt fixo e
# controlado (não input externo).

$repoDir = "C:\Users\tiago\automacao-simples-dental"
$promptPath = Join-Path $repoDir "scripts\analise-semanal-prompt.md"
$logDir = Join-Path $repoDir "logs"
$runLog = Join-Path $logDir "analise-semanal-runs.log"

if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

Set-Location $repoDir
$prompt = Get-Content -Raw -Path $promptPath -Encoding UTF8

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"[$timestamp] iniciando analise semanal..." | Out-File -Append -FilePath $runLog -Encoding utf8

try {
  $output = claude -p $prompt --dangerously-skip-permissions --model claude-sonnet-5 2>&1
  $output | Out-File -Append -FilePath $runLog -Encoding utf8
  "[$timestamp] analise semanal concluida" | Out-File -Append -FilePath $runLog -Encoding utf8
} catch {
  "[$timestamp] ERRO ao rodar analise semanal: $($_.Exception.Message)" | Out-File -Append -FilePath $runLog -Encoding utf8
}
