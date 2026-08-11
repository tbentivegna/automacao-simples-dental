# Master Control + Analytics Agent — guia de implementação no n8n

Pré-requisito: rode `db/migrations/002_master_control_analytics.sql` no Postgres antes de tudo, e cadastre pelo menos um número master:

```sql
INSERT INTO public.numeros_master (telefone, nome)
VALUES ('5511999999999@s.whatsapp.net', 'Seu Nome');
```

(troque pelo telefone real, no mesmo formato JID usado no campo `From`.)

## 1) Gate de "é número master?"

Logo depois do node **Edit Fields** (onde `From`/`Instance`/`Mensagem` já estão definidos), antes de continuar pro fluxo normal:

1. Adicione um node **Postgres** ("Verifica Master") com a query `eh_master` de [db/analytics-queries.sql](../db/analytics-queries.sql), parâmetro `$1 = {{ $json.From }}`.
2. Adicione um node **IF** ("É Master?") checando `{{ $json.eh_master }} === true`.
   - **TRUE** → vai pro sub-fluxo Admin (seção 2).
   - **FALSE** → segue pro fluxo normal, mas primeiro passando pela checagem de pausa (seção 3).

Isso garante que mensagens de números master **nunca** chegam na Lumi nem no fluxo de paciente — sempre caem no sub-fluxo admin.

## 2) Sub-fluxo Admin (só roda pra número master)

Um **Switch** checando o texto da mensagem (`{{ $json.Mensagem }}`):

- **Começa com `##pausar`** → node Postgres rodando o UPDATE de pausar (`$1 = From`) → node Evolution API mandando de volta: *"🔒 Fluxo pausado globalmente. Para reativar, envie `##retomar`."*
- **Começa com `##retomar`** → node Postgres rodando o UPDATE de retomar → Evolution API: *"✅ Fluxo reativado. Atendimento automático voltou ao normal."*
- **Else** → node **AI Agent** novo ("Analytics Agent"):
  - System Message: cole o conteúdo de [lumi-harness/analytics-system-prompt.txt](../lumi-harness/analytics-system-prompt.txt)
  - Modelo: pode reaproveitar o mesmo "Mistral Cloud Chat Model" já configurado (ou outro, sem relação com o modelo da Lumi)
  - **Sem memória Postgres** — cada pergunta de analytics é independente, não precisa de histórico entre sessões (ou, se quiser manter contexto de conversa, use uma `sessionKey` diferente da dos pacientes, ex: `={{ 'admin-' + $json.From }}`)
  - Duas tools **Postgres Tool**, usando as queries de [db/analytics-queries.sql](../db/analytics-queries.sql):
    - `relatorio_geral` — parâmetro `janela` via `$fromAI('janela', 'hoje | ultimas_24h | ultima_semana | ultimo_mes | tudo', 'string')`
    - `listar_pendencias` — parâmetro `apenasUrgentes` via `$fromAI('apenasUrgentes', '...', 'boolean')`
  - A saída do Agent vai direto pra um node Evolution API mandando a resposta pro número master (**sem** passar pelo "Extrai JSON" -- esse agent não gera `agent_action`, é sempre texto puro).

## 3) Checagem de pausa global (só pra quem NÃO é master)

Logo após o branch FALSE de "É Master?", antes de "Humano ou IA?":

1. Node **Postgres** ("Checa Pausa Global") com a query de `bot_pausado`.
2. Node **IF** ("Bot Pausado?"):
   - **TRUE** → Evolution API mandando a mensagem fixa (ex: *"No momento estamos com o atendimento automático pausado temporariamente. Nossa equipe já vai te atender por aqui. 🤎"*) — **sem** chamar a Lumi. Fim do fluxo pra essa mensagem.
   - **FALSE** → segue pro fluxo normal (Humano ou IA? → Lumi → etc.), sem nenhuma outra mudança.

## Testando

1. De um número master: `##pausar` → deve confirmar e, a partir daí, qualquer paciente comum deve receber só a mensagem fixa (a Lumi não roda mais).
2. Ainda pausado, mande `quantos agendamentos essa semana?` de um número master → deve responder com números, não com a mensagem de pausado (o gate de master roda ANTES da checagem de pausa).
3. `##retomar` do mesmo número master → confirma e o atendimento normal volta.
4. De um número comum (não master), tentar mandar `##pausar` → não deve ter efeito nenhum (a checagem `eh_master` bloqueia antes de chegar no Switch admin).

## E se quiser, as melhorias extras sugeridas

- **Confirmação antes de pausar**: troque o `##pausar` direto por um fluxo de 2 passos (pede "responda SIM pra confirmar" antes do UPDATE).
- **Lembrete de pausa esquecida**: um Schedule Trigger separado, rodando a cada poucas horas, checando `pausado_em` e mandando um lembrete pros números master se `bot_pausado = true` há mais de X horas.
- **Resumo automático**: outro Schedule Trigger (ex: toda manhã às 8h) chamando a mesma query de `relatorio_geral` com `janela = 'ultimas_24h'` e mandando pros números master, sem precisar perguntar.
