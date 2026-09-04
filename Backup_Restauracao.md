# Backup e Restauração — Postgres

Resolve o gap real levantado em `Prontidao_Tecnica_Comercializacao.md` §3:
não existia nenhuma rotina de backup do Postgres compartilhado, que
guarda dado real de paciente em produção. Criado e testado ponta a ponta
em 04/09/2026.

## Como funciona

Não usa `pg_dump` (binário não instalado nesta máquina) — é backup
**lógico**, puro Node + `pg`, mesmo padrão do resto do repo:

- **O schema não precisa de backup** — já é 100% recuperável via
  `db/migrations/`, versionado no git. O que precisa de backup de
  verdade são as **linhas** de cada tabela.
- `scripts/backup-postgres.js` exporta toda tabela de cada banco
  configurado em JSON, comprimido em gzip, salvo em `backups/<nome>/`
  (gitignored — tem dado real de paciente, nunca pode ir pro repo).
- Retenção: 14 dias, poda automática a cada execução.
- `scripts/backup-databases.json` (gitignored) lista os bancos — hoje
  `prod` (`.env` da raiz) e `standalone-teste`
  (`standalone-bridge/.env`). **Adicionar aqui quando uma clínica nova
  for onboardada** (ver `Checklist_Onboarding_Nova_Clinica.md`).

## Testado ponta a ponta (não é só teoria)

04/09/2026: banco de teste novo criado do zero, as 13 migrations
aplicadas, um backup real restaurado nele via `scripts/restore-postgres.js`,
contagem de linha por linha comparada contra o original — **13/13 tabelas
bateram exato**. Banco de teste removido depois. Resultado real: `prod`
hoje tem 2.959 linhas em 13 tabelas, ~163KB comprimido por backup diário.

## Agendar a execução diária (1x/dia é suficiente — dado não muda rápido
o bastante pra precisar de mais)

Preciso que você registre o Windows Task Scheduler — criar uma tarefa
agendada é uma ação de configuração persistente do sistema que fico
bloqueado de fazer sozinho (mesma razão pela qual você registrou o
`Lumi-HealthCheck` manualmente). Rodar isto uma vez, no PowerShell:

```powershell
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -File `"C:\Users\tiago\automacao-simples-dental\scripts\run-backup.ps1`""
$trigger = New-ScheduledTaskTrigger -Daily -At 3am
Register-ScheduledTask -TaskName "Lumi-BackupPostgres" -Action $action -Trigger $trigger -Description "Backup diario do Postgres compartilhado (Lumi)"
```

3h da manhã: fora do horário de atendimento, sem concorrência com uso
real do sistema.

## Se precisar restaurar de verdade (desastre real)

1. Achar o backup mais recente em `backups/<nome>/` (nome do arquivo é a
   data/hora em UTC).
2. Criar um banco novo vazio: `CREATE DATABASE <nome_novo>` no Postgres.
3. Rodar TODAS as migrations nesse banco novo, em ordem (`db/run-migration.js`
   ou equivalente, 001 até a mais recente).
4. Restaurar os dados:
   ```bash
   node scripts/restore-postgres.js backups/prod/2026-09-04T....json.gz "postgres://.../<nome_novo>?sslmode=disable"
   ```
5. Repontar `DATABASE_URL` (robô, painel, n8n) pro banco novo.

`restore-postgres.js` roda tudo dentro de uma única transação — ou
aplica 100%, ou não muda nada (nunca deixa o banco pela metade se
alguma tabela falhar no meio).

## O que isso NÃO resolve ainda (limitação real, registrar)

Hoje o backup fica **só no seu PC local** — protege contra o Postgres/VPS
falhar, mas não contra o seu próprio computador falhar no mesmo dia. Não
é redundância geográfica de verdade. Próximo passo natural (não feito
ainda, fora de escopo desta rodada): subir uma cópia periódica pra algum
storage externo (Google Drive, S3/B2, etc.) — decisão de qual serviço
usar fica com você, quando quiser priorizar isso.
