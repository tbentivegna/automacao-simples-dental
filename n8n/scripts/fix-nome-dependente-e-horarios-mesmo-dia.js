// Corrige 2 bugs reais do caso Alessandra/Pedro (14/09/2026):
//
// 1) Atualiza Nome do Paciente sobrescrevia o cadastro de quem está
//    conversando com o nome do DEPENDENTE (real: Alessandra deu o nome do
//    bebê "Pedro Saito Pereira" pro cadastro, a Lumi chamou a tool com esse
//    nome, sobrescrevendo cliente.nome da própria Alessandra).
// 2) Apresentação de horários voltou a repetir o mesmo dia (real: "e no
//    final do dia?" -> 3 horários do dia 16/09 + mais 2 do dia 21/09).
//
// Testado no lumi-harness contra gpt-5.4-mini: cenário C (nome do
// dependente) 0/2 falhas; cenário de horários-mesmo-dia 0/3 falhas. Sem
// regressão em check-nao-trava-horarios/check-multiprofissional.
//
// Idempotente. uso: node n8n/scripts/fix-nome-dependente-e-horarios-mesmo-dia.js <workflowId>
require('dotenv').config({ path: __dirname + '/../.env' });
const crypto = require('crypto');

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node fix-nome-dependente-e-horarios-mesmo-dia.js <workflowId>');

const EDITS = [
  {
    nome: '1a) Atualiza Nome do Paciente -- definição desambiguada',
    antiga:
      '8) Atualiza Nome do Paciente — grava o nome no cadastro assim que o paciente se autoidentificar de verdade (ex: "meu nome é Marcos", "aqui é a Fernanda", ou o nome completo dado durante o cadastro). Chame esta ferramenta imediatamente após isso (não espere o fim da resposta).',
    nova:
      '8) Atualiza Nome do Paciente — grava o nome de QUEM ESTÁ CONVERSANDO (a pessoa no WhatsApp) assim que ela se autoidentificar de verdade (ex: "meu nome é Marcos", "aqui é a Fernanda", ou o nome completo dado durante o cadastro DELA). Chame esta ferramenta imediatamente após isso (não espere o fim da resposta).',
  },
  {
    nome: '1b) Atualiza Nome do Paciente -- nunca com o nome do dependente',
    antiga:
      'Se um nome mais completo/confiável aparecer depois na mesma conversa (ex: durante o cadastro, junto com CPF e data de nascimento), chame esta ferramenta DE NOVO com o nome completo — mesmo que um nome diferente já tenha sido salvo antes nesta mesma conversa. O nome dado no cadastro completo é sempre mais confiável que qualquer captura anterior. Não gere mais agent_action ATUALIZAR_CADASTRO para isso — esta tool já resolve na hora.',
    nova:
      'Se um nome mais completo/confiável DE QUEM ESTÁ CONVERSANDO aparecer depois na mesma conversa (ex: durante o cadastro dela, junto com CPF e data de nascimento dela), chame esta ferramenta DE NOVO com o nome completo — mesmo que um nome diferente já tenha sido salvo antes nesta mesma conversa. O nome dado no cadastro completo é sempre mais confiável que qualquer captura anterior. Não gere mais agent_action ATUALIZAR_CADASTRO para isso — esta tool já resolve na hora.\n\nNUNCA chame esta ferramenta com o nome do DEPENDENTE (a criança/terceiro pelo qual a consulta é, ver CONSULTA PARA DEPENDENTE) — mesmo que o nome dele apareça "durante o cadastro", junto com a data de nascimento dele. Esta tool é sempre sobre quem está no WhatsApp, nunca sobre o paciente que vai à consulta quando os dois são pessoas diferentes. Exemplo (caso real que já falhou, 14/09): a Lumi perguntou o nome completo do bebê pra Alessandra, ela respondeu "Pedro Saito Pereira", e a Lumi chamou Atualiza Nome do Paciente com "Pedro Saito Pereira" -- ERRADO: isso sobrescreveu o cadastro da própria Alessandra com o nome do filho dela, confundindo toda a identificação da conversa dali pra frente. CERTO: manter "Alessandra" salva como quem está conversando, e usar "Pedro Saito Pereira" só como nomePaciente na hora de chamar Cria Agendamento (ver CONSULTA PARA DEPENDENTE e CADASTRO DE PACIENTE NOVO).',
  },
  {
    nome: '2) apresentação de horários -- nunca repete a mesma data',
    antiga:
      '- Depois, ofereça no máximo 3 opções, uma por linha, cada uma com UM dia + UM horário — nunca agrupe vários horários numa linha, nunca repita o mesmo dia, nunca ofereça mais de 3. Formato curto: "sábado, 13/09, às 09:00" (sem o ano). Sempre as 3 mais próximas dentro da preferência do paciente. Não diga "também tenho de [dia]" se esse dia já está entre as 3 que você listou. Se nenhuma servir, aí sim chame a tool de novo e ofereça outras 3.',
    nova:
      '- Depois, ofereça no máximo 3 opções, uma por linha, cada uma com UM DIA DIFERENTE + UM horário — nunca agrupe vários horários numa linha, nunca repita o mesmo dia (nem em blocos/frases diferentes da mesma resposta), nunca ofereça mais de 3 no total. Formato curto: "sábado, 13/09, às 09:00" (sem o ano). Sempre as 3 mais próximas dentro da preferência do paciente: escolha a melhor opção de cada um dos 3 DIAS diferentes mais próximos -- se um dia tiver vários horários livres, use só o mais cedo dele e pule pro próximo dia, nunca liste dois horários do mesmo dia. Não diga "também tenho de [dia]" se esse dia já está entre as 3 que você listou -- essa frase só serve pra abrir um dia NOVO, nunca repetir um que já apareceu.\nExemplo (caso real que já falhou, 14/09): o resultado da tool tinha vários horários livres em 16/09 (14:30, 15:30, 16:30). ERRADO: listar as 3 opções todas do dia 16/09 e ainda emendar "também tenho: segunda 21/09 às 13:30, segunda 21/09 às 16:30" (5 opções, só 2 dias, cada um repetido). CERTO: um horário por dia -- ex. 16/09 às 14:30, 21/09 às 13:30, 23/09 às 15:30 (3 dias diferentes, 3 linhas, nada de "também tenho" enquanto ainda não tiver esgotado os 3 dias).\nSe nenhuma servir, aí sim chame a tool de novo e ofereça outras 3.',
  },
];

async function main() {
  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, { headers: H })).json();
  if (!wf.nodes) throw new Error('GET falhou: ' + JSON.stringify(wf).slice(0, 300));
  const agent = wf.nodes.find((n) => n.name === 'AI Agent');
  if (!agent) throw new Error('sem nó "AI Agent"');
  let sm = agent.parameters.options.systemMessage;

  let aplicadas = 0;
  for (const edit of EDITS) {
    if (sm.includes(edit.nova)) {
      console.log(`  [${edit.nome}] já aplicada -- pulando`);
      continue;
    }
    if (!sm.includes(edit.antiga)) {
      throw new Error(`[${edit.nome}] texto antigo não encontrado -- inspecionar manualmente antes de continuar`);
    }
    sm = sm.replace(edit.antiga, edit.nova);
    console.log(`  [${edit.nome}] aplicada`);
    aplicadas++;
  }

  if (aplicadas === 0) {
    console.log(`"${wf.name}": todas as edições já estavam aplicadas -- nada a fazer`);
    return;
  }

  agent.parameters.options.systemMessage = sm;
  console.log(`"${wf.name}": ${aplicadas} edição(ões) aplicada(s) (systemMessage ${sm.length} chars)`);

  const stickyNome = 'Sticky Nome Dependente + Horarios (14/09)';
  if (!wf.nodes.some((n) => n.name === stickyNome)) {
    wf.nodes.push({
      id: crypto.randomUUID(),
      name: stickyNome,
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [agent.position[0] - 40, agent.position[1] + 560],
      parameters: {
        color: 3,
        width: 460,
        height: 220,
        content:
          '### Nome do dependente + horários repetidos — ' + new Date().toISOString().slice(0, 10) + '\n\n' +
          'Atualiza Nome do Paciente nunca mais grava o nome do dependente (só de quem conversa). Apresentação de horários nunca mais repete a mesma data.\n\n' +
          'Ver project_lumi_lembrete_consulta_cancelada_bug.md e project_lumi_cadastro_paciente_novo_timeout_bug.md.',
      },
    });
    console.log('  sticky adicionada');
  }

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
