// Pedido do usuário 24/08: a Lumi precisa diferenciar reação, figurinha,
// imagem, áudio e documento em vez de jogar tudo que não é texto puro na
// mesma rota de transcrição de áudio. Hoje o node IF "Text/Audio" só sabe
// "texto" vs "não-texto" -- qualquer coisa que caia no "não-texto" vai pro
// Groq Whisper como se fosse áudio, e quebra pra reação/figurinha/imagem
// (bug real já documentado em project_lumi_reaction_media_bug: reação
// falha benignamente, mas IMAGEM enviada por paciente é descartada em
// silêncio -- a Lumi nunca vê a foto).
//
// Fix: troca o IF "Text/Audio" por um Switch de 4 saídas (mesmo padrão já
// usado no fluxo da equipe, node "Tipo Msg Equipe"):
//   texto  -> conversation/extendedTextMessage (comportamento igual, sem
//             mudança -- vai pra "Set Mensagem Texto")
//   audio  -> audioMessage (comportamento igual, sem mudança -- vai pra
//             "Obter mídia em base64" -> transcrição Groq)
//   reacao -> reactionMessage/стickerMessage: sem ação (reação/figurinha
//             não carregam informação que precise de resposta -- já
//             documentado como benigno)
//   anexo  -> tudo mais (imagem, documento, vídeo, contato, localização...):
//             (a) segue pro pipeline normal com um texto-placeholder, pra
//             Lumi poder responder algo razoável ao paciente em vez de
//             quebrar a execução; (b) cria uma pendência determinística em
//             agent_actions (não depende do agente decidir isso sozinho --
//             mesma lógica de garantia por código de
//             feedback_prompt_vs_code_guarantees) pra Dra. Aline saber que
//             tem um anexo de paciente esperando revisão humana.
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node add-diferenciacao-tipo-mensagem.js <workflowId>');

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  const oldNode = wf.nodes.find((n) => n.name === 'Text/Audio');
  if (!oldNode) throw new Error('node Text/Audio nao encontrado');
  if (wf.nodes.some((n) => n.name === 'Tipo Msg Paciente')) {
    console.log('Ja aplicado (Tipo Msg Paciente existe) -- nada a fazer em', workflowId);
    return;
  }

  const [x, y] = oldNode.position;

  const condicao = (id, expr, outputKey) => ({
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
      conditions: [
        {
          id,
          leftValue: `={{ ${expr} }}`,
          rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        },
      ],
      combinator: 'and',
    },
    renameOutput: true,
    outputKey,
  });

  const switchNode = {
    parameters: {
      rules: {
        values: [
          condicao(
            'tmp-texto',
            `['conversation','extendedTextMessage'].includes($('Webhook').first().json.body.data.messageType)`,
            'texto'
          ),
          condicao(
            'tmp-audio',
            `$('Webhook').first().json.body.data.messageType === 'audioMessage'`,
            'audio'
          ),
          condicao(
            'tmp-reacao',
            `['reactionMessage','stickerMessage'].includes($('Webhook').first().json.body.data.messageType)`,
            'reacao'
          ),
          condicao(
            'tmp-anexo',
            `!['conversation','extendedTextMessage','audioMessage','reactionMessage','stickerMessage'].includes($('Webhook').first().json.body.data.messageType)`,
            'anexo'
          ),
        ],
      },
      options: {},
    },
    type: 'n8n-nodes-base.switch',
    typeVersion: 3.4,
    position: [x, y],
    id: 'tipo-msg-paciente-' + workflowId.slice(0, 8),
    name: 'Tipo Msg Paciente',
  };

  const setAnexo = {
    parameters: {
      assignments: {
        assignments: [
          {
            id: 'set-anexo-mensagem-' + workflowId.slice(0, 8),
            name: 'Mensagem',
            value:
              '=[Paciente enviou um anexo (imagem, documento, vídeo ou similar) que a Lumi ainda não consegue abrir]',
            type: 'string',
          },
        ],
      },
      options: {},
    },
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [x + 320, y + 420],
    id: 'set-mensagem-anexo-' + workflowId.slice(0, 8),
    name: 'Set Mensagem Anexo',
  };

  const registraPendenciaAnexo = {
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO agent_actions (from_phone, action, domain, detail)\nVALUES ('{{ $('Webhook').first().json.body.data.key.remoteJid }}', 'OUTROS', 'Geral', $1);",
      options: {
        queryReplacement:
          "={{ [ 'Paciente enviou um anexo do tipo \"' + $('Webhook').first().json.body.data.messageType + '\" que a Lumi ainda não consegue analisar -- pedir pra Dra. Aline conferir.' ] }}",
      },
    },
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.6,
    position: [x + 320, y + 620],
    id: 'registra-pendencia-anexo-' + workflowId.slice(0, 8),
    name: 'Registra Pendência Anexo',
    credentials: { postgres: { id: 'IM7As7mjQcGJIzzy', name: 'Postgres account' } },
  };

  const sticky = {
    parameters: {
      content:
        '## 🔴 FIX 24/08: diferencia tipo de mensagem\n"Text/Audio" (IF binário) virou "Tipo Msg Paciente" (Switch de\n4 saídas): texto, áudio, reação/figurinha (ignora, benigno) e\nanexo (imagem/documento/etc -- segue com texto-placeholder +\ncria pendência automática pra Dra. Aline revisar). Antes, tudo\nque não era texto puro ia pro Whisper como áudio e quebrava\n(imagem de paciente era descartada em silêncio).',
      height: 260,
      width: 420,
      color: 3,
    },
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [x - 60, y - 320],
    id: 'sticky-tipo-msg-' + workflowId.slice(0, 8),
    name: 'Sticky Tipo Msg Paciente',
  };

  wf.nodes = wf.nodes.filter((n) => n.name !== 'Text/Audio');
  wf.nodes.push(switchNode, setAnexo, registraPendenciaAnexo, sticky);

  // Reaponta qualquer conexão que apontava PRA "Text/Audio" como destino
  // (ex: saída do IF "fromMe") pro novo node "Tipo Msg Paciente".
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
