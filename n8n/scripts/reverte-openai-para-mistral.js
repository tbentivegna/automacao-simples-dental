// Reverte a troca feita por troca-mistral-por-openai.js -- volta pro
// "Mistral Cloud Chat Model" (devstral-latest). Motivo: teste ao vivo em
// DEV (03/09) mostrou o GPT-5.4-mini chamando a ferramenta ERRADA
// (Confirmar Agendamento em vez de Cria Agendamento) pra uma consulta
// nova, e inventando um ID de agendamento falso (usando o próprio ID
// interno da tool_call como se fosse idAgendamento) mesmo com a
// descrição da ferramenta explicitamente proibindo isso. Mais grave que
// o problema de rate limit que motivou a troca -- Mistral nunca cometeu
// esse tipo de erro nos testes extensos desta sessão. Decisão: manter
// Mistral, resolver rate limit ativando cobrança na própria conta
// Mistral (mais simples, sem trocar de fornecedor).
//
// uso: node n8n/scripts/reverte-openai-para-mistral.js <workflowId>
require('dotenv').config({ path: __dirname + '/../.env' });
const crypto = require('crypto');
const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node reverte-openai-para-mistral.js <workflowId>');

const CREDENCIAL_MISTRAL = { id: 'emf0jzIsQDlstJwo', name: 'Mistral Cloud account' };
const NOME_NODE_OPENAI = 'OpenAI Chat Model';
const NOME_NODE_MISTRAL = 'Mistral Cloud Chat Model';

async function main() {
  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, { headers: H })).json();
  if (!wf.nodes) throw new Error('GET falhou: ' + JSON.stringify(wf));
  if (wf.active && wf.versionId !== wf.activeVersionId) throw new Error('draft != ativo -- roda realinha-draft.js antes');

  if (wf.nodes.some((n) => n.name === NOME_NODE_MISTRAL)) {
    console.log('ja esta na Mistral -- nada a fazer');
    return;
  }

  const openai = wf.nodes.find((n) => n.name === NOME_NODE_OPENAI);
  if (!openai) throw new Error(`node "${NOME_NODE_OPENAI}" nao encontrado`);

  const conexoesOpenai = wf.connections[NOME_NODE_OPENAI];
  if (!conexoesOpenai) throw new Error(`sem conexoes de saida pro node "${NOME_NODE_OPENAI}" -- CONFERIR`);

  const mistralNode = {
    parameters: { model: 'devstral-latest', options: { temperature: 0.1, maxRetries: 2 } },
    type: '@n8n/n8n-nodes-langchain.lmChatMistralCloud',
    typeVersion: 1,
    position: openai.position,
    id: 'mistral-cloud-chat-model-' + crypto.randomUUID().slice(0, 8),
    name: NOME_NODE_MISTRAL,
    retryOnFail: true,
    notesInFlow: true,
    credentials: { mistralCloudApi: CREDENCIAL_MISTRAL },
  };

  wf.nodes = wf.nodes.filter((n) => n.name !== NOME_NODE_OPENAI);
  wf.nodes.push(mistralNode);

  wf.connections[NOME_NODE_MISTRAL] = conexoesOpenai;
  delete wf.connections[NOME_NODE_OPENAI];

  // Remove a sticky da troca (não faz mais sentido documentar uma troca revertida)
  wf.nodes = wf.nodes.filter((n) => n.name !== 'Sticky Troca OpenAI 03/09');

  const put = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings }),
  });
  const pb = await put.json();
  if (!put.ok) throw new Error(`PUT falhou: ${put.status} ${JSON.stringify(pb)}`);

  if (wf.active) {
    const act = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}/activate`, { method: 'POST', headers: H });
    console.log('activate:', act.status);
  }

  await new Promise((r) => setTimeout(r, 1500));
  const verificacao = await (await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, { headers: H })).json();
  const temMistral = verificacao.nodes.some((n) => n.name === NOME_NODE_MISTRAL && n.credentials?.mistralCloudApi?.id === CREDENCIAL_MISTRAL.id);
  const semOpenai = !verificacao.nodes.some((n) => n.name === NOME_NODE_OPENAI);
  console.log(`PUT ${put.status} | tem Mistral=${temMistral} | sem OpenAI=${semOpenai} | active=${verificacao.active}`);
  if (!temMistral || !semOpenai) throw new Error('verificacao FALHOU -- conferir na UI');
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
