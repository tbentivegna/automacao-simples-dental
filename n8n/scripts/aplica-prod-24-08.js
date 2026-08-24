// Aplica em produção (K2xRqOwS0N0AcoqG) os 3 fixes já testados e
// confirmados no DEV (yFSw0JMMD93EGZMa) em 24/08:
//   1. Truncamento por vírgula (Debounce - Salvar Mensagem, Registrar Ação)
//   2. Diferenciação de tipo de mensagem (Switch "Tipo Msg Paciente" no
//      lugar do IF "Text/Audio") + legenda de anexo preservada
//   3. Remoção do "Loop Blocos" (bug de reuso de Split In Batches)
//
// Pedido explícito do Tiago: preservar o layout que ele ajustou manualmente
// no DEV. Por isso os nodes novos usam as POSIÇÕES ATUAIS do DEV (copiadas
// literalmente), em vez de recalcular offsets do zero como os scripts
// originais fizeram. Os 2 sticky notes que ele apagou no DEV durante a
// limpeza (Sticky Tipo Msg Paciente, Sticky Fix Virgula) também não são
// recriados aqui -- só o "Sticky Fix Loop Blocos", que ainda existe no DEV.
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const PROD_ID = 'K2xRqOwS0N0AcoqG';

async function getWorkflow(id) {
  const res = await fetch(`${BASE_URL}/api/v1/workflows/${id}`, { headers: { 'X-N8N-API-KEY': API_KEY } });
  if (!res.ok) throw new Error(`GET ${id} falhou: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const wf = await getWorkflow(PROD_ID);

  if (wf.nodes.some((n) => n.name === 'Tipo Msg Paciente')) {
    console.log('Ja aplicado em producao -- nada a fazer.');
    return;
  }

  // --- 1. Fix da vírgula ---
  const debounce = wf.nodes.find((n) => n.name === 'Debounce - Salvar Mensagem');
  const registrarAcao = wf.nodes.find((n) => n.name === 'Registrar Ação');
  if (!debounce || !registrarAcao) throw new Error('nos do fix de virgula nao encontrados');
  debounce.parameters.options.queryReplacement = '={{ [$json.Mensagem] }}';
  registrarAcao.parameters.options.queryReplacement = '={{ [$json.detail] }}';

  // --- 2. Diferenciação de tipo de mensagem (posições copiadas do DEV) ---
  const oldNode = wf.nodes.find((n) => n.name === 'Text/Audio');
  if (!oldNode) throw new Error('Text/Audio nao encontrado');

  const switchNode = {
    parameters: {
      rules: {
        values: [
          {
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
              conditions: [
                {
                  id: 'tmp-texto',
                  leftValue:
                    "={{ ['conversation','extendedTextMessage'].includes($('Webhook').first().json.body.data.messageType) }}",
                  rightValue: '',
                  operator: { type: 'boolean', operation: 'true', singleValue: true },
                },
              ],
              combinator: 'and',
            },
            renameOutput: true,
            outputKey: 'texto',
          },
          {
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
              conditions: [
                {
                  id: 'tmp-audio',
                  leftValue: "={{ $('Webhook').first().json.body.data.messageType === 'audioMessage' }}",
                  rightValue: '',
                  operator: { type: 'boolean', operation: 'true', singleValue: true },
                },
              ],
              combinator: 'and',
            },
            renameOutput: true,
            outputKey: 'audio',
          },
          {
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
              conditions: [
                {
                  id: 'tmp-reacao',
                  leftValue:
                    "={{ ['reactionMessage','stickerMessage'].includes($('Webhook').first().json.body.data.messageType) }}",
                  rightValue: '',
                  operator: { type: 'boolean', operation: 'true', singleValue: true },
                },
              ],
              combinator: 'and',
            },
            renameOutput: true,
            outputKey: 'reacao',
          },
          {
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
              conditions: [
                {
                  id: 'tmp-anexo',
                  leftValue:
                    "={{ !['conversation','extendedTextMessage','audioMessage','reactionMessage','stickerMessage'].includes($('Webhook').first().json.body.data.messageType) }}",
                  rightValue: '',
                  operator: { type: 'boolean', operation: 'true', singleValue: true },
                },
              ],
              combinator: 'and',
            },
            renameOutput: true,
            outputKey: 'anexo',
          },
        ],
      },
      options: {},
    },
    type: 'n8n-nodes-base.switch',
    typeVersion: 3.4,
    position: [-4496, 1696], // posição atual em DEV
    id: 'tipo-msg-paciente-K2xRqOwS',
    name: 'Tipo Msg Paciente',
  };

  const legendaExpr =
    "$('Webhook').first().json.body.data.message[$('Webhook').first().json.body.data.messageType]?.caption";

  const setAnexo = {
    parameters: {
      assignments: {
        assignments: [
          {
            id: 'set-anexo-mensagem-K2xRqOwS',
            name: 'Mensagem',
            value: `={{ ${legendaExpr} ? ('[Paciente enviou um anexo (imagem, documento, vídeo ou similar) com esta legenda: "' + ${legendaExpr} + '"]') : '[Paciente enviou um anexo (imagem, documento, vídeo ou similar) que a Lumi ainda não consegue abrir]' }}`,
            type: 'string',
          },
        ],
      },
      options: {},
    },
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [-4208, 1776], // posição atual em DEV
    id: 'set-mensagem-anexo-K2xRqOwS',
    name: 'Set Mensagem Anexo',
  };

  const registraPendenciaAnexo = {
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO agent_actions (from_phone, action, domain, detail)\nVALUES ('{{ $('Webhook').first().json.body.data.key.remoteJid }}', 'OUTROS', 'Geral', $1);",
      options: {
        queryReplacement: `={{ [ 'Paciente enviou um anexo do tipo "' + $('Webhook').first().json.body.data.messageType + '"' + (${legendaExpr} ? (' com a legenda: "' + ${legendaExpr} + '"') : '') + ' -- pedir pra Dra. Aline conferir.' ] }}`,
      },
    },
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.6,
    position: [-4208, 1936], // posição atual em DEV
    id: 'registra-pendencia-anexo-K2xRqOwS',
    name: 'Registra Pendência Anexo',
    credentials: { postgres: { id: 'IM7As7mjQcGJIzzy', name: 'Postgres account' } },
  };

  wf.nodes = wf.nodes.filter((n) => n.name !== 'Text/Audio');
  wf.nodes.push(switchNode, setAnexo, registraPendenciaAnexo);

  for (const sourceName of Object.keys(wf.connections)) {
    const outputs = wf.connections[sourceName]?.main || [];
    for (const output of outputs) {
      for (const conn of output || []) {
        if (conn.node === 'Text/Audio') conn.node = 'Tipo Msg Paciente';
      }
    }
  }
  delete wf.connections['Text/Audio'];
  wf.connections['Tipo Msg Paciente'] = {
    main: [
      [{ node: 'Set Mensagem Texto', type: 'main', index: 0 }],
      [{ node: 'Obter m dia em base64', type: 'main', index: 0 }],
      [],
      [
        { node: 'Set Mensagem Anexo', type: 'main', index: 0 },
        { node: 'Registra Pendência Anexo', type: 'main', index: 0 },
      ],
    ],
  };
  wf.connections['Set Mensagem Anexo'] = { main: [[{ node: 'Edit Fields', type: 'main', index: 0 }]] };

  // --- 3. Remove Loop Blocos ---
  const presencaBloco = wf.nodes.find((n) => n.name === 'Presença Bloco');
  const enviaBloco = wf.nodes.find((n) => n.name === 'Envia Bloco');
  if (!presencaBloco || !enviaBloco) throw new Error('nos do fix de loop nao encontrados');
  const trocaReferencia = (obj) =>
    JSON.parse(JSON.stringify(obj).replaceAll("$('Loop Blocos')", "$('Divide Mensagem em Blocos')"));
  presencaBloco.parameters = trocaReferencia(presencaBloco.parameters);
  enviaBloco.parameters = trocaReferencia(enviaBloco.parameters);

  wf.nodes = wf.nodes.filter((n) => n.name !== 'Loop Blocos');
  wf.connections['Divide Mensagem em Blocos'] = {
    main: [[{ node: 'Presença Bloco', type: 'main', index: 0 }]],
  };
  delete wf.connections['Loop Blocos'];
  wf.connections['Envia Bloco'] = { main: [[]] };

  wf.nodes.push({
    parameters: {
      content:
        '## 🔴 FIX 24/08: remove Loop Blocos (Split In Batches)\nEsse node tem estado por execução e quebra quando o fluxo re-entra\naqui uma 2ª vez na mesma execução (self-loop de mensagem pendente) --\n0 blocos eram enviados na 2ª resposta, sem erro. "Divide Mensagem em\nBlocos" já entrega os itens separados; "Presença Bloco"/"Envia Bloco"\nprocessam sequencialmente sem precisar de loop dedicado.',
      height: 220,
      width: 420,
      color: 3,
    },
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [presencaBloco.position[0] - 60, presencaBloco.position[1] - 260],
    id: 'sticky-fix-loop-blocos-K2xRqOwS',
    name: 'Sticky Fix Loop Blocos',
  });

  const payload = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings };
  const putRes = await fetch(`${BASE_URL}/api/v1/workflows/${PROD_ID}`, {
    method: 'PUT',
    headers: { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await putRes.json();
  if (!putRes.ok) throw new Error(`PUT falhou: ${putRes.status} ${JSON.stringify(body)}`);
  console.log('Aplicado com sucesso em produção', PROD_ID, '| active=', body.active);
}

main().catch((err) => {
  console.error('ERRO:', err.message);
  process.exit(1);
});
