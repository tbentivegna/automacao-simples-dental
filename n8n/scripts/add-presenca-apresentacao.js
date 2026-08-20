require('dotenv').config({ path: __dirname + '/../.env' });
const crypto = require('crypto');

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node add-presenca-apresentacao.js <workflowId>');

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  const nodeSend = wf.nodes.find((n) => n.name === 'Envia Apresentação Padrão');
  if (!nodeSend) throw new Error('node "Envia Apresentação Padrão" nao encontrado -- rode add-se-apresentou.js primeiro');

  if (wf.nodes.find((n) => n.name === 'Presença Apresentação')) {
    console.log('ja aplicado, pulando');
    return;
  }

  // adiciona o prefixo "**[Lumi]:** " igual ao que "Envia Bloco" usa no primeiro bloco de qualquer resposta da Lumi
  if (!nodeSend.parameters.messageText.includes('**[Lumi]:**')) {
    nodeSend.parameters.messageText = nodeSend.parameters.messageText.replace(/^=/, '=**[Lumi]:** ');
  }

  const idPresenca = crypto.randomUUID();
  const nodePresenca = {
    parameters: {
      resource: 'chat-api',
      operation: 'send-presence',
      instanceName: "={{ $('Restaurar Campos').first().json.Instance }}",
      remoteJid: "={{ $('Restaurar Campos').first().json.From }}",
      delay: 4000,
    },
    type: 'n8n-nodes-evolution-api.evolutionApi',
    typeVersion: 1,
    position: [nodeSend.position[0] - 140, nodeSend.position[1]],
    id: idPresenca,
    name: 'Presença Apresentação',
    credentials: { evolutionApi: { id: 'iBL2zZpK6dtnKlWK', name: 'Evolution account' } },
  };
  wf.nodes.push(nodePresenca);

  // rewire: Já se apresentou? (branch false) -> Presença Apresentação -> Envia Apresentação Padrão -> Marca Apresentado
  const conns = wf.connections;
  const ifConn = conns['Já se apresentou?'];
  if (!ifConn || !ifConn.main || !ifConn.main[1]) throw new Error('conexao de "Já se apresentou?" nao esta no formato esperado');
  ifConn.main[1] = [{ node: 'Presença Apresentação', type: 'main', index: 0 }];
  conns['Presença Apresentação'] = { main: [[{ node: 'Envia Apresentação Padrão', type: 'main', index: 0 }]] };
  // conns['Envia Apresentação Padrão'] -> Marca Apresentado ja existe, mantem

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

main().catch((err) => { console.error('ERRO:', err.message); process.exit(1); });
