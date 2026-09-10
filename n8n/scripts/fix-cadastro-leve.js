// Troca a seção "CADASTRO DE PACIENTE NOVO" (ficha completa: CPF, endereço,
// e-mail...) pela versão LEVE no systemMessage do AI Agent -- pra clínicas
// no standalone-bridge, onde o agendamento só precisa do nome (+ nascimento
// e responsável se for dependente menor). Não usar no Simples Dental.
//
// Idempotente. uso: node n8n/scripts/fix-cadastro-leve.js <workflowId>
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node fix-cadastro-leve.js <workflowId>');

const SECAO_LEVE = `🆕 CADASTRO DE PACIENTE NOVO

Quando Busca Agendamentos do Paciente retornar encontrado: false, o paciente ainda não tem consulta registrada aqui. O cadastro é leve -- não peça ficha completa.

PACIENTE ADULTO (respondendo por si): o nome completo (que você já pediu no começo da conversa) já basta. NÃO peça CPF, endereço, e-mail nem data de nascimento -- não é necessário aqui. Siga direto pra confirmar o horário e o valor.

PACIENTE MENOR DE IDADE (consulta para dependente -- ver CONSULTA PARA DEPENDENTE): além do nome completo da criança, peça só a data de nascimento dela (DD/MM/AAAA) e o nome completo de quem é o responsável. É só isso -- nada de CPF, endereço ou e-mail. Na chamada de Cria Agendamento passe: nomePaciente (o da criança), dataNascimentoPaciente, nomeResponsavel.

Nunca invente um dado que o paciente não informou. Se o paciente se recusar a dar o nome, pare e gere agent_action (OUTROS, domain Relacionamento).

`;

async function main() {
  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, { headers: H })).json();
  if (!wf.nodes) throw new Error('GET falhou');
  const agent = wf.nodes.find((n) => n.name === 'AI Agent');
  if (!agent) throw new Error('sem nó "AI Agent"');
  let sm = agent.parameters.options.systemMessage;

  if (sm.includes('O cadastro é leve -- não peça ficha completa')) {
    console.log(`"${wf.name}": cadastro leve já aplicado -- nada a fazer`);
    return;
  }

  // 1) seção inteira (header ... até antes de 🧾 AGENT_ACTION)
  const rxSecao = /🆕 CADASTRO DE PACIENTE NOVO NO [A-ZÀ-Ú]+\n[\s\S]*?(?=\n🧾 AGENT_ACTION)/;
  if (!rxSecao.test(sm)) throw new Error('seção "CADASTRO DE PACIENTE NOVO" não encontrada -- inspecionar');
  sm = sm.replace(rxSecao, SECAO_LEVE.trimEnd());

  // 2) menção na descrição da tool Cria Agendamento
  sm = sm.replace(
    /Se for paciente novo no [^\n(]*\(ver seção 🆕 CADASTRO DE PACIENTE NOVO\), inclua também dataNascimentoPaciente\/cpfPaciente\/email\/cep\/numero\/complemento[^\n]*\./,
    'Se a consulta for para um dependente menor, inclua também dataNascimentoPaciente (da criança) e nomeResponsavel -- ver seção CONSULTA PARA DEPENDENTE. Pra paciente adulto respondendo por si, o nome já basta.'
  );

  // 3) referências do FLUXO passo 7
  sm = sm.replace(/pergunte ativamente os dados que faltam ANTES de seguir, numa mensagem separada\./g, 'peça só o que faltar (normalmente nada pra adulto).');
  sm = sm.replace(/pergunte ativamente os dados que faltam, numa mensagem própria, ANTES de seguir pro passo 5\.( Só depois de ter esses dados é que você segue pro passo 5\.)?/g, 'peça só o que faltar (normalmente nada, pra adulto). Depois siga pro passo 5.');

  agent.parameters.options.systemMessage = sm;
  console.log(`"${wf.name}": seção CADASTRO trocada pela versão LEVE (systemMessage ${sm.length} chars)`);

  const eraAtivo = wf.active === true;
  const put = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings }),
  });
  const pb = await put.json();
  if (!put.ok) throw new Error(`PUT falhou: ${put.status} ${JSON.stringify(pb).slice(0, 400)}`);
  console.log(`PUT ${put.status} | active=${pb.active}`);
  if (eraAtivo) {
    const act = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}/activate`, { method: 'POST', headers: H });
    const ab = await act.json();
    const ok = ab.versionId && ab.versionId === ab.activeVersionId;
    console.log(`activate ${act.status} | draft==ativo=${ok}`);
    if (!ok) throw new Error('draft != ativo depois do activate');
  }
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
