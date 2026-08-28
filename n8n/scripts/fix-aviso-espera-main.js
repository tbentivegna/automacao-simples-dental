// Fix 3 (parte 2/2) -- fluxo principal (path B do aviso de espera: quando
// chega uma 2a mensagem enquanto a Lumi ainda processa).
//
// Mudanças:
//  1. "CREATE & SELECT cliente": +coluna aviso_espera_livre (bool) = nenhum
//     aviso logado em n8n_chat_histories nos últimos 15 min.
//  2. "Já Avisou?": passa a ser OR -> pula o envio se já avisou NESTE turno
//     OU se o cooldown de 15 min ainda vale (aviso_espera_livre = false).
//  3. "Envia Aviso Espera": prefixo **[Lumi]:**.
//  4. Novo "Grava Aviso Espera" (Envia Aviso Espera -> Grava -> Marca Aviso
//     Enviado): grava a linha type:ai pra aparecer no painel.
//
// uso: node n8n/scripts/fix-aviso-espera-main.js <workflowId>
//   DEV  = yFSw0JMMD93EGZMa
//   PROD = K2xRqOwS0N0AcoqG  (só com OK do Tiago)
require('dotenv').config({ path: __dirname + '/../.env' });
const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const PG_CRED = { postgres: { id: 'IM7As7mjQcGJIzzy', name: 'Postgres account' } };
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node fix-aviso-espera-main.js <workflowId>');

const COL_COOLDOWN = `AS primeiro_contato,
  NOT EXISTS (
    SELECT 1 FROM public.n8n_chat_histories h2
    WHERE h2.session_id = c.telefone
      AND h2.message->>'content' LIKE 'Só um instante%já te retorno%'
      AND h2.created_at > now() - interval '15 minutes'
  ) AS aviso_espera_livre
FROM public.cliente c`;

const CONTENT_AVISO_B = 'Só um instante! 🤎 Ainda estou concluindo o que você me pediu, já te retorno.';

async function main() {
  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, { headers: { 'X-N8N-API-KEY': API_KEY } })).json();
  if (!wf.nodes) throw new Error('GET falhou: ' + JSON.stringify(wf));

  // 1. CREATE & SELECT cliente: +aviso_espera_livre
  const cs = wf.nodes.find((n) => n.name === 'CREATE & SELECT cliente');
  if (!cs.parameters.query.includes('aviso_espera_livre')) {
    const antes = cs.parameters.query;
    cs.parameters.query = antes.replace('AS primeiro_contato\nFROM public.cliente c', COL_COOLDOWN);
    if (cs.parameters.query === antes) throw new Error('nao consegui inserir aviso_espera_livre -- query base diferente do esperado');
  }

  // 2. Já Avisou? -> OR com aviso_espera_livre = false
  const ja = wf.nodes.find((n) => n.name === 'Já Avisou?');
  const temSegunda = ja.parameters.conditions.conditions.some((c) => String(c.leftValue).includes('aviso_espera_livre'));
  if (!temSegunda) {
    ja.parameters.conditions.combinator = 'or';
    ja.parameters.conditions.conditions.push({
      id: 'cooldown-aviso-espera',
      leftValue: "={{ $('CREATE & SELECT cliente').first().json.aviso_espera_livre }}",
      rightValue: '',
      operator: { type: 'boolean', operation: 'false', singleValue: true },
    });
  }

  // 3. Envia Aviso Espera: prefixo
  const envia = wf.nodes.find((n) => n.name === 'Envia Aviso Espera');
  if (typeof envia.parameters.messageText === 'string' && !envia.parameters.messageText.startsWith('**[Lumi]:**')) {
    const semPrefixo = envia.parameters.messageText.replace(/^\s*\*+\s*\[Lumi\]\s*:\s*\*+\s*/i, '');
    envia.parameters.messageText = '**[Lumi]:** ' + semPrefixo;
  }

  // 4. Grava Aviso Espera + rewire
  if (!wf.nodes.some((n) => n.name === 'Grava Aviso Espera')) {
    wf.nodes.push({
      parameters: {
        operation: 'executeQuery',
        query:
          "INSERT INTO public.n8n_chat_histories (session_id, message)\nVALUES ('{{ $('CREATE & SELECT cliente').first().json.telefone }}', $1::jsonb);",
        options: {
          queryReplacement:
            "={{ JSON.stringify({ type: 'ai', content: '" +
            CONTENT_AVISO_B +
            "', tool_calls: [], additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [] }) }}",
        },
      },
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.6,
      position: [envia.position[0] + 120, envia.position[1] + 140],
      id: 'grava-aviso-espera-b-' + workflowId.slice(0, 8),
      name: 'Grava Aviso Espera',
      credentials: PG_CRED,
    });
  }
  wf.connections['Envia Aviso Espera'] = { main: [[{ node: 'Grava Aviso Espera', type: 'main', index: 0 }]] };
  wf.connections['Grava Aviso Espera'] = { main: [[{ node: 'Marca Aviso Enviado', type: 'main', index: 0 }]] };

  // 5. red sticky
  if (!wf.nodes.some((n) => n.name === 'Sticky Fix Aviso B 28/08')) {
    wf.nodes.push({
      parameters: {
        content:
          '## 🔴 FIX 28/08: aviso de espera (path B)\n- "Já Avisou?" agora tb pula por cooldown de 15 min (aviso_espera_livre)\n- Grava Aviso Espera: aviso aparece no painel\n- prefixo **[Lumi]:**',
        height: 200,
        width: 400,
        color: 3,
      },
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [envia.position[0] - 40, envia.position[1] + 260],
      id: 'sticky-fix-aviso-b-' + workflowId.slice(0, 8),
      name: 'Sticky Fix Aviso B 28/08',
    });
  }

  const payload = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings };
  const put = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    headers: { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await put.json();
  if (!put.ok) throw new Error(`PUT falhou: ${put.status} ${JSON.stringify(body)}`);
  console.log('OK', workflowId, 'atualizado | active=', body.active);
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
