// Achado no teste ao vivo do Tiago (24/08): ele mandou a imagem COM legenda
// ("Oi isso é um teste. Você pode me confirmar o que estou te enviando?"),
// mas "Set Mensagem Anexo" ignorava completamente a legenda e usava sempre
// o mesmo texto genérico -- a pergunta do paciente se perdia, e a Lumi
// respondia de forma genérica sem nunca "ver" o que ele tinha perguntado.
// Fix: se o anexo (imagem/documento/vídeo) tiver legenda, inclui ela no
// texto que vai pro pipeline normal e na pendência -- senão, mantém o
// texto genérico de antes.
//
// IMPORTANTE: só mexe em parameters desses 2 nodes -- não toca em position
// nem em nenhum outro node, pra preservar o layout que o Tiago ajustou na
// mão no DEV.
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node fix-legenda-anexo.js <workflowId>');

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  const setAnexo = wf.nodes.find((n) => n.name === 'Set Mensagem Anexo');
  const registraPendenciaAnexo = wf.nodes.find((n) => n.name === 'Registra Pendência Anexo');
  if (!setAnexo || !registraPendenciaAnexo) throw new Error('nos esperados nao encontrados');

  const legendaExpr =
    "$('Webhook').first().json.body.data.message[$('Webhook').first().json.body.data.messageType]?.caption";

  setAnexo.parameters.assignments.assignments[0].value =
    `={{ ${legendaExpr} ? ('[Paciente enviou um anexo (imagem, documento, vídeo ou similar) com esta legenda: "' + ${legendaExpr} + '"]') : '[Paciente enviou um anexo (imagem, documento, vídeo ou similar) que a Lumi ainda não consegue abrir]' }}`;

  registraPendenciaAnexo.parameters.options.queryReplacement =
    `={{ [ 'Paciente enviou um anexo do tipo "' + $('Webhook').first().json.body.data.messageType + '"' + (${legendaExpr} ? (' com a legenda: "' + ${legendaExpr} + '"') : '') + ' -- pedir pra Dra. Aline conferir.' ] }}`;

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
