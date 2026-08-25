// Adiciona o header X-Bridge-Key em nós httpRequestTool que chamam o
// servico de automacao (server.js na raiz do repo) -- necessario porque
// esse servico ganhou autenticacao por chave compartilhada (antes nao
// tinha nenhuma). Idempotente: se o header ja existir, so atualiza o
// valor em vez de duplicar.
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;

const workflowId = process.argv[2];
const chaveBridge = process.argv[3];
const nomesNos = process.argv.slice(4);

if (!workflowId || !chaveBridge || nomesNos.length === 0) {
  throw new Error('uso: node add-bridge-api-key-header.js <workflowId> <chaveBridge> <nomeDoNo1> [nomeDoNo2...]');
}

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  const encontrados = [];
  const naoEncontrados = [];

  for (const nome of nomesNos) {
    const node = wf.nodes.find(
      (n) => n.name === nome && (n.type === 'n8n-nodes-base.httpRequestTool' || n.type === 'n8n-nodes-base.httpRequest')
    );
    if (!node) {
      naoEncontrados.push(nome);
      continue;
    }
    node.parameters.sendHeaders = true;
    const parametrosAtuais = (node.parameters.headerParameters && node.parameters.headerParameters.parameters) || [];
    const semChaveAntiga = parametrosAtuais.filter((p) => p.name !== 'X-Bridge-Key');
    node.parameters.headerParameters = {
      parameters: [...semChaveAntiga, { name: 'X-Bridge-Key', value: chaveBridge }],
    };
    encontrados.push(nome);
  }

  if (naoEncontrados.length) {
    throw new Error(`Nos nao encontrados (ou nao sao httpRequestTool): ${naoEncontrados.join(', ')}`);
  }

  const payload = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings };
  const putRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    headers: { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await putRes.json();
  if (!putRes.ok) throw new Error(`PUT falhou: ${putRes.status} ${JSON.stringify(body)}`);
  console.log('Header X-Bridge-Key aplicado em', workflowId, '->', encontrados.join(', '), '| active=', body.active);
}

main().catch((err) => {
  console.error('ERRO:', err.message);
  process.exit(1);
});
