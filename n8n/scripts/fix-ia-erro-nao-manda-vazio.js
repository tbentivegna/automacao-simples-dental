// Achado testando standalone-bridge (03/09): quando a chamada pra IA
// falha de verdade (rate limit da Mistral, 429, timeout etc.), o node "AI
// Agent" não lança erro -- captura dentro do próprio item de saída
// ({error: "..."}, sem nenhum campo "output"). "Extrai JSON" tratava isso
// como resposta vazia normal (`$json.output ?? ""` -> string vazia) e o
// resto do pipeline mandava pro paciente uma mensagem quase em branco (só
// o prefixo "**[Lumi]:** ", sem texto nenhum) -- pior que não responder.
//
// Fix: detecta esse caso ANTES de qualquer outra lógica (erro presente E
// sem "output" válido) e devolve um pedido educado pra repetir, nunca o
// vazio. Não muda nenhum outro comportamento -- resposta normal vazia
// (sem "error") continua caindo no fluxo de sempre.
//
// uso: node n8n/scripts/fix-ia-erro-nao-manda-vazio.js <workflowId>
//   DEV  = yFSw0JMMD93EGZMa
//   PROD = K2xRqOwS0N0AcoqG
require('dotenv').config({ path: __dirname + '/../.env' });
const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node fix-ia-erro-nao-manda-vazio.js <workflowId>');

const ANCHOR = `let text = ($json.output ?? "").replace(/^\\s*\\[Equipe da cl\\u00ednica\\]:\\s*/i, "");`;

const REPLACEMENT = `// Rede de seguranca 3 (03/09, achado testando standalone-bridge): quando
// a chamada pra IA falha de verdade (rate limit da Mistral, timeout,
// etc.), o node AI Agent as vezes nao lanca erro -- captura o erro DENTRO
// do proprio item de saida ({error: "..."}, sem nenhum campo "output").
// Sem essa checagem, o codigo abaixo tratava isso como "resposta vazia
// normal" e mandava pro paciente uma mensagem quase em branco (so o
// prefixo "**[Lumi]:** ", sem nenhum texto) -- pior do que nao responder
// nada. Detecta esse caso ANTES de qualquer outra logica e devolve um
// pedido educado pra repetir, nunca o vazio.
if (typeof $json.output !== "string" && $json.error) {
  return {
    hasAction: false,
    message: "Desculpa, tive um probleminha técnico bem rápido aqui 😅 Pode repetir sua última mensagem?",
    Instance: $('Edit Fields').first().json.Instance,
    From: $('Edit Fields').first().json.From,
  };
}

let text = ($json.output ?? "").replace(/^\\s*\\[Equipe da cl\\u00ednica\\]:\\s*/i, "");`;

async function main() {
  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, { headers: H })).json();
  if (!wf.nodes) throw new Error('GET falhou: ' + JSON.stringify(wf));
  if (wf.active && wf.versionId !== wf.activeVersionId) throw new Error('draft != ativo -- roda realinha-draft.js antes');

  const node = wf.nodes.find((n) => n.name === 'Extrai JSON');
  if (!node) throw new Error('node "Extrai JSON" nao encontrado');

  let codigo = node.parameters.jsCode.replace(/\r\n/g, '\n');

  if (codigo.includes('Rede de seguranca 3 (03/09')) {
    console.log('ja aplicado -- nada a fazer');
    return;
  }
  if (!codigo.includes(ANCHOR)) {
    throw new Error('anchor nao encontrado no jsCode -- codigo base diferente do esperado, CONFERIR');
  }
  node.parameters.jsCode = codigo.replace(ANCHOR, REPLACEMENT);

  if (!wf.nodes.some((n) => n.name === 'Sticky Fix IA Erro Vazio 03/09')) {
    const ej = wf.nodes.find((n) => n.name === 'Extrai JSON');
    wf.nodes.push({
      parameters: {
        content:
          '## 🔴 FIX 03/09: IA falhou mandava mensagem vazia\nRate limit/erro da Mistral virava "**[Lumi]:** " sem texto\nnenhum pro paciente. Agora detecta {error} sem output e\nmanda um pedido educado pra repetir, nunca o vazio.',
          height: 220,
          width: 430,
        color: 3,
      },
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [(ej.position?.[0] ?? 0) - 40, (ej.position?.[1] ?? 0) - 1080],
      id: 'sticky-fix-ia-erro-vazio-' + workflowId.slice(0, 8),
      name: 'Sticky Fix IA Erro Vazio 03/09',
    });
  }

  const put = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings }),
  });
  const pb = await put.json();
  if (!put.ok) throw new Error(`PUT falhou: ${put.status} ${JSON.stringify(pb)}`);
  const act = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}/activate`, { method: 'POST', headers: H });
  const ab = await act.json();
  const ok = ab.versionId === ab.activeVersionId;
  const live = (ab.activeVersion?.nodes || ab.nodes).find((n) => n.name === 'Extrai JSON');
  const okTexto = live.parameters.jsCode.includes('Rede de seguranca 3 (03/09') && live.parameters.jsCode.includes('typeof $json.output !== "string" && $json.error');
  console.log(`PUT ${put.status} | activate ${act.status} | draft==active=${ok} | texto ok=${okTexto}`);
  if (!ok || !okTexto) throw new Error('verificacao FALHOU -- conferir na UI');
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
