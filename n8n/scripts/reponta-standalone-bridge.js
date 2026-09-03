// Reaponta os 6 nodes de ferramenta do workflow "Lumi - Standalone"
// (9PsUjET74L2NblWv, inativo) pro bridge novo (standalone-bridge/) --
// hoje ainda apontam pro bridge do Simples Dental (mesma URL da PROD),
// só porque foi clonado de lá.
//
// URL É PLACEHOLDER (https://TROCAR-standalone-bridge.easypanel.host) --
// standalone-bridge/ ainda não tem deploy feito em lugar nenhum. Trocar
// pela URL real assim que o deploy existir (Easypanel gera o domínio).
//
// A chave (BRIDGE_API_KEY) já é a de verdade, gerada agora -- copiar pro
// .env do standalone-bridge deployado (mesmo valor já está em
// standalone-bridge/.env local, pra você usar quando fizer o deploy).
//
// uso: node n8n/scripts/reponta-standalone-bridge.js
require('dotenv').config({ path: __dirname + '/../.env' });
const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };

const WORKFLOW_ID = '9PsUjET74L2NblWv';
const URL_PLACEHOLDER = 'https://TROCAR-standalone-bridge.easypanel.host';
const BRIDGE_KEY_NOVA = 'a9aabd273e09f8bdb094b52bca4b3ff44c5f80ad7b6a0f4aa48c4915e3a19a05';
const URL_ANTIGA = 'https://whatsapp-teste-github.usixhn.easypanel.host';

const ROTAS = {
  'Verifica Disponibilidade': '/verificar-disponibilidade',
  'Cria Agendamento': '/criar-agendamento',
  'Busca Agendamentos Paciente': '/buscar-agendamentos-paciente',
  'Confirmar Agendamento': '/confirmar-agendamento',
  'Cancelar Agendamento': '/cancelar-agendamento',
  'Remarcar Agendamento': '/remarcar-agendamento',
};

async function main() {
  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, { headers: H })).json();
  if (!wf.nodes) throw new Error('GET falhou: ' + JSON.stringify(wf));
  if (wf.active) throw new Error('SEGURANÇA: workflow está ATIVO -- esperava inativo (rascunho). Conferir antes de continuar.');

  let trocados = 0;
  for (const [nome, rota] of Object.entries(ROTAS)) {
    const node = wf.nodes.find((n) => n.name === nome);
    if (!node) throw new Error(`node "${nome}" não encontrado`);

    if (node.parameters.url === URL_PLACEHOLDER + rota) {
      console.log(`${nome}: já apontado -- pulando`);
      continue;
    }
    if (node.parameters.url !== URL_ANTIGA + rota) {
      throw new Error(`${nome}: url atual (${node.parameters.url}) diferente do esperado -- CONFERIR`);
    }
    node.parameters.url = URL_PLACEHOLDER + rota;

    const header = node.parameters.headerParameters?.parameters?.find((h) => h.name === 'X-Bridge-Key');
    if (!header) throw new Error(`${nome}: header X-Bridge-Key não encontrado`);
    header.value = BRIDGE_KEY_NOVA;

    trocados++;
  }

  if (!wf.nodes.some((n) => n.name === 'Sticky Standalone Bridge Key')) {
    wf.nodes.push({
      parameters: {
        content:
          '## 🔴 URLs placeholder (03/09)\nOs 6 nodes de ferramenta apontam pra\n' +
          'https://TROCAR-standalone-bridge.easypanel.host -- trocar pela\n' +
          'URL real assim que standalone-bridge/ tiver deploy.\n\n' +
          'BRIDGE_API_KEY já é definitiva (mesmo valor em\n' +
          'standalone-bridge/.env local) -- só copiar pro .env do serviço\n' +
          'deployado, não precisa gerar de novo.',
        height: 260,
        width: 460,
        color: 4,
      },
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [-40, -620],
      id: 'sticky-standalone-bridge-key-' + Date.now().toString(36),
      name: 'Sticky Standalone Bridge Key',
    });
  }

  const put = await fetch(`${BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings }),
  });
  const pb = await put.json();
  if (!put.ok) throw new Error(`PUT falhou: ${put.status} ${JSON.stringify(pb)}`);

  console.log(`PUT ${put.status} | ${trocados} nodes atualizados`);
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
