// Bug real reportado pela checagem de saude automatica 26/08: "Busca Funil
// Parado" excluia um paciente do resgate se ele tivesse mandado QUALQUER
// mensagem depois de ultima_interacao_em -- mas ultima_interacao_em so e
// atualizada em /verificar-disponibilidade (abrirOuAtualizarFunil em
// server.js), entao um paciente que manda UMA mensagem de follow-up (ex:
// "vou conversar e te aviso") fica IMUNE a resgate pra sempre, mesmo
// ficando dias em silencio de verdade depois disso.
//
// Caso real confirmado (Erika, 5511993630182): ultima_interacao_em em
// 24/08 11:18, ultima mensagem dela em 24/08 11:22 ("Tá bom / Obrigada"),
// 28.8h de silencio real no momento do achado -- nunca teria sido
// resgatada.
//
// Fix: a checagem de "paciente respondeu recentemente" precisa comparar
// contra AGORA (ultimas 4h reais), nao contra o timestamp fixo e raramente
// atualizado de ultima_interacao_em. Testado com SELECT direto contra
// producao antes de aplicar: query original retornava 0 candidatos nesse
// momento; query corrigida retornou 3 (Renan, Erika, Thaynna), todos com
// silencio real de mais de 4h.
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node fix-resgate-checagem-silencio-real.js <workflowId>');

const DE = `AND NOT EXISTS (
    SELECT 1 FROM public.n8n_chat_histories h
    WHERE h.session_id = f.telefone
      AND h.message->>'type' = 'human'
      AND h.created_at > f.ultima_interacao_em
  )`;

const PARA = `AND NOT EXISTS (
    SELECT 1 FROM public.n8n_chat_histories h
    WHERE h.session_id = f.telefone
      AND h.message->>'type' = 'human'
      AND h.created_at > now() - interval '4 hours'
  )`;

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  const node = wf.nodes.find((n) => n.name === 'Busca Funil Parado');
  if (!node) throw new Error('node "Busca Funil Parado" não encontrado');

  if (!node.parameters.query.includes(DE)) {
    if (node.parameters.query.includes(PARA)) {
      console.log('Já aplicado -- nada a fazer em', workflowId);
      return;
    }
    throw new Error('Trecho esperado não encontrado -- query pode ter mudado desde que este script foi escrito.');
  }
  node.parameters.query = node.parameters.query.replace(DE, PARA);

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
