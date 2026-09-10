// Aperta a regra de apresentação de horários no systemMessage do AI Agent.
// Motivo: numa execução real do demo (10/09) a Lumi listou ~8 slots,
// agrupou horários numa linha só, repetiu o mesmo dia, pôs o ano completo
// e disse "também tenho de quinta" com a quinta já na lista. A regra
// antiga ("no máximo 2-3 opções... Nunca despeje uma lista extensa") era
// frouxa demais.
//
// Idempotente. uso: node n8n/scripts/fix-apresentacao-horarios-tight.js <workflowId>
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node fix-apresentacao-horarios-tight.js <workflowId>');

const ANTIGA =
  '- Depois, apresente no máximo 2–3 opções por vez, priorizando as mais próximas dentro da preferência. Nunca despeje uma lista extensa. Se nenhuma servir, use a tool de novo e ofereça outras.';
const NOVA =
  '- Depois, ofereça no máximo 3 opções, uma por linha, cada uma com UM dia + UM horário — nunca agrupe vários horários numa linha, nunca repita o mesmo dia, nunca ofereça mais de 3. Formato curto: "sábado, 13/09, às 09:00" (sem o ano). Sempre as 3 mais próximas dentro da preferência do paciente. Não diga "também tenho de [dia]" se esse dia já está entre as 3 que você listou. Se nenhuma servir, aí sim chame a tool de novo e ofereça outras 3.';

async function main() {
  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, { headers: H })).json();
  if (!wf.nodes) throw new Error('GET falhou: ' + JSON.stringify(wf).slice(0, 300));
  const agent = wf.nodes.find((n) => n.name === 'AI Agent');
  if (!agent) throw new Error('sem nó "AI Agent"');
  const sm = agent.parameters.options.systemMessage;

  if (sm.includes(NOVA)) { console.log(`"${wf.name}": já tem a regra nova -- nada a fazer`); return; }
  if (!sm.includes(ANTIGA)) throw new Error('regra antiga não encontrada no systemMessage -- inspecionar manualmente');

  agent.parameters.options.systemMessage = sm.replace(ANTIGA, NOVA);
  console.log(`"${wf.name}": regra de apresentação de horários reescrita`);

  const eraAtivo = wf.active === true;
  const put = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings }),
  });
  const pb = await put.json();
  if (!put.ok) throw new Error(`PUT falhou: ${put.status} ${JSON.stringify(pb).slice(0, 400)}`);
  console.log(`PUT ${put.status} | active=${pb.active}`);

  if (eraAtivo) {
    const act = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}/activate`, { method: 'POST', headers: H });
    const ab = await act.json();
    const ok = ab.versionId && ab.versionId === ab.activeVersionId;
    console.log(`activate ${act.status} | draft==ativo=${ok}`);
    if (!ok) throw new Error('draft != ativo depois do activate');
  }
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
