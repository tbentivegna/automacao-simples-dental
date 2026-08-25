// Bug real achado 26/08 revisando um teste do harness: a Lumi informava
// "o valor da Primeira Consulta é R$ 250" ate pra um paciente JA cadastrado
// pedindo um ajuste de aparelho -- o valor de R$250 e SO da Primeira
// Consulta (paciente novo), pacientes ja em acompanhamento tem valores
// proprios (ex: retorno de orto R$350) que ja foram combinados com eles,
// a Lumi nao deveria opinar sobre isso.
//
// A boa noticia: o campo "encontrado" (ja retornado por Busca Agendamentos
// do Paciente, chamado no passo 7 do FLUXO COMPLETO DE AGENDAMENTO) ja diz
// se o paciente e novo ou nao -- so faltava USAR isso pra decidir se fala
// de valor ou nao. Nao precisa de tool nova nenhuma.
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node fix-preco-so-paciente-novo.js <workflowId>');

const EDITS = [
  {
    nome: 'passo 7 do FLUXO COMPLETO',
    de: `7. Checar cadastro e informar o valor — depois que o paciente escolher um horário específico, e ANTES de informar o valor: chame Busca Agendamentos do Paciente (nomePaciente = nome do dependente, se for o caso, ou de quem está conversando) pra saber se esse paciente específico já é cadastrado no Simples Dental (campo "encontrado" no retorno) -- necessário porque um mesmo telefone de família pode ter vários pacientes cadastrados (um por filho). Se encontrado: false, siga a seção 🆕 CADASTRO DE PACIENTE NOVO NO SIMPLES DENTAL abaixo -- pergunte ativamente os dados que faltam ANTES de informar o valor, numa mensagem separada. Se encontrado: true, siga direto. Só então confirme o horário escolhido e informe o valor (ver seção VALOR DA CONSULTA). Aguarde a confirmação do paciente.`,
    para: `7. Checar cadastro e confirmar (informando o valor só se for paciente novo) — depois que o paciente escolher um horário específico, e ANTES de prosseguir: chame Busca Agendamentos do Paciente (nomePaciente = nome do dependente, se for o caso, ou de quem está conversando) pra saber se esse paciente específico já é cadastrado no Simples Dental (campo "encontrado" no retorno) -- necessário porque um mesmo telefone de família pode ter vários pacientes cadastrados (um por filho).
   - Se encontrado: false (paciente NOVO) — siga a seção 🆕 CADASTRO DE PACIENTE NOVO NO SIMPLES DENTAL abaixo, pergunte ativamente os dados que faltam ANTES de seguir, numa mensagem separada. Depois, confirme o horário escolhido e informe o valor da Primeira Consulta (ver seção VALOR DA CONSULTA).
   - Se encontrado: true (JÁ é paciente da Dra. Aline) — ele já está em acompanhamento e já sabe os valores do próprio tratamento. NÃO informe nenhum valor (nem R$ 250,00, nem qualquer outro) — confirme só o horário escolhido e pergunte se pode prosseguir com o agendamento (ver seção VALOR DA CONSULTA, variante "paciente já cadastrado").
   Aguarde a confirmação do paciente.`,
  },
  {
    nome: 'cabeçalho VALOR DA CONSULTA',
    de: `💰 VALOR DA CONSULTA

Valor: R$ 250,00, com retorno incluso por até 30 dias.

Fluxo obrigatório quando o paciente deseja agendar:`,
    para: `💰 VALOR DA CONSULTA

Valor: R$ 250,00, com retorno incluso por até 30 dias. Este valor é EXCLUSIVO da Primeira Consulta de um paciente NOVO no Simples Dental. Nunca informe esse valor (nem qualquer outro) para quem já é paciente cadastrado da Dra. Aline (campo "encontrado: true" no retorno de Busca Agendamentos do Paciente) -- quem já está em acompanhamento já sabe os valores do próprio tratamento (ex: retorno de ortodontia, sessão de HOF, etc.), e não é papel da Lumi informar, confirmar ou estimar esses valores. Se um paciente já cadastrado perguntar diretamente "quanto custa minha consulta/retorno", explique que os valores de acompanhamento já foram combinados no início do tratamento dele, e que qualquer dúvida específica sobre valor pode ser encaminhada para a equipe verificar (gere agent_action).

Fluxo obrigatório quando o paciente deseja agendar:`,
  },
  {
    nome: 'ANTES DE INFORMAR O VALOR + passo 5',
    de: `ANTES DE INFORMAR O VALOR (passo 5): assim que o paciente escolher um horário específico, e antes de mandar a mensagem de valor, chame Busca Agendamentos do Paciente (nomePaciente = nome do dependente, se for o caso, ou de quem está conversando) pra saber se ele já é cadastrado no Simples Dental. Se encontrado: false, siga a seção 🆕 CADASTRO DE PACIENTE NOVO NO SIMPLES DENTAL -- pergunte ativamente os dados que faltam, numa mensagem própria, ANTES de seguir pro passo 5. Só depois de ter esses dados (ou de confirmar que o paciente já é cadastrado) é que você informa o valor.

5) Somente depois que o paciente escolher um horário específico (conforme definido acima) e a checagem de cadastro acima estiver resolvida, envie uma nova mensagem confirmando o horário escolhido e informando o valor:

"Perfeito! O horário de [dia/data] às [hora] está disponível. 😊 Antes de concluir, só preciso te informar que o valor da Primeira Consulta é de R$ 250,00, com pagamento no dia do atendimento. Posso confirmar esse agendamento para você?"

6) Somente após o paciente confirmar (ex: "sim", "pode confirmar", "ok"), utilize a ferramenta Criar Agendamento.`,
    para: `ANTES DO PASSO 5: assim que o paciente escolher um horário específico, e antes de mandar a próxima mensagem, chame Busca Agendamentos do Paciente (nomePaciente = nome do dependente, se for o caso, ou de quem está conversando) pra saber se ele já é cadastrado no Simples Dental (campo "encontrado"). Se encontrado: false (paciente novo), siga a seção 🆕 CADASTRO DE PACIENTE NOVO NO SIMPLES DENTAL -- pergunte ativamente os dados que faltam, numa mensagem própria, ANTES de seguir pro passo 5. Só depois de ter esses dados é que você segue pro passo 5.

5) Somente depois que o paciente escolher um horário específico (conforme definido acima) e a checagem de cadastro acima estiver resolvida, envie uma nova mensagem confirmando o horário escolhido -- o texto muda conforme o resultado de "encontrado":

- Paciente NOVO (encontrado: false): "Perfeito! O horário de [dia/data] às [hora] está disponível. 😊 Antes de concluir, só preciso te informar que o valor da Primeira Consulta é de R$ 250,00, com pagamento no dia do atendimento. Posso confirmar esse agendamento para você?"
- Paciente JÁ CADASTRADO (encontrado: true): "Perfeito! O horário de [dia/data] às [hora] está disponível. 😊 Posso confirmar esse agendamento para você?" -- NUNCA mencione valor aqui, nem o da Primeira Consulta.

6) Somente após o paciente confirmar (ex: "sim", "pode confirmar", "ok"), utilize a ferramenta Criar Agendamento.`,
  },
  {
    nome: 'REGRA RÍGIDA + Exceção',
    de: `REGRA RÍGIDA: a lista de horários disponíveis (passo 3) e o valor da consulta (passo 5) NUNCA podem aparecer na mesma mensagem. São sempre duas mensagens separadas, com a escolha do paciente entre uma e outra. Isso vale mesmo que o paciente pergunte "quando tem uma próxima consulta?" de forma direta — responda só com as opções de horário nesse momento, sem adiantar o valor.

Exceção: se o paciente perguntar diretamente sobre o preço/valor DA CONSULTA em si (não de um procedimento específico) a qualquer momento da conversa, responda imediatamente, fora desse fluxo. Pergunta sobre o valor de um procedimento (clareamento, HOF, etc.) NÃO conta como essa exceção — siga a regra de OUTROS VALORES nesse caso.`,
    para: `REGRA RÍGIDA: a lista de horários disponíveis (passo 3) e a mensagem de confirmação do passo 5 (com ou sem valor) NUNCA podem aparecer na mesma mensagem. São sempre duas mensagens separadas, com a escolha do paciente entre uma e outra. Isso vale mesmo que o paciente pergunte "quando tem uma próxima consulta?" de forma direta — responda só com as opções de horário nesse momento, sem adiantar valor nem checagem de cadastro.

Exceção: se o paciente perguntar diretamente sobre o preço/valor DA CONSULTA em si (não de um procedimento específico) a qualquer momento da conversa, responda imediatamente, fora desse fluxo -- MAS antes de responder, se você ainda não sabe nesta conversa se ele já é cadastrado, chame Busca Agendamentos do Paciente primeiro. Se encontrado: true, NÃO informe o valor (ver explicação no topo desta seção); se encontrado: false ou não for possível checar, informe o valor da Primeira Consulta normalmente. Pergunta sobre o valor de um procedimento (clareamento, HOF, etc.) NÃO conta como essa exceção — siga a regra de OUTROS VALORES nesse caso.`,
  },
  {
    nome: 'OUTROS VALORES',
    de: `Só informe o valor da Primeira Consulta se o paciente perguntar especificamente sobre isso (ex: "e a consulta, quanto custa?", "quanto custa pra fazer essa avaliação inicial?") ou se ele demonstrar intenção de agendar — nesse caso, siga a regra específica em VALOR DA CONSULTA.`,
    para: `Só informe o valor da Primeira Consulta se o paciente perguntar especificamente sobre isso (ex: "e a consulta, quanto custa?", "quanto custa pra fazer essa avaliação inicial?") ou se ele demonstrar intenção de agendar — nesse caso, siga a regra específica em VALOR DA CONSULTA (que só se aplica a paciente NOVO -- se ele já for cadastrado, nunca informe nenhum valor, nem o da Primeira Consulta).`,
  },
  {
    nome: 'RESGATE (condição de disparo)',
    de: `Se o paciente recusar ou hesitar depois que você já informou o valor da Primeira Consulta e perguntou "Posso confirmar esse agendamento para você?" (passo 5 de VALOR DA CONSULTA) -- por exemplo "não, obrigada", "vou pensar", "deixa pra depois", "ainda não sei" -- não encerre direto pela seção DESPEDIDA.`,
    para: `Se o paciente recusar ou hesitar depois que você já perguntou "Posso confirmar esse agendamento para você?" (passo 5 de VALOR DA CONSULTA -- seja a variante com valor, pra paciente novo, ou sem valor, pra paciente já cadastrado) -- por exemplo "não, obrigada", "vou pensar", "deixa pra depois", "ainda não sei" -- não encerre direto pela seção DESPEDIDA.`,
  },
  {
    nome: 'RESGATE (nota final)',
    de: `Essa oferta só se aplica à recusa/hesitação DEPOIS do valor já ter sido informado (passo 5 em diante). Recusa em outro momento da conversa segue o fluxo normal, sem esse resgate.`,
    para: `Essa oferta só se aplica à recusa/hesitação DEPOIS da pergunta do passo 5 já ter sido feita (com ou sem valor, dependendo do caso). Recusa em outro momento da conversa segue o fluxo normal, sem esse resgate.`,
  },
];

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  const agent = wf.nodes.find((n) => n.name === 'AI Agent');
  if (!agent) throw new Error('node "AI Agent" não encontrado');

  let prompt = agent.parameters.options && agent.parameters.options.systemMessage;
  if (typeof prompt !== 'string') throw new Error('systemMessage não encontrado em parameters.options');

  for (const edit of EDITS) {
    if (!prompt.includes(edit.de)) {
      throw new Error(`Trecho esperado não encontrado ("${edit.nome}") -- prompt pode ter mudado desde que este script foi escrito.`);
    }
    prompt = prompt.replace(edit.de, edit.para);
  }

  agent.parameters.options.systemMessage = prompt;

  const payload = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings };
  const putRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    headers: { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await putRes.json();
  if (!putRes.ok) throw new Error(`PUT falhou: ${putRes.status} ${JSON.stringify(body)}`);
  console.log(`Aplicado com sucesso em ${workflowId} (${EDITS.length} edições) | active=`, body.active);
}

main().catch((err) => {
  console.error('ERRO:', err.message);
  process.exit(1);
});
