// Achado real (24/08, print da conversa com a Ana Rosito): a mensagem de
// resgate chegou no WhatsApp sem o prefixo "**[Lumi]:**" que toda resposta
// normal da Lumi tem no primeiro bloco (node "Envia Bloco" do workflow
// principal) -- sem isso, quem olha o WhatsApp não sabe se foi a Lumi ou
// um humano que mandou aquilo. O texto salvo no banco (n8n_chat_histories)
// já era limpo, sem prefixo -- mesma convenção da Lumi normal, onde o
// prefixo é só um marcador visual pro WhatsApp, adicionado na hora do
// envio, não no que fica salvo. Fix: adiciona o mesmo prefixo só no node
// que envia de verdade, sem mexer em "Grava Resgate no Histórico".
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2] || 'vUGMz073giDPfGzx';

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  const envia = wf.nodes.find((n) => n.name === 'Envia Resgate');
  if (!envia) throw new Error('node esperado nao encontrado');

  if (envia.parameters.messageText.includes('[Lumi]')) {
    console.log('Ja aplicado -- nada a fazer em', workflowId);
    return;
  }

  envia.parameters.messageText = "={{ '**[Lumi]:** ' + $json.mensagemResgate }}";

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
