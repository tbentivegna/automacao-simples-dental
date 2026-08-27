'use strict';

// Fix da causa raiz do incidente de 27/08/2026 (Renan Jefferson da Silva):
// o node "Abre Funil Interesse" (workflow "Lumi", prod) abre uma tentativa
// de resgate (etapa "interesse") pra QUALQUER mensagem do paciente que bata
// na regex de palavras-chave do node "Tem Sinal de Interesse?" (valor,
// preço, dúvida, procedimento, etc) -- mesmo quando a conversa já está sendo
// 100% conduzida pela equipe humana (bot_disabled/human_assigned = true).
//
// Caso real: uma negociação de valor de tratamento já em andamento, tratada
// inteiramente pela equipe no WhatsApp, teve a palavra "valor" na mensagem
// do paciente e abriu uma tentativa de resgate -- horas depois a Lumi
// mandou uma mensagem de resgate fora de contexto ("ainda tem interesse
// em agendar?") no meio de uma conversa sobre boleto.
//
// Fix: só abre a tentativa de resgate se o paciente NÃO estiver com
// bot_disabled/human_assigned = true -- ou seja, só rastreia como
// "oportunidade perdida" conversas que a própria Lumi está conduzindo.
//
// Idempotente: só reescreve se ainda encontrar a query antiga (sem a
// checagem de cliente).

require('dotenv').config();

const BASE = process.env.N8N_BASE_URL;
const KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = process.env.WORKFLOW_ID_ALVO || 'K2xRqOwS0N0AcoqG'; // Lumi (prod)
const NODE_NAME = 'Abre Funil Interesse';

const QUERY_ANTIGA = `INSERT INTO public.funil_agendamento (telefone, instancia, etapa)
SELECT '{{ $json.telefone }}', '{{ $json.instance }}', 'interesse'
WHERE NOT EXISTS (
  SELECT 1 FROM public.funil_agendamento
  WHERE telefone = '{{ $json.telefone }}' AND status = 'em_andamento'
);`;

const QUERY_NOVA = `INSERT INTO public.funil_agendamento (telefone, instancia, etapa)
SELECT '{{ $json.telefone }}', '{{ $json.instance }}', 'interesse'
WHERE NOT EXISTS (
  SELECT 1 FROM public.funil_agendamento
  WHERE telefone = '{{ $json.telefone }}' AND status = 'em_andamento'
)
AND NOT EXISTS (
  -- Só rastreia como oportunidade de resgate conversas que a Lumi está
  -- conduzindo de verdade -- se a equipe já assumiu (bot_disabled/
  -- human_assigned), essa mensagem não é uma tentativa de agendamento
  -- abandonada, é atendimento humano em andamento (ex: negociação de
  -- valor de tratamento já existente).
  SELECT 1 FROM public.cliente
  WHERE telefone = '{{ $json.telefone }}' AND (bot_disabled = true OR human_assigned = true)
);`;

async function main() {
  const resposta = await fetch(`${BASE}/api/v1/workflows/${WORKFLOW_ID}`, {
    headers: { 'X-N8N-API-KEY': KEY },
  });
  const workflow = await resposta.json();

  const node = workflow.nodes.find((n) => n.name === NODE_NAME);
  if (!node) throw new Error(`Node "${NODE_NAME}" não encontrado.`);

  if (node.parameters.query.includes('bot_disabled')) {
    console.log('Já aplicado (query já tem a checagem de bot_disabled). Nada a fazer.');
    return;
  }
  if (node.parameters.query.trim() !== QUERY_ANTIGA.trim()) {
    throw new Error('Query atual do node não bate com o esperado -- abortando pra não sobrescrever algo inesperado. Confira manualmente.');
  }

  node.parameters.query = QUERY_NOVA;

  const stickyId = `sticky-fix-funil-interesse-${Date.now()}`;
  workflow.nodes.push({
    parameters: {
      content:
        '## ⚠️ Fix 27/08/2026\nAdicionada checagem de bot_disabled/human_assigned -- não abre mais tentativa de resgate quando a equipe já está atendendo manualmente (evita resgate fora de contexto em conversa 100% humana).',
      height: 220,
      width: 320,
      color: 3,
    },
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [node.position[0] - 60, node.position[1] - 280],
    id: stickyId,
    name: 'Nota - Fix Funil Interesse 27-08',
  });

  const payload = {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings || {},
  };

  const put = await fetch(`${BASE}/api/v1/workflows/${WORKFLOW_ID}`, {
    method: 'PUT',
    headers: { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!put.ok) {
    throw new Error(`Falha ao salvar workflow: ${put.status} ${await put.text()}`);
  }
  console.log('Aplicado com sucesso.');
}

main().catch((erro) => {
  console.error('ERRO:', erro.message);
  process.exit(1);
});
