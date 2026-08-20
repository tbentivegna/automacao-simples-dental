// Reconstroi telefone -> pushName a partir das execucoes de hoje do n8n
// (fonte: o payload bruto do webhook, que ja tinha isso antes da gente
// comecar a guardar em cliente.apelido_whatsapp).
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2] || 'K2xRqOwS0N0AcoqG';
const dataFiltro = process.argv[3] || new Date().toISOString().slice(0, 10);

async function main() {
  const listRes = await fetch(`${BASE_URL}/api/v1/executions?workflowId=${workflowId}&limit=250`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  const listBody = await listRes.json();
  const execs = (listBody.data || listBody).filter((e) => e.startedAt.startsWith(dataFiltro));
  console.error(`${execs.length} execucoes de ${dataFiltro} pra checar...`);

  const mapa = new Map(); // telefone -> { pushName, vezes, ultimaVez }

  for (const exec of execs) {
    const res = await fetch(`${BASE_URL}/api/v1/executions/${exec.id}?includeData=true`, {
      headers: { 'X-N8N-API-KEY': API_KEY },
    });
    if (!res.ok) continue;
    const data = await res.json();
    const rd = data.data && data.data.resultData && data.data.resultData.runData;
    const wh = rd && rd['Webhook'];
    if (!wh) continue;
    const body = wh[0].data.main[0][0].json.body;
    const d = body && body.data;
    if (!d) continue;

    const fromMe = d.key && d.key.fromMe;
    const texto = (d.message && (d.message.conversation || (d.message.extendedTextMessage || {}).text)) || '';
    if (fromMe) continue; // so nos interessa quem mandou mensagem pra Lumi
    if (texto.includes('[Lumi]')) continue; // eco, nao e gente de verdade

    const telefone = d.key.remoteJid;
    const pushName = d.pushName;
    if (!telefone || !pushName) continue;

    const atual = mapa.get(telefone);
    if (!atual || exec.startedAt > atual.ultimaVez) {
      mapa.set(telefone, { pushName, ultimaVez: exec.startedAt, vezes: (atual ? atual.vezes : 0) + 1 });
    } else {
      atual.vezes += 1;
    }
  }

  console.error(`\n${mapa.size} numeros distintos encontrados.\n`);
  const lista = [...mapa.entries()].map(([telefone, info]) => ({ telefone, ...info }));
  console.log(JSON.stringify(lista, null, 2));
}

main().catch((err) => { console.error('ERRO:', err.message); process.exit(1); });
