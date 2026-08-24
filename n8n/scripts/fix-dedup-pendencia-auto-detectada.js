// Bug real, achado no vivo (24/08, paciente Thaynna com dor de dente): a
// rede de seguranca "PROMESSA DE RETORNO" (node Extrai JSON) cria uma
// pendencia toda vez que a resposta da Lumi bate no regex (ex: "vou
// encaminhar pra equipe"), sem checar se ja existe uma pendencia parecida
// em aberto. Numa conversa confusa em loop, isso gerou 5 pendencias quase
// identicas em 3 minutos (ids 100-104) pro mesmo paciente -- ruido que
// esconde o sinal real (paciente com dor precisando de atencao).
//
// Fix: "Registrar Ação" (onde a pendencia de fato e gravada) passa a
// pular a insercao se JA existir uma pendencia em aberto, do mesmo
// paciente, tambem auto-detectada (prefixo "[Auto-detectado"), criada nos
// ultimos 30 minutos. So afeta as auto-detectadas -- um agent_action de
// verdade que a propria IA decidiu gerar continua sempre sendo gravado,
// mesmo que dispare varias vezes (isso e informacao legitima, nao ruido
// de regex repetindo).
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node fix-dedup-pendencia-auto-detectada.js <workflowId>');

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  const registrarAcao = wf.nodes.find((n) => n.name === 'Registrar Ação');
  if (!registrarAcao) throw new Error('node esperado nao encontrado');

  if (registrarAcao.parameters.query.includes('Auto-detectado')) {
    console.log('Ja aplicado -- nada a fazer em', workflowId);
    return;
  }

  registrarAcao.parameters.query = `INSERT INTO agent_actions (from_phone, action, domain, detail)
SELECT
  '{{ $('CREATE & SELECT cliente').first().json.telefone }}',
  '{{ $json.action }}',
  '{{ $json.domain }}',
  $1
WHERE NOT (
  $1 LIKE '[Auto-detectado%'
  AND EXISTS (
    SELECT 1 FROM agent_actions
    WHERE from_phone = '{{ $('CREATE & SELECT cliente').first().json.telefone }}'
      AND resolved_at IS NULL
      AND detail LIKE '[Auto-detectado%'
      AND created_at > now() - interval '30 minutes'
  )
);`;

  const payload = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings };
  const putRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    headers: { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await putRes.json();
  if (!putRes.ok) throw new Error(`PUT falhou: ${putRes.status} ${JSON.stringify(body)}`);
  console.log('Aplicado com sucesso em', workflowId, '| active=', body.active);
}

main().catch((err) => {
  console.error('ERRO:', err.message);
  process.exit(1);
});
