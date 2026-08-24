// Segunda parte da etapa "interesse" (ver add-funil-etapa-interesse.js):
// o workflow de resgate precisa saber diferenciar as duas etapas e mandar
// uma mensagem apropriada pra cada uma -- a de "horario_oferecido"
// (existente) fica igual; a nova "interesse" cita a própria pergunta do
// paciente pra soar pessoal, já que não tem um horário específico pra
// retomar. Só existe workflow de resgate em produção (sem gêmeo DEV), então
// testado por dry-run direto no banco (query) e localmente (lógica do
// código) antes de aplicar aqui.
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
  const monta = wf.nodes.find((n) => n.name === 'Monta Mensagem Resgate');
  if (!busca || !monta) throw new Error('nos esperados nao encontrados');

  busca.parameters.query = `SELECT
  f.id,
  f.telefone,
  f.instancia,
  f.etapa,
  coalesce(c.nome, c.apelido_whatsapp) AS nome,
  (SELECT h.message->>'content' FROM public.n8n_chat_histories h
   WHERE h.session_id = f.telefone AND h.message->>'type' = 'human'
   ORDER BY h.created_at DESC LIMIT 1) AS ultima_mensagem_paciente
FROM public.funil_agendamento f
LEFT JOIN public.cliente c ON c.telefone = f.telefone
WHERE f.status = 'em_andamento'
  AND f.resgate_enviado_em IS NULL
  AND f.ultima_interacao_em < now() - interval '4 hours'
    AND extract(hour from now() AT TIME ZONE 'America/Sao_Paulo') >= 8
  AND extract(hour from now() AT TIME ZONE 'America/Sao_Paulo') < 18
    AND extract(dow from now() AT TIME ZONE 'America/Sao_Paulo') BETWEEN 1 AND 5
  AND NOT EXISTS (
    SELECT 1 FROM public.n8n_chat_histories h
    WHERE h.session_id = f.telefone
      AND h.message->>'type' = 'human'
      AND h.created_at > f.ultima_interacao_em
  )
LIMIT 20;`;

  monta.parameters.jsCode = `const nome = $json.nome;
const saudacao = nome ? \`Oi, \${nome}!\` : 'Oi!';

let mensagem;
if ($json.etapa === 'interesse') {
  const trecho = ($json.ultima_mensagem_paciente || '').slice(0, 140).trim();
  mensagem = trecho
    ? \`\${saudacao} 🤎 Vi que você tinha perguntado: "\${trecho}" -- ainda tem interesse? Fico à disposição pra te ajudar! 😊\`
    : \`\${saudacao} 🤎 Vi que você tinha entrado em contato e a conversa parou por aqui -- ainda tem interesse em saber mais? Fico à disposição! 😊\`;
} else {
  mensagem = \`\${saudacao} 🤎 Vi que ficamos de combinar um horário pra sua consulta com a Dra. Aline e a conversa parou por aqui. Ainda tem interesse? Responde um "sim" que eu já retomo com os horários 😊\`;
}

return { ...$json, mensagemResgate: mensagem };`;

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
