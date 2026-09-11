// Corrige o bug do cadastro de paciente dependente/menor (caso real:
// Alessandra Saito, 11/09/2026). A Lumi nunca reconheceu "bebê de 14 meses"
// como um dependente (o gatilho de CONSULTA PARA DEPENDENTE só cobria
// parentesco explícito: "meu filho"/"minha filha"), foi direto pro
// cadastro-completo genérico ("preciso completar SEU cadastro"), e a
// paciente respondeu misturando o nascimento do bebê com o CPF/CEP/e-mail
// dela. A tool call final ficou com nomePaciente = nome da mãe +
// dataNascimentoPaciente = data do bebê (inconsistente) e nomeResponsavel
// vazio -- teria criado um cadastro real errado no Simples Dental.
//
// Investigação (ver memória project_lumi_cadastro_paciente_novo_timeout_bug.md)
// achou uma provável âncora do problema: a seção PRIMEIRO CONTATO usa "nome
// do paciente" pra pedir o nome de quem está no WhatsApp -- mas isso pode
// não ser o paciente de verdade (se for consulta pra dependente). Esse nome
// ambíguo, com prioridade máxima e nos 2 primeiros turnos, provavelmente
// ancorava o modelo em "quem está conversando = o paciente" antes mesmo do
// sinal de dependente aparecer.
//
// Testado no lumi-harness (check-cadastro-dependente.js) contra o modelo
// real (gpt-5.4-mini): sem nenhuma dessas mudanças, cenário A (bebê sem
// parentesco explícito) falhava 4/4 e cenário B (campos corretos na Cria
// Agendamento) tinha falhas frequentes. Com as 6 mudanças abaixo: cenário A
// caiu pra ~1/3, cenário B foi 0/3 (0 falhas). Sem regressão detectada em
// check-nome-saudacao (cenário A já falhava igual antes, é bug conhecido
// separado) nem check-multiprofissional (0/2 nos dois cenários).
//
// Idempotente. uso: node n8n/scripts/fix-dependente-anchoragem-nome.js <workflowId>
require('dotenv').config({ path: __dirname + '/../.env' });
const crypto = require('crypto');

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node fix-dependente-anchoragem-nome.js <workflowId>');

const EDITS = [
  {
    nome: '1) gatilho CONSULTA PARA DEPENDENTE (implícito, sem parentesco)',
    antiga:
      'Se o paciente mencionar que a consulta é para outra pessoa (ex: "para meu filho", "pra minha filha", "é pro meu sobrinho", "para minha esposa"), a consulta é para um dependente/terceiro -- não para quem está conversando.',
    nova:
      'Se o paciente mencionar que a consulta é para outra pessoa (ex: "para meu filho", "pra minha filha", "é pro meu sobrinho", "para minha esposa"), OU descrever o paciente de um jeito que já deixa claro que não é quem está escrevendo -- bebê, recém-nascido, criança pequena, idade em meses, ou qualquer idade claramente incompatível com estar mandando mensagem sozinho -- mesmo SEM usar nenhuma palavra de parentesco (ex: "consulta pra bebê de 14 meses", "tem atendimento pra criança de 2 anos?"), a consulta é para um dependente/terceiro -- não para quem está conversando.',
  },
  {
    // Variante COMPLETA (Simples Dental, ex: Aline PROD/DEV).
    nome: '2) decisão explícita ADULTO vs MENOR antes do cadastro (completo)',
    antiga:
      'a Dra. Aline exige cadastro completo antes de confirmar a consulta, não só nome+telefone.\n\nPERGUNTE ATIVAMENTE',
    nova:
      'a Dra. Aline exige cadastro completo antes de confirmar a consulta, não só nome+telefone.\n\nANTES de escolher qual das duas variantes abaixo usar (ADULTO ou MENOR DE IDADE), decida: quem vai ser cadastrado é a própria pessoa que está conversando, ou um dependente? Releia a conversa em busca de qualquer menção a bebê, criança, filho(a), ou qualquer descrição que já deixe claro que o paciente não é quem está escrevendo -- mesmo sem uma palavra de parentesco explícita (ver CONSULTA PARA DEPENDENTE). Errar essa decisão manda a mensagem errada (pedir "seu" CPF/data de nascimento quando na verdade é a criança que vai ser cadastrada). Na dúvida, é dependente -- é o caso mais comum de errar.\n\nPERGUNTE ATIVAMENTE',
    opcional: true, // pode não existir -- workflow pode estar na variante LEVE (ver 2b)
  },
  {
    // Variante LEVE (standalone-bridge, ex: Standalone). Texto exato de
    // fix-cadastro-leve.js (SECAO_LEVE).
    nome: '2b) decisão explícita ADULTO vs MENOR antes do cadastro (leve)',
    antiga:
      'O cadastro é leve -- não peça ficha completa.\n\nPACIENTE ADULTO (respondendo por si):',
    nova:
      'O cadastro é leve -- não peça ficha completa.\n\nANTES de escolher qual das duas variantes abaixo usar (ADULTO ou MENOR DE IDADE), decida: quem vai ser cadastrado é a própria pessoa que está conversando, ou um dependente? Releia a conversa em busca de qualquer menção a bebê, criança, filho(a), ou qualquer descrição que já deixe claro que o paciente não é quem está escrevendo -- mesmo sem uma palavra de parentesco explícita (ver CONSULTA PARA DEPENDENTE). Na dúvida, é dependente -- é o caso mais comum de errar.\n\nPACIENTE ADULTO (respondendo por si):',
    opcional: true, // pode não existir -- workflow pode estar na variante COMPLETA (ver 2)
  },
  {
    nome: '3) "nome do paciente" -> "nome de quem está conversando" (PRIMEIRO CONTATO)',
    antiga:
      'Isso NÃO impede perguntar o nome do paciente. Sempre que a regra de PRIMEIRO CONTATO exigir',
    nova:
      'Isso NÃO impede perguntar o nome de quem está conversando. Sempre que a regra de PRIMEIRO CONTATO exigir',
  },
  {
    nome: '4) PRAZO PARA PERGUNTAR O NOME -- desambiguação + nota nova',
    antiga:
      'REGRA COM PRIORIDADE MÁXIMA — PRAZO PARA PERGUNTAR O NOME:\nSe você ainda não sabe o nome do paciente, a pergunta do nome é OBRIGATÓRIA até a sua 2ª mensagem na conversa, sem exceção. Não existe situação em que isso pode ser adiado além disso — nem se o paciente estiver só conversando socialmente, nem se ele tiver feito uma pergunta técnica, nem se parecer "cedo demais". Conte suas próprias mensagens enviadas nesta conversa: se esta é a 1ª ou a 2ª mensagem sua e o nome ainda é desconhecido, a mensagem tem que terminar perguntando o nome.',
    nova:
      'REGRA COM PRIORIDADE MÁXIMA — PRAZO PARA PERGUNTAR O NOME:\nSe você ainda não sabe o nome de quem está conversando, a pergunta do nome é OBRIGATÓRIA até a sua 2ª mensagem na conversa, sem exceção. Não existe situação em que isso pode ser adiado além disso — nem se o paciente estiver só conversando socialmente, nem se ele tiver feito uma pergunta técnica, nem se parecer "cedo demais". Conte suas próprias mensagens enviadas nesta conversa: se esta é a 1ª ou a 2ª mensagem sua e o nome ainda é desconhecido, a mensagem tem que terminar perguntando o nome.\n\nIMPORTANTE -- esse nome é de QUEM ESTÁ NO WHATSAPP, não necessariamente do paciente que vai à consulta: se depois ficar claro que a consulta é para outra pessoa (dependente/terceiro -- ver CONSULTA PARA DEPENDENTE), esse nome vira o do RESPONSÁVEL, e você ainda precisa coletar nome completo + data de nascimento de quem vai ser atendido, separadamente. Nunca trate "já sei o nome" (desta regra) como "já sei quem é o paciente".',
  },
  {
    nome: '5) "nome do paciente" -> "nome de quem está conversando" (regra anti-loop)',
    antiga:
      'Nunca repita perguntas já respondidas ("Como posso ajudar?", "Qual seu nome?", "Você gostaria de agendar?"). Se a informação já foi dada, avance a conversa. Uma pergunta por vez. Use o nome do paciente naturalmente quando possível.',
    nova:
      'Nunca repita perguntas já respondidas ("Como posso ajudar?", "Qual seu nome?", "Você gostaria de agendar?"). Se a informação já foi dada, avance a conversa. Uma pergunta por vez. Use o nome de quem está conversando naturalmente quando possível.',
  },
  {
    nome: '6) checklist final -- desambiguação + reforço do gatilho',
    antiga:
      '- Eu já sei o nome do paciente? Se não, esta é minha 1ª ou 2ª mensagem na conversa? Se for, minha resposta termina perguntando o nome?\n- Estou prestes a chamar Cria Agendamento ou Remarcar Agendamento? Eu já tenho o nome\nreal do paciente nesta conversa? Se não, paro e peço antes.\n- Essa consulta é para um dependente (filho, filha, terceiro)? Se sim, já tenho nome completo e data de nascimento dele(a)?',
    nova:
      '- Eu já sei o nome de quem está conversando? Se não, esta é minha 1ª ou 2ª mensagem na conversa? Se for, minha resposta termina perguntando o nome?\n- Estou prestes a chamar Cria Agendamento ou Remarcar Agendamento? Eu já tenho o nome\nreal do paciente nesta conversa? Se não, paro e peço antes.\n- Essa consulta é para um dependente -- filho(a), terceiro, OU qualquer descrição (bebê, criança, idade incompatível com estar escrevendo sozinho) que já deixa isso claro mesmo sem palavra de parentesco? Se sim, já tenho nome completo e data de nascimento dele(a)? E, ao montar a mensagem de cadastro completo, estou usando a variante MENOR DE IDADE (nunca a ADULTO)?',
  },
];

async function main() {
  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, { headers: H })).json();
  if (!wf.nodes) throw new Error('GET falhou: ' + JSON.stringify(wf).slice(0, 300));
  const agent = wf.nodes.find((n) => n.name === 'AI Agent');
  if (!agent) throw new Error('sem nó "AI Agent"');
  let sm = agent.parameters.options.systemMessage;

  let aplicadas = 0;
  let jaTinha = 0;
  let decisaoCadastroResolvida = false; // edits 2/2b -- exatamente uma variante deve bater
  for (const edit of EDITS) {
    if (sm.includes(edit.nova)) {
      console.log(`  [${edit.nome}] já aplicada -- pulando`);
      jaTinha++;
      if (edit.nome.startsWith('2')) decisaoCadastroResolvida = true;
      continue;
    }
    if (!sm.includes(edit.antiga)) {
      if (edit.opcional) {
        console.log(`  [${edit.nome}] âncora não encontrada -- variante não usada neste workflow, pulando`);
        continue;
      }
      throw new Error(`[${edit.nome}] texto antigo não encontrado -- inspecionar manualmente antes de continuar`);
    }
    sm = sm.replace(edit.antiga, edit.nova);
    console.log(`  [${edit.nome}] aplicada`);
    aplicadas++;
    if (edit.nome.startsWith('2')) decisaoCadastroResolvida = true;
  }

  if (!decisaoCadastroResolvida) {
    throw new Error('nem a variante COMPLETA nem a LEVE da seção de cadastro foram encontradas -- inspecionar manualmente');
  }

  if (aplicadas === 0) {
    console.log(`"${wf.name}": todas as edições já estavam aplicadas -- nada a fazer`);
    return;
  }

  agent.parameters.options.systemMessage = sm;
  console.log(`"${wf.name}": ${aplicadas} edição(ões) aplicada(s), ${jaTinha} já estavam ok (systemMessage ${sm.length} chars)`);

  // sticky vermelha
  const stickyNome = 'Sticky Cadastro Dependente (11/09)';
  if (!wf.nodes.some((n) => n.name === stickyNome)) {
    wf.nodes.push({
      id: crypto.randomUUID(),
      name: stickyNome,
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [agent.position[0] - 40, agent.position[1] + 340],
      parameters: {
        color: 3,
        width: 460,
        height: 220,
        content:
          '### Cadastro dependente/menor (caso Alessandra) — ' + new Date().toISOString().slice(0, 10) + '\n\n' +
          '"bebê de X meses" agora conta como dependente mesmo sem "meu filho". Cadastro-completo decide explicitamente ADULTO vs MENOR. "Nome do paciente" (PRIMEIRO CONTATO) desambiguado pra "nome de quem está conversando" -- evita a IA travar em "quem me respondeu = o paciente".\n\nVer project_lumi_cadastro_paciente_novo_timeout_bug.md.',
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
