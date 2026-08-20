// Corrige a perda silenciosa de mensagens: hoje uma mensagem que chega
// enquanto a Lumi ainda esta processando a anterior e marcada como
// "processada" mesmo sem nunca ter sido de fato enviada pra IA -- ela so
// recebe (no maximo) o aviso de espera e o conteudo se perde pra sempre.
//
// Fix: so marca como processada quando o processamento realmente vai
// acontecer (depois do Define Lock, nao logo apos juntar as mensagens).
// Quando o lock e liberado, verifica se sobrou mensagem pendente na fila
// (quem chegou durante o processamento) e reprocessa automaticamente,
// sem precisar que o paciente mande mais uma mensagem pra "acordar" o fluxo.
require('dotenv').config({ path: __dirname + '/../.env' });
const crypto = require('crypto');

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node fix-debounce-requeue.js <workflowId>');

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  const marcarProcessadas = wf.nodes.find((n) => n.name === 'Debounce Marcar Processadas');
  const defineLock = wf.nodes.find((n) => n.name === 'Define Lock');
  const liberaLock = wf.nodes.find((n) => n.name === 'Libera Lock');
  if (!marcarProcessadas || !defineLock || !liberaLock) throw new Error('nos esperados nao encontrados -- workflow pode ter mudado');

  if (wf.nodes.find((n) => n.name === 'Debounce - Verifica Pendentes')) {
    console.log('ja aplicado, pulando');
    return;
  }

  // 1) "Debounce Marcar Processadas" so roda depois do Define Lock agora,
  // entao a query precisa referenciar o telefone de CREATE & SELECT cliente
  marcarProcessadas.parameters.query =
    "UPDATE public.whatsapp_debounce\nSET processado = true\nWHERE telefone = '{{ $('CREATE & SELECT cliente').first().json.telefone }}'\n  AND processado = false;";

  // 2) "Debounce - Juntar Mensagens" passa direto pro fluxo normal (pulando
  // a antiga posicao do Marcar Processadas)
  wf.connections['Debounce - Juntar Mensagens'] = {
    main: [[{ node: 'Restaurar Campos', type: 'main', index: 0 }]],
  };

  // 3) "Debounce Marcar Processadas" entra entre Define Lock e o que ele ja mandava pra
  const defineLockTargets = wf.connections['Define Lock'].main[0];
  wf.connections['Define Lock'] = { main: [[{ node: 'Debounce Marcar Processadas', type: 'main', index: 0 }]] };
  wf.connections['Debounce Marcar Processadas'] = { main: [defineLockTargets] };

  // 4) novos nos: ao liberar o lock, verifica se ficou mensagem pendente
  // (quem chegou durante o processamento) e, se sim, reprocessa
  const idVerifica = crypto.randomUUID();
  const idIf = crypto.randomUUID();

  const nodeVerifica = {
    parameters: {
      operation: 'executeQuery',
      query:
        "(SELECT true AS tem_pendente, telefone\nFROM public.whatsapp_debounce\nWHERE telefone = '{{ $('Extrai JSON').first().json.From }}'\n  AND processado = false\nLIMIT 1)\n\nUNION ALL\n\nSELECT false AS tem_pendente, '{{ $('Extrai JSON').first().json.From }}' AS telefone\nWHERE NOT EXISTS (\n  SELECT 1 FROM public.whatsapp_debounce\n  WHERE telefone = '{{ $('Extrai JSON').first().json.From }}'\n    AND processado = false\n);",
      options: {},
    },
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.6,
    position: [liberaLock.position[0] + 260, liberaLock.position[1]],
    id: idVerifica,
    name: 'Debounce - Verifica Pendentes',
    credentials: { postgres: { id: 'IM7As7mjQcGJIzzy', name: 'Postgres account' } },
  };

  const nodeIf = {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
        conditions: [
          {
            id: crypto.randomUUID(),
            leftValue: '={{ $json.tem_pendente }}',
            rightValue: '',
            operator: { type: 'boolean', operation: 'true', singleValue: true },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position: [liberaLock.position[0] + 520, liberaLock.position[1]],
    id: idIf,
    name: 'Tem Mensagem Pendente?',
  };

  wf.nodes.push(nodeVerifica, nodeIf);

  wf.connections['Libera Lock'] = { main: [[{ node: 'Debounce - Verifica Pendentes', type: 'main', index: 0 }]] };
  wf.connections['Debounce - Verifica Pendentes'] = { main: [[{ node: 'Tem Mensagem Pendente?', type: 'main', index: 0 }]] };
  wf.connections['Tem Mensagem Pendente?'] = {
    main: [[{ node: 'Debounce - Juntar Mensagens', type: 'main', index: 0 }], []],
  };

  const sticky = {
    parameters: {
      content:
        '🔴 Fix debounce (20/08): mensagem que chegava durante o processamento da anterior era marcada como "processada" sem nunca ir pra IA -- se perdia de vez (so o paciente Cristiane Maciel). Agora so marca como processada quando realmente vai processar (depois do Define Lock), e ao liberar o lock verifica se sobrou mensagem na fila e reprocessa sozinho. Pode apagar esta nota.',
      height: 260,
      width: 380,
      color: 3,
    },
    type: 'n8n-nodes-base.stickyNote',
    position: [liberaLock.position[0] + 100, liberaLock.position[1] + 220],
    typeVersion: 1,
    id: crypto.randomUUID(),
    name: 'Sticky Note - Claude ' + Date.now(),
  };
  wf.nodes.push(sticky);

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

main().catch((err) => { console.error('ERRO:', err.message); process.exit(1); });
