# Roda a checagem de saude do ecossistema Lumi via Claude Code headless
# (-p / print mode). Chamado pelo Windows Task Scheduler a cada poucas
# horas em horario comercial -- ver scripts/health-check-prompt.md pro que
# exatamente e checado e quando um alerta de WhatsApp e disparado.
#
# --dangerously-skip-permissions: sem isso, uma sessao headless sem humano
# pra aprovar ferramentas trava no primeiro comando. Aceitavel aqui porque
# roda local, com a conta do proprio usuario, sobre um prompt fixo e
# controlado (nao input externo) -- mesmo padrao de uso em CI.

$repoDir = "C:\Users\tiago\automacao-simples-dental"
$promptPath = Join-Path $repoDir "scripts\health-check-prompt.md"
$logDir = Join-Path $repoDir "logs"
$runLog = Join-Path $logDir "health-check-runs.log"

if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

Set-Location $repoDir
$prompt = Get-Content -Raw -Path $promptPath -Encoding UTF8

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"[$timestamp] iniciando checagem..." | Out-File -Append -FilePath $runLog -Encoding utf8

try {
  $output = claude -p $prompt --dangerously-skip-permissions --model claude-sonnet-5 2>&1
  $output | Out-File -Append -FilePath $runLog -Encoding utf8
  "[$timestamp] checagem concluida" | Out-File -Append -FilePath $runLog -Encoding utf8
} catch {
  "[$timestamp] ERRO ao rodar checagem: $($_.Exception.Message)" | Out-File -Append -FilePath $runLog -Encoding utf8
}
