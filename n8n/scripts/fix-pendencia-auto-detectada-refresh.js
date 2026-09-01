// "Registrar Ação" ja tinha um guard de dedup (fix 24/08, caso Thaynna):
// nao insere uma 2a pendencia auto-detectada se ja existe uma em aberto do
// mesmo paciente nos ultimos 30 min. Bom pra evitar spam -- mas so fazia
// SKIP, nunca atualizava o detail/created_at da pendencia existente.
//
// Bug achado 31/08 (caso Diovana Terra Fonseca): a rede de seguranca
// disparou as 12:21 (1a fala travada) e de novo as 12:25 (2a fala, mesmo
// padrao) -- o dedup corretamente suprimiu a 2a insercao, mas a pendencia
// #198 ficou congelada citando a fala das 12:21, mesmo a conversa tendo
// avancado 4 minutos depois. Pra equipe, pareceu inconsistente com o
// historico real (que ja tinha mensagem mais recente).
//
// Fix: quando o dedup impede a insercao, faz UPDATE na pendencia existente
// (detail + created_at) em vez de so pular -- sempre reflete o ultimo
// ponto onde a Lumi travou, nao o primeiro. So afeta auto-detectadas, mesma
// regra de antes: agent_action real da IA sempre insere, nunca mexe em
// pendencia existente.
//
// uso: node n8n/scripts/fix-pendencia-auto-detectada-refresh.js <workflowId>
//   DEV  = yFSw0JMMD93EGZMa
//   PROD = K2xRqOwS0N0AcoqG
require('dotenv').config({ path: __dirname + '/../.env' });
const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node fix-pendencia-auto-detectada-refresh.js <workflowId>');

const ANCHOR_QUERY = `INSERT INTO agent_actions (from_phone, action, domain, detail)
SELECT
  '{{ $('CREATE & SELECT cliente').first().json.telefone }}',
  '{{ $json.action }}',
  '{{ $json.domain }}',
  $1
WHERE NOT (
  $1 LIKE '%[Auto-detectado%'
  AND EXISTS (
    SELECT 1 FROM agent_actions
    WHERE from_phone = '{{ $('CREATE & SELECT cliente').first().json.telefone }}'
      AND resolved_at IS NULL
      AND detail LIKE '%[Auto-detectado%'
      AND created_at > now() - interval '30 minutes'
  )
);`;

const NEW_QUERY = `WITH atualiza_existente AS (
  UPDATE agent_actions
  SET detail = $1, created_at = now()
  WHERE $1 LIKE '%[Auto-detectado%'
    AND from_phone = '{{ $('CREATE & SELECT cliente').first().json.telefone }}'
    AND resolved_at IS NULL
    AND detail LIKE '%[Auto-detectado%'
    AND created_at > now() - interval '30 minutes'
  RETURNING id
)
INSERT INTO agent_actions (from_phone, action, domain, detail)
SELECT
  '{{ $('CREATE & SELECT cliente').first().json.telefone }}',
  '{{ $json.action }}',
  '{{ $json.domain }}',
  $1
WHERE NOT EXISTS (SELECT 1 FROM atualiza_existente);`;

async function main() {
  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, { headers: H })).json();
  if (!wf.nodes) throw new Error('GET falhou: ' + JSON.stringify(wf));
  if (wf.versionId !== wf.activeVersionId) throw new Error('draft != ativo -- roda realinha-draft.js antes');

  const node = wf.nodes.find((n) => n.name === 'Registrar Ação');
  if (!node) throw new Error('node "Registrar Ação" nao encontrado');

  if (node.parameters.query.includes('atualiza_existente')) {
    console.log('ja aplicado -- nada a fazer');
    return;
  }
  if (node.parameters.query.trim() !== ANCHOR_QUERY.trim()) {
    throw new Error('query atual diferente do esperado -- CONFERIR antes de aplicar (evita sobrescrever mudanca nao prevista)');
  }
  node.parameters.query = NEW_QUERY;

  if (!wf.nodes.some((n) => n.name === 'Sticky Fix Pendencia Refresh 31/08')) {
    wf.nodes.push({
      parameters: {
        content:
          '## 🔴 FIX 31/08: pendencia auto-detectada nao atualizava\nCaso Diovana: dedup suprimia a 2a deteccao mas nunca\natualizava o detail/created_at da 1a pendencia -- ficava\ncongelada citando a fala antiga. Agora faz UPDATE em vez\nde so pular (so afeta auto-detectadas).',
        height: 220,
        width: 430,
        color: 3,
      },
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [(node.position?.[0] ?? 0) - 40, (node.position?.[1] ?? 0) - 300],
      id: 'sticky-fix-pendencia-refresh-' + workflowId.slice(0, 8),
      name: 'Sticky Fix Pendencia Refresh 31/08',
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
  const live = (ab.activeVersion?.nodes || ab.nodes).find((n) => n.name === 'Registrar Ação');
  const okTexto = live.parameters.query.includes('atualiza_existente');
  console.log(`PUT ${put.status} | activate ${act.status} | draft==active=${ok} | texto ok=${okTexto}`);
  if (!ok || !okTexto) throw new Error('verificacao FALHOU -- conferir na UI');
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
