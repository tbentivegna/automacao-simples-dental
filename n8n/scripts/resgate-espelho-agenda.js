// Peca 3 + 4 do plano "Espelho da Agenda".
//
// No workflow "Lumi - Resgate de Funil" (vUGMz073giDPfGzx):
//  1. novo no "Sincronizar Agenda" (HTTP -> bridge /sincronizar-agenda)
//     ENTRE o trigger e o Busca Funil Parado -- espelho fresco a cada
//     ciclo. Erro no sync PARA o workflow (default do n8n): melhor pular
//     um ciclo de resgate do que mandar errado com espelho velho.
//  2. novo no "Fecha Funis Com Consulta" -- marca 'concluido' os funis
//     em_andamento que ja tem consulta futura no espelho (mata a linha
//     zumbi).
//  3. "Busca Funil Parado": troca o NOT EXISTS de eventos_agenda pelo de
//     public.consultas (autoritativo, pega consulta marcada na mao).
//
// Fluxo final:
//   A cada 30 min ─┬─> Sincronizar Agenda -> Fecha Funis Com Consulta -> Busca Funil Parado -> ...
//                  └─> Expira Resgates Antigos   (paralelo)
//
// O workflow esta DESATIVADO -- este script so aplica o PUT, NAO reativa.
// A reativacao e o teste de aceitacao sao o passo 5 do plano.
//
// uso: node n8n/scripts/resgate-espelho-agenda.js
require('dotenv').config({ path: __dirname + '/../.env' });
const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };
const WF = 'vUGMz073giDPfGzx';
const PG_CRED = { postgres: { id: 'IM7As7mjQcGJIzzy', name: 'Postgres account' } };
const BRIDGE = 'https://whatsapp-teste-github.usixhn.easypanel.host';
const BRIDGE_KEY = '37e4399e62ab2799d4b1736702eaa316b1cb22ac03a324b2f430f9bd70bd6df2';

const CONSULTAS_NOT_EXISTS = `  AND NOT EXISTS (
    SELECT 1 FROM public.consultas ct
    WHERE ct.telefone = f.telefone
      AND ct.inicio >= now()
      AND ct.status NOT IN ('Cancelada pelo paciente','Cancelada pelo profissional','Falta','removido_do_calendario')
  )
LIMIT 20;`;

const EVENTOS_NOT_EXISTS_RE =
  /  AND NOT EXISTS \(\s*SELECT 1 FROM public\.eventos_agenda ev[\s\S]*?'-infinity'::timestamptz\)\s*\)\s*LIMIT 20;/;

const FECHA_FUNIS_SQL = `UPDATE public.funil_agendamento f
SET status = 'concluido', concluido_em = now()
WHERE f.status = 'em_andamento'
  AND EXISTS (
    SELECT 1 FROM public.consultas ct
    WHERE ct.telefone = f.telefone
      AND ct.inicio >= now()
      AND ct.status NOT IN ('Cancelada pelo paciente','Cancelada pelo profissional','Falta','removido_do_calendario')
  );`;

async function main() {
  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${WF}`, { headers: H })).json();
  if (!wf.nodes) throw new Error('GET falhou: ' + JSON.stringify(wf));

  // --- 1. no Sincronizar Agenda
  if (!wf.nodes.some((n) => n.name === 'Sincronizar Agenda')) {
    wf.nodes.push({
      parameters: {
        method: 'POST',
        url: `${BRIDGE}/sincronizar-agenda`,
        sendHeaders: true,
        headerParameters: { parameters: [{ name: 'X-Bridge-Key', value: BRIDGE_KEY }] },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '{ "semanas": 4 }',
        options: { timeout: 900000 },
      },
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [140, -260],
      id: 'sincronizar-agenda-resgate',
      name: 'Sincronizar Agenda',
    });
  }

  // --- 2. no Fecha Funis Com Consulta
  if (!wf.nodes.some((n) => n.name === 'Fecha Funis Com Consulta')) {
    wf.nodes.push({
      parameters: { operation: 'executeQuery', query: FECHA_FUNIS_SQL, options: {} },
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.6,
      position: [140, -60],
      id: 'fecha-funis-com-consulta',
      name: 'Fecha Funis Com Consulta',
      credentials: PG_CRED,
    });
  }

  // --- 3. Busca Funil Parado: eventos_agenda -> consultas
  const bfp = wf.nodes.find((n) => n.name === 'Busca Funil Parado');
  if (!bfp) throw new Error('Busca Funil Parado nao encontrado');
  if (bfp.parameters.query.includes('public.consultas ct')) {
    console.log('Busca Funil Parado ja usa consultas -- ok');
  } else {
    if (!EVENTOS_NOT_EXISTS_RE.test(bfp.parameters.query)) {
      throw new Error('nao achei o bloco NOT EXISTS de eventos_agenda -- CONFERIR query base');
    }
    bfp.parameters.query = bfp.parameters.query.replace(EVENTOS_NOT_EXISTS_RE, CONSULTAS_NOT_EXISTS);
  }

  // --- rewire
  wf.connections['A cada 30 min'] = {
    main: [[
      { node: 'Sincronizar Agenda', type: 'main', index: 0 },
      { node: 'Expira Resgates Antigos', type: 'main', index: 0 },
    ]],
  };
  wf.connections['Sincronizar Agenda'] = { main: [[{ node: 'Fecha Funis Com Consulta', type: 'main', index: 0 }]] };
  wf.connections['Fecha Funis Com Consulta'] = { main: [[{ node: 'Busca Funil Parado', type: 'main', index: 0 }]] };

  // --- sticky
  if (!wf.nodes.some((n) => n.name === 'Sticky Espelho Agenda 28/08')) {
    wf.nodes.push({
      parameters: {
        content:
          '## 🔴 28/08: Espelho da Agenda\nSincronizar Agenda (bridge /sincronizar-agenda) roda ANTES do\nBusca Funil Parado -> espelho public.consultas fresco a cada ciclo.\nErro no sync PARA o workflow (sem resgate com espelho velho).\nFecha Funis Com Consulta: marca concluido quem ja tem consulta.\nBusca Funil Parado agora checa public.consultas, nao eventos_agenda.',
        height: 240,
        width: 470,
        color: 3,
      },
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [-40, -560],
      id: 'sticky-espelho-agenda',
      name: 'Sticky Espelho Agenda 28/08',
    });
  }

  const put = await fetch(`${BASE_URL}/api/v1/workflows/${WF}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings }),
  });
  const pb = await put.json();
  if (!put.ok) throw new Error(`PUT falhou: ${put.status} ${JSON.stringify(pb)}`);
  console.log('OK -- PUT', put.status, '| workflow segue DESATIVADO (reativar no teste de aceitacao)');

  // conferencia
  const back = await (await fetch(`${BASE_URL}/api/v1/workflows/${WF}`, { headers: H })).json();
  const q = back.nodes.find((n) => n.name === 'Busca Funil Parado').parameters.query;
  console.log('  Busca Funil Parado usa consultas?', q.includes('public.consultas ct'), '| ainda cita eventos_agenda?', /eventos_agenda/.test(q));
  console.log('  tem Sincronizar Agenda?', back.nodes.some((n) => n.name === 'Sincronizar Agenda'));
  console.log('  tem Fecha Funis Com Consulta?', back.nodes.some((n) => n.name === 'Fecha Funis Com Consulta'));
  console.log('  A cada 30 min ->', JSON.stringify(back.connections['A cada 30 min'].main[0].map((x) => x.node)));
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
