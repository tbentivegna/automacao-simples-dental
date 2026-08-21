// Fecha uma brecha real: a Lumi podia dizer "vou verificar com a Dra. Aline
// e te retorno" sem gerar agent_action nenhum -- promessa feita, pendencia
// nenhuma registrada, ninguem da equipe sabe que precisa responder. Os
// criterios de GERE agent_action eram todos "julgamento" (urgencia, analise
// clinica etc.), sem nenhuma regra deterministica amarrando a propria
// promessa de retorno a criacao da pendencia. Caso real: paciente Eduardo,
// pedido de indicacao de exames, resposta prometeu retorno, zero linha em
// agent_actions (2026-08-21).
require('dotenv').config({ path: __dirname + '/../.env' });
const crypto = require('crypto');

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node add-regra-promessa-retorno.js <workflowId>');

const NOVO_PARAGRAFO =
  'REGRA COM PRIORIDADE MÁXIMA — PROMESSA DE RETORNO: sempre que a sua resposta disser, de qualquer forma, que você vai verificar algo com a Dra. Aline, repassar pra equipe, consultar internamente, ou retornar/dar um retorno depois sobre um assunto -- essa mesma mensagem TEM que terminar com o bloco JSON de agent_action, sem exceção, mesmo que a situação não pareça se encaixar nos critérios acima. Nunca prometa um retorno futuro sem registrar o que precisa ser resolvido: sem o agent_action, ninguém da equipe fica sabendo que esse retorno é esperado.';

function patchSystemMessage(sysMsg) {
  const linhas = sysMsg.split('\n');

  const idxGere = linhas.findIndex((l) => l.startsWith('GERE agent_action quando:'));
  if (idxGere === -1) throw new Error('linha "GERE agent_action quando:" nao encontrada -- prompt pode ja ter mudado, abortando');
  if (linhas[idxGere + 1] !== '') throw new Error('linha seguinte a "GERE agent_action quando:" nao e branco -- abortando');
  if (!linhas[idxGere + 2].startsWith('Ações permitidas:')) throw new Error('linha apos o branco nao e "Ações permitidas:" -- abortando');

  if (linhas.some((l) => l.includes('PROMESSA DE RETORNO'))) {
    return { texto: sysMsg, jaAplicado: true };
  }

  linhas.splice(idxGere + 2, 0, NOVO_PARAGRAFO, '');
  return { texto: linhas.join('\n'), jaAplicado: false };
}

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  const aiAgent = wf.nodes.find((n) => n.name === 'AI Agent');
  if (!aiAgent) throw new Error('AI Agent nao encontrado');

  const { texto, jaAplicado } = patchSystemMessage(aiAgent.parameters.options.systemMessage);
  if (jaAplicado) {
    console.log('ja aplicado, pulando');
    return;
  }
  aiAgent.parameters.options.systemMessage = texto;

  if (!wf.nodes.find((n) => n.name === 'Sticky Note - Promessa Retorno')) {
    wf.nodes.push({
      parameters: {
        content:
          '🔴 CLAUDE (21/08): prompt AGENT_ACTION -- nova regra "PROMESSA DE RETORNO". Sempre que a Lumi disser que vai verificar/repassar/retornar sobre algo, a mensagem tem que gerar agent_action, sem depender dos critérios de julgamento de cima. Pode apagar esta nota.',
        height: 220,
        width: 340,
        color: 3,
      },
      type: 'n8n-nodes-base.stickyNote',
      position: [aiAgent.position[0], aiAgent.position[1] - 260],
      typeVersion: 1,
      id: crypto.randomUUID(),
      name: 'Sticky Note - Promessa Retorno',
    });
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
