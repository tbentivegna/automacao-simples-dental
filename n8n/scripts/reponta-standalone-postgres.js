// Reaponta a credencial Postgres de TODOS os nodes do workflow "Lumi -
// Standalone" (9PsUjET74L2NblWv, inativo) pro banco de teste isolado
// (lumi_standalone_teste) -- clonado de PROD, então os 37 nodes com
// credencial postgres ainda apontavam pro banco de produção real da Dra.
// Aline. Sem isso, testar uma conversa completa gravaria dado de teste
// misturado com paciente real (cliente, n8n_chat_histories, etc.).
//
// uso: node n8n/scripts/reponta-standalone-postgres.js
require('dotenv').config({ path: __dirname + '/../.env' });
const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };

const WORKFLOW_ID = '9PsUjET74L2NblWv';
const CREDENCIAL_ANTIGA_ID = 'IM7As7mjQcGJIzzy';
const CREDENCIAL_NOVA = { id: 'TuGqjurBdjQvGIbf', name: 'Postgres - Standalone Teste' };

async function main() {
  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, { headers: H })).json();
  if (!wf.nodes) throw new Error('GET falhou: ' + JSON.stringify(wf));
  if (wf.active) throw new Error('SEGURANÇA: workflow ATIVO -- esperava inativo. Conferir antes de continuar.');

  let trocados = 0;
  for (const node of wf.nodes) {
    if (node.credentials?.postgres?.id === CREDENCIAL_ANTIGA_ID) {
      node.credentials.postgres = CREDENCIAL_NOVA;
      trocados++;
    }
  }

  if (trocados === 0) {
    console.log('nenhum node com a credencial antiga -- já trocado ou nada a fazer');
    return;
  }

  if (!wf.nodes.some((n) => n.name === 'Sticky Standalone Postgres Isolado')) {
    wf.nodes.push({
      parameters: {
        content:
          '## 🟢 Banco isolado (03/09)\nTodos os nodes com credencial Postgres apontam pro banco de\nteste isolado (lumi_standalone_teste), NÃO pro banco de\nprodução da Dra. Aline. Seguro testar conversa completa aqui\nsem misturar dado real.',
        height: 220,
        width: 440,
        color: 4,
      },
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [-40, -400],
      id: 'sticky-standalone-postgres-isolado-' + Date.now().toString(36),
      name: 'Sticky Standalone Postgres Isolado',
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
