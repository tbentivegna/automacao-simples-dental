// Ativa/desativa o workflow "Lumi - Resgate de Funil" (vUGMz073giDPfGzx).
// uso: node n8n/scripts/resgate-ativar.js on|off
require('dotenv').config({ path: __dirname + '/../.env' });
const B = process.env.N8N_BASE_URL;
const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Content-Type': 'application/json' };
const WF = 'vUGMz073giDPfGzx';
const acao = process.argv[2];
if (!['on', 'off'].includes(acao)) throw new Error('uso: node resgate-ativar.js on|off');
(async () => {
  const ep = acao === 'on' ? 'activate' : 'deactivate';
  const r = await fetch(`${B}/api/v1/workflows/${WF}/${ep}`, { method: 'POST', headers: H });
  const b = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(b)}`);
  console.log(`Lumi - Resgate de Funil -> ${ep} | active=${b.active}`);
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
