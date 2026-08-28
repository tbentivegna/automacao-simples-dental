// Rede de seguranca 2 no "Extrai JSON" -- caso Ana Paula (28/08, exec 3087):
// o modelo disse "vamos verificar os horarios... um momento, por favor!" e
// ENCERROU o turno sem chamar Verifica Disponibilidade. Paciente ficou no
// limbo, sem nenhum horario. Status success, sem erro -- flakiness
// intermitente do Mistral, a mesma que motivou a PROMESSA DE RETORNO, mas o
// regex de la pega "vou verificar" e nao "vamos verificar".
//
// Fix: se a msg final da Lumi promete verificar disponibilidade/horarios, E
// nenhuma tool foi chamada nesse turno (intermediateSteps vazio), E a msg
// nao contem nenhum horario -> gera pendencia AGENDAR_CONSULTA pra equipe
// retomar. Mesma filosofia da rede de seguranca existente (codigo, nao
// prompt, pro que nao pode ser esquecido -- ver feedback_prompt_vs_code_guarantees).
//
// uso: node n8n/scripts/fix-promessa-horarios-sem-tool.js <workflowId>
//   DEV  = yFSw0JMMD93EGZMa
//   PROD = K2xRqOwS0N0AcoqG
require('dotenv').config({ path: __dirname + '/../.env' });
const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node fix-promessa-horarios-sem-tool.js <workflowId>');

const ANCHOR = `const REGEX_PROMESSA_RETORNO = /vou verificar|vou repassar|vou encaminhar|te retorno|lhe retorno|assim que (eu )?tiver (uma )?resposta|assim que a dra\\.? aline (responder|retornar)|vou confirmar (isso |isto )?com a (dra\\.?|equipe)/i;

function comFallback(mensagemLimpa) {
  if (!REGEX_PROMESSA_RETORNO.test(mensagemLimpa)) {
    return { hasAction: false, message: mensagemLimpa, Instance: instance, From: from };
  }`;

const REPLACEMENT = `const REGEX_PROMESSA_RETORNO = /vou verificar|vou repassar|vou encaminhar|te retorno|lhe retorno|assim que (eu )?tiver (uma )?resposta|assim que a dra\\.? aline (responder|retornar)|vou confirmar (isso |isto )?com a (dra\\.?|equipe)/i;

// Rede de seguranca 2 (28/08, caso Ana Paula): a Lumi as vezes diz que
// "vai verificar os horarios / um momento" e encerra o turno sem chamar
// Verifica Disponibilidade. Se prometeu horarios, NAO chamou nenhuma tool
// nesse turno, e a msg nao tem nenhum horario -> pendencia pra equipe.
const REGEX_PROMETEU_HORARIOS = /(vou|vamos|deixa eu|deixe-me|posso|irei|vou j[áa]|j[áa] vou)\\s+(verificar|checar|consultar|ver|olhar|dar uma olhada|conferir|pesquisar)[^.!?\\n]{0,40}(hor[áa]rio|disponibilidade|agenda|vagas?)|um\\s+(momento|instante|minuto|segundo|minutinho)\\b[^.!?\\n]{0,60}(hor[áa]rio|verific|disponib|agenda)|j[áa]\\s+(te |lhe )?retorno com os hor[áa]rios|deixa (eu )?(verificar|ver|consultar)[^.!?\\n]{0,40}(hor[áa]rio|disponib|agenda)/i;
const REGEX_TEM_HORARIO = /\\d{1,2}\\s*[:h]\\s*\\d{2}|\\b[àa]s?\\s+\\d{1,2}\\s*(h\\b|hora|:)/i;
const nenhumaToolNoTurno = !Array.isArray($json.intermediateSteps) || $json.intermediateSteps.length === 0;

function comFallback(mensagemLimpa) {
  if (nenhumaToolNoTurno && REGEX_PROMETEU_HORARIOS.test(mensagemLimpa) && !REGEX_TEM_HORARIO.test(mensagemLimpa)) {
    return {
      hasAction: true,
      message: mensagemLimpa,
      action: "AGENDAR_CONSULTA",
      domain: "Geral",
      detail: "[Auto-detectado] A Lumi disse que ia verificar os horarios e nao completou (nao chamou a ferramenta). Retomar com o paciente e enviar a disponibilidade. Ultima fala da Lumi: " + mensagemLimpa.slice(0, 400),
      Instance: instance,
      From: from,
    };
  }
  if (!REGEX_PROMESSA_RETORNO.test(mensagemLimpa)) {
    return { hasAction: false, message: mensagemLimpa, Instance: instance, From: from };
  }`;

async function main() {
  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, { headers: H })).json();
  if (!wf.nodes) throw new Error('GET falhou: ' + JSON.stringify(wf));
  if (wf.versionId !== wf.activeVersionId) throw new Error('draft != ativo -- roda realinha-draft.js antes');

  const node = wf.nodes.find((n) => n.name === 'Extrai JSON');
  if (!node) throw new Error('node "Extrai JSON" nao encontrado');

  if (node.parameters.jsCode.includes('REGEX_PROMETEU_HORARIOS')) {
    console.log('ja aplicado -- nada a fazer');
    return;
  }
  if (!node.parameters.jsCode.includes(ANCHOR)) {
    throw new Error('anchor nao encontrado no jsCode -- codigo base diferente do esperado, CONFERIR');
  }
  node.parameters.jsCode = node.parameters.jsCode.replace(ANCHOR, REPLACEMENT);

  if (!wf.nodes.some((n) => n.name === 'Sticky Fix Promessa Horarios 28/08')) {
    const ej = wf.nodes.find((n) => n.name === 'Extrai JSON');
    wf.nodes.push({
      parameters: {
        content:
          '## 🔴 FIX 28/08: promessa de horarios sem tool\nCaso Ana Paula (exec 3087): "vamos verificar os horarios... um\nmomento" e encerrou o turno sem chamar Verifica Disponibilidade.\nRede de seguranca no "Extrai JSON": promessa de horarios + 0 tools\nno turno + sem horario na msg -> pendencia AGENDAR_CONSULTA.',
        height: 220,
        width: 430,
        color: 3,
      },
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [(ej.position?.[0] ?? 0) - 40, (ej.position?.[1] ?? 0) - 300],
      id: 'sticky-fix-promessa-horarios-' + workflowId.slice(0, 8),
      name: 'Sticky Fix Promessa Horarios 28/08',
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
  const okTexto = live.parameters.jsCode.includes('REGEX_PROMETEU_HORARIOS') && live.parameters.jsCode.includes('nenhumaToolNoTurno');
  console.log(`PUT ${put.status} | activate ${act.status} | draft==active=${ok} | texto ok=${okTexto}`);
  if (!ok || !okTexto) throw new Error('verificacao FALHOU -- conferir na UI');
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
