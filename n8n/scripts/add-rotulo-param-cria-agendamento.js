// Adiciona o parametro "rotulo" ao node "Cria Agendamento" -- a Lumi passa
// a escolher, pelo contexto da conversa, um dos rotulos clinicos nativos
// do Simples Dental (separado de "categoria", que so grava em
// eventos_agenda pra analytics interno). Pedido do Tiago 26/08: so os 8
// rotulos clinicos entram na decisao -- "Secretaria IA"/"Link de
// Agendamento"/"Online" ficam de fora.
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node add-rotulo-param-cria-agendamento.js <workflowId>');

const PROMPT_ROTULO =
  'Rótulo do Simples Dental que melhor representa o tipo desta consulta, com base no que foi identificado na conversa. Escolha EXATAMENTE um destes valores, com a mesma grafia: Primeira Consulta, Clínica Geral, Ortodontia, INVISALIGN, HOF, Clareamento, Profilaxia, Urgência. Se não tiver certeza ou a conversa não se encaixar claramente em nenhum, use Clínica Geral. Só para uso interno do sistema de agenda, nunca mencione ao paciente.';

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  const node = wf.nodes.find((n) => n.name === 'Cria Agendamento');
  if (!node) throw new Error('node "Cria Agendamento" não encontrado');

  const parametros = node.parameters.bodyParameters.parameters;
  const jaTem = parametros.find((p) => p.name === 'rotulo');
  if (jaTem) {
    jaTem.value = `={{ $fromAI('rotulo', \`${PROMPT_ROTULO}\`, 'string') }}`;
    console.log('Parâmetro "rotulo" já existia, valor atualizado.');
  } else {
    const indiceCategoria = parametros.findIndex((p) => p.name === 'categoria');
    const novoParametro = { name: 'rotulo', value: `={{ $fromAI('rotulo', \`${PROMPT_ROTULO}\`, 'string') }}` };
    parametros.splice(indiceCategoria + 1, 0, novoParametro);
    console.log('Parâmetro "rotulo" adicionado.');
  }

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
