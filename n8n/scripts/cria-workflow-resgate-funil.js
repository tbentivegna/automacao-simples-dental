// Cria o workflow "Lumi - Resgate de Funil": roda a cada 30 min, acha
// tentativas de agendamento (funil_agendamento) paradas há mais de 6h desde
// que a Lumi mostrou horários, sem resposta do paciente depois disso e sem
// resgate já enviado -- manda UMA mensagem fixa de resgate, loga no
// historico (aparece no painel) e marca a tentativa como resgate_enviado
// (trava permanente -- nunca reenvia pra essa mesma tentativa). Uma
// tentativa nova, no futuro, é elegível de novo.
//
// Criado INATIVO de propósito -- ativar só depois de testar manualmente
// (ver n8n/scripts/testa-resgate-funil.js).
require('dotenv').config({ path: __dirname + '/../.env' });
const crypto = require('crypto');

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const CRED_POSTGRES = { id: 'IM7As7mjQcGJIzzy', name: 'Postgres account' };
const CRED_EVOLUTION = { id: 'iBL2zZpK6dtnKlWK', name: 'Evolution account' };

const HORAS_SILENCIO = 6;
const HORAS_EXPIRACAO = 48;

function id() {
  return crypto.randomUUID();
}

const nodes = [
  {
    parameters: {
      rule: { interval: [{ field: 'minutes', minutesInterval: 30 }] },
    },
    type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.2,
    position: [0, 0],
    id: id(),
    name: 'A cada 30 min',
  },
  {
    parameters: {
      operation: 'executeQuery',
      query: `SELECT
  f.id,
  f.telefone,
  f.instancia,
  coalesce(c.nome, c.apelido_whatsapp) AS nome
FROM public.funil_agendamento f
LEFT JOIN public.cliente c ON c.telefone = f.telefone
WHERE f.status = 'em_andamento'
  AND f.resgate_enviado_em IS NULL
  AND f.ultima_interacao_em < now() - interval '${HORAS_SILENCIO} hours'
  AND NOT EXISTS (
    SELECT 1 FROM public.n8n_chat_histories h
    WHERE h.session_id = f.telefone
      AND h.message->>'type' = 'human'
      AND h.created_at > f.ultima_interacao_em
  );`,
      options: {},
    },
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.6,
    position: [260, -120],
    id: id(),
    name: 'Busca Funil Parado',
    credentials: { postgres: CRED_POSTGRES },
  },
  {
    parameters: {
      jsCode: `const nome = $json.nome;
const saudacao = nome ? \`Oi, \${nome}!\` : 'Oi!';
const mensagem = \`\${saudacao} 🤎 Vi que ficamos de combinar um horário pra sua consulta com a Dra. Aline e a conversa parou por aqui. Ainda tem interesse? Responde um "sim" que eu já retomo com os horários 😊\`;
return { ...$json, mensagemResgate: mensagem };`,
    },
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [520, -120],
    id: id(),
    name: 'Monta Mensagem Resgate',
  },
  {
    parameters: {
      resource: 'messages-api',
      instanceName: '={{ $json.instancia }}',
      remoteJid: '={{ $json.telefone }}',
      messageText: '={{ $json.mensagemResgate }}',
      options_message: { delay: 1200 },
    },
    type: 'n8n-nodes-evolution-api.evolutionApi',
    typeVersion: 1,
    position: [780, -120],
    id: id(),
    name: 'Envia Resgate',
    credentials: { evolutionApi: CRED_EVOLUTION },
  },
  {
    parameters: {
      operation: 'executeQuery',
      query: "INSERT INTO public.n8n_chat_histories (session_id, message)\nVALUES ('{{ $json.telefone }}', $1::jsonb);",
      options: {
        queryReplacement:
          "={{ JSON.stringify({ type: 'ai', content: $json.mensagemResgate, tool_calls: [], additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [] }) }}",
      },
    },
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.6,
    position: [1040, -120],
    id: id(),
    name: 'Grava Resgate no Histórico',
    credentials: { postgres: CRED_POSTGRES },
  },
  {
    parameters: {
      operation: 'executeQuery',
      query: "UPDATE public.funil_agendamento\nSET status = 'resgate_enviado', resgate_enviado_em = now()\nWHERE id = {{ $json.id }};",
      options: {},
    },
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.6,
    position: [1300, -120],
    id: id(),
    name: 'Marca Resgate Enviado',
    credentials: { postgres: CRED_POSTGRES },
  },
  {
    parameters: {
      operation: 'executeQuery',
      query: `UPDATE public.funil_agendamento
SET status = 'expirado'
WHERE status = 'resgate_enviado'
  AND resgate_enviado_em < now() - interval '${HORAS_EXPIRACAO} hours';`,
      options: {},
    },
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.6,
    position: [260, 120],
    id: id(),
    name: 'Expira Resgates Antigos',
    credentials: { postgres: CRED_POSTGRES },
  },
  {
    parameters: {
      content:
        '🔴 CLAUDE (21/08): workflow novo -- funil de resgate de agendamento. Acha tentativas paradas há 6h+ desde que a Lumi mostrou horários (sem resposta do paciente depois disso), manda UMA mensagem fixa de resgate e trava (resgate_enviado_em) pra nunca reenviar na mesma tentativa. Uma tentativa nova no futuro é elegível de novo. Criado inativo -- testar antes de ativar.',
      height: 260,
      width: 360,
      color: 3,
    },
    type: 'n8n-nodes-base.stickyNote',
    position: [0, -420],
    typeVersion: 1,
    id: id(),
    name: 'Sticky Note - Claude ' + Date.now(),
  },
];

const connections = {
  'A cada 30 min': {
    main: [
      [
        { node: 'Busca Funil Parado', type: 'main', index: 0 },
        { node: 'Expira Resgates Antigos', type: 'main', index: 0 },
      ],
    ],
  },
  'Busca Funil Parado': { main: [[{ node: 'Monta Mensagem Resgate', type: 'main', index: 0 }]] },
  'Monta Mensagem Resgate': { main: [[{ node: 'Envia Resgate', type: 'main', index: 0 }]] },
  'Envia Resgate': { main: [[{ node: 'Grava Resgate no Histórico', type: 'main', index: 0 }]] },
  'Grava Resgate no Histórico': { main: [[{ node: 'Marca Resgate Enviado', type: 'main', index: 0 }]] },
};

async function main() {
  const payload = {
    name: 'Lumi - Resgate de Funil',
    nodes,
    connections,
    settings: { executionOrder: 'v1' },
  };
  const res = await fetch(`${BASE_URL}/api/v1/workflows`, {
    method: 'POST',
    headers: { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`POST falhou: ${res.status} ${JSON.stringify(body)}`);
  console.log('Criado com sucesso. id =', body.id, '| active =', body.active);
}

main().catch((err) => {
  console.error('ERRO:', err.message);
  process.exit(1);
});
