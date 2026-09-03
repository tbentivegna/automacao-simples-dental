// Troca o node "Mistral Cloud Chat Model" (Mistral, plano gratuito -- rate
// limit) por "OpenAI Chat Model" (gpt-5.4-mini, plano pago) em qualquer
// workflow "Lumi". A credencial OpenAI já foi criada pelo Tiago
// diretamente no n8n (id 62uywFMN3sJ9WRDR).
//
// gpt-5.4-mini, não gpt-4o-mini: confirmado via pesquisa (setembro/2026)
// que gpt-4o-mini está obsoleto -- o próprio código-fonte do node
// LmChatOpenAi do n8n avisa isso no builderHint ("Never use gpt-4o...").
// Preço real: $0.75/M input, $4.50/M output -- ainda assim irrelevante no
// volume desta clínica (uso real desde o início de produção simulado em
// menos de $1 total, ver conversa).
//
// Faz um swap completo: adiciona o node OpenAI novo, reconecta a entrada
// ai_languageModel do "AI Agent" pra ele, remove o node Mistral antigo.
// Não mexe em mais nada (prompt, tools, resto do grafo intactos).
//
// uso: node n8n/scripts/troca-mistral-por-openai.js <workflowId>
//   DEV        = yFSw0JMMD93EGZMa
//   PROD       = K2xRqOwS0N0AcoqG
//   Standalone = 9PsUjET74L2NblWv
require('dotenv').config({ path: __dirname + '/../.env' });
const crypto = require('crypto');
const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node troca-mistral-por-openai.js <workflowId>');

const CREDENCIAL_OPENAI = { id: '62uywFMN3sJ9WRDR', name: 'OpenAI account' };
const MODELO = 'gpt-5.4-mini';
const NOME_NODE_MISTRAL = 'Mistral Cloud Chat Model';
const NOME_NODE_OPENAI = 'OpenAI Chat Model';

async function main() {
  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, { headers: H })).json();
  if (!wf.nodes) throw new Error('GET falhou: ' + JSON.stringify(wf));
  if (wf.active && wf.versionId !== wf.activeVersionId) throw new Error('draft != ativo -- roda realinha-draft.js antes');

  if (wf.nodes.some((n) => n.name === NOME_NODE_OPENAI)) {
    console.log('ja aplicado -- nada a fazer');
    return;
  }

  const mistral = wf.nodes.find((n) => n.name === NOME_NODE_MISTRAL);
  if (!mistral) throw new Error(`node "${NOME_NODE_MISTRAL}" nao encontrado`);

  const conexoesMistral = wf.connections[NOME_NODE_MISTRAL];
  if (!conexoesMistral) throw new Error(`sem conexoes de saida pro node "${NOME_NODE_MISTRAL}" -- CONFERIR`);

  // Novo node OpenAI, na mesma posição do Mistral (facilita achar no canvas)
  const openaiNode = {
    parameters: {
      model: { mode: 'id', value: MODELO },
      options: { temperature: 0.1, maxRetries: 2 },
    },
    type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
    typeVersion: 1.3,
    position: mistral.position,
    id: 'openai-chat-model-' + crypto.randomUUID().slice(0, 8),
    name: NOME_NODE_OPENAI,
    credentials: { openAiApi: CREDENCIAL_OPENAI },
  };

  wf.nodes = wf.nodes.filter((n) => n.name !== NOME_NODE_MISTRAL);
  wf.nodes.push(openaiNode);

  wf.connections[NOME_NODE_OPENAI] = conexoesMistral;
  delete wf.connections[NOME_NODE_MISTRAL];

  if (!wf.nodes.some((n) => n.name === 'Sticky Troca OpenAI 03/09')) {
    wf.nodes.push({
      parameters: {
        content:
          '## 🔴 03/09: Mistral (grátis, rate limit) -> OpenAI (pago)\n' +
          'Modelo trocado pra gpt-5.4-mini via API própria (não mais\n' +
          'Mistral gratuito) -- resolve o rate limit sustentado que\n' +
          'afetou pacientes reais. Prompt/ferramentas/resto do grafo\n' +
          'intactos, só o node do modelo mudou.',
        height: 220,
        width: 460,
        color: 3,
      },
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [(openaiNode.position?.[0] ?? 0) - 40, (openaiNode.position?.[1] ?? 0) - 300],
      id: 'sticky-troca-openai-' + workflowId.slice(0, 8),
      name: 'Sticky Troca OpenAI 03/09',
    });
  }

  const put = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings }),
  });
  const pb = await put.json();
  if (!put.ok) throw new Error(`PUT falhou: ${put.status} ${JSON.stringify(pb)}`);

  // Só ativa se já estava ativo antes (não força estado)
  if (wf.active) {
    const act = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}/activate`, { method: 'POST', headers: H });
    console.log('activate:', act.status);
  }

  await new Promise((r) => setTimeout(r, 1500));
  const verificacao = await (await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, { headers: H })).json();
  const temOpenAI = verificacao.nodes.some((n) => n.name === NOME_NODE_OPENAI && n.credentials?.openAiApi?.id === CREDENCIAL_OPENAI.id);
  const semMistral = !verificacao.nodes.some((n) => n.name === NOME_NODE_MISTRAL);
  const conexaoCerta = JSON.stringify(verificacao.connections[NOME_NODE_OPENAI]) === JSON.stringify(conexoesMistral);
  console.log(`PUT ${put.status} | tem OpenAI=${temOpenAI} | sem Mistral=${semMistral} | conexão ok=${conexaoCerta} | active=${verificacao.active}`);
  if (!temOpenAI || !semMistral || !conexaoCerta) throw new Error('verificacao FALHOU -- conferir na UI');
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
