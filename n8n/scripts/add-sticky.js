require('dotenv').config({ path: __dirname + '/../.env' });
const crypto = require('crypto');

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;

const workflowId = process.argv[2];
const content = process.argv[3];
const [x, y] = process.argv[4].split(',').map(Number);
const color = process.argv[5] ? Number(process.argv[5]) : undefined;
const width = process.argv[6] ? Number(process.argv[6]) : 300;
const height = process.argv[7] ? Number(process.argv[7]) : 160;

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  const stickyNode = {
    parameters: { content, height, width, ...(color ? { color } : {}) },
    type: 'n8n-nodes-base.stickyNote',
    position: [x, y],
    typeVersion: 1,
    id: crypto.randomUUID(),
    name: 'Sticky Note - Claude ' + Date.now(),
  };

  wf.nodes.push(stickyNode);

  const payload = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings };

  const putRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    headers: { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await putRes.json();
  if (!putRes.ok) throw new Error(`PUT falhou: ${putRes.status} ${JSON.stringify(body)}`);
  console.log('Sticky adicionado:', stickyNode.name, 'em', x, y, 'color', color);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
