// Aplica o prompt compilado (scripts/compilar-prompt-clinica.js a partir de
// scripts/variaveis-clinica-demo.json) no node "AI Agent" do workflow
// "Lumi - Standalone" -- clínica fictícia usada só pro painel_demo, sem
// relação com a Dra. Aline real (nome, endereço e preço são inventados).
//
// uso: node n8n/scripts/aplica-prompt-clinica-demo.js
require('dotenv').config({ path: __dirname + '/../.env' });
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };
const workflowId = '9PsUjET74L2NblWv'; // Lumi - Standalone

const promptCompilado = fs
  .readFileSync(path.join(__dirname, '..', '..', 'scripts', 'variaveis-clinica-demo.compilado.txt'), 'utf8')
  .trim();

async function main() {
  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, { headers: H })).json();
  if (!wf.nodes) throw new Error('GET falhou: ' + JSON.stringify(wf));
  if (wf.active && wf.versionId !== wf.activeVersionId) throw new Error('draft != ativo -- roda realinha-draft.js antes');

  const agent = wf.nodes.find((n) => n.name === 'AI Agent');
  if (!agent) throw new Error('node "AI Agent" nao encontrado');

  const alvo = agent.parameters.options?.systemMessage !== undefined ? 'options' : 'raiz';
  const atual = alvo === 'options' ? agent.parameters.options.systemMessage : agent.parameters.systemMessage;

  if (!atual.includes('Dra. Aline')) {
    console.log('já parece aplicado (não contém mais "Dra. Aline") -- nada a fazer');
    return;
  }

  if (alvo === 'options') agent.parameters.options.systemMessage = promptCompilado;
  else agent.parameters.systemMessage = promptCompilado;

  if (!wf.nodes.some((n) => n.name === 'Sticky Prompt Clinica Demo 04/09')) {
    wf.nodes.push({
      parameters: {
        content:
          '## 🔴 04/09: Prompt trocado pra clínica fictícia de demo\nEra o prompt real da Dra. Aline (clonado do PROD). Agora é\n"Dra. Camila Duarte / Clínica Sorriso Digital" -- nome, endereço\ne preço inventados de propósito, sem relação com a Dra. Aline\nreal. Compilado de Template_Prompt_Assistente_IA.md via\nscripts/compilar-prompt-clinica.js + variaveis-clinica-demo.json.',
        height: 260,
        width: 460,
        color: 3,
      },
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [(agent.position?.[0] ?? 0) - 40, (agent.position?.[1] ?? 0) - 320],
      id: 'sticky-prompt-clinica-demo-' + workflowId.slice(0, 8),
      name: 'Sticky Prompt Clinica Demo 04/09',
    });
  }

  const put = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings }),
  });
  const pb = await put.json();
  if (!put.ok) throw new Error(`PUT falhou: ${put.status} ${JSON.stringify(pb)}`);

  // Standalone fica INATIVO por padrão nesta sessão (não reativa sozinho) --
  // só reativa se já estava ativo antes desta mudança.
  if (wf.active) {
    const act = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}/activate`, { method: 'POST', headers: H });
    console.log('activate:', act.status);
  }

  await new Promise((r) => setTimeout(r, 1500));
  const verificacao = await (await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, { headers: H })).json();
  const agentVerif = verificacao.nodes.find((n) => n.name === 'AI Agent');
  const textoFinal = agentVerif.parameters.options?.systemMessage ?? agentVerif.parameters.systemMessage;
  const okTroca = textoFinal.includes('Dra. Camila Duarte') && !textoFinal.includes('Dra. Aline');
  console.log(`PUT ${put.status} | prompt trocado=${okTroca} | tamanho=${textoFinal.length} | active=${verificacao.active}`);
  if (!okTroca) throw new Error('verificacao FALHOU -- conferir na UI');
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
