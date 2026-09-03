// "Lumi - Standalone" (9PsUjET74L2NblWv, inativo) ganhou webhookId novo
// (UUID aleatório) na clonagem de PROD -- a pedido do Tiago, troca pro
// MESMO path que "Lumi - DEV" (yFSw0JMMD93EGZMa, ativo) já usa. Assim, a
// instância Tiago/DEV do Evolution API (já configurada apontando pra
// esse webhook) não precisa de nenhuma reconfiguração pra testar
// standalone -- só ativar o workflow que quiser no n8n de cada vez.
//
// Trade-off aceito deliberadamente: só um dos dois workflows pode ficar
// ATIVO por vez (n8n não deixa dois workflows ativos reivindicando o
// mesmo path de webhook simultaneamente) -- tudo bem pra teste manual,
// nunca se testa os dois ao mesmo tempo mesmo.
//
// uso: node n8n/scripts/reponta-standalone-webhook-dev.js
require('dotenv').config({ path: __dirname + '/../.env' });
const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };

const WORKFLOW_STANDALONE = '9PsUjET74L2NblWv';
const WORKFLOW_DEV = 'yFSw0JMMD93EGZMa';

async function main() {
  const wfDev = await (await fetch(`${BASE_URL}/api/v1/workflows/${WORKFLOW_DEV}`, { headers: H })).json();
  const webhookDev = wfDev.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  const pathDev = webhookDev.webhookId;

  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${WORKFLOW_STANDALONE}`, { headers: H })).json();
  if (wf.active) throw new Error('SEGURANÇA: Lumi - Standalone está ATIVO -- esperava inativo antes dessa troca.');

  const webhook = wf.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  if (webhook.webhookId === pathDev) {
    console.log('já está apontado pro mesmo webhook do DEV -- nada a fazer');
    return;
  }
  webhook.parameters.path = pathDev;
  webhook.webhookId = pathDev;

  const put = await fetch(`${BASE_URL}/api/v1/workflows/${WORKFLOW_STANDALONE}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings }),
  });
  const pb = await put.json();
  if (!put.ok) throw new Error(`PUT falhou: ${put.status} ${JSON.stringify(pb)}`);
  console.log(`PUT ${put.status} | webhook agora é ${pathDev} (mesmo do DEV)`);
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
