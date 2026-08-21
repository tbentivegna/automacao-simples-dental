// Duas correcoes no fluxo "Lumi - Resgate de Funil":
//
// 1) BUG REAL: o node "Monta Mensagem Resgate" (Code) nao tinha o modo
//    "runOnceForEachItem" definido -- por padrao o n8n roda Code node uma
//    unica vez pra TODOS os itens juntos, entao se "Busca Funil Parado"
//    retornasse 3 pacientes parados na mesma execucao, so o PRIMEIRO
//    recebia o resgate; os outros 2 eram silenciosamente ignorados nessa
//    execucao (ficavam em_andamento, so seriam pegos numa execucao futura --
//    sem erro nenhum aparecer, dado real perdido/atrasado sem aviso).
//    Fix: define mode='runOnceForEachItem' -- o codigo em si ja retorna no
//    formato certo por item, nao precisa mudar.
//
// 2) Trava de fim de semana (sabado/domingo) -- mesma logica da trava de
//    horario comercial: fora da janela permitida, a query so nao retorna
//    nada nessa execucao, a tentativa continua em_andamento e e pega depois.
//
// 3) LIMIT de seguranca por execucao, pra nunca disparar uma rajada grande
//    de mensagens de uma vez so (ex: se algo upstream abrir varias
//    tentativas por engano).
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2] || 'vUGMz073giDPfGzx';
const LIMITE_POR_EXECUCAO = 20;

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  // --- 1) modo por item no Code node ---
  const codeNode = wf.nodes.find((n) => n.name === 'Monta Mensagem Resgate');
  if (!codeNode) throw new Error('node "Monta Mensagem Resgate" nao encontrado');
  let mudouCode = false;
  if (codeNode.parameters.mode !== 'runOnceForEachItem') {
    codeNode.parameters.mode = 'runOnceForEachItem';
    mudouCode = true;
  }

  // --- 2) fim de semana + 3) LIMIT ---
  const buscaNode = wf.nodes.find((n) => n.name === 'Busca Funil Parado');
  if (!buscaNode) throw new Error('node "Busca Funil Parado" nao encontrado');
  let mudouQuery = false;

  if (!buscaNode.parameters.query.includes('extract(dow')) {
    const marcador = 'AND NOT EXISTS (';
    if (!buscaNode.parameters.query.includes(marcador)) {
      throw new Error('query atual nao tem o formato esperado -- abortando (fim de semana)');
    }
    const condicaoFds =
      "  AND extract(dow from now() AT TIME ZONE 'America/Sao_Paulo') BETWEEN 1 AND 5\n  ";
    buscaNode.parameters.query = buscaNode.parameters.query.replace(marcador, condicaoFds + marcador);
    mudouQuery = true;
  }

  if (!/LIMIT \d+;?\s*$/.test(buscaNode.parameters.query.trim())) {
    buscaNode.parameters.query = buscaNode.parameters.query.replace(/;\s*$/, '') + `\nLIMIT ${LIMITE_POR_EXECUCAO};`;
    mudouQuery = true;
  }

  if (!mudouCode && !mudouQuery) {
    console.log('ja aplicado, pulando');
    return;
  }

  const payload = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings };
  const putRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    headers: { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await putRes.json();
  if (!putRes.ok) throw new Error(`PUT falhou: ${putRes.status} ${JSON.stringify(body)}`);
  console.log('Aplicado com sucesso em', workflowId, '| active=', body.active, '| mudouCode=', mudouCode, '| mudouQuery=', mudouQuery);
}

main().catch((err) => {
  console.error('ERRO:', err.message);
  process.exit(1);
});
