// BUG REAL, confirmado em produção 25/08/2026: quando 2+ pacientes ficam
// elegíveis pro resgate no MESMO ciclo de 30 min, o node "Marca Resgate
// Enviado" quebra com "Multiple matches found" (erro de paired-item do n8n)
// -- a expressão `$('Monta Mensagem Resgate').item.json.id` fica ambígua
// porque o node da Evolution API (community node) não implementa
// pairedItem corretamente ao repassar itens em lote.
//
// Efeito: a mensagem de resgate SAI normalmente (Envia Resgate funciona),
// mas a linha do funil nunca é marcada como resgate_enviado -- ela volta a
// ser "elegível" no próximo ciclo e repete pra sempre, a cada 30 min, pra
// TODOS os pacientes daquele lote. Caso real: Erika (id 10) e Thaynna
// (id 12) receberam a mesma mensagem de resgate duplicada às 16:30 e 17:00
// (execuções 2488 e 2490, ambas status=error) antes de o workflow ser
// desativado manualmente como contenção.
//
// Fix: trocar `.item` (resolução automática de paired-item, ambígua com
// múltiplos itens) por `.all()[$itemIndex]` (indexação explícita por
// posição -- não depende de pairedItem, funciona mesmo com nodes que não
// implementam esse rastreamento corretamente).
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node fix-marca-resgate-paired-item.js <workflowId>');

const DE = "$('Monta Mensagem Resgate').item.json.id";
const PARA = "$('Monta Mensagem Resgate').all()[$itemIndex].json.id";

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  const node = wf.nodes.find((n) => n.name === 'Marca Resgate Enviado');
  if (!node) throw new Error('node "Marca Resgate Enviado" não encontrado');

  if (!node.parameters.query.includes(DE)) {
    if (node.parameters.query.includes(PARA)) {
      console.log('Já aplicado -- nada a fazer em', workflowId);
      return;
    }
    throw new Error('Trecho esperado não encontrado -- query pode ter mudado desde que este script foi escrito.');
  }
  node.parameters.query = node.parameters.query.replace(DE, PARA);

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
