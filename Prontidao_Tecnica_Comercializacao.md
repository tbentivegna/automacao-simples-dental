# Prontidão Técnica pra Vender — Lumi (Fase 2)

Lente Back-end/Segurança do `Plano_Comercializacao_Lumi.md` §3. Objetivo:
formalizar o que hoje só é **afirmado em call de venda** (`Roteiro_Demo_Vendas.md`,
tabela de objeções: *"cada clínica tem banco de dados próprio, isolado"*,
*"existe monitoramento automatizado rodando várias vezes por dia"*) — pra
essas frases aguentarem escrutínio antes de virarem texto público (site).

## 1. Isolamento multi-tenant — verificado no código, pode ser afirmado com segurança

- **Banco de dados separado por clínica** (não schema) — `CREATE DATABASE`
  próprio + `ROLE` Postgres dedicado por clínica, nunca superuser nem
  credencial de outra clínica (`Checklist_Onboarding_Nova_Clinica.md` §2).
  Uma query com bug numa clínica não tem como sequer enxergar o banco de
  outra.
- **Instância de WhatsApp dedicada por clínica** (Evolution API) — sem
  cruzamento de número/conversa entre clientes.
- **Chaves de API dedicadas** por clínica (`BRIDGE_API_KEY`,
  `ADMIN_PASSWORD`) — nunca reaproveitadas.
- **n8n**: workflows duplicados por clínica, credenciais Postgres/Evolution
  próprias (não compartilhadas) — confirmado ao vivo nesta mesma sessão
  (achado real: 37 nodes do Standalone precisaram de credencial Postgres
  isolada própria, existia um risco real de vazamento cruzado até isso
  ser corrigido — ver `Log_Progresso_Comercializacao.md`).

**Pode virar texto público**: *"Cada clínica tem banco de dados e número
de WhatsApp isolados — não é uma base compartilhada entre clientes."*
(Já é exatamente a frase usada no roteiro de demo — agora com verificação
por trás.)

## 2. LGPD — rascunho mínimo, não substitui revisão jurídica

- **Dados coletados**: nome, telefone (WhatsApp), conteúdo da conversa,
  dados de agendamento (data/hora/tipo de consulta).
- **Finalidade**: exclusivamente operar o atendimento/agendamento da
  clínica contratante — nunca reaproveitado entre clínicas nem pra
  treinar modelo nenhum.
- **Quem acessa**: equipe da própria clínica (via painel autenticado,
  senha própria por clínica) + Tiago, só pra operação/manutenção técnica.
- **Em aberto, preciso de você**: não existe hoje política de
  retenção/expiração (dados ficam indefinidamente) nem fluxo formal de
  solicitação de exclusão/portabilidade pelo titular (paciente). Pra uma
  clínica nova perguntar "e se um paciente pedir pra apagar os dados
  dele?", ainda não temos resposta operacional pronta — vale decidir
  antes do site prometer conformidade total com LGPD.

## 3. Backup e disaster recovery — gap real, não é só item de checklist de venda

Busquei no repositório inteiro (scripts, migrations, workflows n8n) e
**não encontrei nenhuma rotina de backup do Postgres compartilhado**. A
`DATABASE_URL` aponta pra um IP direto (`72.60.242.51`), não um provedor
gerenciado (tipo Supabase/RDS/Neon, que teriam backup automático por
padrão) — tudo indica Postgres self-hosted num container do Easypanel.

Isso é uma lacuna **independente de venda**: hoje, se esse Postgres tiver
um problema sério (disco corrompido, erro de operação, etc.), não há
garantia nenhuma de recuperação — de nenhuma clínica, incluindo a Dra.
Aline em produção, com pacientes reais.

⚠️ **Preciso confirmar com você**: o Easypanel ou a VPS fazem
snapshot/backup automático do disco por fora da aplicação? Se não, isso
deveria ser resolvido **antes de vender pra um segundo cliente** — não é
prontidão comercial, é risco operacional de hoje. Não vou implementar
nada aqui sem sua confirmação (é infraestrutura de produção rodando
paciente real).

## 4. SLA — texto proposto, honesto

- O que existe de verdade: monitoramento automatizado 3x/dia
  (health-check headless, ver `project_health_check_routine`),
  best-effort, com humano no comando de qualquer intervenção — não é
  monitoramento em tempo real, não é uptime garantido por contrato.
- **Texto sugerido pro site/proposta**: *"Monitoramos a operação da Lumi
  várias vezes ao dia, com alerta automático pra qualquer problema real —
  hoje não oferecemos SLA formal de uptime. Pra clínicas que precisam de
  garantia contratual de disponibilidade, isso é uma conversa à parte."*
- **Não recomendo** prometer um número de SLA (99,9% etc.) antes de
  resolver o item 3 — prometer disponibilidade sem backup garantido é a
  pior combinação possível de se anunciar.

## Resumo — o que pode e o que não pode virar texto público ainda

| Pode afirmar hoje | Não afirmar ainda |
|---|---|
| Isolamento multi-tenant (banco + WhatsApp dedicados) | SLA numérico de uptime |
| Monitoramento ativo várias vezes ao dia | "Backup garantido" (até confirmar item 3) |
| Nunca inventa/confirma sem checar o sistema (comportamento da IA) | Conformidade total com LGPD (falta política de retenção/exclusão) |
