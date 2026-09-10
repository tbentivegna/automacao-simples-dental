// Fase 2b do Plano_Multi_Profissional.md -- aplica o multi-profissional num
// workflow de conversa (PROD / DEV / Standalone):
//   1. nó novo "Lista Profissionais" (httpRequestTool GET {BRIDGE}/profissionais)
//   2. conecta ele ao AI Agent (ai_tool)
//   3. adiciona o parâmetro opcional profissionalId a Verifica Disponibilidade,
//      Cria Agendamento e Remarcar Agendamento
//   4. insere a seção "PROFISSIONAIS DA CLÍNICA" no systemMessage + conta 8->9
//   5. sticky vermelha
//
// Idempotente: rodar de novo não duplica nada.
// uso: node n8n/scripts/multiprof-add-lista-profissionais.js <workflowId>
require('dotenv').config({ path: __dirname + '/../.env' });
const crypto = require('crypto');

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node multiprof-add-lista-profissionais.js <workflowId>');

const DESC_PROFISSIONAL_ID =
  'Opcional. id do profissional (vindo da ferramenta Lista Profissionais) quando a consulta já está definida com um profissional específico -- numa clínica com mais de um. Deixe vazio numa clínica de um profissional só.';

const TOOL_DESC_LISTA =
  'Retorna os profissionais ativos da clínica: id, nome, especialidades, aceitaPrimeiraConsulta e qual é o padrão. Use numa clínica com mais de um profissional pra decidir com quem é a consulta (roteamento por especialidade / profissional pedido pelo nome / padrão). Numa clínica de um profissional só a lista vem com um item -- nesse caso siga o fluxo normal sem perguntar nada.';

const BLOCO_PROMPT = `9) Lista Profissionais — retorna os profissionais ativos da clínica (nome, especialidades, se aceita Primeira Consulta, e qual é o padrão). Numa clínica com mais de um profissional, use antes de oferecer horários quando ainda não estiver definido com quem é a consulta, e sempre que o motivo do paciente puder ser de uma especialidade específica. Parâmetro opcional das ferramentas Verifica Disponibilidade, Cria Agendamento e Remarcar Agendamento: profissionalId — preencha com o id vindo desta lista quando já estiver definido o profissional (clínica com mais de um); numa clínica de um profissional só, deixe de fora.

👥 PROFISSIONAIS DA CLÍNICA

A clínica pode ter um ou vários profissionais. Chame Lista Profissionais para saber.

• LISTA COM UM SÓ PROFISSIONAL (ou a ferramenta não existe / falha): a clínica atende com um profissional só. NUNCA pergunte "com qual profissional?", NUNCA trate especialidade como escolha entre pessoas. Siga todo o fluxo normal, sem nenhuma diferença.

• LISTA COM VÁRIOS PROFISSIONAIS:
  - Roteamento por especialidade: se o motivo do paciente casa claramente com a especialidade de UM profissional (canal → Endodontia; implante/extração → Implantodontia/Cirurgia; aparelho → Ortodontia; etc.), ofereça esse profissional pelo nome, citando a especialidade — ex: "O Dr. Rafael é endodontista. Deixa eu ver a próxima agenda livre dele." Depois chame Verifica Disponibilidade com o profissionalId dele.
  - Sem match claro de especialidade, ou o paciente diz "tanto faz": use o profissional padrão (campo padrao: true). Não precisa perguntar.
  - Paciente pediu um profissional específico pelo nome: use esse.
  - Profissional com aceitaPrimeiraConsulta: false só atende encaminhado — a Primeira Consulta vai pro profissional padrão; nunca ofereça agenda de Primeira Consulta com quem tem aceitaPrimeiraConsulta: false. O encaminhamento interno pro especialista, se fizer sentido, vira agent_action depois.
  - Ao chamar Cria Agendamento / Remarcar Agendamento, passe o profissionalId do profissional escolhido.

• SEMPRE (um ou vários): quando Busca Agendamentos do Paciente retornar profissionalNome preenchido, inclua o nome do profissional ao falar daquela consulta — ex: "sua consulta é com a Dra. Aline no dia 12/03 às 14h". Se profissionalNome vier vazio ou ausente, fale da consulta sem citar profissional (não invente).

`;

// Âncora: o systemMessage tem o item 8 ("Atualiza Nome do Paciente")
// terminando com este parágrafo, e logo depois vem "🚨 REGRA FUNDAMENTAL
// SOBRE TOOLS". Inserimos o bloco entre os dois.
const ANCORA = 'esta tool já resolve na hora.\n\n🚨 REGRA FUNDAMENTAL SOBRE TOOLS';

function novoSystemMessage(sm) {
  if (sm.includes('👥 PROFISSIONAIS DA CLÍNICA')) {
    console.log('  systemMessage: já tem a seção -- pulando');
    return sm;
  }
  if (!sm.includes(ANCORA)) throw new Error('âncora não encontrada no systemMessage -- inspecionar manualmente');
  let out = sm.replace(ANCORA, `esta tool já resolve na hora.\n\n${BLOCO_PROMPT}🚨 REGRA FUNDAMENTAL SOBRE TOOLS`);
  out = out.replace(
    /exatamente 8 ferramentas reais \(Verifica Disponibilidade, Cria Agendamento, Busca Agendamentos do Paciente, Confirmar Agendamento, Cancelar Agendamento, Remarcar Agendamento, Registrar Consentimento Lembrete, Atualiza Nome do Paciente\)/,
    'exatamente 9 ferramentas reais (Verifica Disponibilidade, Cria Agendamento, Busca Agendamentos do Paciente, Confirmar Agendamento, Cancelar Agendamento, Remarcar Agendamento, Registrar Consentimento Lembrete, Atualiza Nome do Paciente, Lista Profissionais)'
  );
  console.log('  systemMessage: seção inserida + contagem 8->9');
  return out;
}

function addProfissionalIdParam(node) {
  const bp = node.parameters.bodyParameters && node.parameters.bodyParameters.parameters;
  if (!bp) { console.log(`  ${node.name}: sem bodyParameters -- pulando`); return; }
  if (bp.some((p) => p.name === 'profissionalId')) { console.log(`  ${node.name}: profissionalId já existe`); return; }
  bp.push({ name: 'profissionalId', value: `={{ $fromAI('profissionalId', \`${DESC_PROFISSIONAL_ID}\`, 'string') }}` });
  console.log(`  ${node.name}: + profissionalId`);
}

async function main() {
  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, { headers: H })).json();
  if (!wf.nodes) throw new Error('GET falhou: ' + JSON.stringify(wf).slice(0, 300));
  console.log(`workflow "${wf.name}" | ${wf.nodes.length} nós | active=${wf.active}`);

  const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
  const ref = byName['Verifica Disponibilidade'];
  if (!ref) throw new Error('sem "Verifica Disponibilidade" -- não dá pra derivar BRIDGE_URL/chave');
  const bridgeBase = ref.parameters.url.replace(/\/[^/]+$/, '');
  const bridgeKey = (ref.parameters.headerParameters.parameters.find((p) => p.name === 'X-Bridge-Key') || {}).value;
  console.log('  bridge:', bridgeBase);

  // 1) systemMessage
  const agent = byName['AI Agent'];
  agent.parameters.options.systemMessage = novoSystemMessage(agent.parameters.options.systemMessage);

  // 2) nó Lista Profissionais
  if (!byName['Lista Profissionais']) {
    const pos = ref.position ? [ref.position[0], (ref.position[1] || 0) + 220] : [4656, 2140];
    wf.nodes.push({
      id: crypto.randomUUID(),
      name: 'Lista Profissionais',
      type: 'n8n-nodes-base.httpRequestTool',
      typeVersion: 4.3,
      position: pos,
      parameters: {
        toolDescription: TOOL_DESC_LISTA,
        method: 'GET',
        url: `${bridgeBase}/profissionais`,
        sendHeaders: true,
        headerParameters: { parameters: [{ name: 'X-Bridge-Key', value: bridgeKey }] },
        options: { timeout: 60000 },
      },
    });
    console.log('  nó "Lista Profissionais" criado');
  } else {
    console.log('  nó "Lista Profissionais" já existe -- pulando');
  }

  // 3) conexão ai_tool -> AI Agent
  wf.connections['Lista Profissionais'] = wf.connections['Lista Profissionais'] || {};
  wf.connections['Lista Profissionais'].ai_tool = [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]];

  // 4) profissionalId nos 3 nós
  ['Verifica Disponibilidade', 'Cria Agendamento', 'Remarcar Agendamento'].forEach((nome) => {
    if (byName[nome]) addProfissionalIdParam(byName[nome]);
    else console.log(`  ${nome}: nó não encontrado`);
  });

  // 5) sticky vermelha
  const stickyNome = 'Sticky Multi-Profissional (Fase 2b)';
  if (!wf.nodes.some((n) => n.name === stickyNome)) {
    wf.nodes.push({
      id: crypto.randomUUID(),
      name: stickyNome,
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [ (byName['Lista Profissionais'] ? byName['Lista Profissionais'].position[0] : 4656) - 40, (byName['Lista Profissionais'] ? byName['Lista Profissionais'].position[1] : 2140) + 120 ],
      parameters: {
        color: 3,
        width: 420,
        height: 200,
        content:
          '### Multi-profissional (Fase 2b) — ' + new Date().toISOString().slice(0, 10) + '\n\n' +
          'Nó "Lista Profissionais" (GET /profissionais) + `profissionalId` opcional em Verifica/Cria/Remarcar + seção "PROFISSIONAIS DA CLÍNICA" no systemMessage.\n\n' +
          'Inerte numa clínica de 1 profissional (guarda no prompt). Ver Plano_Multi_Profissional.md.',
      },
    });
    console.log('  sticky adicionada');
  }

  const eraAtivo = wf.active === true;
  const payload = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings };
  const put = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, { method: 'PUT', headers: H, body: JSON.stringify(payload) });
  const pb = await put.json();
  if (!put.ok) throw new Error(`PUT falhou: ${put.status} ${JSON.stringify(pb).slice(0, 400)}`);
  console.log(`\nPUT ${put.status} | nós agora: ${pb.nodes.length} | active=${pb.active}`);

  // n8n: PUT != publish. Num workflow ativo, é preciso POST /activate e
  // conferir que o draft virou a versão ativa (ver feedback_n8n_draft_publish).
  if (eraAtivo) {
    const act = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}/activate`, { method: 'POST', headers: H });
    const ab = await act.json();
    const ok = ab.versionId && ab.versionId === ab.activeVersionId;
    console.log(`activate ${act.status} | active=${ab.active} | draft==ativo=${ok}`);
    if (!ok) throw new Error(`draft != ativo depois do activate (versionId=${ab.versionId} activeVersionId=${ab.activeVersionId})`);
  }
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
