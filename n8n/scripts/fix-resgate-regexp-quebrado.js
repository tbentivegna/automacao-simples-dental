// HOTFIX 2026-08-28 -- o fix 2a (fix-resgate-consulta-futura.js) deixou a
// query do node "Busca Funil Parado" QUEBRADA em prod.
//
// O n8n mastigou o `$` do regex ao salvar: `'^55|@.*$', ''` virou
// `'^55|@.*, ''` (o `$'` sumiu, aspas quebraram). Toda execucao do
// `Lumi - Resgate de Funil` desde ~08:00 de 28/08 falha com
// "Syntax error ... near 'g'" -- nenhum resgate sai (Daniela, funil id 21,
// perdeu o resgate das 8h). Achado pelo monitor automatico.
//
// Causa raiz: NUNCA por um `$` cru num campo de query/param de node n8n --
// o resolver de expressao mexe nele mesmo fora de `{{ }}`.
//
// Fix: troca a normalizacao de telefone de
//   regexp_replace(f.telefone, '^55|@.*$', '', 'g')   (tem `$`)
// por
//   substring(split_part(f.telefone, '@', 1) from 3)  (sem `$`, sem regex)
// Ambos produzem "11999999999" a partir de "5511999999999@s.whatsapp.net".
//
// uso: node n8n/scripts/fix-resgate-regexp-quebrado.js
require('dotenv').config({ path: __dirname + '/../.env' });
const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };
const WF = 'vUGMz073giDPfGzx';

const NOVO_NORM = "substring(split_part(f.telefone, '@', 1) from 3)";

async function main() {
  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${WF}`, { headers: H })).json();
  if (!wf.nodes) throw new Error('GET falhou: ' + JSON.stringify(wf));
  const node = wf.nodes.find((n) => n.name === 'Busca Funil Parado');
  if (!node) throw new Error('node "Busca Funil Parado" nao encontrado');

  let q = node.parameters.query;
  const antes = q;

  // troca as duas ocorrencias da normalizacao quebrada (e da correta, se por
  // algum motivo ela ainda existir) pela versao sem `$`.
  q = q.split("regexp_replace(f.telefone, '^55|@.*, '', 'g')").join(NOVO_NORM);
  q = q.split("regexp_replace(f.telefone, '^55|@.*$', '', 'g')").join(NOVO_NORM);

  if (q === antes) {
    if (q.includes(NOVO_NORM)) { console.log('ja corrigido -- nada a fazer'); return; }
    throw new Error('nao encontrei o trecho quebrado nem o corrigido -- CONFERIR MANUALMENTE:\n' + q);
  }
  // sanidade: nao pode sobrar `$` cru nem regexp_replace da normalizacao
  if (/regexp_replace\(f\.telefone/.test(q)) throw new Error('ainda tem regexp_replace(f.telefone) na query apos o replace');
  if (q.includes("'^55|@.*")) throw new Error("ainda tem '^55|@.* na query");

  node.parameters.query = q;

  const put = await fetch(`${BASE_URL}/api/v1/workflows/${WF}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings }),
  });
  const pb = await put.json();
  if (!put.ok) throw new Error(`PUT falhou: ${put.status} ${JSON.stringify(pb)}`);
  const act = await fetch(`${BASE_URL}/api/v1/workflows/${WF}/activate`, { method: 'POST', headers: H });
  const ab = await act.json();
  const ok = ab.versionId === ab.activeVersionId;

  // VERIFICA O TEXTO EXATO que ficou salvo na versao ativa (a licao do bug:
  // checar `.includes('eventos_agenda')` nao pega corrupcao de `$`).
  const live = (ab.activeVersion?.nodes || ab.nodes).find((n) => n.name === 'Busca Funil Parado');
  const lq = live.parameters.query;
  const okTexto =
    (lq.match(/substring\(split_part\(f\.telefone, '@', 1\) from 3\)/g) || []).length === 2 &&
    !/regexp_replace\(f\.telefone/.test(lq) &&
    !lq.includes("'^55|@.*");
  console.log(`PUT ${put.status} | activate ${act.status} | active=${ab.active} | draft==active=${ok} | texto ok=${okTexto}`);
  if (!ok || !okTexto) {
    console.log('\n----- query salva na versao ativa -----\n' + lq);
    throw new Error('verificacao FALHOU -- conferir na UI');
  }
  console.log('\nOK. Query corrigida e publicada. Confirme a proxima execucao do cron (:00/:30).');
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
