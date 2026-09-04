// "Lumi - Standalone" (9PsUjET74L2NblWv) hoje divide o MESMO webhook que
// "Lumi - DEV" (yFSw0JMMD93EGZMa) -- aplicado por
// reponta-standalone-webhook-dev.js -- o que significa que só um dos dois
// pode ficar ATIVO por vez (achado real: gerou vaivém o dia inteiro pra
// testar o demo enquanto o DEV também precisava ficar de pé).
//
// Este script é o inverso: gera um webhookId novo (UUID aleatório, mesma
// técnica de cria-workflow-standalone.js) e aplica SÓ no Standalone --
// depois disso os dois workflows podem ficar ativos ao mesmo tempo, sem
// brigar por path.
//
// Não mexe no DEV. Não ativa o Standalone no final -- o webhook novo só
// funciona depois que uma instância do Evolution API for configurada
// apontando pra ele (passo manual, ver instrução impressa no final).
//
// uso: node n8n/scripts/dedica-webhook-standalone.js
require('dotenv').config({ path: __dirname + '/../.env' });
const crypto = require('crypto');
const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };

const WORKFLOW_STANDALONE = '9PsUjET74L2NblWv';

async function main() {
  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${WORKFLOW_STANDALONE}`, { headers: H })).json();
  if (!wf.nodes) throw new Error('GET falhou: ' + JSON.stringify(wf));
  if (wf.active) throw new Error('SEGURANÇA: Lumi - Standalone está ATIVO -- desative antes de trocar o webhook.');

  const webhook = wf.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  if (!webhook) throw new Error('node Webhook não encontrado');

  const pathNovo = crypto.randomUUID();

  if (!wf.nodes.some((n) => n.name === 'Sticky Webhook Dedicado Demo 04/09')) {
    wf.nodes.push({
      parameters: {
        content:
          '## 🔴 04/09: webhook próprio, não divide mais com o DEV\nAntes usava o mesmo path do "Lumi - DEV" (só um dos dois\npodia ficar ativo por vez). Agora tem webhook dedicado --\nprecisa de uma instância nova no Evolution API apontando\npra ele (ver n8n/scripts/dedica-webhook-standalone.js).',
        height: 240,
        width: 460,
        color: 3,
      },
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [(webhook.position?.[0] ?? 0) - 40, (webhook.position?.[1] ?? 0) - 300],
      id: 'sticky-webhook-dedicado-demo-' + WORKFLOW_STANDALONE.slice(0, 8),
      name: 'Sticky Webhook Dedicado Demo 04/09',
    });
  }

  webhook.parameters.path = pathNovo;
  webhook.webhookId = pathNovo;

  const put = await fetch(`${BASE_URL}/api/v1/workflows/${WORKFLOW_STANDALONE}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings }),
  });
  const pb = await put.json();
  if (!put.ok) throw new Error(`PUT falhou: ${put.status} ${JSON.stringify(pb)}`);

  await new Promise((r) => setTimeout(r, 1500));
  const verificacao = await (await fetch(`${BASE_URL}/api/v1/workflows/${WORKFLOW_STANDALONE}`, { headers: H })).json();
  const webhookVerif = verificacao.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  const ok = webhookVerif.webhookId === pathNovo;

  console.log(`PUT ${put.status} | webhook novo aplicado=${ok}`);
  console.log('');
  console.log('Path novo:', pathNovo);
  console.log('URL completa do webhook:', `${BASE_URL}/webhook/${pathNovo}`);
  console.log('');
  console.log('Próximo passo (manual, no painel do Evolution API):');
  console.log('1. Criar uma instância nova (ex: "Demo").');
  console.log('2. Conectar um número de WhatsApp de teste (escanear QR).');
  console.log('3. Configurar o webhook dessa instância apontando pra URL acima.');
  console.log('4. Ativar "Lumi - Standalone" no n8n quando tudo isso estiver pronto.');
  if (!ok) throw new Error('verificação FALHOU -- conferir na UI');
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
