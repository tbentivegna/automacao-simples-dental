// Achado 2 da análise semanal de lições aprendidas (02/09, casos Morgana e
// Marisa): quando a Dra. Aline/equipe manda uma mensagem pelo WhatsApp do
// consultório pra alguém que NUNCA foi paciente (colega dentista pedindo
// conselho, outra pessoa no mesmo número de família, etc.), a Lumi
// respondeu/se apresentou como se fosse a primeira mensagem de uma
// paciente nova -- a equipe teve que se desculpar duas vezes na mesma
// semana.
//
// Causa raiz encontrada (não a hipótese original da análise -- mais
// precisa): o node "Desativar IA" faz
//   UPDATE public.cliente SET bot_disabled = true, ... WHERE telefone = '<jid>'
// Se não existe linha em public.cliente pra esse telefone (porque nunca
// foi paciente), o UPDATE afeta 0 linhas, silenciosamente -- bot_disabled
// nunca vira true, e a próxima mensagem de volta é processada normal pela
// IA. Não precisa de heurística nenhuma pra distinguir "colega" de
// "paciente de resgate" (a ideia original aprovada pelo usuário) -- basta
// o UPDATE sempre ter uma linha pra afetar. Pacientes de resgate JÁ têm
// linha em cliente (vieram de um agendamento/funil anterior), então esse
// fix não muda nada pro caminho do resgate -- só fecha o buraco de
// telefone nunca visto antes.
//
// uso: node n8n/scripts/fix-desativar-ia-cliente-inexistente.js <workflowId>
//   DEV  = yFSw0JMMD93EGZMa
//   PROD = K2xRqOwS0N0AcoqG
require('dotenv').config({ path: __dirname + '/../.env' });
const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node fix-desativar-ia-cliente-inexistente.js <workflowId>');

const QUERY_ANTIGA = `UPDATE public.cliente
SET bot_disabled = true,
    human_assigned = true,
    last_handoff = now()
WHERE telefone = '{{ $('Webhook').first().json.body.data.key.remoteJid }}';
`;

const QUERY_NOVA = `INSERT INTO public.cliente (telefone, bot_disabled, human_assigned, last_handoff, created_at)
VALUES ('{{ $('Webhook').first().json.body.data.key.remoteJid }}', true, true, now(), now())
ON CONFLICT (telefone) DO UPDATE SET
  bot_disabled = true,
  human_assigned = true,
  last_handoff = now();
`;

async function main() {
  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, { headers: H })).json();
  if (!wf.nodes) throw new Error('GET falhou: ' + JSON.stringify(wf));
  if (wf.versionId !== wf.activeVersionId) throw new Error('draft != ativo -- roda realinha-draft.js antes');

  const node = wf.nodes.find((n) => n.name === 'Desativar IA');
  if (!node) throw new Error('node "Desativar IA" nao encontrado');

  if (node.parameters.query.includes('ON CONFLICT (telefone)')) {
    console.log('ja aplicado -- nada a fazer');
    return;
  }
  if (node.parameters.query.trim() !== QUERY_ANTIGA.trim()) {
    throw new Error('query atual diferente do esperado -- CONFERIR antes de aplicar');
  }
  node.parameters.query = QUERY_NOVA;

  if (!wf.nodes.some((n) => n.name === 'Sticky Fix Desativar IA Cliente Novo 02/09')) {
    wf.nodes.push({
      parameters: {
        content:
          '## 🔴 FIX 02/09: Desativar IA não pausava telefone novo\nCasos Morgana/Marisa: equipe falou com alguém que\nnunca foi paciente -- UPDATE afetava 0 linhas (não\nexistia cliente), bot nunca pausava. Agora faz\nINSERT...ON CONFLICT, sempre garante a linha.',
          height: 220,
          width: 430,
        color: 3,
      },
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [(node.position?.[0] ?? 0) - 40, (node.position?.[1] ?? 0) - 300],
      id: 'sticky-fix-desativar-ia-' + workflowId.slice(0, 8),
      name: 'Sticky Fix Desativar IA Cliente Novo 02/09',
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
  const live = (ab.activeVersion?.nodes || ab.nodes).find((n) => n.name === 'Desativar IA');
  const okTexto = live.parameters.query.includes('ON CONFLICT (telefone)');
  console.log(`PUT ${put.status} | activate ${act.status} | draft==active=${ok} | texto ok=${okTexto}`);
  if (!ok || !okTexto) throw new Error('verificacao FALHOU -- conferir na UI');
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
