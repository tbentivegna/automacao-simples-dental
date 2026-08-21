// Trava o funil de resgate pra so rodar em horario comercial (8h-18h,
// horario de Brasilia) -- sem isso, um paciente podia receber a mensagem de
// resgate de madrugada. A checagem fica dentro da propria query: fora do
// horario, a query simplesmente nao retorna nada nessa execucao -- a
// tentativa continua em_andamento e e pega na proxima execucao que cair
// dentro da janela, entao nada se perde, so atrasa.
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2] || 'vUGMz073giDPfGzx';

const CONDICAO_HORARIO =
  "  AND extract(hour from now() AT TIME ZONE 'America/Sao_Paulo') >= 8\n  AND extract(hour from now() AT TIME ZONE 'America/Sao_Paulo') < 18\n";

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  const node = wf.nodes.find((n) => n.name === 'Busca Funil Parado');
  if (!node) throw new Error('node "Busca Funil Parado" nao encontrado');

  if (node.parameters.query.includes('America/Sao_Paulo')) {
    console.log('ja aplicado, pulando');
    return;
  }

  const marcador = "AND NOT EXISTS (";
  if (!node.parameters.query.includes(marcador)) {
    throw new Error('query atual nao tem o formato esperado -- prompt/query pode ja ter mudado, abortando');
  }
  node.parameters.query = node.parameters.query.replace(marcador, CONDICAO_HORARIO + '  ' + marcador);

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
