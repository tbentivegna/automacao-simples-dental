// Aplica lumi-harness/system-prompt.txt no node "AI Agent" do workflow
// (options.systemMessage). O harness e o n8n devem ficar sempre iguais
// (ver [[project_lumi_harness_sync]]).
//
// uso: node n8n/scripts/aplica-prompt.js <workflowId>
//   DEV  = yFSw0JMMD93EGZMa
//   PROD = K2xRqOwS0N0AcoqG
require('dotenv').config({ path: __dirname + '/../.env' });
const fs = require('fs');
const path = require('path');
const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };
const id = process.argv[2];
if (!id) throw new Error('uso: node aplica-prompt.js <workflowId>');

const PROMPT = fs.readFileSync(path.join(__dirname, '../../lumi-harness/system-prompt.txt'), 'utf8');

async function main() {
  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${id}`, { headers: H })).json();
  if (!wf.nodes) throw new Error('GET falhou: ' + JSON.stringify(wf));
  if (wf.versionId !== wf.activeVersionId) {
    throw new Error('draft != ativo -- roda realinha-draft.js antes');
  }
  const ai = wf.nodes.find((n) => n.name === 'AI Agent');
  if (!ai) throw new Error('node "AI Agent" nao encontrado');
  const atual = ai.parameters?.options?.systemMessage || '';
  if (atual === PROMPT) {
    console.log('prompt ja identico -- nada a fazer (', PROMPT.length, 'chars)');
    return;
  }
  console.log(`prompt atual ${atual.length} chars -> novo ${PROMPT.length} chars`);
  ai.parameters = ai.parameters || {};
  ai.parameters.options = ai.parameters.options || {};
  ai.parameters.options.systemMessage = PROMPT;

  const put = await fetch(`${BASE_URL}/api/v1/workflows/${id}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings }),
  });
  const pb = await put.json();
  if (!put.ok) throw new Error(`PUT falhou: ${put.status} ${JSON.stringify(pb)}`);
  const act = await fetch(`${BASE_URL}/api/v1/workflows/${id}/activate`, { method: 'POST', headers: H });
  const ab = await act.json();
  const ok = ab.versionId === ab.activeVersionId;
  const live = (ab.activeVersion?.nodes || ab.nodes).find((n) => n.name === 'AI Agent');
  const liveLen = (live?.parameters?.options?.systemMessage || '').length;
  console.log(`PUT ${put.status} | activate ${act.status} | draft==active=${ok} | systemMessage na versao ativa=${liveLen} chars`);
  if (!ok || liveLen !== PROMPT.length) throw new Error('verificacao falhou -- CONFERIR NA UI');
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
