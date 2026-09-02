// Achado extra (02/09, fora do lote da análise semanal -- reportado
// direto pelo Tiago, caso Thalita): consulta dela foi às 8h30 da manhã,
// um attachment do Invisalign caiu à tarde (16h). A Lumi nunca chamou
// Busca Agendamentos do Paciente pra confirmar, e presumiu que a consulta
// ainda ia acontecer -- disse "ela vai te orientar na consulta de hoje" e
// "leve ele com você" às 16h, quando a consulta já tinha passado 8h antes.
//
// server.js (formatarCompromissos) já ganhou um campo novo "jaOcorreu"
// (compara horário de término contra agora -- não depende do status do
// Simples Dental estar atualizado, já que a Dra. Aline às vezes esquece
// de marcar "Finalizada"). Este fix ensina o prompt a checar e usar esse
// campo antes de tratar uma consulta como ainda-por-acontecer.
//
// uso: node n8n/scripts/fix-consulta-ja-ocorreu.js <workflowId>
//   DEV  = yFSw0JMMD93EGZMa
//   PROD = K2xRqOwS0N0AcoqG
require('dotenv').config({ path: __dirname + '/../.env' });
const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node fix-consulta-ja-ocorreu.js <workflowId>');

const ANCHOR = `🔎 CONSULTA DE AGENDAMENTOS EXISTENTES

"Tenho alguma consulta marcada?" → use Busca Agendamentos do Paciente → responda com base exclusiva no resultado.

🚨 URGÊNCIAS E DOR INTENSA`;

const REPLACEMENT = `🔎 CONSULTA DE AGENDAMENTOS EXISTENTES

"Tenho alguma consulta marcada?" → use Busca Agendamentos do Paciente → responda com base exclusiva no resultado.

REGRA CRÍTICA -- CONSULTA JÁ OCORRIDA: antes de dizer que algo vai ser tratado "na consulta de hoje", pedir pra "levar isso na consulta" ou de qualquer forma tratar uma consulta do paciente como ainda-por-acontecer, chame Busca Agendamentos do Paciente e olhe o campo jaOcorreu do resultado -- nunca presuma pelo contexto da conversa (ex: um lembrete mandado de manhã não garante que a consulta ainda não aconteceu se já for tarde). Não confie só no campo status pra isso: a Dra. Aline às vezes esquece de marcar a consulta como "Finalizada" mesmo depois do horário já ter passado, então jaOcorreu é o sinal confiável (compara o horário real, não o status). Se jaOcorreu vier true, a consulta já aconteceu -- trate qualquer relato do paciente (ex: alinhador/attachment que caiu, dúvida sobre o procedimento) como uma questão PÓS-consulta: siga a regra de DÚVIDA_PROCEDIMENTO normalmente, mas nunca diga "ela vai te orientar na consulta" nem peça pra levar algo pra uma consulta que já terminou.

🚨 URGÊNCIAS E DOR INTENSA`;

async function main() {
  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, { headers: H })).json();
  if (!wf.nodes) throw new Error('GET falhou: ' + JSON.stringify(wf));
  if (wf.versionId !== wf.activeVersionId) throw new Error('draft != ativo -- roda realinha-draft.js antes');

  const node = wf.nodes.find((n) => n.name === 'AI Agent');
  if (!node) throw new Error('node "AI Agent" nao encontrado');

  const campo = node.parameters.options?.systemMessage !== undefined ? 'options' : 'top';
  let texto = campo === 'options' ? node.parameters.options.systemMessage : node.parameters.systemMessage;
  texto = texto.replace(/\r\n/g, '\n');

  if (texto.includes('REGRA CRÍTICA -- CONSULTA JÁ OCORRIDA')) {
    console.log('ja aplicado -- nada a fazer');
    return;
  }
  if (!texto.includes(ANCHOR)) {
    throw new Error('anchor nao encontrado no systemMessage -- texto base diferente do esperado, CONFERIR');
  }
  texto = texto.replace(ANCHOR, REPLACEMENT);
  if (campo === 'options') {
    node.parameters.options.systemMessage = texto;
  } else {
    node.parameters.systemMessage = texto;
  }

  if (!wf.nodes.some((n) => n.name === 'Sticky Fix Consulta Ja Ocorreu 02/09')) {
    wf.nodes.push({
      parameters: {
        content:
          '## 🔴 FIX 02/09: consulta já ocorrida tratada como futura\nCaso Thalita: attachment caiu à tarde, consulta tinha sido\nde manhã -- Lumi nunca checou e disse "na consulta de hoje"\ncomo se ainda fosse acontecer. Novo campo jaOcorreu\n(server.js) + regra no prompt pra sempre checar antes de\ntratar consulta como futura.',
        height: 240,
        width: 440,
        color: 3,
      },
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [(node.position?.[0] ?? 0) - 40, (node.position?.[1] ?? 0) - 820],
      id: 'sticky-fix-consulta-ja-ocorreu-' + workflowId.slice(0, 8),
      name: 'Sticky Fix Consulta Ja Ocorreu 02/09',
    });
  }

  const put = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings }),
  });
  const pb = await put.json();
  if (!put.ok) throw new Error(`PUT falhou: ${put.status} ${JSON.stringify(pb)}`);
  const act = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}/activate`, { method: 'POST', headers: H });
  const ab = await act.json();
  const ok = ab.versionId === ab.activeVersionId;
  const live = (ab.activeVersion?.nodes || ab.nodes).find((n) => n.name === 'AI Agent');
  const liveTexto = live.parameters.options?.systemMessage || live.parameters.systemMessage;
  const okTexto = liveTexto.includes('REGRA CRÍTICA -- CONSULTA JÁ OCORRIDA');
  console.log(`PUT ${put.status} | activate ${act.status} | draft==active=${ok} | texto ok=${okTexto}`);
  if (!ok || !okTexto) throw new Error('verificacao FALHOU -- conferir na UI');
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
