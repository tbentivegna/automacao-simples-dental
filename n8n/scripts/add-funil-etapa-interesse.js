// Etapa "interesse" do funil de resgate (desenhada e simulada com o Tiago
// em 24/08 -- ver [[project_funil_resgate]] na memória): até aqui o funil
// só abria quando a Lumi chegava a oferecer horário real. Casos reais
// mostraram pacientes sumindo bem antes disso -- perguntaram sobre
// procedimento/valor e nunca mais responderam, e só a Dra. Aline percebeu
// dias depois, manualmente.
//
// Adiciona um ramo em PARALELO logo depois de "Debounce - Juntar
// Mensagens" (não interfere no fluxo principal): se a mensagem do paciente
// bate numa heurística de "sinal de interesse" (valor, como funciona,
// dúvida sobre procedimento, quer agendar...), abre uma tentativa em
// funil_agendamento com etapa='interesse' -- só se não existir outra
// tentativa em_andamento pro mesmo telefone já (WHERE NOT EXISTS, idempotente).
// server.js's abrirOuAtualizarFunil() promove pra 'horario_oferecido' se o
// paciente avançar até a oferta de horário de verdade.
//
// Testado em simulação (scripts/simula-funil-interesse.js) contra as 24
// conversas reais do banco: 1 acerto real (mãe da Isa, 111h de silêncio),
// zero falso-positivo (os outros 4 matches responderam em <1h).
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node add-funil-etapa-interesse.js <workflowId>');

const REGEX_INTERESSE_JS =
  "/\\b(valor|quanto custa|pre[çc]o|como funciona|avalia[çc][ãa]o|avaliar|gostaria de (marcar|agendar)|marcar (uma )?consulta|agendar (uma )?consulta|d[úu]vida|indica[çc][ãa]o|procedimento)\\b/i";

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  if (wf.nodes.some((n) => n.name === 'Tem Sinal de Interesse?')) {
    console.log('Ja aplicado (Tem Sinal de Interesse? existe) -- nada a fazer em', workflowId);
    return;
  }

  const juntar = wf.nodes.find((n) => n.name === 'Debounce - Juntar Mensagens');
  if (!juntar) throw new Error('Debounce - Juntar Mensagens nao encontrado');
  const [x, y] = juntar.position;

  const ifNode = {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
        conditions: [
          {
            id: 'tem-sinal-interesse',
            leftValue: `={{ ${REGEX_INTERESSE_JS}.test($json.mensagem) }}`,
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
    position: [x + 80, y + 260],
    id: 'tem-sinal-interesse-' + workflowId.slice(0, 8),
    name: 'Tem Sinal de Interesse?',
  };

  const abreFunilInteresse = {
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO public.funil_agendamento (telefone, instancia, etapa)\nSELECT '{{ $json.telefone }}', '{{ $json.instance }}', 'interesse'\nWHERE NOT EXISTS (\n  SELECT 1 FROM public.funil_agendamento\n  WHERE telefone = '{{ $json.telefone }}' AND status = 'em_andamento'\n);",
      options: {},
    },
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.6,
    position: [x + 360, y + 260],
    id: 'abre-funil-interesse-' + workflowId.slice(0, 8),
    name: 'Abre Funil Interesse',
    credentials: { postgres: { id: 'IM7As7mjQcGJIzzy', name: 'Postgres account' } },
  };

  wf.nodes.push(ifNode, abreFunilInteresse);

  // Branch em paralelo -- não mexe na conexão existente pra "Restaurar Campos".
  const conexoesAtuais = wf.connections['Debounce - Juntar Mensagens'].main[0] || [];
  wf.connections['Debounce - Juntar Mensagens'].main[0] = [
    ...conexoesAtuais,
    { node: 'Tem Sinal de Interesse?', type: 'main', index: 0 },
  ];
  wf.connections['Tem Sinal de Interesse?'] = {
    main: [[{ node: 'Abre Funil Interesse', type: 'main', index: 0 }], []],
  };

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
