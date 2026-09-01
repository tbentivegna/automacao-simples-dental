// Rede de seguranca 2 (a de "promessa de horarios sem tool", node "Extrai
// JSON") tinha um falso positivo real, achado 31/08 no caso Diovana Terra
// Fonseca: a Lumi perguntou "...preciso verificar os horarios disponiveis.
// Ele prefere manha ou tarde?" -- ou seja, terminou o turno jogando a bola
// pro paciente responder, que e o fluxo CORRETO (perguntar periodo antes
// de chamar Verifica Disponibilidade com filtro). O regex nao distinguia
// isso do caso Ana Paula original (28/08), onde a Lumi realmente travou no
// meio ("vamos verificar os horarios... um momento, por favor!") sem
// deixar nada pendente pro paciente.
//
// Sinal pra diferenciar: a mensagem que trava de verdade NAO termina
// perguntando nada ao paciente. A que so esta esperando resposta termina
// com "?". Fix: só considera travamento real se a mensagem NAO termina em
// pergunta.
//
// uso: node n8n/scripts/fix-promessa-horarios-falso-positivo-pergunta.js <workflowId>
//   DEV  = yFSw0JMMD93EGZMa
//   PROD = K2xRqOwS0N0AcoqG
require('dotenv').config({ path: __dirname + '/../.env' });
const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node fix-promessa-horarios-falso-positivo-pergunta.js <workflowId>');

const ANCHOR = `const REGEX_TEM_HORARIO = /\\d{1,2}\\s*[:h]\\s*\\d{2}|\\b[àa]s?\\s+\\d{1,2}\\s*(h\\b|hora|:)/i;
const nenhumaToolNoTurno = !Array.isArray($json.intermediateSteps) || $json.intermediateSteps.length === 0;

function comFallback(mensagemLimpa) {
  if (nenhumaToolNoTurno && REGEX_PROMETEU_HORARIOS.test(mensagemLimpa) && !REGEX_TEM_HORARIO.test(mensagemLimpa)) {`;

const REPLACEMENT = `const REGEX_TEM_HORARIO = /\\d{1,2}\\s*[:h]\\s*\\d{2}|\\b[àa]s?\\s+\\d{1,2}\\s*(h\\b|hora|:)/i;
const nenhumaToolNoTurno = !Array.isArray($json.intermediateSteps) || $json.intermediateSteps.length === 0;

// Rede de seguranca 2b (31/08, caso Diovana): a promessa de horarios so e
// travamento de verdade se a Lumi NAO deixou nada pendente pro paciente
// responder. Se a msg termina em pergunta ("...horarios. Prefere manha ou
// tarde?"), a bola esta com o paciente -- fluxo correto, nao e bug.
const REGEX_TERMINA_PERGUNTANDO = /\\?\\s*$/;

function comFallback(mensagemLimpa) {
  const travouSemDeixarPendente = nenhumaToolNoTurno && REGEX_PROMETEU_HORARIOS.test(mensagemLimpa) && !REGEX_TEM_HORARIO.test(mensagemLimpa) && !REGEX_TERMINA_PERGUNTANDO.test(mensagemLimpa.trim());
  if (travouSemDeixarPendente) {`;

async function main() {
  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, { headers: H })).json();
  if (!wf.nodes) throw new Error('GET falhou: ' + JSON.stringify(wf));
  if (wf.versionId !== wf.activeVersionId) throw new Error('draft != ativo -- roda realinha-draft.js antes');

  const node = wf.nodes.find((n) => n.name === 'Extrai JSON');
  if (!node) throw new Error('node "Extrai JSON" nao encontrado');

  if (node.parameters.jsCode.includes('REGEX_TERMINA_PERGUNTANDO')) {
    console.log('ja aplicado -- nada a fazer');
    return;
  }
  if (!node.parameters.jsCode.includes(ANCHOR)) {
    throw new Error('anchor nao encontrado no jsCode -- codigo base diferente do esperado, CONFERIR');
  }
  node.parameters.jsCode = node.parameters.jsCode.replace(ANCHOR, REPLACEMENT);

  if (!wf.nodes.some((n) => n.name === 'Sticky Fix Falso Positivo Pergunta 31/08')) {
    const ej = wf.nodes.find((n) => n.name === 'Extrai JSON');
    wf.nodes.push({
      parameters: {
        content:
          '## 🔴 FIX 31/08: falso positivo (pergunta pendente)\nCaso Diovana: "...verificar horarios. Prefere manha ou\ntarde?" foi marcado como travamento, mas a bola estava\ncom a paciente (pergunta legitima). Rede de seguranca 2\nagora so dispara se a msg NAO termina perguntando algo.',
        height: 220,
        width: 430,
        color: 3,
      },
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [(ej.position?.[0] ?? 0) - 40, (ej.position?.[1] ?? 0) - 560],
      id: 'sticky-fix-falso-positivo-pergunta-' + workflowId.slice(0, 8),
      name: 'Sticky Fix Falso Positivo Pergunta 31/08',
    });
  }

  const put = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings }),
  });
  const pb = await put.json();
  if (!put.ok) throw new Error(`PUT falhou: ${put.status} ${JSON.stringify(pb)}`);
  const act = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}/activate`, { method: 'POST', headers: H });
  const ab = await act.json();
  const ok = ab.versionId === ab.activeVersionId;
  const live = (ab.activeVersion?.nodes || ab.nodes).find((n) => n.name === 'Extrai JSON');
  const okTexto = live.parameters.jsCode.includes('REGEX_TERMINA_PERGUNTANDO') && live.parameters.jsCode.includes('travouSemDeixarPendente');
  console.log(`PUT ${put.status} | activate ${act.status} | draft==active=${ok} | texto ok=${okTexto}`);
  if (!ok || !okTexto) throw new Error('verificacao FALHOU -- conferir na UI');
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
