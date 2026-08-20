require('dotenv').config({ path: __dirname + '/../.env' });
const crypto = require('crypto');

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/K2xRqOwS0N0AcoqG`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const original = await getRes.json();

  const novoWebhookId = crypto.randomUUID();

  const nodes = original.nodes.map((n) => {
    if (n.type === 'n8n-nodes-base.webhook') {
      return {
        ...n,
        webhookId: novoWebhookId,
        parameters: { ...n.parameters, path: novoWebhookId },
      };
    }
    return n;
  });

  const payload = {
    name: 'Lumi - DEV',
    nodes,
    connections: original.connections,
    settings: original.settings,
  };

  const postRes = await fetch(`${BASE_URL}/api/v1/workflows`, {
    method: 'POST',
    headers: {
      'X-N8N-API-KEY': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const body = await postRes.json();
  if (!postRes.ok) throw new Error(`POST falhou: ${postRes.status} ${JSON.stringify(body)}`);

  console.log('Criado com sucesso!');
  console.log('ID:', body.id);
  console.log('Nome:', body.name);
  console.log('Ativo:', body.active);
  console.log('Novo webhook path:', novoWebhookId);
  console.log('Novo webhook URL (producao apos ativar):', `${BASE_URL}/webhook/${novoWebhookId}`);
  console.log('Novo webhook URL (teste, workflow inativo):', `${BASE_URL}/webhook-test/${novoWebhookId}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
