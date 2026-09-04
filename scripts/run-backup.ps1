# Roda o backup diario do Postgres (scripts/backup-postgres.js) e alerta
# por WhatsApp se algo falhar -- reaproveita o mesmo canal/numero que
# scripts/run-health-check.ps1 ja usa. Chamado pelo Windows Task
# Scheduler 1x/dia (ver Backup_Restauracao.md pro comando de registro).
#
# Diferente do health-check, este NAO passa por Claude -- e uma operacao
# mecanica (exportar linhas, podar antigos), sem julgamento nenhum
# envolvido, entao roda o script Node direto: mais rapido, mais barato,
# mais previsivel.

$repoDir = "C:\Users\tiago\automacao-simples-dental"
$logDir = Join-Path $repoDir "logs"
$runLog = Join-Path $logDir "backup-runs.log"

if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

function Enviar-AlertaWhatsApp($mensagem) {
  try {
    $envPath = Join-Path $repoDir "n8n\.env"
    $envVars = @{}
    Get-Content $envPath | ForEach-Object {
      if ($_ -match '^([A-Z_]+)=(.*)$') {
        $envVars[$matches[1]] = $matches[2]
      }
    }
    $uri = "$($envVars['EVOLUTION_BASE_URL'])/message/sendText/$($envVars['EVOLUTION_INSTANCE_TIAGO'])"
    $body = @{ number = "5511981174657"; text = $mensagem } | ConvertTo-Json
    Invoke-RestMethod -Uri $uri -Method Post -Headers @{ apikey = $envVars['EVOLUTION_API_KEY']; 'Content-Type' = 'application/json' } -Body $body | Out-Null
  } catch {
    "[$timestamp] FALHA AO ENVIAR ALERTA: $($_.Exception.Message)" | Out-File -Append -FilePath $runLog -Encoding utf8
  }
}

Set-Location $repoDir
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"[$timestamp] iniciando backup..." | Out-File -Append -FilePath $runLog -Encoding utf8

try {
  $output = node scripts\backup-postgres.js 2>&1
  $output | Out-File -Append -FilePath $runLog -Encoding utf8
  if ($LASTEXITCODE -ne 0) {
    "[$timestamp] backup FALHOU (exit code $LASTEXITCODE)" | Out-File -Append -FilePath $runLog -Encoding utf8
    Enviar-AlertaWhatsApp "🩺 *Monitor automático:* backup diário do Postgres falhou -- ver logs\backup-runs.log no PC."
  } else {
    "[$timestamp] backup concluido" | Out-File -Append -FilePath $runLog -Encoding utf8
  }
} catch {
  "[$timestamp] ERRO ao rodar backup: $($_.Exception.Message)" | Out-File -Append -FilePath $runLog -Encoding utf8
  Enviar-AlertaWhatsApp "🩺 *Monitor automático:* backup diário do Postgres falhou (erro ao executar) -- ver logs\backup-runs.log no PC."
}
