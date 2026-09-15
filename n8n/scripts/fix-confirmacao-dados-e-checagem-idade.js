// Caso real Valentina Freitas de Lima (15/09/2026): ela conduziu toda a
// conversa sozinha, se apresentou por si, nunca sinalizou ser menor -- mas
// informou data de nascimento 11/05/2015, que dá 11 anos. A Lumi seguiu pelo
// caminho de PACIENTE ADULTO e chamou Cria Agendamento com nomeResponsavel
// vazio.
//
// No Simples Dental isso trava de forma SILENCIOSA: preencher a data de
// nascimento de um menor revela a seção "Dados do responsável", "Nome do
// responsável" vira obrigatório, e o "Salvar" simplesmente não conclui --
// sem erro, sem fechar o diálogo. Custou 26 tentativas reais em produção pra
// identificar (ver project_lumi_cadastro_paciente_novo_timeout_bug.md).
//
// Duas regras novas, pedidas pelo Tiago depois de fechar a causa raiz:
//   1) CHECAGEM DE IDADE pela data de nascimento -- < 18 anos é MENOR mesmo
//      sem nenhum sinal de dependência na conversa.
//   2) CONFIRMAÇÃO ESTRUTURADA dos dados antes de chamar Cria Agendamento,
//      com "não informado" nos campos que faltam.
//
// Testado no lumi-harness contra gpt-5.4-mini (o modelo real de produção):
// check-confirmacao-dados-e-idade 0/3 falhas nos 2 cenários;
// check-cadastro-dependente cenário B 0/3 e C 0/3; check-nao-trava-horarios
// 0/2 travadas.
//
// LIMPEZA DE STICKIES: pedido explícito do Tiago (15/09) -- remove TODAS as
// stickies vermelhas (color 3) anteriores e deixa só a desta mudança. O
// histórico completo está no git e nas memórias do projeto; as stickies
// acumuladas só poluíam o canvas. Só mexe em stickyNote com color===3 --
// stickies de outras cores (documentação estrutural do workflow) ficam.
//
// Idempotente. uso: node n8n/scripts/fix-confirmacao-dados-e-checagem-idade.js <workflowId>
require('dotenv').config({ path: __dirname + '/../.env' });
const crypto = require('crypto');

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node fix-confirmacao-dados-e-checagem-idade.js <workflowId>');

const ANCORA =
  'BLOQUEIO OBRIGATÓRIO: nunca chame Cria Agendamento pra um paciente novo (encontrado: false) sem ter perguntado ativamente E recebido, nesta conversa, todos os dados obrigatórios acima.';

const BLOCO_NOVO =
  '⚠️ CHECAGEM DE IDADE PELA DATA DE NASCIMENTO (obrigatória, roda SEMPRE): assim que receber a data de nascimento do paciente, calcule a idade. **Se der menos de 18 anos, o paciente é MENOR DE IDADE — mesmo que nada na conversa tenha indicado isso e mesmo que a pessoa esteja escrevendo sozinha e se apresentando por si.** Nesse caso você DEVE coletar os dados do responsável antes de chamar Cria Agendamento (o cadastro do Simples Dental exige o nome do responsável e não salva sem ele). Não assuma que quem escreve é adulto só porque conduziu a conversa sozinho. Se a data parecer não bater com o resto da conversa (ex: alguém que fala como adulto informando uma data que dá 11 anos), confirme gentilmente antes de seguir: "Só confirmando, a data de nascimento é [data] mesmo? 😊" — pode ser erro de digitação no ano.\n\n' +
  '✅ CONFIRMAÇÃO ESTRUTURADA DOS DADOS (obrigatória antes de chamar Cria Agendamento): depois de receber os dados e ANTES de chamar a tool, devolva TODOS eles numa lista pro paciente conferir. É a última chance de pegar um dado errado ou faltando antes de virar cadastro de verdade. Campos que o paciente não informou aparecem como "não informado" — nunca omita a linha e nunca invente o valor.\n\n' +
  'Modelo (paciente adulto):\n' +
  '"Só pra confirmar antes de agendar:\n' +
  'Nome: Maria Silva Santos\n' +
  'Data de nascimento: 12/03/1988\n' +
  'CPF: 123.456.789-00\n' +
  'CEP: 13.339-545\n' +
  'Número: 186\n' +
  'E-mail: não informado\n\n' +
  'Está tudo certo? 😊"\n\n' +
  'Modelo (paciente menor de idade — inclui as linhas do responsável):\n' +
  '"Só pra confirmar antes de agendar:\n' +
  'Paciente: Valentina Freitas de Lima\n' +
  'Data de nascimento: 11/05/2015\n' +
  'CPF do paciente: não informado\n' +
  'Responsável: Yasmin Karina de Lima\n' +
  'CPF do responsável: 123.456.789-00\n' +
  'CEP: 13.339-545\n' +
  'Número: 186\n' +
  'E-mail: yasmin@email.com\n\n' +
  'Está tudo certo? 😊"\n\n' +
  'Se o paciente corrigir algum dado, refaça a confirmação com a correção aplicada. Só chame Cria Agendamento depois de um "sim"/confirmação.\n\n';

const STICKY_NOME = 'Confirmacao de dados + checagem de idade (15/09)';

async function main() {
  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, { headers: H })).json();
  if (!wf.nodes) throw new Error('GET falhou: ' + JSON.stringify(wf).slice(0, 300));
  const agent = wf.nodes.find((n) => n.name === 'AI Agent');
  if (!agent) throw new Error('sem nó "AI Agent"');
  let sm = agent.parameters.options.systemMessage;

  // --- 1. Edição do prompt ---
  let mudouPrompt = false;
  if (sm.includes(BLOCO_NOVO)) {
    console.log('  [prompt] já aplicado -- pulando');
  } else {
    if (!sm.includes(ANCORA)) {
      throw new Error(
        'âncora do BLOQUEIO OBRIGATÓRIO (variante cadastro COMPLETO) não encontrada -- ' +
          'este workflow provavelmente usa a variante CADASTRO LEVE (standalone), que precisa de uma adaptação à parte. Inspecionar antes de continuar.'
      );
    }
    sm = sm.replace(ANCORA, BLOCO_NOVO + ANCORA);
    agent.parameters.options.systemMessage = sm;
    mudouPrompt = true;
    console.log(`  [prompt] aplicado (systemMessage ${sm.length} chars)`);
  }

  // --- 2. Limpeza das stickies vermelhas (pedido do Tiago, 15/09) ---
  const vermelhas = wf.nodes.filter(
    (n) => n.type === 'n8n-nodes-base.stickyNote' && n.parameters && n.parameters.color === 3 && n.name !== STICKY_NOME
  );
  if (vermelhas.length) {
    console.log(`  [stickies] removendo ${vermelhas.length} sticky(ies) vermelha(s) antiga(s):`);
    for (const s of vermelhas) {
      const titulo = String((s.parameters.content || '').split('\n')[0]).replace(/^#+\s*/, '').slice(0, 80);
      console.log(`      - ${s.name} :: ${titulo}`);
    }
    wf.nodes = wf.nodes.filter((n) => !vermelhas.includes(n));
  } else {
    console.log('  [stickies] nenhuma sticky vermelha antiga -- nada a remover');
  }

  // --- 3. Sticky nova (só esta fica) ---
  if (!wf.nodes.some((n) => n.name === STICKY_NOME)) {
    wf.nodes.push({
      id: crypto.randomUUID(),
      name: STICKY_NOME,
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [agent.position[0] - 40, agent.position[1] + 560],
      parameters: {
        color: 3,
        width: 480,
        height: 260,
        content:
          '### Confirmação de dados + checagem de idade — ' + new Date().toISOString().slice(0, 10) + '\n\n' +
          'Caso Valentina: paciente conduziu a conversa sozinha mas tinha 11 anos pela data de nascimento. ' +
          'A Lumi foi pelo caminho de adulto, não coletou responsável, e o Salvar do Simples Dental travou em silêncio.\n\n' +
          '1) Data de nascimento < 18 anos = MENOR, mesmo sem sinal de dependência na conversa.\n' +
          '2) Confirmação estruturada dos dados antes de Cria Agendamento, com "não informado" no que falta.\n\n' +
          'Testado no lumi-harness com gpt-5.4-mini: 0/3 falhas.\n' +
          'Histórico completo: project_lumi_cadastro_paciente_novo_timeout_bug.md (as stickies vermelhas antigas foram removidas de propósito).',
      },
    });
    console.log('  [stickies] sticky nova adicionada');
  }

  if (!mudouPrompt && !vermelhas.length) {
    console.log(`"${wf.name}": nada a fazer`);
    return;
  }

  const eraAtivo = wf.active === true;
  const put = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings }),
  });
  const pb = await put.json();
  if (!put.ok) throw new Error(`PUT falhou: ${put.status} ${JSON.stringify(pb).slice(0, 400)}`);
  console.log(`"${wf.name}": PUT ${put.status} | active=${pb.active}`);

  if (eraAtivo) {
    const act = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}/activate`, { method: 'POST', headers: H });
    const ab = await act.json();
    const ok = ab.versionId && ab.versionId === ab.activeVersionId;
    console.log(`  activate ${act.status} | draft==ativo=${ok}`);
    if (!ok) throw new Error('draft != ativo depois do activate');
  }
}

main().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
