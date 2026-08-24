// Bug real, confirmado com dados de execução ao vivo (21/08, caso Selen
// Yaokiti): o node Postgres "Debounce - Salvar Mensagem" perdia tudo que
// vinha depois da primeira vírgula na mensagem do paciente ao salvar.
// Confirmado node a node: "Set Mensagem Texto" (upstream) tinha os 124
// caracteres completos (endereço com número + e-mail), mas o próprio
// RETURNING do INSERT em "Debounce - Salvar Mensagem" já voltava com só 95
// caracteres, cortado exatamente antes da vírgula em "Rua das margaridas, 80".
// Selen perdeu o número da casa e o e-mail; a Lumi pediu de novo sem saber
// que a informação já tinha sido enviada -- perda de dado real, não só
// cosmética.
//
// Causa raiz: bug conhecido do node Postgres do n8n (v2.6) -- quando o campo
// "Query Parameters"/queryReplacement recebe uma expressão que resolve pra
// uma STRING contendo vírgula, o node tenta (re)interpretar o resultado como
// lista separada por vírgula e usa só o primeiro pedaço pra $1, descartando o
// resto. Confirmado como bug conhecido/reportado (n8n-io/n8n issues #14955 e
// #16354). Fix oficial da comunidade: envolver o valor num array literal na
// própria expressão -- {{ [valor] }} em vez de {{ valor }} -- assim o node
// usa o array como lista de parâmetros diretamente, sem tentar fatiar string.
//
// Mesmo fix aplicado preventivamente em "Registrar Ação" (mesma exposição:
// {{ $json.detail }} bruto alimentando $1 de texto livre) -- o detail de uma
// pendência pode facilmente conter vírgula (datas, horários, listas), e é
// exatamente o tipo de dado que não pode ser perdido silenciosamente.
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node fix-comma-truncation.js <workflowId>');

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  const debounce = wf.nodes.find((n) => n.name === 'Debounce - Salvar Mensagem');
  const registrarAcao = wf.nodes.find((n) => n.name === 'Registrar Ação');
  if (!debounce || !registrarAcao) throw new Error('nos esperados nao encontrados');

  debounce.parameters.options.queryReplacement = '={{ [$json.Mensagem] }}';
  registrarAcao.parameters.options.queryReplacement = '={{ [$json.detail] }}';

  const jaTemSticky = wf.nodes.some((n) => n.name === 'Sticky Fix Virgula');
  if (!jaTemSticky) {
    wf.nodes.push({
      parameters: {
        content:
          '## 🔴 FIX 24/08: truncamento por vírgula\nEsses 2 nodes (Debounce - Salvar Mensagem, Registrar Ação) perdiam tudo\napós a primeira vírgula do texto ao salvar (bug conhecido do node Postgres\ndo n8n com Query Parameters). Corrigido envolvendo o valor num array:\n{{ [$json.campo] }} em vez de {{ $json.campo }}.',
        height: 220,
        width: 380,
        color: 3,
      },
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [debounce.position[0] - 60, debounce.position[1] - 300],
      id: 'sticky-fix-virgula-' + workflowId.slice(0, 8),
      name: 'Sticky Fix Virgula',
    });
  }

  const payload = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings };
  const putRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    headers: { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await putRes.json();
  if (!putRes.ok) throw new Error(`PUT falhou: ${putRes.status} ${JSON.stringify(body)}`);
  console.log('Aplicado com sucesso em', workflowId, '| active=', body.active);
}

main().catch((err) => {
  console.error('ERRO:', err.message);
  process.exit(1);
});
