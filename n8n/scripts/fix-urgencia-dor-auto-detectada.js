// Achado real (24/08, Thaynna com dor de dente): quando a rede de
// seguranca "PROMESSA DE RETORNO" cria uma pendencia automatica, ela
// sempre usa action=OUTROS/domain=Geral sem nenhuma noção de gravidade --
// mesmo quando a mensagem é claramente sobre dor/urgência (a Lumi tentou
// seguir a seção URGÊNCIAS do prompt, perguntou a triagem, mas a paciente
// não respondeu com clareza, então o JSON de agent_action com
// "URGÊNCIA/DOR:" nunca foi gerado -- só a rede de segurança genérica
// pegou). Resultado: uma pendência de dor real apareceu como "Pendência"
// comum, não como "Urgência" no painel.
//
// Fix: a rede de segurança agora detecta sinais de dor/urgência na própria
// mensagem (dor, sangramento, inchaço, trauma, ou a frase "priorizar
// [o/seu] atendimento/caso" -- exatamente o que o prompt instrui a Lumi a
// dizer na seção URGÊNCIAS) e, se achar, prefixa o detail com
// "URGÊNCIA/DOR: " -- mesmo prefixo que buscarPendencias() usa pra marcar
// como urgente no painel.
//
// Ajusta tambem o guard de duplicata em "Registrar Ação" (deduplicacao
// adicionada mais cedo hoje) pra continuar reconhecendo essas entradas
// como "auto-detectadas" mesmo com o novo prefixo na frente.
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node fix-urgencia-dor-auto-detectada.js <workflowId>');

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  const extraiJson = wf.nodes.find((n) => n.name === 'Extrai JSON');
  const registrarAcao = wf.nodes.find((n) => n.name === 'Registrar Ação');
  if (!extraiJson || !registrarAcao) throw new Error('nos esperados nao encontrados');

  if (!extraiJson.parameters.jsCode.includes('REGEX_URGENCIA_DOR')) {
    const antigo = `  return {
    hasAction: true,
    message: mensagemLimpa,
    action: "OUTROS",
    domain: "Geral",
    detail: "[Auto-detectado, sem agent_action da IA] " + mensagemLimpa.slice(0, 500),
    Instance: instance,
    From: from,
  };
}`;
    const novo = `  const REGEX_URGENCIA_DOR = /\\bdor\\b|dor de dente|urg[êe]ncia|sangrament|inchaç|trauma|prioriz\\w* (o |seu )?(atendimento|caso)/i;
  const ehUrgenciaDor = REGEX_URGENCIA_DOR.test(mensagemLimpa);
  return {
    hasAction: true,
    message: mensagemLimpa,
    action: "OUTROS",
    domain: "Geral",
    detail: (ehUrgenciaDor ? "URGÊNCIA/DOR: " : "") + "[Auto-detectado, sem agent_action da IA] " + mensagemLimpa.slice(0, 500),
    Instance: instance,
    From: from,
  };
}`;
    if (!extraiJson.parameters.jsCode.includes(antigo)) throw new Error('trecho esperado nao encontrado em Extrai JSON -- codigo pode ter mudado');
    extraiJson.parameters.jsCode = extraiJson.parameters.jsCode.replace(antigo, novo);
  } else {
    console.log('Extrai JSON ja tem a deteccao de urgencia, pulando essa parte.');
  }

  // O guard de duplicata (adicionado mais cedo hoje) checava só
  // "LIKE '[Auto-detectado%'" (no início) -- agora que a urgência pode vir
  // ANTES desse prefixo, precisa checar em qualquer posição.
  if (registrarAcao.parameters.query.includes("LIKE '[Auto-detectado%'")) {
    registrarAcao.parameters.query = registrarAcao.parameters.query.replaceAll(
      "LIKE '[Auto-detectado%'",
      "LIKE '%[Auto-detectado%'"
    );
  } else {
    console.log('Registrar Ação já não usa o padrão antigo (ou já foi ajustado), pulando essa parte.');
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
