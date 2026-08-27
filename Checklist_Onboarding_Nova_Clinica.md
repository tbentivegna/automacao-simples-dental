# Checklist de Onboarding — Nova Clínica (Assistente IA estilo Lumi)

Use este checklist toda vez que uma clínica nova contratar. Ele assume que a arquitetura atual continua "clonar e configurar" (containers/workflow separados por clínica), não a plataforma multi-tenant.

## 0. Qualificação (antes de vender / antes de aceitar o setup)

- [ ] A clínica usa **Simples Dental**? Isso é bloqueante — o robô de automação (`automacao-simples-dental`) foi feito para os seletores de tela do Simples Dental especificamente. Se a clínica usa outro sistema (Clinicorp, iClinic, Sasu etc.), isto NÃO é um setup padrão — é um projeto de integração novo, deve ser orçado e prazo comunicado à parte.
- [ ] O dono/responsável tem acesso admin ao login do Simples Dental (usuário e senha que o robô vai usar)?
- [ ] A clínica tem (ou vai criar) um número de WhatsApp Business dedicado para a assistente? Idealmente não é o número pessoal do dono — reduz risco de a IA responder conversas pessoais por engano.

## 1. Entrevista Estratégica e de Essência (manual, com o dono — não pule, é o coração do "IN dirige")

Roteiro completo (o que perguntar, em que ordem, e o que cada resposta alimenta): `Roteiro_Entrevista_Personalizacao.md`. Resumo do que precisa sair da call:

- [ ] Nome completo do profissional e registro (CRO, CRP, CRM etc.)
- [ ] Especialidades / tratamentos que a clínica realmente atende (lista exata)
- [ ] O que a clínica **não** atende (procedimentos que a IA deve recusar/encaminhar em vez de afirmar que faz)
- [ ] Preço da primeira consulta/avaliação e o que está incluso (ex.: retorno em 30 dias)
- [ ] Tom de voz desejado (feminino/masculino, formal/informal, uso de emoji sim/não, nível de "calor humano")
- [ ] Regras específicas do negócio (ex.: não atende convênio, idade mínima, exige responsável para menores, etc.)
- [ ] Horários de atendimento por dia da semana e duração padrão de consulta
- [ ] Nome que a assistente vai usar (decidir: mantém a marca "Lumi" para todas as clínicas, ou cada clínica tem um nome próprio? Recomendo manter "Lumi" como marca do produto — facilita seu marketing e reconhecimento)
- [ ] Rede social / canal para mencionar na despedida (Instagram etc.)
- [ ] Número de WhatsApp que deve receber o handoff humano (dono, recepção ou equipe)

Preencher o `Template_Prompt_Assistente_IA.md` com essas respostas antes de seguir para a etapa 2.

## 2. Provisionamento técnico

**Evolution API (WhatsApp)**
- [ ] Criar nova instância no Evolution API com nome único (ex.: nome da clínica)
- [ ] Conectar o WhatsApp Business da clínica escaneando o QR code — fazer isso ao vivo com o cliente
- [ ] Confirmar webhook da instância apontando para o n8n

**Robô de automação (Simples Dental)**
- [ ] Duplicar o container `automacao-simples-dental` no Easypanel
- [ ] Configurar as env vars: `SIMPLES_DENTAL_URL`, `SIMPLES_DENTAL_USER`, `SIMPLES_DENTAL_PASS`, `SIMPLES_DENTAL_CLINICA`, `SIMPLES_DENTAL_PROFISSIONAL`, `SEMANAS_A_VERIFICAR`, `PORT`, `DATABASE_URL` (aponta pro Postgres desta clínica), `BRIDGE_API_KEY` (chave própria desta clínica, não reaproveitar a de outra)
- [ ] Criar volume persistente apontando para `/app/auth` (sessão de login salva)
- [ ] Confirmar que **não** há domínio público ativado (serviço só acessível internamente pelo n8n/painel admin)
- [ ] Testar `/health` do serviço
- [ ] ~~Conferir MODELO_HORARIOS hardcoded~~ **resolvido em 2026-08-27**: horários/duração da consulta agora moram em `public.configuracao_horarios` (Postgres), editáveis pela tela "⚙️ Configurações" do painel admin — não precisa mais editar código nem redeployar por causa disso. Só rodar a migration `db/migrations/009_configuracao_horarios.sql` neste novo banco e preencher os valores reais da clínica pela tela.
- [ ] Rodar um teste real de verificação de disponibilidade e conferir se os horários batem com a agenda real da clínica

**Banco de dados**

Isolamento é por **banco (database) separado, não schema separado**, dentro do **mesmo serviço Postgres do Easypanel que já existe** — não precisa (e não deve) subir um novo serviço/container de Postgres por clínica. Um único servidor Postgres hospeda quantos `CREATE DATABASE` forem necessários; "banco" e "instância" são coisas diferentes. Banco separado dá isolamento de verdade (uma query com bug numa clínica não tem nem como enxergar o banco de outra); schema separado dependeria de todo query estar sempre ciente do schema certo, um risco a mais que não vale a pena.

⚠️ **Nunca clonar o banco de produção da Dra. Aline como "template"** (nem com `CREATE DATABASE ... TEMPLATE`) — isso copiaria dados reais de pacientes dela pro banco da clínica nova, problema sério de LGPD. O jeito certo é sempre partir de um banco vazio.

- [ ] `CREATE DATABASE <clinica_x>` no Postgres existente do Easypanel (banco novo, vazio)
- [ ] Rodar TODAS as migrations de `db/migrations/`, em ordem, contra esse banco novo (schema fica idêntico ao de produção, sem nenhuma linha de paciente)
- [ ] Criar um `ROLE` Postgres próprio desta clínica (usuário + senha dedicados), com permissão só nesse banco — nunca reaproveitar o superuser nem a credencial de outra clínica
- [ ] Montar a `DATABASE_URL` desta clínica com esse role/banco novos — é o valor usado no robô, no painel admin, e na credencial Postgres do n8n (ver seções abaixo)
- [ ] Criar a credencial Postgres correspondente no n8n, apontando pra essa `DATABASE_URL`

**Workflows n8n** (são 3, não 1 — os 3 duplicam por clínica)
- [ ] Duplicar o workflow principal ("Lumi")
  - [ ] Colar o prompt preenchido (do `Template_Prompt_Assistente_IA.md`) no nó do AI Agent
  - [ ] Apontar a credencial Evolution API do workflow para a nova instância
  - [ ] Apontar a credencial Postgres para o banco da nova clínica
  - [ ] Atualizar o número de destino no nó de handoff humano para o número da etapa 1
  - [ ] Conferir que as tools (Verifica Disponibilidade, Cria Agendamento, Busca Agendamentos, Confirmar, Cancelar, Remarcar, Registrar Consentimento Lembrete, Atualiza Nome) apontam pra URL (`BRIDGE_URL`) e `X-Bridge-Key` do container correto desta clínica
  - [ ] Ativar o webhook
- [ ] Duplicar o workflow "Lumi - Resgate de Funil" (funil de resgate/win-back) — apontar Postgres + Evolution da nova clínica, conferir schedule trigger (cron `*/30 8-17 * * 1-5`, `settings.timezone` correto pro fuso da clínica)
- [ ] Duplicar o workflow "Lumi - Retorno Automático do Atendimento Humano" — apontar Postgres da nova clínica

**Painel administrativo** (não estava neste checklist antes — é parte do produto hoje, não é opcional)
- [ ] Duplicar o serviço `admin-panel` no Easypanel
- [ ] Configurar as env vars: `DATABASE_URL` (banco desta clínica), `DATABASE_SSL`, `BRIDGE_URL`/`BRIDGE_API_KEY` (mesmos valores do robô desta clínica), `EVOLUTION_BASE_URL`/`EVOLUTION_API_KEY`/`EVOLUTION_INSTANCE_ALINE` (renomear a variável mentalmente — é a instância desta clínica), `ADMIN_PASSWORD` (senha própria, não reaproveitar)
- [ ] Testar login e abrir a tela "⚙️ Configurações" pra preencher os horários reais desta clínica

## 3. Teste e validação (antes de anunciar para os pacientes)

Enviar mensagens de teste cobrindo:
- [ ] Saudação / primeiro contato
- [ ] Dúvida geral sobre tratamento
- [ ] Pergunta sobre procedimento que a clínica **não** oferece (validar que não afirma que atende)
- [ ] Fluxo completo de agendamento (nome → motivo → horário → confirmação)
- [ ] Consulta de agendamento existente
- [ ] Remarcação
- [ ] Cancelamento
- [ ] Confirmação de agendamento
- [ ] Urgência/dor intensa (validar que não recomenda medicamento)
- [ ] Validar que o preço da consulta só aparece quando apropriado (não é oferecido de forma espontânea)
- [ ] Validar que a IA nunca confirma nada sem checar a ferramenta (testar um cenário de horário indisponível)
- [ ] Confirmar que o handoff humano chega no número certo
- [ ] Rodar 24-48h em modo supervisionado (você acompanhando as conversas) antes de liberar 100%

## 4. Ativação

- [ ] Cliente aprova o tom/comportamento da assistente
- [ ] Clínica anuncia publicamente (Instagram etc.)
- [ ] Agendar follow-up em ~2 semanas para coletar resultado real / depoimento (usar isso depois em material de venda)

## Notas para reduzir tempo de setup no futuro

O maior gargalo hoje é o prompt sendo montado manualmente por clínica em vez de gerado a partir do template com variáveis já preenchidas — `Template_Prompt_Assistente_IA.md` foi revisado em 2026-08-27 pra bater com o prompt real de produção (antes era uma versão simplificada, desatualizada, que teria feito uma clínica nova reviver bugs que a Dra. Aline já pagou o preço de descobrir). O gargalo de horários hardcoded (item antigo #1) já foi resolvido — agora é configurável pela tela do painel, sem precisar editar código.

Todo o provisionamento (Evolution API, robô, banco, 3 workflows n8n, painel admin) ainda é 100% manual hoje — clicar no n8n e no Easypanel pra cada clínica nova. Automatizar isso (script de scaffolding ou tela "Nova Clínica" no próprio painel) é o próximo salto de eficiência, mas só vale a pena depois de ter passado por esse processo manual pelo menos mais uma ou duas vezes — automatizar cedo demais corre o risco de travar um formato que ainda vai mudar.
