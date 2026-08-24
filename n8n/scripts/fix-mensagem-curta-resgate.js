// Achado ao abrir manualmente o registro da Ana Rosito (24/08): a última
// mensagem humana dela era só "Limpeza" (resposta curta a uma pergunta da
// Lumi), não a pergunta de verdade ("Gostaria de marcar um horário"). Citar
// isso de volta no resgate ("Vi que você tinha perguntado: 'Limpeza'...")
// soaria estranho, fora de contexto. Corrige "Busca Funil Parado" pra pegar
// a mensagem humana mais recente com mais de 15 caracteres, pulando
// respostas curtas tipo "sim"/"ok"/"limpeza" e indo pra pergunta anterior
// que carrega contexto de verdade.
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2] || 'vUGMz073giDPfGzx';

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  const busca = wf.nodes.find((n) => n.name === 'Busca Funil Parado');
  if (!busca) throw new Error('node esperado nao encontrado');

  busca.parameters.query = busca.parameters.query.replace(
    `(SELECT h.message->>'content' FROM public.n8n_chat_histories h
   WHERE h.session_id = f.telefone AND h.message->>'type' = 'human'
   ORDER BY h.created_at DESC LIMIT 1) AS ultima_mensagem_paciente`,
    `(SELECT h.message->>'content' FROM public.n8n_chat_histories h
   WHERE h.session_id = f.telefone AND h.message->>'type' = 'human'
     AND char_length(h.message->>'content') > 15
   ORDER BY h.created_at DESC LIMIT 1) AS ultima_mensagem_paciente`
  );

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
