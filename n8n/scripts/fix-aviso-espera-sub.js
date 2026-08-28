// Fix 3 (parte 1/2) -- sub-workflow "Lumi - Aviso de Espera" (02gnpDAyI3aLDGpB).
//
// Problemas (reportados pelo Tiago a partir da conversa do Guilherme):
//  - o "Só um instante!..." disparava VÁRIAS vezes numa conversa lenta
//    (cada turno reseta cliente.aviso_espera_enviado, e a remarcação teve
//    várias chamadas lentas ao bridge);
//  - a mensagem NÃO aparecia no painel (nunca era gravada em
//    n8n_chat_histories).
//
// Mudanças aqui:
//  1. "Monta Tentativas": 6 -> 12 iterações (janela 30s -> 60s antes de avisar).
//  2. "Ainda Processando?": além das checagens atuais, exige que nenhum
//     aviso tenha sido logado em n8n_chat_histories nos últimos 15 min
//     (cooldown que sobrevive ao reset por turno -- o próprio log serve de
//     registro, sem precisar de coluna nova).
//  3. Novo node "Grava Aviso Espera" (Envia Aviso -> Grava Aviso Espera ->
//     Marca Aviso Enviado): insere a linha type:ai em n8n_chat_histories
//     pra aparecer no painel (mesmo shape de "Grava Apresentação").
//  4. Normaliza o prefixo pra **[Lumi]:** (era *[Lumi]:*).
require('dotenv').config({ path: __dirname + '/../.env' });
const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const SUB = '02gnpDAyI3aLDGpB';
const PG_CRED = { postgres: { id: 'IM7As7mjQcGJIzzy', name: 'Postgres account' } };

const NOVA_QUERY_AINDA_PROCESSANDO = `SELECT
  (
    c.processando_desde IS NOT NULL
    AND c.processando_desde > now() - interval '5 minutes'
    AND COALESCE(c.aviso_espera_enviado, false) = false
    AND NOT EXISTS (
      SELECT 1 FROM public.n8n_chat_histories h
      WHERE h.session_id = c.telefone
        AND h.message->>'content' LIKE 'Só um instante%já te retorno%'
        AND h.created_at > now() - interval '15 minutes'
    )
  ) AS deve_avisar
FROM public.cliente c
WHERE c.telefone = '{{ $('Chamado pelo Fluxo Principal').first().json.telefone }}';`;

const CONTENT_AVISO = 'Só um instante! Estou verificando isso pra você, já te retorno.';

async function main() {
  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${SUB}`, { headers: { 'X-N8N-API-KEY': API_KEY } })).json();
  if (!wf.nodes) throw new Error('GET falhou: ' + JSON.stringify(wf));

  // 1. Monta Tentativas 6 -> 12
  const mt = wf.nodes.find((n) => n.name === 'Monta Tentativas');
  mt.parameters.jsCode =
    '// 12 tentativas de 5s cada = ate 60s de monitoramento antes de avisar.\n' +
    'return Array.from({ length: 12 }, () => ({ json: {} }));';

  // 2. Ainda Processando? + cooldown
  const ap = wf.nodes.find((n) => n.name === 'Ainda Processando?');
  ap.parameters.query = NOVA_QUERY_AINDA_PROCESSANDO;

  // 3. novo node Grava Aviso Espera
  const envia = wf.nodes.find((n) => n.name === 'Envia Aviso');
  // normaliza prefixo -> **[Lumi]:**
  if (typeof envia.parameters.messageText === 'string') {
    const semPrefixo = envia.parameters.messageText.replace(/^\s*\*+\s*\[Lumi\]\s*:\s*\*+\s*/i, '');
    envia.parameters.messageText = '**[Lumi]:** ' + semPrefixo;
  }
  if (!wf.nodes.some((n) => n.name === 'Grava Aviso Espera')) {
    wf.nodes.push({
      parameters: {
        operation: 'executeQuery',
        query:
          "INSERT INTO public.n8n_chat_histories (session_id, message)\nVALUES ('{{ $('Chamado pelo Fluxo Principal').first().json.telefone }}', $1::jsonb);",
        options: {
          queryReplacement:
            "={{ JSON.stringify({ type: 'ai', content: '" +
            CONTENT_AVISO +
            "', tool_calls: [], additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [] }) }}",
        },
      },
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.6,
      position: [envia.position[0] + 100, envia.position[1] + 150],
      id: 'grava-aviso-espera-sub',
      name: 'Grava Aviso Espera',
      credentials: PG_CRED,
    });
  }
  // rewire: Envia Aviso -> Grava Aviso Espera -> Marca Aviso Enviado
  wf.connections['Envia Aviso'] = { main: [[{ node: 'Grava Aviso Espera', type: 'main', index: 0 }]] };
  wf.connections['Grava Aviso Espera'] = { main: [[{ node: 'Marca Aviso Enviado', type: 'main', index: 0 }]] };

  // 4. red sticky
  if (!wf.nodes.some((n) => n.name === 'Sticky Fix Aviso 28/08')) {
    wf.nodes.push({
      parameters: {
        content:
          '## 🔴 FIX 28/08: aviso de espera\n- janela 30s -> 60s (Monta Tentativas 6 -> 12)\n- cooldown de 15 min via log em n8n_chat_histories (Ainda Processando?)\n- Grava Aviso Espera: aviso agora aparece no painel\n- prefixo normalizado pra **[Lumi]:**',
        height: 220,
        width: 420,
        color: 3,
      },
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [mt.position[0] - 40, mt.position[1] - 260],
      id: 'sticky-fix-aviso-2808',
      name: 'Sticky Fix Aviso 28/08',
    });
  }

  const payload = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings };
  const put = await fetch(`${BASE_URL}/api/v1/workflows/${SUB}`, {
    method: 'PUT',
    headers: { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await put.json();
  if (!put.ok) throw new Error(`PUT falhou: ${put.status} ${JSON.stringify(body)}`);
  console.log('OK sub-workflow atualizado | active=', body.active);
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
