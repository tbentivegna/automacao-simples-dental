'use strict';

// Fix da causa raiz DEFINITIVA do incidente de duplicata/triplicata de
// 31/08/2026 (Aurora 2x, Walter 3x): o fix de 27/08 (.item -> .all()
// [$itemIndex]) foi necessário mas NÃO suficiente. O node Postgres
// "Grava Resgate no Histórico" continua "achatando" sua própria saída
// pra 1 item só quando processa 2+ candidatos na mesma leva -- mesmo com
// o acessor correto, mesmo gravando o conteúdo certo por baixo dos panos
// (confirmado em 27/08: os INSERTs de fato acontecem certos, só a
// contagem de itens de SAÍDA do node é que colapsa). Como "Marca Resgate
// Enviado" (o node que evita reenvio) rodava DEPOIS desse node na mesma
// cadeia, ele herdava esse colapso e só marcava resgate_enviado pro
// primeiro item de cada leva -- os outros ficavam em_andamento e eram
// reenviados na leva seguinte, repetidamente, até por acaso caírem na
// posição 0 de uma leva menor.
//
// Fix: parar de encadear os dois em série. "Envia Resgate" passa a
// alimentar os dois EM PARALELO (Grava Resgate no Histórico E Marca
// Resgate Enviado direto), não mais um depois do outro. Isso desacopla
// a marcação de "já enviei" (a garantia crítica contra duplicata) de
// qualquer bug de contagem de item no node de histórico -- "Marca
// Resgate Enviado" passa a usar a saída de "Envia Resgate" (confirmado
// preservando a contagem certa de itens, 3 iníciopara 3 fim na leva de
// hoje) em vez da saída de "Grava Resgate no Histórico".

require('dotenv').config();

const BASE = process.env.N8N_BASE_URL;
const KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = 'vUGMz073giDPfGzx'; // Lumi - Resgate de Funil (prod)

async function main() {
  const resposta = await fetch(`${BASE}/api/v1/workflows/${WORKFLOW_ID}`, {
    headers: { 'X-N8N-API-KEY': KEY },
  });
  const workflow = await resposta.json();

  const conexoesEnvia = workflow.connections['Envia Resgate'];
  const conexoesGrava = workflow.connections['Grava Resgate no Histórico'];
  if (!conexoesEnvia || !conexoesGrava) {
    throw new Error('Não encontrei as conexões esperadas -- abortando pra não corromper o workflow.');
  }

  const destinosAtuais = (conexoesEnvia.main[0] || []).map((c) => c.node);
  if (destinosAtuais.includes('Marca Resgate Enviado')) {
    console.log('Já aplicado (Envia Resgate já aponta direto pra Marca Resgate Enviado). Nada a fazer.');
    return;
  }
  if (!destinosAtuais.includes('Grava Resgate no Histórico') || destinosAtuais.length !== 1) {
    throw new Error(`Conexões de "Envia Resgate" não batem com o esperado (esperava só ["Grava Resgate no Histórico"], achei ${JSON.stringify(destinosAtuais)}) -- abortando.`);
  }

  // "Envia Resgate" passa a apontar pros dois, em paralelo.
  workflow.connections['Envia Resgate'] = {
    main: [
      [
        { node: 'Grava Resgate no Histórico', type: 'main', index: 0 },
        { node: 'Marca Resgate Enviado', type: 'main', index: 0 },
      ],
    ],
  };
  // "Grava Resgate no Histórico" não aponta mais pra "Marca Resgate
  // Enviado" -- vira um beco sem saída (só grava o histórico, sem mais
  // nada depender do que ela produz).
  workflow.connections['Grava Resgate no Histórico'] = { main: [[]] };

  const nodeMarca = workflow.nodes.find((n) => n.name === 'Marca Resgate Enviado');
  if (!nodeMarca) throw new Error('Node "Marca Resgate Enviado" não encontrado.');
  // $itemIndex agora se refere à posição em "Envia Resgate" (que
  // preserva a contagem certa de itens) em vez de "Grava Resgate no
  // Histórico" -- só troca o nome do node referenciado na query, mesma
  // lógica de indexação posicional (.all()[$itemIndex]) já em uso.
  const queryAntiga = nodeMarca.parameters.query;
  if (!queryAntiga.includes("$('Monta Mensagem Resgate')")) {
    throw new Error('Query de "Marca Resgate Enviado" não bate com o esperado -- abortando.');
  }
  // A query já referencia "Monta Mensagem Resgate" diretamente (não
  // "Grava Resgate no Histórico"), então não precisa mudar -- só a
  // posição de $itemIndex no pipeline muda (antes vinha de Grava
  // Resgate no Histórico, agora vem de Envia Resgate), o texto da
  // query em si já está correto.

  const stickyId = `sticky-fix-desacopla-${Date.now()}`;
  workflow.nodes.push({
    parameters: {
      content:
        '## ⚠️ Fix 31/08/2026\n"Envia Resgate" agora alimenta "Grava Resgate no Histórico" E "Marca Resgate Enviado" EM PARALELO (não mais em série) -- o node de histórico colapsava sua própria saída pra 1 item em levas de 2+, e "Marca Resgate Enviado" herdava esse colapso, causando duplicata/triplicata mesmo com o fix de paired-item de 27/08 já aplicado. Ver [[project_funil_resgate]] pra detalhe completo.',
      height: 240,
      width: 340,
      color: 3,
    },
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [1150, -260],
    id: stickyId,
    name: 'Nota - Fix Desacopla Marca Enviado 31-08',
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
