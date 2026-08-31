'use strict';

// Reforço do fix de lembrete opt-out de 31/08/2026: testando via harness,
// a Lumi mandou o aviso de lembrete mas NÃO chamou a ferramenta Registrar
// Consentimento Lembrete na mesma resposta -- ou seja, lembrete_informado_em
// nunca seria marcado, e o aviso se repetiria pro mesmo paciente pra
// sempre. Reforça com uma REGRA CRÍTICA explícita (mesmo padrão já usado
// em "está registrado?" antes da mudança), tanto no passo 10 quanto na
// descrição da ferramenta.
//
// Aplicar primeiro em DEV, testar de novo, só depois em PROD.
// Uso: WORKFLOW_ID_ALVO=yFSw0JMMD93EGZMa node scripts/fix-lembrete-forca-chamada-ferramenta.js

require('dotenv').config();

const BASE = process.env.N8N_BASE_URL;
const KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = process.env.WORKFLOW_ID_ALVO || 'K2xRqOwS0N0AcoqG';

const PASSO10_ANTIGO = '10. Aviso de lembrete — na mesma mensagem de confirmação ou na seguinte, se ainda não houver nota do sistema dizendo que o paciente já foi avisado sobre isso, informe (não pergunte -- é automático por padrão): "Vou te avisar por WhatsApp um dia antes e no dia da sua consulta, tá bom? Se não quiser receber, é só me avisar que eu te tiro da lista. 😊" Assim que mandar essa mensagem, use a ferramenta Registrar Consentimento Lembrete com consentimento "sim" (ver item 7 da lista de ferramentas, seção FERRAMENTAS) -- isso marca que o paciente já foi avisado, pra você nunca repetir esse aviso de novo. Se o paciente responder recusando, chame a mesma ferramenta com consentimento "nao" nesse momento.';

const PASSO10_NOVO = `10. Aviso de lembrete — na mesma mensagem de confirmação ou na seguinte, se ainda não houver nota do sistema dizendo que o paciente já foi avisado sobre isso, informe (não pergunte -- é automático por padrão): "Vou te avisar por WhatsApp um dia antes e no dia da sua consulta, tá bom? Se não quiser receber, é só me avisar que eu te tiro da lista. 😊"
REGRA CRÍTICA: SEMPRE que você mandar esse aviso, chame a ferramenta Registrar Consentimento Lembrete com consentimento "sim" ANTES de finalizar sua resposta -- nunca mande o texto do aviso numa resposta sem chamar a ferramenta na MESMA resposta (ver item 7 da lista de ferramentas, seção FERRAMENTAS). Se você esquecer de chamar a ferramenta, o sistema nunca vai saber que você já avisou, e você vai repetir esse aviso pro mesmo paciente para sempre -- é um erro tão grave quanto dizer que confirmou algo sem ter confirmado de verdade. Se o paciente responder recusando, chame a mesma ferramenta com consentimento "nao" nesse momento.`;

const TOOL7_ANTIGO = `7) Registrar Consentimento Lembrete — o padrão hoje é opt-out: todo paciente já recebe lembrete automático de consulta por WhatsApp (workflow separado, fora desta conversa), a menos que peça pra sair da lista. Esta ferramenta serve pra duas coisas:
- Marcar que o paciente já foi AVISADO dessa política -- chame com consentimento "sim" assim que você mandar o aviso do passo 10 do FLUXO COMPLETO DE AGENDAMENTO (ou a mesma oportunidade logo após uma remarcação bem-sucedida — item 6 acima).
- Registrar quando o paciente pede explicitamente pra SAIR da lista -- chame com consentimento "nao" a qualquer momento que ele disser isso, mesmo sem você ter avisado antes nesta conversa (ex: "não quero receber lembrete", "pode tirar da lista", "cancela o lembrete", "não precisa me avisar").
Parâmetro consentimento: "sim" = confirma que o paciente foi avisado da política padrão. "nao" = paciente pediu explicitamente pra não receber.
Se o paciente perguntar "vou receber lembrete?"/"como funciona isso do lembrete?", responda que sim, é automático, e que pode pedir pra sair quando quiser.`;

const TOOL7_NOVO = `7) Registrar Consentimento Lembrete — o padrão hoje é opt-out: todo paciente já recebe lembrete automático de consulta por WhatsApp (workflow separado, fora desta conversa), a menos que peça pra sair da lista. Esta ferramenta serve pra duas coisas:
- Marcar que o paciente já foi AVISADO dessa política -- chame com consentimento "sim" assim que você mandar o aviso do passo 10 do FLUXO COMPLETO DE AGENDAMENTO (ou a mesma oportunidade logo após uma remarcação bem-sucedida — item 6 acima). REGRA CRÍTICA: essa chamada é OBRIGATÓRIA sempre que você mandar o texto do aviso -- nunca mande o aviso sem chamar a ferramenta na mesma resposta, senão o sistema nunca sabe que você já avisou e o aviso se repete pra sempre.
- Registrar quando o paciente pede explicitamente pra SAIR da lista -- chame com consentimento "nao" a qualquer momento que ele disser isso, mesmo sem você ter avisado antes nesta conversa (ex: "não quero receber lembrete", "pode tirar da lista", "cancela o lembrete", "não precisa me avisar").
Parâmetro consentimento: "sim" = confirma que o paciente foi avisado da política padrão. "nao" = paciente pediu explicitamente pra não receber.
Se o paciente perguntar "vou receber lembrete?"/"como funciona isso do lembrete?", responda que sim, é automático, e que pode pedir pra sair quando quiser.`;

async function main() {
  const resposta = await fetch(`${BASE}/api/v1/workflows/${WORKFLOW_ID}`, {
    headers: { 'X-N8N-API-KEY': KEY },
  });
  const workflow = await resposta.json();

  const nodeAgente = workflow.nodes.find((n) => n.type === '@n8n/n8n-nodes-langchain.agent');
  if (!nodeAgente) throw new Error('Node do AI Agent não encontrado.');

  let texto = nodeAgente.parameters.options.systemMessage.replace(/\r\n/g, '\n');
  if (texto.includes('é um erro tão grave quanto dizer que confirmou algo sem ter confirmado de verdade')) {
    console.log('Já aplicado neste workflow. Nada a fazer.');
    return;
  }
  if (!texto.includes(PASSO10_ANTIGO)) throw new Error('Passo 10 não bate com o esperado -- abortando.');
  if (!texto.includes(TOOL7_ANTIGO)) throw new Error('Descrição da ferramenta 7 não bate com o esperado -- abortando.');

  texto = texto.replace(PASSO10_ANTIGO, PASSO10_NOVO);
  texto = texto.replace(TOOL7_ANTIGO, TOOL7_NOVO);
  nodeAgente.parameters.options.systemMessage = texto;

  const stickyId = `sticky-fix-lembrete-forca-${Date.now()}`;
  workflow.nodes.push({
    parameters: {
      content:
        '## ⚠️ Fix 31/08/2026 (reforço)\nTeste via harness mostrou que a Lumi mandava o aviso de lembrete mas não chamava a ferramenta -- reforçado com REGRA CRÍTICA explícita em 2 lugares (passo 10 + descrição da ferramenta).',
      height: 200,
      width: 340,
      color: 3,
    },
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [nodeAgente.position[0] - 60, nodeAgente.position[1] - 450],
    id: stickyId,
    name: 'Nota - Fix Lembrete Reforco 31-08',
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
  if (!put.ok) throw new Error(`Falha ao salvar workflow: ${put.status} ${await put.text()}`);
  console.log('Aplicado com sucesso.');
}

main().catch((erro) => {
  console.error('ERRO:', erro.message);
  process.exit(1);
});
