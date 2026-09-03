// Clona "Lumi" (PROD, K2xRqOwS0N0AcoqG) pra um novo workflow "Lumi -
// Standalone" -- ponto de partida pra explorar a variante do produto onde
// a clínica não tem NENHUM sistema de agenda hoje. Mesmo padrão de
// clonagem já usado pra criar "Lumi - DEV" (duplicate-lumi-dev.js) --
// webhook novo, resto idêntico.
//
// IMPORTANTE: os 6 nodes de ferramenta (Verifica Disponibilidade, Cria
// Agendamento, Busca Agendamentos Paciente, Confirmar/Cancelar/Remarcar
// Agendamento) continuam apontando pro MESMO bridge de hoje (server.js,
// Simples Dental) -- isso é proposital nesta primeira etapa (só criar o
// esqueleto). O passo seguinte é construir um serviço novo
// "standalone-bridge/" (mesmo contrato HTTP de 6 rotas que server.js/
// clinicorp-bridge já implementam, só que CRUD direto em public.consultas,
// sem sistema externo nenhum) e só então repontar esses 6 nodes pra lá.
//
// Criado INATIVO de propósito (mesmo padrão do resgate/DEV) -- não afeta
// pacientes reais até ser deliberadamente ativado.
//
// uso: node n8n/scripts/cria-workflow-standalone.js
require('dotenv').config({ path: __dirname + '/../.env' });
const crypto = require('crypto');

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/K2xRqOwS0N0AcoqG`, { headers: H });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const original = await getRes.json();

  const novoWebhookId = crypto.randomUUID();

  const nodes = original.nodes.map((n) => {
    if (n.type === 'n8n-nodes-base.webhook') {
      return { ...n, webhookId: novoWebhookId, parameters: { ...n.parameters, path: novoWebhookId } };
    }
    return n;
  });

  // Sticky documentando o propósito, pra quem abrir o canvas entender de
  // cara que isso é um ponto de partida, não uma cópia "de produção".
  nodes.push({
    parameters: {
      content:
        '## 🧪 Lumi - Standalone (rascunho, 03/09)\nClonado de PROD como ponto de partida pra explorar a\nvariante "clínica sem sistema nenhum" -- agenda vira\npublic.consultas direto (sem Simples Dental/Playwright).\n\nOs 6 nodes de ferramenta AINDA apontam pro bridge atual\n(server.js) -- só repontar depois que o serviço novo\n"standalone-bridge/" existir. Inativo de propósito.',
      height: 260,
      width: 460,
      color: 4,
    },
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [-40, -900],
    id: 'sticky-standalone-rascunho-' + Date.now().toString(36),
    name: 'Sticky Standalone Rascunho',
  });

  const payload = {
    name: 'Lumi - Standalone',
    nodes,
    connections: original.connections,
    settings: original.settings,
  };

  const postRes = await fetch(`${BASE_URL}/api/v1/workflows`, { method: 'POST', headers: H, body: JSON.stringify(payload) });
  const body = await postRes.json();
  if (!postRes.ok) throw new Error(`POST falhou: ${postRes.status} ${JSON.stringify(body)}`);

  console.log('Criado com sucesso!');
  console.log('ID:', body.id);
  console.log('Nome:', body.name);
  console.log('Ativo:', body.active);
  console.log('Novo webhook path:', novoWebhookId);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
