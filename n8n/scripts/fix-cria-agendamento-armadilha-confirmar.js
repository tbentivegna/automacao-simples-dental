// Achado testando GPT-5.4-mini em DEV (03/09): a Lumi chamou "Confirmar
// Agendamento" em vez de "Cria Agendamento" pra uma marcação NOVA (sem ID
// nenhum), e inventou um ID falso (usou o próprio id da tool_call). O
// paciente respondeu "Pode confirmar sim por favor" -- palavra "confirmar"
// coincide com o NOME da ferramenta errada, mesmo não tendo nada a ver com
// ela tecnicamente. Suspeita do Tiago, confirmada plausível: correspondência
// lexical (a palavra do paciente) em vez de raciocínio semântico (existe ID
// real ou não).
//
// Fix: reforça a descrição de "Cria Agendamento" com (1) instrução explícita
// de quando usar (que faltava -- a descrição só falava de timeout/erro) e
// (2) a armadilha específica da palavra "confirmar" nomeada e desarmada.
// Mesmo texto já testado no harness (lumi-harness/tools.js) -- 7 de 7
// rodadas limpas depois desse reforço, contra 0 de 1 antes.
//
// uso: node n8n/scripts/fix-cria-agendamento-armadilha-confirmar.js <workflowId>
//   DEV  = yFSw0JMMD93EGZMa
//   PROD = K2xRqOwS0N0AcoqG
require('dotenv').config({ path: __dirname + '/../.env' });
const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node fix-cria-agendamento-armadilha-confirmar.js <workflowId>');

const DESCRICAO_ANTIGA = `IMPORTANTE — TIMEOUT OU ERRO

Esta ferramenta realiza uma operação real de criação de agendamento.

Se a ferramenta retornar timeout, erro ou resultado inconclusivo, NÃO tente criar o mesmo agendamento novamente.

Um timeout não significa necessariamente que o agendamento não foi criado no sistema.

Em caso de erro ou timeout:
1. Não informe ao paciente que o agendamento foi cancelado ou não foi criado.
2. Não execute novamente "Criar Agendamento" imediatamente.
3. Utilize "Buscar Agendamentos do Paciente" para verificar se o agendamento solicitado foi criado.
4. Se o agendamento for encontrado para a mesma data e horário solicitados pelo paciente, considere a operação concluída.
5. Se não for encontrado, encaminhe a situação para a equipe humana.

Nunca crie um segundo agendamento apenas porque esta ferramenta não retornou uma confirmação.`;

const DESCRICAO_NOVA = `Cria um agendamento NOVO para o paciente -- use esta ferramenta sempre que for a primeira vez marcando esse horário específico (o paciente ainda NÃO tem esse agendamento no sistema, e "Busca Agendamentos do Paciente" não retornou nenhum ID pra ele nesse horário).

NUNCA use "Confirmar Agendamento" pra marcar um horário novo -- aquela ferramenta serve SOMENTE pra confirmar um agendamento que JÁ EXISTE e já tem um ID retornado por "Busca Agendamentos do Paciente". Se você não tem um ID de agendamento real pra esse horário, a ferramenta certa é sempre esta (Criar Agendamento), nunca "Confirmar Agendamento".

ARMADILHA COMUM -- a palavra do paciente NÃO decide a ferramenta: depois que você pergunta "Posso confirmar esse agendamento para você?" (pergunta padrão ao oferecer um horário novo), é normal o paciente responder com a MESMA palavra ("pode confirmar", "confirma sim", "tá confirmado então", "confirmado"). Isso NÃO significa chamar "Confirmar Agendamento" -- nesse ponto do fluxo o agendamento ainda não existe (sem ID nenhum), então o paciente está dizendo "sim, pode marcar", e a ferramenta certa continua sendo esta (Criar Agendamento). Decida pela ferramenta certa SEMPRE com base em existir ou não um ID real de agendamento pra esse horário -- nunca pela palavra usada pelo paciente.

IMPORTANTE — TIMEOUT OU ERRO

Esta ferramenta realiza uma operação real de criação de agendamento.

Se a ferramenta retornar timeout, erro ou resultado inconclusivo, NÃO tente criar o mesmo agendamento novamente.

Um timeout não significa necessariamente que o agendamento não foi criado no sistema.

Em caso de erro ou timeout:
1. Não informe ao paciente que o agendamento foi cancelado ou não foi criado.
2. Não execute novamente "Criar Agendamento" imediatamente.
3. Utilize "Buscar Agendamentos do Paciente" para verificar se o agendamento solicitado foi criado.
4. Se o agendamento for encontrado para a mesma data e horário solicitados pelo paciente, considere a operação concluída.
5. Se não for encontrado, encaminhe a situação para a equipe humana.

Nunca crie um segundo agendamento apenas porque esta ferramenta não retornou uma confirmação.`;

async function main() {
  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, { headers: H })).json();
  if (!wf.nodes) throw new Error('GET falhou: ' + JSON.stringify(wf));
  if (wf.active && wf.versionId !== wf.activeVersionId) throw new Error('draft != ativo -- roda realinha-draft.js antes');

  const node = wf.nodes.find((n) => n.name === 'Cria Agendamento');
  if (!node) throw new Error('node "Cria Agendamento" nao encontrado');

  const atual = (node.parameters.toolDescription || '').replace(/\r\n/g, '\n');
  if (atual.includes('ARMADILHA COMUM')) {
    console.log('ja aplicado -- nada a fazer');
    return;
  }
  if (atual.trim() !== DESCRICAO_ANTIGA.trim()) {
    throw new Error('descricao atual diferente do esperado -- CONFERIR antes de aplicar');
  }
  node.parameters.toolDescription = DESCRICAO_NOVA;

  if (!wf.nodes.some((n) => n.name === 'Sticky Fix Cria Vs Confirmar 03/09')) {
    wf.nodes.push({
      parameters: {
        content:
          '## 🔴 FIX 03/09: Cria vs Confirmar Agendamento\nGPT-5.4-mini chamou Confirmar (e inventou ID) pra uma\nmarcação nova, porque o paciente disse "pode confirmar".\nDescrição de Cria Agendamento agora nomeia e desarma essa\narmadilha -- 7/7 limpo no harness depois disso.',
        height: 240,
        width: 460,
        color: 3,
      },
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [(node.position?.[0] ?? 0) - 40, (node.position?.[1] ?? 0) - 300],
      id: 'sticky-fix-cria-vs-confirmar-' + workflowId.slice(0, 8),
      name: 'Sticky Fix Cria Vs Confirmar 03/09',
    });
  }

  const put = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings }),
  });
  const pb = await put.json();
  if (!put.ok) throw new Error(`PUT falhou: ${put.status} ${JSON.stringify(pb)}`);

  if (wf.active) {
    const act = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}/activate`, { method: 'POST', headers: H });
    console.log('activate:', act.status);
  }

  await new Promise((r) => setTimeout(r, 1500));
  const verificacao = await (await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, { headers: H })).json();
  const live = verificacao.nodes.find((n) => n.name === 'Cria Agendamento');
  const okTexto = (live.parameters.toolDescription || '').includes('ARMADILHA COMUM');
  console.log(`PUT ${put.status} | texto ok=${okTexto} | active=${verificacao.active}`);
  if (!okTexto) throw new Error('verificacao FALHOU -- conferir na UI');
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
