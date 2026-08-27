'use strict';

// Fix da causa raiz do incidente de duplicata do dia 27/08/2026 (Daniela
// Voltolini): o node "Grava Resgate no Histórico" (workflow "Lumi -
// Resgate de Funil", prod) ainda usava o padrão antigo
// $('Monta Mensagem Resgate').item.json.X, o mesmo tipo de ambiguidade de
// paired-item já corrigido em "Marca Resgate Enviado" no incidente de
// 25/08 (ver fix-marca-resgate-paired-item.js) -- só que esse node aqui
// ficou pra trás na época.
//
// Sintoma real observado: quando 2+ pacientes entram na mesma leva de
// resgate, este node "achata" a saída pra 1 item só, fazendo o node
// seguinte (Marca Resgate Enviado) marcar resgate_enviado só pro
// primeiro -- o segundo fica em_andamento e recebe um resgate duplicado
// na leva seguinte (30 min depois).
//
// Idempotente: só reescreve se ainda encontrar o padrão antigo.

require('dotenv').config();

const BASE = process.env.N8N_BASE_URL;
const KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = 'vUGMz073giDPfGzx'; // Lumi - Resgate de Funil (prod)
const NODE_NAME = 'Grava Resgate no Histórico';

async function main() {
  const resposta = await fetch(`${BASE}/api/v1/workflows/${WORKFLOW_ID}`, {
    headers: { 'X-N8N-API-KEY': KEY },
  });
  const workflow = await resposta.json();

  const node = workflow.nodes.find((n) => n.name === NODE_NAME);
  if (!node) throw new Error(`Node "${NODE_NAME}" não encontrado.`);

  const queryAntiga = node.parameters.query;
  const queryReplacementAntiga = node.parameters.options.queryReplacement;

  if (!queryAntiga.includes("$('Monta Mensagem Resgate').item.json.telefone")) {
    console.log('Já aplicado (query principal não tem mais o padrão antigo). Nada a fazer.');
    return;
  }

  node.parameters.query = queryAntiga.replace(
    "$('Monta Mensagem Resgate').item.json.telefone",
    "$('Monta Mensagem Resgate').all()[$itemIndex].json.telefone"
  );
  node.parameters.options.queryReplacement = queryReplacementAntiga.replace(
    "$('Monta Mensagem Resgate').item.json.mensagemResgate",
    "$('Monta Mensagem Resgate').all()[$itemIndex].json.mensagemResgate"
  );

  // Sticky note vermelha (color 3) perto do node alterado, avisando da
  // mudança -- convenção já usada nos fixes anteriores deste workflow.
  const stickyId = `sticky-fix-grava-resgate-${Date.now()}`;
  workflow.nodes.push({
    parameters: {
      content:
        '## ⚠️ Fix 27/08/2026\nMesmo bug de paired-item do "Marca Resgate Enviado" (25/08), só que este node tinha ficado pra trás. Trocado `.item` por `.all()[$itemIndex]` -- evita duplicar resgate quando 2+ pacientes caem na mesma leva.',
      height: 200,
      width: 320,
      color: 3,
    },
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [node.position[0] - 60, node.position[1] - 260],
    id: stickyId,
    name: 'Nota - Fix Grava Resgate 27-08',
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
