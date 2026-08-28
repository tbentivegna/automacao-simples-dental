// Fix do truncamento de mensagens multi-bloco no WhatsApp.
//
// Sintoma (prod, desde 24/08): toda resposta da Lumi com 2+ paragrafos
// chega cortada no 1o bloco no WhatsApp. O texto completo aparece certo no
// painel (que le de n8n_chat_histories, gravado noutro caminho).
//
// Causa (confirmada na execucao 2901): o node `n8n-nodes-evolution-api`
// so processa o 1o item da entrada. "Divide Mensagem em Blocos" gerava 3
// itens; "Presença Bloco" e "Envia Bloco" rodavam 1x cada. Enquanto
// existia o "Loop Blocos" (Split In Batches) alimentando 1 bloco por vez,
// isso ficava mascarado -- a remocao dele (fix de reuso, 24/08) expos o
// bug.
//
// Fix: o fluxo principal passa a chamar o sub-workflow "Lumi - Envia
// Blocos" (M2mJfPhd6fxPZ1ev) UMA VEZ POR BLOCO, via Execute Workflow em
// modo "run once for each item" + waitForSubWorkflow. Cada bloco = uma
// execucao nova do sub-workflow => o node Evolution sempre recebe 1 item
// (caminho bom) e nao ha node com estado pra quebrar em re-entrancia.
//
// - "Divide Mensagem em Blocos": passa a emitir os campos prontos pro
//   sub-workflow (instanceName, remoteJid, messageText JA com o prefixo
//   **[Lumi]:** no bloco 0, presenceDelay). Campos antigos preservados.
// - "Presença Bloco" e "Envia Bloco" REMOVIDOS do fluxo principal (viram
//   os nodes de mesmo nome DENTRO do sub-workflow, iguais aos de hoje).
// - "Divide Mensagem em Blocos" -> "Envia Blocos (sub)".
//
// uso: node n8n/scripts/fix-envio-blocos-multiplos.js <workflowId>
//   DEV  = yFSw0JMMD93EGZMa
//   PROD = K2xRqOwS0N0AcoqG   (so com OK explicito do Tiago)
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const SUBWF_ID = 'M2mJfPhd6fxPZ1ev';

const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node fix-envio-blocos-multiplos.js <workflowId>');

const NOVO_JSCODE = `const items = $input.all();
const output = [];
const instance = $('Extrai JSON').first().json.Instance;
const from = $('Extrai JSON').first().json.From;
const fallbackMessage = $('Extrai JSON').first().json.message ?? "";
for (const item of items) {
  // O historico agora contem mensagens da equipe humana marcadas com
  // "[Equipe da clinica]:". O modelo tende a IMITAR esse prefixo e acaba
  // escrevendo ele na propria resposta (confirmado em teste real contra a
  // API). O prompt ja pede pra nao fazer isso, mas imitacao de padrao as
  // vezes escapa -- entao removemos aqui, de forma deterministica, antes
  // de qualquer coisa ser enviada ao paciente.
  const raw = (item.json.message ?? fallbackMessage)
    .replace(/^[ \\t]*\\[Equipe da cl[ií]nica\\]:[ \\t]*/gim, "");
  // Divide por paragrafos (linha em branco entre blocos)
  let blocks = raw
    .split(/\\n\\s*\\n/)
    .map(b => b.trim())
    .filter(b => b.length > 0);
  // Funde blocos curtos demais (ex: so um emoji) com o anterior, pra nao
  // virar uma mensagem "solta" estranha
  const MIN_CHARS = 6;
  const merged = [];
  for (const b of blocks) {
    if (merged.length > 0 && b.length < MIN_CHARS) {
      merged[merged.length - 1] += "\\n" + b;
    } else {
      merged.push(b);
    }
  }
  blocks = merged;
  // Limita a no maximo 3 mensagens seguidas, pra nao virar spam.
  // Se tiver mais blocos que isso, junta o excedente no ultimo.
  const MAX_BLOCKS = 3;
  if (blocks.length > MAX_BLOCKS) {
    const head = blocks.slice(0, MAX_BLOCKS - 1);
    const tail = blocks.slice(MAX_BLOCKS - 1).join("\\n");
    blocks = [...head, tail];
  }
  if (blocks.length === 0) {
    blocks = [raw];
  }
  blocks.forEach((block, index) => {
    output.push({
      json: {
        ...item.json,
        Instance: instance,
        From: from,
        messageBlock: block,
        blockIndex: index,
        totalBlocks: blocks.length,
        // Campos prontos pro sub-workflow "Lumi - Envia Blocos" (chamado
        // 1x por bloco). messageText ja leva o prefixo **[Lumi]:** so no
        // bloco 0, igual ao comportamento antigo do node "Envia Bloco".
        instanceName: instance,
        remoteJid: from,
        messageText: (index === 0 ? "**[Lumi]:** " : "") + block,
        presenceDelay: Math.min(4000, Math.max(1000, block.length * 35)),
      }
    });
  });
}
return output;`;

async function main() {
  const wf = await (
    await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, { headers: { 'X-N8N-API-KEY': API_KEY } })
  ).json();
  if (!wf.nodes) throw new Error('GET falhou: ' + JSON.stringify(wf));

  const divide = wf.nodes.find((n) => n.name === 'Divide Mensagem em Blocos');
  if (!divide) throw new Error('node "Divide Mensagem em Blocos" nao encontrado');

  // 1. novo codigo do Divide
  divide.parameters.jsCode = NOVO_JSCODE;

  // 2. remove Presença Bloco / Envia Bloco do fluxo principal
  const posEnvia = (wf.nodes.find((n) => n.name === 'Envia Bloco') || {}).position || [
    divide.position[0] + 260,
    divide.position[1],
  ];
  wf.nodes = wf.nodes.filter((n) => n.name !== 'Presença Bloco' && n.name !== 'Envia Bloco');

  // 3. adiciona (ou atualiza) o node Execute Workflow "Envia Blocos (sub)"
  const subNodeDef = {
    parameters: {
      workflowId: { __rl: true, value: SUBWF_ID, mode: 'id', cachedResultName: 'Lumi - Envia Blocos' },
      mode: 'each',
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {},
        matchingColumns: [],
        schema: [],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: { waitForSubWorkflow: true },
    },
    type: 'n8n-nodes-base.executeWorkflow',
    typeVersion: 1.2,
    position: [posEnvia[0], posEnvia[1]],
    id: 'envia-blocos-sub-' + workflowId.slice(0, 8),
    name: 'Envia Blocos (sub)',
  };
  const jaTem = wf.nodes.findIndex((n) => n.name === 'Envia Blocos (sub)');
  if (jaTem >= 0) wf.nodes[jaTem] = subNodeDef;
  else wf.nodes.push(subNodeDef);

  // 4. reconecta: Divide -> Envia Blocos (sub); limpa conexoes orfas
  delete wf.connections['Presença Bloco'];
  delete wf.connections['Envia Bloco'];
  wf.connections['Divide Mensagem em Blocos'] = {
    main: [[{ node: 'Envia Blocos (sub)', type: 'main', index: 0 }]],
  };

  // 5. red sticky
  if (!wf.nodes.some((n) => n.name === 'Sticky Fix Envio Blocos')) {
    wf.nodes.push({
      parameters: {
        content:
          '## 🔴 FIX 28/08: envio de blocos multiplos\nO node `n8n-nodes-evolution-api` so processa o 1o item da entrada.\nSem o "Loop Blocos" (removido 24/08), resposta com 2+ paragrafos era\ncortada no 1o bloco no WhatsApp.\n\nAgora "Divide Mensagem em Blocos" -> "Envia Blocos (sub)" (Execute\nWorkflow "Lumi - Envia Blocos", 1x por bloco, run-once-for-each-item\n+ waitForSubWorkflow). Cada bloco = execucao nova => Evolution recebe\n1 item so, e nao ha estado pra quebrar em re-entrancia.',
        height: 260,
        width: 460,
        color: 3,
      },
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [divide.position[0] - 40, divide.position[1] - 300],
      id: 'sticky-fix-envio-blocos-' + workflowId.slice(0, 8),
      name: 'Sticky Fix Envio Blocos',
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
  console.log('OK, aplicado em', workflowId, '| active =', body.active);
}

main().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
