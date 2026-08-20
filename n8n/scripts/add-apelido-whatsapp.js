// Captura o pushName (nome de perfil do WhatsApp) e guarda em
// cliente.apelido_whatsapp -- fallback de exibicao no painel quando o nome
// oficial ainda nao foi confirmado pela Lumi.
require('dotenv').config({ path: __dirname + '/../.env' });
const crypto = require('crypto');

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node add-apelido-whatsapp.js <workflowId>');

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  if (wf.nodes.find((n) => n.name === 'Atualiza Apelido WhatsApp')) {
    console.log('ja aplicado, pulando');
    return;
  }

  const restaurarCampos = wf.nodes.find((n) => n.name === 'Restaurar Campos');
  const criaCliente = wf.nodes.find((n) => n.name === 'Cria Cliente');
  if (!restaurarCampos || !criaCliente) throw new Error('nos esperados nao encontrados');

  // 1) novo node: atualiza o apelido em toda mensagem, pra qualquer paciente
  // que ja exista (roda antes de qualquer ramificacao, entao cobre todos os
  // caminhos -- admin, pausado, handoff, IA)
  const idNode = crypto.randomUUID();
  const nodeAtualiza = {
    parameters: {
      operation: 'executeQuery',
      query:
        "UPDATE public.cliente\nSET apelido_whatsapp = $1\nWHERE telefone = '{{ $('Restaurar Campos').first().json.From }}'\n  AND (apelido_whatsapp IS DISTINCT FROM $1);",
      options: { queryReplacement: "={{ $('Webhook').first().json.body.data.pushName }}" },
    },
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.6,
    position: [restaurarCampos.position[0] + 160, restaurarCampos.position[1] + 160],
    id: idNode,
    name: 'Atualiza Apelido WhatsApp',
    credentials: { postgres: { id: 'IM7As7mjQcGJIzzy', name: 'Postgres account' } },
  };
  wf.nodes.push(nodeAtualiza);

  // rewire: Restaurar Campos -> Atualiza Apelido WhatsApp -> (o que ja ia depois)
  const oldTargets = wf.connections['Restaurar Campos'].main[0];
  wf.connections['Restaurar Campos'] = { main: [[{ node: 'Atualiza Apelido WhatsApp', type: 'main', index: 0 }]] };
  wf.connections['Atualiza Apelido WhatsApp'] = { main: [oldTargets] };

  // 2) Cria Cliente passa a gravar o apelido tambem pra paciente novo
  criaCliente.parameters.query =
    "INSERT INTO public.cliente (telefone, apelido_whatsapp, created_at)\nVALUES ('{{ $('Restaurar Campos').first().json.From }}', $1, now())\nON CONFLICT (telefone) DO NOTHING;";
  criaCliente.parameters.options = {
    ...(criaCliente.parameters.options || {}),
    queryReplacement: "={{ $('Webhook').first().json.body.data.pushName }}",
  };

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

main().catch((err) => { console.error('ERRO:', err.message); process.exit(1); });
