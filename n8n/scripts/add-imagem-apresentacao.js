require('dotenv').config({ path: __dirname + '/../.env' });
const fs = require('fs');

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node add-imagem-apresentacao.js <workflowId>');

const LOGO_PATH = __dirname + '/../../admin-panel/public/assets/logo-lumi.png';
const CAPTION =
  '**[Lumi]:** Olá! 🤎 Sou a Lumi✨, concierge digital da Dra. Aline Bentivegna. Será um prazer te atender por aqui — espero que sua experiência seja excelente! 😊';

async function main() {
  const logoBase64 = fs.readFileSync(LOGO_PATH).toString('base64');

  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  const nodeSend = wf.nodes.find((n) => n.name === 'Envia Apresentação Padrão');
  if (!nodeSend) throw new Error('node "Envia Apresentação Padrão" nao encontrado');

  nodeSend.parameters = {
    resource: 'messages-api',
    operation: 'send-image',
    instanceName: "={{ $('Restaurar Campos').first().json.Instance }}",
    remoteJid: "={{ $('Restaurar Campos').first().json.From }}",
    media: logoBase64,
    caption: '=' + CAPTION,
    options_message: {},
  };

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
