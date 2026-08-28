// Fix 2a -- "Lumi - Resgate de Funil" (vUGMz073giDPfGzx) nao deve disparar
// resgate pra paciente que JA TEM consulta futura marcada.
//
// Caso Guilherme (27/08): o resgate disparou pra um paciente com consulta
// confirmada pro dia seguinte, no meio de uma remarcacao. O funil de
// resgate e pra tentativas de agendamento ABANDONADAS -- quem ja tem
// consulta marcada e esta remarcando esta no fluxo normal da Lumi, nao e
// "abandonado". Alem do resgate ficar fora de contexto, ele re-primou o
// modelo e levou ao cancelamento errado (ver fix 2b).
//
// Mudanca: "Busca Funil Parado" ganha mais um NOT EXISTS -- pula a linha
// se o paciente tem evento em eventos_agenda (criado/remarcado/
// lembrete_enviado/confirmado) com data_consulta >= hoje (BRT) e mais
// recente que o ultimo 'cancelado' dele. Telefone convertido de
// 5511999999999@s.whatsapp.net -> 11999999999 (formato de eventos_agenda).
//
// Workflow sem DEV twin -> aplicado direto em prod (com OK do Tiago).
// uso: node n8n/scripts/fix-resgate-consulta-futura.js
require('dotenv').config({ path: __dirname + '/../.env' });
const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };
const WF = 'vUGMz073giDPfGzx';

const CLAUSE = `  AND NOT EXISTS (
    SELECT 1 FROM public.eventos_agenda ev
    WHERE ev.telefone = substring(split_part(f.telefone, '@', 1) from 3)
      AND ev.tipo IN ('criado','remarcado','lembrete_enviado','confirmado')
      AND ev.data_consulta::date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date
      AND ev.criado_em > COALESCE(
        (SELECT max(cc.criado_em) FROM public.eventos_agenda cc
          WHERE cc.telefone = substring(split_part(f.telefone, '@', 1) from 3)
            AND cc.tipo = 'cancelado'),
        '-infinity'::timestamptz)
  )
LIMIT 20;`;

async function main() {
  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${WF}`, { headers: H })).json();
  if (!wf.nodes) throw new Error('GET falhou: ' + JSON.stringify(wf));

  const node = wf.nodes.find((n) => n.name === 'Busca Funil Parado');
  if (!node) throw new Error('node "Busca Funil Parado" nao encontrado');

  if (node.parameters.query.includes('eventos_agenda ev')) {
    console.log('ja aplicado (clause presente) -- nada a fazer');
    return;
  }
  if (!node.parameters.query.includes('LIMIT 20;')) {
    throw new Error('query base diferente do esperado (sem "LIMIT 20;") -- abortando');
  }
  node.parameters.query = node.parameters.query.replace('LIMIT 20;', CLAUSE);

  if (!wf.nodes.some((n) => n.name === 'Sticky Fix Consulta Futura 28/08')) {
    wf.nodes.push({
      parameters: {
        content:
          '## 🔴 FIX 28/08: resgate nao dispara com consulta futura\nNOT EXISTS em eventos_agenda -- se o paciente tem consulta\n(criado/remarcado/lembrete_enviado/confirmado) com data >= hoje\ne mais nova que o ultimo cancelado, a linha e pulada.\nCaso Guilherme: resgate disparou pra quem tinha consulta amanha.',
        height: 200,
        width: 440,
        color: 3,
      },
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [(node.position?.[0] ?? 0) - 40, (node.position?.[1] ?? 0) - 260],
      id: 'sticky-fix-resgate-consulta-futura',
      name: 'Sticky Fix Consulta Futura 28/08',
    });
  }

  const put = await fetch(`${BASE_URL}/api/v1/workflows/${WF}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings }),
  });
  const pb = await put.json();
  if (!put.ok) throw new Error(`PUT falhou: ${put.status} ${JSON.stringify(pb)}`);

  // publicar (PUT sozinho nem sempre publica nesse n8n)
  const act = await fetch(`${BASE_URL}/api/v1/workflows/${WF}/activate`, { method: 'POST', headers: H });
  const ab = await act.json();
  const ok = ab.versionId === ab.activeVersionId;
  console.log(`PUT ${put.status} | activate ${act.status} | active=${ab.active} | draft==active=${ok}`);
  if (!ok) throw new Error('draft != active depois do activate -- CONFERIR NA UI');
  const liveNode = (ab.activeVersion?.nodes || ab.nodes).find((n) => n.name === 'Busca Funil Parado');
  console.log('clause na versao ativa?', liveNode.parameters.query.includes('eventos_agenda ev'));
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
