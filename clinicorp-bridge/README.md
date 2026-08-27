# clinicorp-bridge

Ponte de automação equivalente ao `server.js` da raiz (que fala com Simples Dental via Playwright), mas para clínicas que usam **Clinicorp** — via API REST real, sem robô de navegador. Expõe o **mesmo contrato HTTP** (mesmas 6 rotas, mesmos nomes de campo, mesmo formato de resposta) — o workflow n8n "Lumi" e o painel admin funcionam sem nenhuma mudança, só apontando `BRIDGE_URL`/`BRIDGE_API_KEY` pra este serviço em vez do da raiz.

Plano completo de implementação: ver o plano usado pra construir isto (`Integração com Clinicorp`), que cobre a decisão de arquitetura, a tabela de mapeamento rota-a-rota, e a ordem de fases.

## Status: Fase 0-1 concluídas, Fase 2 bloqueada em credencial real

- **Fase 0** (esqueleto): ✅ as 6 rotas existem, autenticação por `X-Bridge-Key` funcionando, `/health` ok.
- **Fase 1** (tradução pura): ✅ `translate.js` com funções puras + `translate.selfcheck.js` passando contra fixtures da documentação (`node clinicorp-bridge/translate.selfcheck.js`).
- **Fase 2** (verificação com conta real): ❌ **não iniciada** — nenhuma chamada real foi feita contra o Clinicorp ainda. Tudo abaixo vem só da documentação Swagger pública (https://sistema.clinicorp.com/api-docs/, lida em 2026-08-27), nunca de uma resposta real.

## O que precisa ser verificado antes de considerar isto pronto pra produção

Mesma disciplina já seguida no resto do projeto: nunca supor formato de resposta de sistema externo sem testar. Nesta ordem de prioridade:

1. **`GET /appointment/get_avaliable_days` já exclui horário ocupado, ou é só grade fixa de expediente?** Determina se `/verificar-disponibilidade` precisa de uma segunda chamada cruzando com `GET /appointment/list`. Sem isso confirmado, a Lumi pode oferecer horário que já está ocupado.
2. **Formato real de `GET /patient/get` e `POST /patient/create`.** Bloqueia `/criar-agendamento` e `/buscar-agendamentos-paciente` inteiros — o código em `clinicorp-client.js` reflete só o schema documentado, nunca foi chamado de verdade.
3. **Relação entre `subscriber_id`/`code_link` (exigidos em todo endpoint) e as credenciais de Basic Auth** (usuário = "ID de acesso ao Sistema", senha = "Token API"). Podem ser redundantes ou genuinamente separados — confirmar antes de assumir qualquer coisa.
4. **`POST /appointment/create_appointment_by_api` aceita criar paciente novo inline**, ou `Patient_PersonId` sempre tem que vir resolvido antes via `patient/get`+`patient/create`?
5. **Remarcação** (`/remarcar-agendamento`) — devolve `501` de propósito. Não existe endpoint dedicado no Clinicorp; a única forma encontrada é cancelar + criar de novo, que tem um modo de falha que o Simples Dental nunca teve (se criar falhar depois do cancelamento ter tido sucesso, o paciente fica sem consulta nenhuma). Precisa de desenho cuidadoso (rollback? nova tentativa? aviso?) e teste real antes de implementar — não implementar apressado só pra "fechar a lista".

## Como testar quando houver credencial (conta de teste ou clínica-piloto)

1. Preencher `.env` a partir de `.env.example`.
2. `npm install && node server.js`.
3. Testar cada rota isoladamente com `curl`, na ordem da lista acima, ANTES de plugar num workflow n8n de verdade.
4. Corrigir `clinicorp-client.js`/`translate.js`/`server.js` com os formatos reais confirmados — remover os comentários "NÃO VERIFICADO" conforme cada item for confirmado.
5. Só depois disso, seguir o processo normal de onboarding (`Checklist_Onboarding_Nova_Clinica.md`, seção 3 — teste supervisionado 24-48h) com a clínica-piloto.

## O que é reaproveitado do `server.js` da raiz (sem mudança de comportamento)

- `db.js` — mesmas funções (`registrarEventoAgenda`, `abrirOuAtualizarFunil`, `fecharFunil`, `salvarTelefoneAgendamento`), mesmo schema Postgres. O painel admin (Analytics, Oportunidades/funil de resgate) funciona pra uma clínica Clinicorp sem saber a diferença.
- `tempo.js` — helpers de data/fuso puros. **Não** portado: a lógica de sábado quinzenal (`ehSabadoAberto`/`SABADO_DATA_REFERENCIA`), específica de uma limitação do Simples Dental que o Clinicorp não deveria ter (a confirmar).
- Middleware de autenticação `X-Bridge-Key` — idêntico.
