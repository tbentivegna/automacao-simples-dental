// A apresentacao (imagem + legenda) e enviada direto pela Evolution API, fora
// do fluxo do AI Agent/memoria -- por isso nunca aparecia no painel (que so
// le n8n_chat_histories). Este node grava a mesma mensagem la, no mesmo
// formato que o resto do historico usa pra mensagens da Lumi.
require('dotenv').config({ path: __dirname + '/../.env' });
const crypto = require('crypto');

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node add-log-apresentacao.js <workflowId>');

const MENSAGEM_FIXA =
  'Olá! 🤎 Sou a Lumi✨, concierge digital da Dra. Aline Bentivegna. Será um prazer te atender por aqui — espero que sua experiência seja excelente! 😊';

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  if (wf.nodes.find((n) => n.name === 'Grava Apresentação')) {
    console.log('ja aplicado, pulando');
    return;
  }

  const nodeSend = wf.nodes.find((n) => n.name === 'Envia Apresentação Padrão');
  const nodeMarca = wf.nodes.find((n) => n.name === 'Marca Apresentado');
  if (!nodeSend || !nodeMarca) throw new Error('nos esperados nao encontrados');

  const idNode = crypto.randomUUID();
  const idSticky = crypto.randomUUID();

  const nodeGrava = {
    parameters: {
      operation: 'executeQuery',
      query: "INSERT INTO public.n8n_chat_histories (session_id, message)\nVALUES ('{{ $('Restaurar Campos').first().json.From }}', $1::jsonb);",
      options: {
        queryReplacement:
          "={{ JSON.stringify({ type: 'ai', content: " + JSON.stringify(MENSAGEM_FIXA) + ", tool_calls: [], additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [] }) }}",
      },
    },
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.6,
    position: [nodeSend.position[0] + 160, nodeSend.position[1] + 160],
    id: idNode,
    name: 'Grava Apresentação',
    credentials: { postgres: { id: 'IM7As7mjQcGJIzzy', name: 'Postgres account' } },
  };

  const sticky = {
    parameters: {
      content:
        '🔴 CLAUDE (21/08): node novo -- Grava Apresentação. Envia Apresentação Padrão fala direto com a Evolution API (fora do AI Agent/memoria), entao a mensagem nunca ia parar em n8n_chat_histories e sumia do painel. Este node grava a mesma legenda no historico logo depois do envio. Pode apagar esta nota.',
      height: 220,
      width: 340,
      color: 3,
    },
    type: 'n8n-nodes-base.stickyNote',
    position: [nodeSend.position[0] + 100, nodeSend.position[1] - 220],
    typeVersion: 1,
    id: idSticky,
    name: 'Sticky Note - Claude ' + Date.now(),
  };

  wf.nodes.push(nodeGrava, sticky);

  // rewire: Envia Apresentação Padrão -> Grava Apresentação -> Marca Apresentado
  wf.connections['Envia Apresentação Padrão'] = { main: [[{ node: 'Grava Apresentação', type: 'main', index: 0 }]] };
  wf.connections['Grava Apresentação'] = { main: [[{ node: 'Marca Apresentado', type: 'main', index: 0 }]] };

  const payload = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings };
  const putRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    headers: { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await putRes.json();
  if (!putRes.ok) throw new Error(`PUT falhou: ${putRes.status} ${JSON.stringify(body)}`);
  console.log('Aplicado com sucesso em', workflowId, '| active=', body.active);
}

main().catch((err) => {
  console.error('ERRO:', err.message);
  process.exit(1);
});
