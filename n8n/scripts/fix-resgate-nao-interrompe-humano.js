// Achado real (24/08): "Busca Funil Parado" não checava se o paciente
// estava com atendimento humano assumido (cliente.bot_disabled = true) --
// um resgate automático podia disparar bem no meio de uma conversa que a
// equipe já estava conduzindo pessoalmente, contradizendo o que a Dra.
// Aline (ou quem estivesse atendendo) tinha acabado de dizer. Corrige
// adicionando a mesma checagem que "Atendimento Humano" no painel usa.
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

  const busca = wf.nodes.find((n) => n.name === 'Busca Funil Parado');
  if (!busca) throw new Error('node esperado nao encontrado');

  if (busca.parameters.query.includes('bot_disabled')) {
    console.log('Ja aplicado -- nada a fazer em', workflowId);
    return;
  }

  busca.parameters.query = busca.parameters.query.replace(
    "WHERE f.status = 'em_andamento'",
    "WHERE f.status = 'em_andamento'\n  AND coalesce(c.bot_disabled, false) = false"
  );

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
