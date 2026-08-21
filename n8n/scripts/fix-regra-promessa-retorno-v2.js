// v1 (add-regra-promessa-retorno.js) rodou no harness e só funcionou 0/3 das
// vezes em que a Lumi de fato prometeu retorno na mesma mensagem -- regra
// fraca demais, enterrada entre outras. v2: reescreve o paragrafo com
// gatilhos textuais explicitos ("vou verificar", "te retorno" etc.) e
// reforça a mesma regra na seção REGRA FUNDAMENTAL SOBRE TOOLS, que o modelo
// segue de forma bem mais consistente nos testes.
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node fix-regra-promessa-retorno-v2.js <workflowId>');

const PARAGRAFO_ANTIGO_MARCADOR = 'PROMESSA DE RETORNO';
const PARAGRAFO_NOVO =
  'REGRA COM PRIORIDADE MÁXIMA — PROMESSA DE RETORNO: antes de enviar sua resposta, releia o texto. Se ele contiver, em qualquer forma, "vou verificar", "vou repassar", "vou encaminhar", "te retorno", "assim que tiver uma resposta/retorno" ou equivalente sobre algo que depende da Dra. Aline ou da equipe -- essa MESMA mensagem tem que terminar com o bloco JSON de agent_action, sem exceção. Isso vale mesmo que você também tenha feito uma pergunta de esclarecimento na mesma mensagem, e mesmo que a situação não pareça se encaixar nos critérios de "GERE agent_action quando" acima -- a própria promessa já é o gatilho, não precisa satisfazer mais nada. Promessa de retorno sem agent_action é uma mentira pro paciente: ninguém da equipe vai saber que precisa responder.';

const TRECHO_TOOLS_ANTIGO =
  'As tools são ações reais no sistema. NUNCA: inventar resultado de tool; dizer que marcou/cancelou/remarcou sem confirmação; inventar horários/disponibilidade; dizer que consultou o sistema sem ter chamado a tool.';
const TRECHO_TOOLS_NOVO =
  'As tools são ações reais no sistema. NUNCA: inventar resultado de tool; dizer que marcou/cancelou/remarcou sem confirmação; inventar horários/disponibilidade; dizer que consultou o sistema sem ter chamado a tool; prometer "verificar"/"repassar"/"retornar" sobre algo pra Dra. Aline ou pra equipe sem gerar o agent_action correspondente na mesma mensagem (ver PROMESSA DE RETORNO).';

function patchSystemMessage(sysMsg) {
  const linhas = sysMsg.split('\n');

  const idxParagrafo = linhas.findIndex((l) => l.includes(PARAGRAFO_ANTIGO_MARCADOR));
  if (idxParagrafo === -1) throw new Error('paragrafo PROMESSA DE RETORNO nao encontrado -- rode add-regra-promessa-retorno.js primeiro');
  linhas[idxParagrafo] = PARAGRAFO_NOVO;

  const idxTools = linhas.findIndex((l) => l.trim() === TRECHO_TOOLS_ANTIGO);
  if (idxTools === -1) throw new Error('trecho da REGRA FUNDAMENTAL SOBRE TOOLS nao encontrado no formato esperado -- abortando');
  linhas[idxTools] = TRECHO_TOOLS_NOVO;

  return linhas.join('\n');
}

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  const aiAgent = wf.nodes.find((n) => n.name === 'AI Agent');
  if (!aiAgent) throw new Error('AI Agent nao encontrado');
  aiAgent.parameters.options.systemMessage = patchSystemMessage(aiAgent.parameters.options.systemMessage);

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
