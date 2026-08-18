# Painel Administrativo

Painel web para a equipe da clínica acompanhar o que a Lumi está fazendo:
pacientes, pendências que precisam de humano, atendimentos assumidos pela
equipe, e um resumo de analytics (os mesmos números que a Lumi já responde
no WhatsApp pro número master).

Lê do mesmo Postgres que o n8n e o `server.js` já usam -- não mexe em nada
do Simples Dental nem do WhatsApp diretamente. A única escrita que faz é
marcar uma pendência (`agent_actions`) como resolvida.

## Rodando local (pra testar antes de subir)

```bash
cd admin-panel
npm install
cp .env.example .env
# edite o .env: ADMIN_PASSWORD, DATABASE_URL, e PANEL_COOKIE_SECURE=false
# (só localmente, sem https -- em produção deixe "true")
npm start
```

Abre em `http://localhost:3100`.

## Deploy no Easypanel (mesmo padrão do `server.js`)

1. Suba este repositório no GitHub, se ainda não tiver feito (já deve estar
   feito, já que o resto do projeto está lá).
2. No Easypanel, crie um **novo serviço**, conectado ao mesmo repositório
   GitHub -- mas aponte o **diretório de build/contexto para `admin-panel/`**
   (é um serviço separado do `server.js`, com seu próprio `Dockerfile`).
3. Nas variáveis de ambiente do serviço, configure:

| Nome | Valor |
|---|---|
| `ADMIN_PASSWORD` | uma senha forte, só a equipe deve saber |
| `DATABASE_URL` | a mesma URL de Postgres que o n8n/`server.js` já usam |
| `DATABASE_SSL` | `true` (ou `false` se o Postgres não usar TLS) |
| `PORT` | `3100` |
| `PANEL_COOKIE_SECURE` | `true` (o Easypanel já serve com HTTPS) |

4. **Diferente do `server.js`**: este serviço PRECISA de um domínio público
   (é a página que a secretária vai acessar do navegador). Ative o domínio
   nas configurações do serviço, com HTTPS.
5. Deploy. Teste abrindo o domínio, entrando com a senha configurada.

## O que cada seção mostra

- **Visão Geral** -- os mesmos números do resumo operacional (consultas
  criadas/confirmadas/canceladas/remarcadas, lembretes enviados, novos
  pacientes, mensagens trocadas), com filtro de período.
- **Atendimento Humano** -- pacientes com a Lumi pausada (a equipe assumiu a
  conversa). Mostra há quanto tempo está parado -- a Lumi volta sozinha
  depois de 6h sem mensagem da equipe (workflow `retorno-automatico`), então
  algo "vermelho" aqui por muito tempo pode indicar que esse workflow não
  está ativo no n8n.
- **Pendências** -- tudo que a Lumi encaminhou pra equipe (`agent_actions`
  sem `resolved_at`). Urgências aparecem primeiro. Botão "Marcar concluída"
  grava `resolved_at`, `status = 'resolvido'` e `assigned_to`.
- **Pacientes** -- diretório de quem já falou com a Lumi, com busca por nome
  ou telefone.

## Segurança

- Login único (uma senha só, via `ADMIN_PASSWORD`) -- não tem cadastro de
  usuário nem recuperação de senha. Pra trocar a senha, muda a variável de
  ambiente e reinicia o serviço.
- Sessão fica em memória do processo -- reiniciar o serviço desloga todo
  mundo (aceitável pra esse uso).
- Cookie de sessão é `HttpOnly` (não acessível via JavaScript) e, com
  `PANEL_COOKIE_SECURE=true`, só trafega em HTTPS.
- Não expõe nada do `DATABASE_URL`, credenciais ou detalhes técnicos pro
  navegador -- só os dados já formatados pelas rotas `/api/*`.
