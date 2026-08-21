// Funil de resgate de agendamento: pra abrir uma tentativa em
// funil_agendamento no server.js, ele precisa saber DE QUEM é a consulta de
// disponibilidade -- hoje a tool "Verifica Disponibilidade" só manda
// diaSemana/periodo (nenhum dado de identificação). Adiciona telefone e
// instancia como parametros fixos (nao preenchidos pela IA, iguais ao
// padrao ja usado em "Cria Agendamento" pra telefone).
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node add-telefone-verifica-disponibilidade.js <workflowId>');

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  const node = wf.nodes.find((n) => n.name === 'Verifica Disponibilidade');
  if (!node) throw new Error('node "Verifica Disponibilidade" nao encontrado');

  const params = node.parameters.bodyParameters.parameters;
  if (params.some((p) => p.name === 'telefone')) {
    console.log('ja aplicado, pulando');
    return;
  }

  params.push(
    { name: 'telefone', value: "={{ $('CREATE & SELECT cliente').first().json.telefone }}" },
    { name: 'instancia', value: "={{ $('Restaurar Campos').first().json.Instance }}" }
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
