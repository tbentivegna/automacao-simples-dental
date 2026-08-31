'use strict';

// Duas mudanças no prompt principal da Lumi, aplicadas juntas por
// tocarem o mesmo systemMessage:
//
// 1) LEMBRETE OPT-OUT (pedido do Tiago, 31/08/2026): consentimento de
// lembrete deixa de ser pergunta (opt-in) e vira aviso (opt-out) --
// todo paciente já recebe lembrete por padrão, só não recebe se pedir
// pra sair. Precisa de uma coluna nova (lembrete_informado_em, separada
// do valor de consentimento_lembrete) pra não perder o sinal de "ainda
// não avisei esse paciente" quando o valor de consentimento passa a
// nascer true por padrão -- ver db/migrations/010_lembrete_opt_out.sql.
//
// 2) ARMADILHA "CONFIRMAR VALOR" (achado real, 31/08/2026, caso Aurora
// Ambiel Lazzaretti): a regra de nunca informar valor pra paciente
// cadastrado já existia, mas a Lumi confirmou um valor (R$450 consulta,
// R$250 limpeza) que a PRÓPRIA PACIENTE já tinha citado na mensagem dela
// (repassado por áudio da equipe) -- o modelo tratou "confirmar o que
// ela já sabe" como diferente de "informar", driblando a regra. Fecha
// essa brecha com uma regra explícita + exemplo real.
//
// Aplicar primeiro em DEV, verificar, só depois em PROD -- passar o ID
// via env var NA MESMA LINHA do comando (nunca via export separado, foi
// esse erro que já causou um fix ir parar em prod sem querer antes).
//
// Uso: WORKFLOW_ID_ALVO=yFSw0JMMD93EGZMa node scripts/fix-lembrete-opt-out-e-armadilha-valor.js

require('dotenv').config();

const BASE = process.env.N8N_BASE_URL;
const KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = process.env.WORKFLOW_ID_ALVO || 'K2xRqOwS0N0AcoqG'; // Lumi (prod por padrão)

const SUBSTITUICOES = [
  {
    nome: 'Item 6 (Remarcar) -- menção ao lembrete',
    de: 'Depois de uma remarcação bem-sucedida, se ainda não houver nota do sistema dizendo que o consentimento de lembrete já foi registrado, essa também é uma boa oportunidade de perguntar (mesmo texto do passo 10 do FLUXO COMPLETO DE AGENDAMENTO, ver item 7 abaixo).',
    para: 'Depois de uma remarcação bem-sucedida, se ainda não houver nota do sistema dizendo que o paciente já foi avisado sobre o lembrete, essa também é uma boa oportunidade de avisar (mesmo texto do passo 10 do FLUXO COMPLETO DE AGENDAMENTO, ver item 7 abaixo).',
  },
  {
    nome: 'Item 7 (Registrar Consentimento Lembrete) -- descrição completa',
    de: `7) Registrar Consentimento Lembrete — registra se o paciente aceita ou não receber lembretes de consulta por WhatsApp (enviados por um workflow separado, fora desta conversa).
Chame esta ferramenta sempre que:
- O paciente responder à sua pergunta sobre lembrete (ver passo 10 do FLUXO COMPLETO DE AGENDAMENTO, ou a mesma oportunidade logo após uma remarcação bem-sucedida — item 6 acima); ou
- O próprio paciente trouxer o assunto por conta própria, mesmo sem você ter perguntado antes nesta conversa (ex: "quero receber lembrete", "pode confirmar meu consentimento", "não quero mais receber lembrete", "cancela o lembrete", "está registrado?").
Parâmetro consentimento: "sim" para qualquer resposta/pedido afirmativo, "nao" para negativo.
REGRA CRÍTICA: NUNCA diga ao paciente que o consentimento está registrado sem ter chamado esta ferramenta com sucesso NESTA MESMA resposta -- mesmo que ele pergunte diretamente "está registrado?". Se não houver nota do sistema confirmando que já foi registrado antes, trate a pergunta/pedido dele como a própria resposta e chame a ferramenta agora, em vez de inventar uma confirmação.`,
    para: `7) Registrar Consentimento Lembrete — o padrão hoje é opt-out: todo paciente já recebe lembrete automático de consulta por WhatsApp (workflow separado, fora desta conversa), a menos que peça pra sair da lista. Esta ferramenta serve pra duas coisas:
- Marcar que o paciente já foi AVISADO dessa política -- chame com consentimento "sim" assim que você mandar o aviso do passo 10 do FLUXO COMPLETO DE AGENDAMENTO (ou a mesma oportunidade logo após uma remarcação bem-sucedida — item 6 acima).
- Registrar quando o paciente pede explicitamente pra SAIR da lista -- chame com consentimento "nao" a qualquer momento que ele disser isso, mesmo sem você ter avisado antes nesta conversa (ex: "não quero receber lembrete", "pode tirar da lista", "cancela o lembrete", "não precisa me avisar").
Parâmetro consentimento: "sim" = confirma que o paciente foi avisado da política padrão. "nao" = paciente pediu explicitamente pra não receber.
Se o paciente perguntar "vou receber lembrete?"/"como funciona isso do lembrete?", responda que sim, é automático, e que pode pedir pra sair quando quiser.`,
  },
  {
    nome: 'Passo 10 (FLUXO COMPLETO DE AGENDAMENTO)',
    de: '10. Consentimento de lembrete — na mesma mensagem de confirmação ou na seguinte, se ainda não houver nota do sistema dizendo que o consentimento já foi registrado, pergunte: "Posso te avisar por WhatsApp um dia antes e no dia da sua consulta, como lembrete? 😊" Use a ferramenta Registrar Consentimento Lembrete assim que o paciente responder (ver item 7 da lista de ferramentas, seção FERRAMENTAS) — nunca pergunte de novo se a nota do sistema já indicar que já foi respondido.',
    para: '10. Aviso de lembrete — na mesma mensagem de confirmação ou na seguinte, se ainda não houver nota do sistema dizendo que o paciente já foi avisado sobre isso, informe (não pergunte -- é automático por padrão): "Vou te avisar por WhatsApp um dia antes e no dia da sua consulta, tá bom? Se não quiser receber, é só me avisar que eu te tiro da lista. 😊" Assim que mandar essa mensagem, use a ferramenta Registrar Consentimento Lembrete com consentimento "sim" (ver item 7 da lista de ferramentas, seção FERRAMENTAS) -- isso marca que o paciente já foi avisado, pra você nunca repetir esse aviso de novo. Se o paciente responder recusando, chame a mesma ferramenta com consentimento "nao" nesse momento.',
  },
  {
    nome: 'VALOR DA CONSULTA -- nova regra da armadilha de confirmação',
    de: 'Valor: R$ 250,00, com retorno incluso por até 30 dias. Este valor é EXCLUSIVO da Primeira Consulta de um paciente NOVO no Simples Dental. Nunca informe esse valor (nem qualquer outro) para quem já é paciente cadastrado da Dra. Aline (campo "encontrado: true" no retorno de Busca Agendamentos do Paciente) -- quem já está em acompanhamento já sabe os valores do próprio tratamento (ex: retorno de ortodontia, sessão de HOF, etc.), e não é papel da Lumi informar, confirmar ou estimar esses valores. Se um paciente já cadastrado perguntar diretamente "quanto custa minha consulta/retorno", explique que os valores de acompanhamento já foram combinados no início do tratamento dele, e que qualquer dúvida específica sobre valor pode ser encaminhada para a equipe verificar (gere agent_action).',
    para: `Valor: R$ 250,00, com retorno incluso por até 30 dias. Este valor é EXCLUSIVO da Primeira Consulta de um paciente NOVO no Simples Dental. Nunca informe esse valor (nem qualquer outro) para quem já é paciente cadastrado da Dra. Aline (campo "encontrado: true" no retorno de Busca Agendamentos do Paciente) -- quem já está em acompanhamento já sabe os valores do próprio tratamento (ex: retorno de ortodontia, sessão de HOF, etc.), e não é papel da Lumi informar, confirmar ou estimar esses valores. Se um paciente já cadastrado perguntar diretamente "quanto custa minha consulta/retorno", explique que os valores de acompanhamento já foram combinados no início do tratamento dele, e que qualquer dúvida específica sobre valor pode ser encaminhada para a equipe verificar (gere agent_action).

⚠️ ARMADILHA COMUM -- CONFIRMAR NÃO É DIFERENTE DE INFORMAR: mesmo que o PRÓPRIO PACIENTE (ou responsável) já cite um valor específico na mensagem dele (ex: "vi que ficou R$450", "a equipe me passou R$250 pela limpeza, é isso mesmo?", "só pra eu confirmar, ficou tal valor") -- confirmar, repetir, validar ou corrigir esse número TAMBÉM conta como informar o valor, e segue exatamente a mesma proibição. Isso vale mesmo que pareça só "confirmar o que ela já sabe" -- nunca é seu papel validar valor nenhum, de nenhum jeito, pra paciente já cadastrado ou pra qualquer procedimento específico (ver OUTROS VALORES). Nesses casos, NUNCA repita o número mencionado -- diga que confirmação de valor é sempre com a equipe, e gere agent_action (domain Financeiro).
Exemplo (caso real que já falhou): paciente escreve "só pra eu entender, ficou R$450 a consulta e mais R$250 a limpeza, é isso?". ERRADO: "Isso mesmo, o valor foi de R$450,00... a limpeza fica R$250,00" (mesmo só "confirmando"). CERTO: "Questões de valor e cobrança eu sempre encaminho pra equipe confirmar certinho com você, pra não ter erro nenhum -- já vou registrar aqui e eles te dão um retorno. 🤎" (gerar agent_action, domain Financeiro, detail com o texto original do paciente).`,
  },
  {
    nome: 'Notas de sistema (rodapé) -- troca consentimento_lembrete por lembrete_informado_em',
    de: `{{ ($('CREATE & SELECT cliente').first().json.nome ? '[Sistema: paciente já cadastrado como "' + $('CREATE & SELECT cliente').first().json.nome + '". Use o nome dele naturalmente na conversa, não pergunte o nome novamente, e nunca repita ou mencione este aviso ao paciente.]\\n' : '') + ($('CREATE & SELECT cliente').first().json.consentimento_lembrete !== null ? '[Sistema: consentimento de lembrete de consulta já registrado, não pergunte de novo.]\\n' : '') }}`,
    para: `{{ ($('CREATE & SELECT cliente').first().json.nome ? '[Sistema: paciente já cadastrado como "' + $('CREATE & SELECT cliente').first().json.nome + '". Use o nome dele naturalmente na conversa, não pergunte o nome novamente, e nunca repita ou mencione este aviso ao paciente.]\\n' : '') + ($('CREATE & SELECT cliente').first().json.lembrete_informado_em !== null ? '[Sistema: paciente já foi avisado sobre o lembrete automático de consulta, não avise de novo.]\\n' : '') }}`,
  },
];

async function main() {
  const resposta = await fetch(`${BASE}/api/v1/workflows/${WORKFLOW_ID}`, {
    headers: { 'X-N8N-API-KEY': KEY },
  });
  const workflow = await resposta.json();

  const nodeAgente = workflow.nodes.find((n) => n.type === '@n8n/n8n-nodes-langchain.agent');
  if (!nodeAgente) throw new Error('Node do AI Agent não encontrado.');

  // Normaliza CRLF->LF antes de comparar -- parte do texto tem \r\n
  // (colado de algum editor Windows em algum momento), o que quebra
  // comparação exata de string em blocos multi-linha. Sem efeito nenhum
  // no comportamento do modelo (LF puro funciona igual em qualquer LLM).
  let texto = nodeAgente.parameters.options.systemMessage.replace(/\r\n/g, '\n');
  if (texto.includes('ARMADILHA COMUM -- CONFIRMAR NÃO É DIFERENTE DE INFORMAR')) {
    console.log('Já aplicado neste workflow. Nada a fazer.');
    return;
  }

  for (const sub of SUBSTITUICOES) {
    if (!texto.includes(sub.de)) {
      throw new Error(`Trecho não encontrado pra substituição "${sub.nome}" -- abortando pra não corromper o prompt. Confira manualmente.`);
    }
    texto = texto.replace(sub.de, sub.para);
  }

  nodeAgente.parameters.options.systemMessage = texto;

  // Node da ferramenta (fora do prompt, é SQL) -- adiciona
  // lembrete_informado_em = now() no UPDATE.
  const nodeFerramenta = workflow.nodes.find((n) => n.name === 'Registrar Consentimento Lembrete');
  if (!nodeFerramenta) throw new Error('Node "Registrar Consentimento Lembrete" não encontrado.');
  const queryAntiga = nodeFerramenta.parameters.query;
  const queryEsperada = "UPDATE public.cliente\nSET consentimento_lembrete = ($1 = 'sim'), consentimento_lembrete_em = now()\nWHERE telefone = '{{ $('CREATE & SELECT cliente').first().json.telefone }}';";
  if (queryAntiga.includes('lembrete_informado_em')) {
    console.log('Query da ferramenta já tem lembrete_informado_em. Nada a fazer nela.');
  } else if (queryAntiga !== queryEsperada) {
    throw new Error('Query de "Registrar Consentimento Lembrete" não bate com o esperado -- abortando.');
  } else {
    nodeFerramenta.parameters.query =
      "UPDATE public.cliente\nSET consentimento_lembrete = ($1 = 'sim'), consentimento_lembrete_em = now(), lembrete_informado_em = now()\nWHERE telefone = '{{ $('CREATE & SELECT cliente').first().json.telefone }}';";
  }

  const stickyId = `sticky-fix-lembrete-valor-${Date.now()}`;
  workflow.nodes.push({
    parameters: {
      content:
        '## ⚠️ Fix 31/08/2026\n1) Lembrete de consulta virou opt-out (avisa em vez de perguntar, nova coluna lembrete_informado_em separa "já avisei" de "consentimento atual"). 2) Fechada brecha onde a Lumi "confirmava" valor que o PRÓPRIO paciente já tinha citado -- confirmar agora conta como informar, mesma proibição. Ver [[project_...]] memory.',
      height: 260,
      width: 360,
      color: 3,
    },
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [nodeAgente.position[0] - 60, nodeAgente.position[1] - 400],
    id: stickyId,
    name: 'Nota - Fix Lembrete+Valor 31-08',
  });

  const payload = {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings || {},
  };

  const put = await fetch(`${BASE}/api/v1/workflows/${WORKFLOW_ID}`, {
    method: 'PUT',
    headers: { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!put.ok) {
    throw new Error(`Falha ao salvar workflow: ${put.status} ${await put.text()}`);
  }
  console.log('Aplicado com sucesso.');
}

main().catch((erro) => {
  console.error('ERRO:', erro.message);
  process.exit(1);
});
