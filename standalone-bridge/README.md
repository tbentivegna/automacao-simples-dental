# standalone-bridge

Ponte de automação equivalente ao `server.js` da raiz (Simples Dental, via Playwright) e ao `clinicorp-bridge/` (Clinicorp, via API REST) -- mas para clínicas que **não têm nenhum sistema de agenda hoje**. Expõe o **mesmo contrato HTTP** (mesmas 6 rotas, mesmos nomes de campo, mesmo formato de resposta) -- o workflow n8n "Lumi - Standalone" e o painel admin funcionam sem nenhuma mudança, só apontando `BRIDGE_URL`/`BRIDGE_API_KEY` pra este serviço.

Diferença real em relação aos outros dois: aqui **não existe sistema externo nenhum**. `public.consultas` -- que hoje é só um espelho local da agenda real do Simples Dental (ver `db/migrations/011_consultas.sql`) -- vira a **fonte de verdade única**. Sem Playwright, sem API de terceiro, sem sincronização: cada rota é só uma query no mesmo Postgres que o resto do sistema já usa.

## Status: esqueleto funcional, não testado ao vivo ainda

As 6 rotas + `/health` existem, com lógica real (não stub) -- diferente do `clinicorp-bridge/` na sua Fase 0, aqui não há credencial externa esperando: tudo já pode ser testado direto contra um Postgres real. Ainda **não foi**:
- Plugado num workflow n8n de verdade (nem `Lumi - Standalone`, que existe mas ainda aponta pro bridge do Simples Dental).
- Testado com um banco de uma clínica nova de verdade (migrations rodadas do zero).
- Rodado em produção nem uma vez.

## O que fica mais simples aqui (sem sistema externo)

- `/verificar-disponibilidade`: `SELECT` em `consultas` (janela de N semanas) cruzado com `configuracao_horarios`, mesmos cálculos puros (`calcularSlotsSemana`/`agruparPorDiaSemana`) que o `server.js` da raiz já usa -- só troca de onde vêm os "compromissos" (raspagem -> query).
- `/criar-agendamento`, `/confirmar-agendamento`, `/cancelar-agendamento`, `/remarcar-agendamento`: `INSERT`/`UPDATE` direto, sem preencher formulário nenhum. `agendamento_id` é gerado aqui (`crypto.randomUUID()`), não vem de um sistema externo.
- Sem `sincronizarAgenda()`/cron de sync -- não tem nada externo pra espelhar.
- `remarcar-agendamento` é um `UPDATE` simples (troca `inicio`/`fim`) -- **não** tem o problema que o Clinicorp tem (lá não existe endpoint de remarcação, a única forma é cancelar+criar de novo, com risco real de ficar sem nenhuma consulta se a 2ª parte falhar). Aqui isso nunca foi um risco.

## Gaps conhecidos desta 1ª versão (decisões deliberadas, não esquecimento)

1. **Sem tabela de paciente própria.** `pacienteNovo` (campo que o prompt da Lumi usa pra decidir se pede cadastro completo) é aproximado checando "esse telefone já tem alguma consulta aqui, de qualquer status" -- funciona, mas não é um cadastro de verdade (sem endereço/CPF persistidos em lugar nenhum além do vínculo `paciente_dependente`, que é só pra menores). Se o produto padrão standalone precisar de ficha de paciente completa (histórico clínico, etc.), isso pede uma tabela nova (`public.paciente`) e uma decisão de escopo com o Tiago antes de construir.
2. **Sem bloqueio de dia inteiro (folga/feriado).** No Simples Dental isso era um evento nativo do calendário de lá; aqui, `verificarDisponibilidade` sempre devolve `diasBloqueados: []`. Se precisar, é uma tabela `bloqueios_agenda` nova, simples de adicionar depois.
3. **Remarcar sempre volta o status pra `'Agendada'`.** Decisão deliberada (o novo horário ainda não foi confirmado, mesmo que o antigo já tivesse sido) -- documentada no código, vale revisar se incomodar na prática.
4. **`rotulo` é texto livre**, sem validação contra uma lista pré-existente (no Simples Dental, um rótulo teria que casar EXATO com um já cadastrado lá, senão era ignorado silenciosamente) -- aqui qualquer string é aceita e salva.

## Como testar

```bash
cd standalone-bridge
npm install
cp .env.example .env   # preencher DATABASE_URL de um banco com as migrations aplicadas
node server.js
```

Depois, testar cada rota com `curl` (lembrando do header `X-Bridge-Key`) contra um banco de teste antes de plugar no workflow `Lumi - Standalone` de verdade.

## Reaproveitado do `server.js` da raiz (sem mudança de comportamento)

- `tempo.js` -- helpers de data/fuso/expediente puros (`calcularSlotsSemana`, `agruparPorDiaSemana`, `ehSabadoAberto`...), cópia exata.
- `db.js` -- `registrarEventoAgenda`, `abrirOuAtualizarFunil`, `fecharFunil`, `buscarConfiguracaoHorarios`, e a trava `deveBloquearCancelamentoPorRemarcacao` (generalizada 02/09, caso Gabriella -- protege contra a Lumi cancelar "no susto" no meio de uma remarcação, mesmo sem tentativa em_andamento no funil).
- Middleware de autenticação `X-Bridge-Key` -- idêntico.
- **Não precisa** (diferente do `clinicorp-bridge/`): `salvarTelefoneAgendamento`/`agendamento_telefone` -- aqui o telefone já vem certo desde a criação, não precisa resolver depois por nome ambíguo.
