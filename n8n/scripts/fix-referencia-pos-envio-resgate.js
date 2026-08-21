// Bug real, encontrado num teste ao vivo com 3 pacientes reais (21/08): as
// 3 mensagens de resgate foram enviadas com sucesso e com o texto certo
// (confirmado no payload de resposta da Evolution API), mas os dois passos
// seguintes falharam -- "Grava Resgate no Histórico" gravou uma linha lixo
// (session_id = "undefined") e "Marca Resgate Enviado" caiu com erro SQL
// ("column undefined does not exist"), o que travou a marcação
// resgate_enviado_em pras 3 tentativas -- risco real de reenvio duplicado
// na proxima execucao (contornado manualmente marcando as 3 na mao).
//
// Causa raiz: nodes de API (Evolution API incluso) substituem o $json do
// item pela PROPRIA resposta da API, descartando os campos que vieram do
// node anterior (telefone, mensagemResgate, id). "Grava Resgate no
// Histórico" e "Marca Resgate Enviado" usavam $json.telefone/mensagemResgate
// /id, que so existiam ANTES do "Envia Resgate" rodar. Fix: apontar essas
// expressoes pro node de origem explicitamente
// ($('Monta Mensagem Resgate').item.json.X), que funciona não importa o que
// o node no meio faca com o proprio $json.
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2] || 'vUGMz073giDPfGzx';

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  const grava = wf.nodes.find((n) => n.name === 'Grava Resgate no Histórico');
  const marca = wf.nodes.find((n) => n.name === 'Marca Resgate Enviado');
  if (!grava || !marca) throw new Error('nos esperados nao encontrados');

  grava.parameters.query =
    "INSERT INTO public.n8n_chat_histories (session_id, message)\nVALUES ('{{ $('Monta Mensagem Resgate').item.json.telefone }}', $1::jsonb);";
  grava.parameters.options.queryReplacement =
    "={{ JSON.stringify({ type: 'ai', content: $('Monta Mensagem Resgate').item.json.mensagemResgate, tool_calls: [], additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [] }) }}";

  marca.parameters.query =
    "UPDATE public.funil_agendamento\nSET status = 'resgate_enviado', resgate_enviado_em = now()\nWHERE id = {{ $('Monta Mensagem Resgate').item.json.id }};";

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
