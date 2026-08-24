// Bug real, achado no teste ao vivo do Tiago (24/08): quando o debounce
// detecta mensagem pendente e reprocessa DENTRO da mesma execução (o
// self-loop "Debounce - Verifica Pendentes" -> "Tem Mensagem Pendente?" ->
// volta pra "Debounce - Juntar Mensagens"), a segunda resposta é gerada
// certinho pela IA, mas o node "Loop Blocos" (Split In Batches / Loop Over
// Items) simplesmente não envia nenhum bloco na segunda passada -- 0 de 3
// blocos chegaram no WhatsApp, sem erro nenhum no log. A primeira resposta
// (2 blocos) enviou normalmente.
//
// Causa: "Split In Batches" é conhecido por manter estado interno (índice
// do batch atual) por NODE dentro de uma execução -- ele não foi feito pra
// ser re-alimentado do zero uma segunda vez na mesma execução. Quando o
// fluxo externo reentra em "Divide Mensagem em Blocos" -> "Loop Blocos" de
// novo (2ª resposta), o node acha que já terminou o loop anterior e não
// processa os novos itens.
//
// Fix: remove o "Loop Blocos" -- não precisa dele. "Divide Mensagem em
// Blocos" já entrega os blocos como itens separados, e nodes normais do
// n8n (incluindo os da Evolution API aqui) já processam múltiplos itens
// SEQUENCIALMENTE por padrão, sem precisar de um node de loop dedicado.
// Reconecta "Divide Mensagem em Blocos" -> "Presença Bloco" diretamente, e
// atualiza as expressões de "Presença Bloco"/"Envia Bloco" que liam
// $('Loop Blocos').item.json.X pra lerem $('Divide Mensagem em
// Blocos').item.json.X. Sem node de loop com estado, não tem como esse bug
// de reuso acontecer de novo.
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node fix-loop-blocos-reuso.js <workflowId>');

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  const loopBlocos = wf.nodes.find((n) => n.name === 'Loop Blocos');
  const presencaBloco = wf.nodes.find((n) => n.name === 'Presença Bloco');
  const enviaBloco = wf.nodes.find((n) => n.name === 'Envia Bloco');
  if (!loopBlocos || !presencaBloco || !enviaBloco) throw new Error('nos esperados nao encontrados');

  const trocaReferencia = (obj) => {
    const str = JSON.stringify(obj).replaceAll("$('Loop Blocos')", "$('Divide Mensagem em Blocos')");
    return JSON.parse(str);
  };
  presencaBloco.parameters = trocaReferencia(presencaBloco.parameters);
  enviaBloco.parameters = trocaReferencia(enviaBloco.parameters);

  // Remove o node de loop e reconecta em volta dele.
  wf.nodes = wf.nodes.filter((n) => n.name !== 'Loop Blocos');
  wf.connections['Divide Mensagem em Blocos'] = {
    main: [[{ node: 'Presença Bloco', type: 'main', index: 0 }]],
  };
  delete wf.connections['Loop Blocos'];
  // "Envia Bloco" apontava de volta pro loop -- agora não aponta pra nada,
  // igual a saída "done" do Loop Blocos que já não ia pra lugar nenhum.
  wf.connections['Envia Bloco'] = { main: [[]] };

  const jaTemSticky = wf.nodes.some((n) => n.name === 'Sticky Fix Loop Blocos');
  if (!jaTemSticky) {
    wf.nodes.push({
      parameters: {
        content:
          '## 🔴 FIX 24/08: remove Loop Blocos (Split In Batches)\nEsse node tem estado por execução e quebra quando o fluxo re-entra\naqui uma 2ª vez na mesma execução (self-loop de mensagem pendente) --\n0 blocos eram enviados na 2ª resposta, sem erro. "Divide Mensagem em\nBlocos" já entrega os itens separados; "Presença Bloco"/"Envia Bloco"\nprocessam sequencialmente sem precisar de loop dedicado.',
        height: 220,
        width: 420,
        color: 3,
      },
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [presencaBloco.position[0] - 60, presencaBloco.position[1] - 260],
      id: 'sticky-fix-loop-blocos-' + workflowId.slice(0, 8),
      name: 'Sticky Fix Loop Blocos',
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
