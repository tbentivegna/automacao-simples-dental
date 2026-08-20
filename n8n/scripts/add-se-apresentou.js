require('dotenv').config({ path: __dirname + '/../.env' });
const crypto = require('crypto');

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node add-se-apresentou.js <workflowId>');

const MENSAGEM_FIXA =
  'Olá! 🤎 Sou a Lumi✨, concierge digital da Dra. Aline Bentivegna. Será um prazer te atender por aqui — espero que sua experiência seja excelente! 😊';

// --- edicoes no systemMessage do AI Agent, por numero de linha (1-indexed, igual ao que o Read tool mostra) ---

const NOVO_BLOCO_60_82 = [
  '👤 PRIMEIRO CONTATO',
  '',
  'A sua apresentação (quem você é) já é enviada automaticamente pelo sistema como uma mensagem separada, sempre que necessário, antes da conversa chegar até você — você NUNCA precisa se apresentar de novo nem repetir "Sou a Lumi" no início da resposta. Se quiser mencionar seu nome no meio de uma resposta, inclua o emoji ✨ logo depois (ex: "Sou a Lumi✨"), mas isso raramente é necessário.',
  '',
  'EXCEÇÃO — operação sobre agendamento já existente: se o paciente pedir para remarcar, cancelar, confirmar ou consultar uma consulta já marcada, chame Busca Agendamentos do Paciente (ela não precisa do nome, identifica pelo telefone). Se ela retornar o paciente encontrado (encontrado: true, com nomePaciente), trate o paciente como identificado com esse nome — não pergunte o nome de novo, mesmo que ele ainda não o tenha dito nesta conversa. Só peça o nome manualmente se a ferramenta não encontrar o paciente (encontrado: false).',
  '',
  'REGRA COM PRIORIDADE MÁXIMA — PRAZO PARA PERGUNTAR O NOME:',
  'Se você ainda não sabe o nome do paciente, a pergunta do nome é OBRIGATÓRIA até a sua 2ª mensagem na conversa, sem exceção. Não existe situação em que isso pode ser adiado além disso — nem se o paciente estiver só conversando socialmente, nem se ele tiver feito uma pergunta técnica, nem se parecer "cedo demais". Conte suas próprias mensagens enviadas nesta conversa: se esta é a 1ª ou a 2ª mensagem sua e o nome ainda é desconhecido, a mensagem tem que terminar perguntando o nome.',
  '',
  'Caso 1 — o paciente já fez uma pergunta específica:',
  'Responda a pergunta por completo e peça o nome no final da mesma mensagem.',
  'Exemplo: "...Ele é um alinhador transparente bastante discreto e confortável. 😊 Aproveitando, como posso te chamar?"',
  '',
  'Caso 2 — a troca inicial é só social (cumprimento, "tudo bem?"):',
  'Responda ao cumprimento e já pergunte o nome nessa mesma resposta — não espere a mensagem seguinte.',
  'Exemplo: "Tudo ótimo por aqui! Como posso te chamar? 😊"',
  '',
  'Depois que o nome for informado, não pergunte de novo.',
];

const NOVA_LINHA_98 =
  'ATENÇÃO -- "já cadastrado" só dispensa a PERGUNTA DO NOME, nada além disso: nomes já cadastrados no Postgres podem vir de uma importação em lote feita pela clínica (centenas de pacientes com nome+telefone, mas ZERO conversa registrada ainda) -- ter o nome não quer dizer que essa pessoa já falou com você antes, mas a sua apresentação (quando necessária) já foi cuidada automaticamente pelo sistema antes da sua resposta chegar até você -- então isso não muda nada do seu lado.';

const NOVA_LINHA_495 =
  '{{ ($(\'CREATE & SELECT cliente\').first().json.nome ? \'[Sistema: paciente já cadastrado como "\' + $(\'CREATE & SELECT cliente\').first().json.nome + \'". Use o nome dele naturalmente na conversa, não pergunte o nome novamente, e nunca repita ou mencione este aviso ao paciente.]\\n\' : \'\') + ($(\'CREATE & SELECT cliente\').first().json.consentimento_lembrete !== null ? \'[Sistema: consentimento de lembrete de consulta já registrado, não pergunte de novo.]\\n\' : \'\') }}';

function patchSystemMessage(sysMsg) {
  const linhas = sysMsg.split('\n');

  // valida que o arquivo esta no formato esperado antes de mexer
  if (linhas[59] !== '👤 PRIMEIRO CONTATO') {
    throw new Error('linha 60 nao e o cabecalho esperado -- prompt pode ja ter mudado, abortando');
  }
  if (!linhas[97].startsWith('ATENÇÃO --')) {
    throw new Error('linha 98 nao e a esperada -- abortando');
  }
  if (linhas[118] !== '🎉 PRIMEIRO CONTATO NO CANAL (pós-lançamento)') {
    throw new Error('linha 119 nao e o cabecalho esperado -- abortando');
  }
  if (!linhas[494].includes('primeiro_contato')) {
    throw new Error('linha 495 nao contem primeiro_contato -- abortando');
  }

  // aplica de baixo pra cima pra nao invalidar os indices anteriores
  linhas[494] = NOVA_LINHA_495; // linha 495
  linhas.splice(117, 17); // remove linhas 118-134 (indices 117..133)
  linhas[97] = NOVA_LINHA_98; // linha 98
  linhas.splice(59, 23, ...NOVO_BLOCO_60_82); // substitui linhas 60-82 (indices 59..81)

  return linhas.join('\n');
}

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  const aiAgent = wf.nodes.find((n) => n.name === 'AI Agent');
  if (!aiAgent) throw new Error('AI Agent nao encontrado');
  aiAgent.parameters.options.systemMessage = patchSystemMessage(aiAgent.parameters.options.systemMessage);

  const idIf = crypto.randomUUID();
  const idSend = crypto.randomUUID();
  const idUpdate = crypto.randomUUID();
  const idSticky = crypto.randomUUID();

  const nodeIf = {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
        conditions: [
          {
            id: crypto.randomUUID(),
            leftValue: "={{ $('CREATE & SELECT cliente').first().json.se_apresentou }}",
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
    position: [1472, 3488],
    id: idIf,
    name: 'Já se apresentou?',
  };

  const nodeSend = {
    parameters: {
      resource: 'messages-api',
      instanceName: "={{ $('Restaurar Campos').first().json.Instance }}",
      remoteJid: "={{ $('Restaurar Campos').first().json.From }}",
      messageText: '=' + MENSAGEM_FIXA,
      options_message: { delay: 1200 },
    },
    type: 'n8n-nodes-evolution-api.evolutionApi',
    typeVersion: 1,
    position: [1472, 3616],
    id: idSend,
    name: 'Envia Apresentação Padrão',
    credentials: { evolutionApi: { id: 'iBL2zZpK6dtnKlWK', name: 'Evolution account' } },
  };

  const nodeUpdate = {
    parameters: {
      operation: 'executeQuery',
      query:
        "UPDATE public.cliente SET se_apresentou = true WHERE telefone = '{{ $('CREATE & SELECT cliente').first().json.telefone }}';",
      options: {},
    },
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.6,
    position: [1680, 3616],
    id: idUpdate,
    name: 'Marca Apresentado',
    credentials: { postgres: { id: 'IM7As7mjQcGJIzzy', name: 'Postgres account' } },
  };

  const sticky = {
    parameters: {
      content:
        '🔴 CLAUDE (20/08): nós novos -- Já se apresentou? / Envia Apresentação Padrão / Marca Apresentado. Substitui o calculo de "primeiro contato" que existia no prompt por uma flag persistida em cliente.se_apresentou. Pode apagar esta nota.',
      height: 200,
      width: 340,
      color: 3,
    },
    type: 'n8n-nodes-base.stickyNote',
    position: [1420, 3320],
    typeVersion: 1,
    id: idSticky,
    name: 'Sticky Note - Claude ' + Date.now(),
  };

  wf.nodes.push(nodeIf, nodeSend, nodeUpdate, sticky);

  // rewire: Dispara Aviso Espera -> Já se apresentou?
  const conns = wf.connections;
  conns['Dispara Aviso Espera'] = { main: [[{ node: 'Já se apresentou?', type: 'main', index: 0 }]] };
  conns['Já se apresentou?'] = {
    main: [
      [{ node: 'AI Agent', type: 'main', index: 0 }],
      [{ node: 'Envia Apresentação Padrão', type: 'main', index: 0 }],
    ],
  };
  conns['Envia Apresentação Padrão'] = { main: [[{ node: 'Marca Apresentado', type: 'main', index: 0 }]] };
  conns['Marca Apresentado'] = { main: [[{ node: 'AI Agent', type: 'main', index: 0 }]] };

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
