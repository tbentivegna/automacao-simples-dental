// Cria o sub-workflow "Lumi - Envia Blocos".
//
// Contexto: o node da community `n8n-nodes-evolution-api` SÓ processa o
// primeiro item da entrada. Enquanto existia o "Loop Blocos" (Split In
// Batches) alimentando um bloco por vez, isso ficava mascarado. Quando o
// "Loop Blocos" foi removido (fix do reuso, 24/08), toda resposta da Lumi
// com 2+ paragrafos passou a ser cortada no 1o bloco no WhatsApp (o texto
// completo continua certo no painel, que le de n8n_chat_histories).
//
// Fix: em vez de confiar que o node Evolution itera, o fluxo principal
// passa a chamar ESTE sub-workflow uma vez por bloco (Execute Workflow em
// modo "run once for each item", waitForSubWorkflow=true). Cada bloco vira
// uma execucao NOVA do sub-workflow -> o node Evolution sempre recebe
// exatamente 1 item (o caminho comprovadamente bom), e re-entrancia deixa
// de ser possivel por construcao (sem node com estado, ao contrario do
// Split In Batches).
//
// A chamada de envio em si (mesmos 2 nodes Evolution, mesma credential
// iBL2zZpK6dtnKlWK) NAO muda -- muda so quantas vezes ela e invocada.
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const EVOLUTION_CRED = { evolutionApi: { id: 'iBL2zZpK6dtnKlWK', name: 'Evolution account' } };

const nodes = [
  {
    parameters: { inputSource: 'passthrough' },
    type: 'n8n-nodes-base.executeWorkflowTrigger',
    typeVersion: 1.1,
    position: [0, 0],
    id: 'recebe-bloco-trigger',
    name: 'Recebe Bloco',
  },
  {
    parameters: {
      resource: 'chat-api',
      operation: 'send-presence',
      instanceName: '={{ $json.instanceName }}',
      remoteJid: '={{ $json.remoteJid }}',
      delay: '={{ $json.presenceDelay }}',
    },
    type: 'n8n-nodes-evolution-api.evolutionApi',
    typeVersion: 1,
    position: [220, 0],
    id: 'sub-presenca-bloco',
    name: 'Presença Bloco',
    credentials: EVOLUTION_CRED,
  },
  {
    parameters: {
      resource: 'messages-api',
      instanceName: "={{ $('Recebe Bloco').item.json.instanceName }}",
      remoteJid: "={{ $('Recebe Bloco').item.json.remoteJid }}",
      messageText: "={{ $('Recebe Bloco').item.json.messageText }}",
      options_message: { delay: 0, linkPreview: true },
    },
    type: 'n8n-nodes-evolution-api.evolutionApi',
    typeVersion: 1,
    position: [440, 0],
    id: 'sub-envia-bloco',
    name: 'Envia Bloco',
    credentials: EVOLUTION_CRED,
  },
  {
    parameters: {
      content:
        '## Lumi - Envia Blocos\nChamado pelo fluxo principal (Lumi / Lumi - DEV) UMA VEZ POR BLOCO,\nem modo "run once for each item" + waitForSubWorkflow.\n\nPor que existe: o node `n8n-nodes-evolution-api` so processa o 1o item\nda entrada. Rodando 1 bloco por execucao, ele sempre recebe 1 item so\n(caminho bom) e nao tem estado pra quebrar em re-entrancia.\n\nEntrada esperada (1 item): { instanceName, remoteJid, messageText, presenceDelay }\nmessageText ja vem com o prefixo **[Lumi]:** no bloco 0 (montado no\n"Divide Mensagem em Blocos" do fluxo principal).',
      height: 320,
      width: 520,
      color: 4,
    },
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [-40, -360],
    id: 'sub-sticky-doc',
    name: 'Sticky Doc',
  },
];

const connections = {
  'Recebe Bloco': { main: [[{ node: 'Presença Bloco', type: 'main', index: 0 }]] },
  'Presença Bloco': { main: [[{ node: 'Envia Bloco', type: 'main', index: 0 }]] },
};

async function main() {
  // idempotencia: se ja existe um workflow com esse nome, so reporta o id.
  const list = await (
    await fetch(`${BASE_URL}/api/v1/workflows?limit=250`, { headers: { 'X-N8N-API-KEY': API_KEY } })
  ).json();
  const existing = (list.data || []).find((w) => w.name === 'Lumi - Envia Blocos');
  if (existing) {
    console.log('Ja existe: id =', existing.id, '(nao recriado)');
    return;
  }
  const payload = {
    name: 'Lumi - Envia Blocos',
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
  console.log('Criado "Lumi - Envia Blocos" | id =', body.id, '| active =', body.active);
  console.log('>>> use esse id no fix-envio-blocos-multiplos.js');
}

main().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
