// Realinha o "draft" de um workflow com a versao ATIVA (publicada).
//
// Nesse n8n, GET /workflows/:id retorna o draft (wf.nodes), que pode estar
// atrasado em relacao a versao que roda de fato (wf.activeVersion.nodes).
// Aconteceu no PROD (K2xRqOwS0N0AcoqG): um draft de aba antiga do n8n ficou
// na frente da versao ativa, funcionalmente identico mas sem 5 sticky notes.
// Como os scripts de fix fazem GET(draft) -> modifica -> PUT, e preciso
// primeiro alinhar o draft com o ativo pra nao perder nada.
//
// uso: node n8n/scripts/realinha-draft.js <workflowId>
require('dotenv').config({ path: __dirname + '/../.env' });
const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };
const id = process.argv[2];
if (!id) throw new Error('uso: node realinha-draft.js <workflowId>');

async function main() {
  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${id}`, { headers: H })).json();
  if (!wf.nodes) throw new Error('GET falhou: ' + JSON.stringify(wf));
  if (wf.versionId === wf.activeVersionId) {
    console.log('draft ja == ativo -- nada a fazer (', wf.nodes.length, 'nodes)');
    return;
  }
  const av = wf.activeVersion;
  if (!av || !av.nodes) throw new Error('sem activeVersion -- nao da pra realinhar com seguranca');
  console.log(`draft ${wf.nodes.length} nodes / ativo ${av.nodes.length} nodes -> alinhando pelo ativo`);
  const put = await fetch(`${BASE_URL}/api/v1/workflows/${id}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ name: wf.name, nodes: av.nodes, connections: av.connections, settings: wf.settings }),
  });
  const pb = await put.json();
  if (!put.ok) throw new Error(`PUT falhou: ${put.status} ${JSON.stringify(pb)}`);
  const act = await fetch(`${BASE_URL}/api/v1/workflows/${id}/activate`, { method: 'POST', headers: H });
  const ab = await act.json();
  const ok = ab.versionId === ab.activeVersionId;
  console.log(`PUT ${put.status} | activate ${act.status} | active=${ab.active} | draft==active=${ok} | nodes=${ab.nodes.length}`);
  if (!ok) throw new Error('draft != active depois do activate');
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
