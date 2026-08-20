require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2];
const oldNamePrefix = process.argv[3];
const newName = process.argv[4];

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  const wf = await getRes.json();
  const node = wf.nodes.find((n) => n.type === 'n8n-nodes-base.stickyNote' && n.name.startsWith(oldNamePrefix));
  if (!node) throw new Error('sticky nao encontrada com prefixo ' + oldNamePrefix);
  node.name = newName;

  const payload = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings };
  const putRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    headers: { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!putRes.ok) throw new Error(`PUT falhou: ${putRes.status} ${JSON.stringify(await putRes.json())}`);
  console.log('Renomeado para:', newName);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
