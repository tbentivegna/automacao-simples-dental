// A regra de prompt (PROMESSA DE RETORNO) sozinha nao segura: testado no
// harness (lumi-harness/check-promessa-retorno.js), a Lumi so gerou
// agent_action na MESMA mensagem em que prometeu retorno em 0 de varias
// execucoes -- o modelo prefere fazer a pergunta de esclarecimento e
// "esquece" o JSON. Mesmo padrao ja visto neste projeto: regra abstrata no
// prompt nao e confiavel sob pressao de contexto, precisa de rede de
// seguranca deterministica no codigo (ver incidente "[Equipe da clínica]"
// leak, mesma logica). Este patch adiciona: se a resposta final contiver
// linguagem de promessa de retorno ("vou verificar", "te retorno" etc.) e a
// IA nao tiver gerado agent_action nenhum, gera uma pendencia generica
// automaticamente (OUTROS/Geral) -- nunca deixa a promessa sem rastro.
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node add-fallback-promessa-retorno.js <workflowId>');

const NOVO_CODIGO = `const text = ($json.output ?? "").replace(/^\\s*\\[Equipe da cl\\u00ednica\\]:\\s*/i, "");

const start = text.indexOf("{");
const end = text.lastIndexOf("}");

const instance = $('Edit Fields').first().json.Instance;
const from = $('Edit Fields').first().json.From;

// Rede de seguranca: mesmo quando o modelo esquece de gerar o bloco
// agent_action, se a mensagem promete verificar algo com a Dra. Aline/equipe
// e retornar depois, gera uma pendencia generica automaticamente -- nunca
// deixa uma promessa sem rastro (ver PROMESSA DE RETORNO no prompt).
const REGEX_PROMESSA_RETORNO = /vou verificar|vou repassar|vou encaminhar|te retorno|lhe retorno|assim que (eu )?tiver (uma )?resposta|assim que a dra\\.? aline (responder|retornar)|vou confirmar (isso |isto )?com a (dra\\.?|equipe)/i;

function comFallback(mensagemLimpa) {
  if (!REGEX_PROMESSA_RETORNO.test(mensagemLimpa)) {
    return { hasAction: false, message: mensagemLimpa, Instance: instance, From: from };
  }
  return {
    hasAction: true,
    message: mensagemLimpa,
    action: "OUTROS",
    domain: "Geral",
    detail: "[Auto-detectado, sem agent_action da IA] " + mensagemLimpa.slice(0, 500),
    Instance: instance,
    From: from,
  };
}

if (start === -1 || end === -1 || end <= start) {
  return comFallback(text);
}

const possibleJson = text.substring(start, end + 1);

let parsed;

try {
  parsed = JSON.parse(possibleJson);
} catch (err) {
  return comFallback(text);
}

if (!parsed.agent_action) {
  return comFallback(text.replace(possibleJson, "").trim());
}

return {
  hasAction: true,
  message: text.replace(possibleJson, "").trim(),
  action: parsed.agent_action.action,
  domain: parsed.agent_action.domain,
  detail: parsed.agent_action.detail,
  Instance: instance,
  From: from
};`;

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  const extraiJson = wf.nodes.find((n) => n.name === 'Extrai JSON');
  if (!extraiJson) throw new Error('node "Extrai JSON" nao encontrado');

  if (extraiJson.parameters.jsCode.includes('REGEX_PROMESSA_RETORNO')) {
    console.log('ja aplicado, pulando');
    return;
  }
  if (!extraiJson.parameters.jsCode.includes('parsed.agent_action')) {
    throw new Error('conteudo atual de "Extrai JSON" nao e o esperado -- prompt/codigo pode ja ter mudado, abortando');
  }

  extraiJson.parameters.jsCode = NOVO_CODIGO;

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
