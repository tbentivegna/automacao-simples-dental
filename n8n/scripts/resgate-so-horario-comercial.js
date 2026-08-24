// Pedido do usuário 24/08: o funil de resgate não precisa ACIONAR (nem
// tentar) fora do horário comercial -- hoje o Schedule Trigger dispara a
// cada 30min o dia inteiro, e é só a query dentro de "Busca Funil Parado"
// que filtra pra 8h-18h BRT (fora da janela, a execução roda à toa e não
// acha nada). Troca o trigger de intervalo fixo pra expressão cron
// "*/30 8-17 * * 1-5" (a cada 30min, das 8h às 17h30, seg-sex) e fixa o
// timezone do workflow em America/Sao_Paulo -- assim o próprio disparo já
// não acontece fora da janela, em vez de disparar e não fazer nada.
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = 'vUGMz073giDPfGzx';

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  const trigger = wf.nodes.find((n) => n.type === 'n8n-nodes-base.scheduleTrigger');
  if (!trigger) throw new Error('Schedule Trigger nao encontrado');

  trigger.parameters = {
    rule: {
      interval: [
        {
          field: 'cronExpression',
          expression: '*/30 8-17 * * 1-5',
        },
      ],
    },
  };

  wf.settings = { ...(wf.settings || {}), timezone: 'America/Sao_Paulo' };

  const jaTemSticky = wf.nodes.some((n) => n.name === 'Sticky Horario Comercial');
  if (!jaTemSticky) {
    wf.nodes.push({
      parameters: {
        content:
          '## 🔴 FIX 24/08: só dispara em horário comercial\nTrigger trocado de "a cada 30min o dia todo" pra cron\n"*/30 8-17 * * 1-5" (seg-sex, 8h-17h30) + timezone do\nworkflow fixado em America/Sao_Paulo. Antes disparava 24/7 e\na query filtrava depois -- agora nem dispara fora da janela.',
        height: 200,
        width: 380,
        color: 3,
      },
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [trigger.position[0] - 60, trigger.position[1] - 260],
      id: 'sticky-horario-comercial-resgate',
      name: 'Sticky Horario Comercial',
    });
  }

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
