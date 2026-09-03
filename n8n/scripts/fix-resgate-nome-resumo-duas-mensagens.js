// Pedido do Tiago (02/09): a mensagem de resgate usa nome completo
// ("Oi, Leticia Manduca!") e cita a pergunta do paciente ao pé da letra,
// cortada em 140 caracteres -- fica estranho. Muda pra:
//   1. Só primeiro nome.
//   2. Resumo da pergunta gerado por IA (Basic LLM Chain -- não citação
//      literal), com fallback pro texto antigo se a IA falhar/não achar
//      assunto claro (nunca trava o resgate por causa disso).
//   3. Duas mensagens separadas (2 envios do WhatsApp), não uma só.
//
// Cuidado arquitetural (por causa do bug de duplicata já corrigido antes
// neste workflow, ver fix-desacopla-marca-enviado.js e fix-grava-resgate-
// paired-item.js): "Grava Resgate no Histórico" e "Marca Resgate Enviado"
// SEMPRE leem os dados de origem via `$('Monta Mensagem Resgate').all()
// [$itemIndex]` (nunca do output do node anterior direto) -- esse padrão
// é mantido e só ESTENDIDO aqui, nunca quebrado. O node de IA (Basic LLM
// Chain) SUBSTITUI o $json inteiro pelo seu próprio {text: ...} (não faz
// passthrough dos campos originais) -- por isso "Monta Mensagem Resgate"
// passa a ler os campos originais (nome, etapa, telefone, id, instancia)
// via `$('Busca Funil Parado').all()[$itemIndex]`, não mais de $json
// direto.
//
// Validado ao vivo (02-03/09), incluindo um seed de teste no número
// Tiago-DEV processado pelo cron real de resgate: 2 mensagens separadas,
// só primeiro nome, resumo natural (não citação literal). Texto final das
// mensagens (saudação, tom) foi depois ajustado pelo Tiago direto no n8n
// -- este script reflete o texto como ficou publicado, não o rascunho
// original. Dado de teste limpo do banco depois da validação.
//
// uso: node n8n/scripts/fix-resgate-nome-resumo-duas-mensagens.js <workflowId>
//   Só existe em PROD (sem gêmeo DEV): vUGMz073giDPfGzx
require('dotenv').config({ path: __dirname + '/../.env' });
const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node fix-resgate-nome-resumo-duas-mensagens.js <workflowId>');

const CREDENCIAL_MISTRAL = { id: 'emf0jzIsQDlstJwo', name: 'Mistral Cloud account' };

// v2 (02-03/09): a v1 (regra abstrata + exemplos de resposta só) fez o
// devstral-latest devolver SEM_RESUMO até pra pergunta clara e direta
// ("Qual o valor da consulta de avaliação pra Invisalign?" -- achado ao
// vivo testando pelo canvas do n8n). Trocado por few-shot com pares
// pergunta->resposta completos, incluindo esse caso exato que falhou, e
// reforço explícito "não seja excessivamente cauteloso". Confirmado
// corrigido: mesmo input passou a gerar "sobre o valor da consulta de
// avaliação pra Invisalign".
const PROMPT_RESUMO = `Resuma em português brasileiro, em até 10 palavras, o assunto da mensagem de um paciente de clínica odontológica abaixo. A resposta deve completar naturalmente a frase "vi que você tinha perguntado ___" -- responda só com esse complemento, sem aspas, sem ponto final, sem repetir "perguntado".

Exemplos:
Mensagem: "Qual o valor da consulta de avaliação pra Invisalign?" -> Resposta: sobre o valor da consulta de avaliação pra Invisalign
Mensagem: "Vocês aceitam algum convênio?" -> Resposta: se vocês aceitam algum convênio
Mensagem: "Tem horário disponível essa semana à tarde?" -> Resposta: sobre horários disponíveis essa semana à tarde
Mensagem: "Oi, tudo bem?" -> Resposta: SEM_RESUMO
Mensagem: "" -> Resposta: SEM_RESUMO

Só responda SEM_RESUMO quando a mensagem não tiver NENHUM assunto ou pergunta real (só saudação social, ou vazia). Toda pergunta ou pedido concreto do paciente, mesmo que simples ou direto, deve virar um resumo -- não seja excessivamente cauteloso.

Mensagem do paciente: {{ $json.ultima_mensagem_paciente }}`;

const CODIGO_MONTA_MENSAGEM_NOVO = `// Campos originais (nome, etapa, telefone, id, instancia,
// ultima_mensagem_paciente) -- NÃO vêm mais de $json direto porque o node
// anterior (Resume Pergunta Paciente, Basic LLM Chain) substitui o item
// inteiro pelo seu próprio {text: ...}. Mesmo padrão de lookback por nome
// que "Grava Resgate no Histórico"/"Marca Resgate Enviado" já usavam.
const original = $('Busca Funil Parado').all()[$itemIndex].json;

const primeiroNome = (original.nome || '').trim().split(/\\s+/)[0] || '';
const saudacao = primeiroNome ? \`Oi \${primeiroNome}, tudo bem?\` : 'Oi, tudo bem?';

// Resumo gerado pela IA -- SEM_RESUMO (ou vazio/chain falhou) cai pro
// texto antigo sem resumo nenhum. Nunca trava o resgate por causa disso.
const resumoIA = ($json.text || '').trim();
const temResumo = resumoIA && resumoIA.toUpperCase() !== 'SEM_RESUMO';

let mensagem1, mensagem2;
if (original.etapa === 'interesse') {
  if (temResumo) {
    mensagem1 = \`\${saudacao} 🤎 Sei que a rotina da vida pode ser corrida e entendo que as vezes as conversas aqui ficam paradas por um tempo. Você tinha perguntado \${resumoIA}.\`;
    mensagem2 = 'Ainda tem interesse? Fico à disposição pra continuarmos nossa conversa. 😊';
  } else {
    mensagem1 = \`\${saudacao} 🤎 Sei que a rotina da vida pode ser corrida e entendo que as vezes as conversas aqui ficam paradas por um tempo. Vi que você tinha entrado em contato e a conversa parou por aqui.\`;
    mensagem2 = 'Ainda tem interesse em saber mais? Fico à disposição! 😊';
  }
} else {
  mensagem1 = \`\${saudacao} 🤎 Sei que a rotina da vida pode ser corrida e entendo que as vezes as conversas aqui ficam paradas por um tempo. Vi que ficamos de combinar um horário pra sua consulta com a Dra. Aline e a conversa parou por aqui.\`;
  mensagem2 = 'Ainda tem interesse? Responde um "sim" que eu já retomo com os horários 😊';
}

return { ...original, mensagemResgate1: mensagem1, mensagemResgate2: mensagem2 };`;

async function main() {
  const wf = await (await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, { headers: H })).json();
  if (!wf.nodes) throw new Error('GET falhou: ' + JSON.stringify(wf));
  if (wf.versionId !== wf.activeVersionId) throw new Error('draft != ativo -- roda realinha-draft.js antes');

  if (wf.nodes.some((n) => n.name === 'Resume Pergunta Paciente')) {
    console.log('ja aplicado -- nada a fazer');
    return;
  }

  const monta = wf.nodes.find((n) => n.name === 'Monta Mensagem Resgate');
  const envia = wf.nodes.find((n) => n.name === 'Envia Resgate');
  const grava = wf.nodes.find((n) => n.name === 'Grava Resgate no Histórico');
  if (!monta || !envia || !grava) throw new Error('node esperado nao encontrado -- CONFERIR');

  // -- 1. Novo sub-node: modelo Mistral (mesma credencial do workflow principal)
  const modelo = {
    parameters: { model: 'devstral-latest', options: { temperature: 0.1, maxRetries: 2 } },
    type: '@n8n/n8n-nodes-langchain.lmChatMistralCloud',
    typeVersion: 1,
    position: [400, -420],
    id: 'mistral-resumo-resgate',
    name: 'Mistral - Resumo Resgate',
    credentials: { mistralCloudApi: CREDENCIAL_MISTRAL },
  };

  // -- 2. Novo node: Basic LLM Chain, resume a pergunta do paciente
  const chain = {
    parameters: { promptType: 'define', text: PROMPT_RESUMO, hasOutputParser: false },
    type: '@n8n/n8n-nodes-langchain.chainLlm',
    typeVersion: 1.9,
    position: [400, -260],
    id: 'resume-pergunta-paciente',
    name: 'Resume Pergunta Paciente',
  };

  // -- 3. Envia Resgate: passa a mandar mensagemResgate1 (era mensagemResgate)
  if (!envia.parameters.messageText.includes('mensagemResgate1')) {
    if (!envia.parameters.messageText.includes("$json.mensagemResgate")) {
      throw new Error('Envia Resgate: messageText diferente do esperado -- CONFERIR');
    }
    envia.parameters.messageText = envia.parameters.messageText.replace('$json.mensagemResgate', '$json.mensagemResgate1');
  }

  // -- 4. Novo node: 2º envio (mensagemResgate2, sem prefixo [Lumi]:, igual
  // ao padrão de "Divide Mensagem em Blocos" no workflow principal onde só
  // o bloco 0 leva o prefixo)
  const envia2 = {
    parameters: {
      resource: 'messages-api',
      instanceName: envia.parameters.instanceName,
      remoteJid: envia.parameters.remoteJid,
      messageText: "={{ $('Monta Mensagem Resgate').all()[$itemIndex].json.mensagemResgate2 }}",
      options_message: { delay: 1800 },
    },
    type: envia.type,
    typeVersion: envia.typeVersion,
    position: [
      (envia.position?.[0] ?? 784) + 260,
      envia.position?.[1] ?? -128,
    ],
    id: 'envia-resgate-2',
    name: 'Envia Resgate 2',
    credentials: envia.credentials,
  };

  // -- 5. Monta Mensagem Resgate: novo código (lê original via lookback, gera 2 mensagens)
  if (monta.parameters.jsCode.trim() === CODIGO_MONTA_MENSAGEM_NOVO.trim()) {
    console.log('Monta Mensagem Resgate ja tem o codigo novo -- pulando essa parte');
  } else {
    monta.parameters.jsCode = CODIGO_MONTA_MENSAGEM_NOVO;
  }

  // -- 6. Grava Resgate no Histórico: agora grava as 2 mensagens (2 linhas)
  const QUERY_GRAVA_ANTIGA = `INSERT INTO public.n8n_chat_histories (session_id, message)
VALUES ('{{ $('Monta Mensagem Resgate').all()[$itemIndex].json.telefone }}', $1::jsonb);`;
  if (grava.parameters.query.trim() !== QUERY_GRAVA_ANTIGA.trim()) {
    throw new Error('Grava Resgate no Historico: query diferente do esperado -- CONFERIR');
  }
  grava.parameters.query = `INSERT INTO public.n8n_chat_histories (session_id, message)
VALUES
  ('{{ $('Monta Mensagem Resgate').all()[$itemIndex].json.telefone }}', $1::jsonb),
  ('{{ $('Monta Mensagem Resgate').all()[$itemIndex].json.telefone }}', $2::jsonb);`;
  grava.parameters.options.queryReplacement =
    "={{ [JSON.stringify({ type: 'ai', content: $('Monta Mensagem Resgate').all()[$itemIndex].json.mensagemResgate1, tool_calls: [], additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [] }), JSON.stringify({ type: 'ai', content: $('Monta Mensagem Resgate').all()[$itemIndex].json.mensagemResgate2, tool_calls: [], additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [] }) ] }}";

  wf.nodes.push(modelo, chain, envia2);

  // -- 7. Sticky vermelha documentando a mudança
  wf.nodes.push({
    parameters: {
      content:
        '## 🔴 FIX 02/09: resgate com nome completo + citação literal\nTrocado por: só primeiro nome, resumo da pergunta gerado por\nIA (Basic LLM Chain, fallback pro texto antigo se falhar) e\n2 mensagens separadas em vez de 1. "Monta Mensagem Resgate"\nagora lê os campos originais via lookback pro "Busca Funil\nParado" -- o Chain LLM substitui o $json inteiro.',
      height: 260,
      width: 460,
      color: 3,
    },
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [232, -560],
    id: 'sticky-fix-resgate-nome-resumo-' + workflowId.slice(0, 8),
    name: 'Sticky Fix Resgate Nome+Resumo 02/09',
  });

  // -- 8. Reconexões
  // Busca Funil Parado -> Resume Pergunta Paciente -> Monta Mensagem Resgate
  wf.connections['Busca Funil Parado'] = { main: [[{ node: 'Resume Pergunta Paciente', type: 'main', index: 0 }]] };
  wf.connections['Resume Pergunta Paciente'] = { main: [[{ node: 'Monta Mensagem Resgate', type: 'main', index: 0 }]] };
  wf.connections['Mistral - Resumo Resgate'] = { ai_languageModel: [[{ node: 'Resume Pergunta Paciente', type: 'ai_languageModel', index: 0 }]] };
  // Envia Resgate -> Envia Resgate 2 -> [Grava, Marca] (fan-out movido pro
  // final da cadeia de envio -- Grava/Marca continuam lendo os dados reais
  // de "Monta Mensagem Resgate" por nome, não mudou o que é gravado, só
  // QUANDO dispara: depois que as 2 mensagens saíram, não só a 1ª).
  wf.connections['Envia Resgate'] = { main: [[{ node: 'Envia Resgate 2', type: 'main', index: 0 }]] };
  wf.connections['Envia Resgate 2'] = {
    main: [[
      { node: 'Grava Resgate no Histórico', type: 'main', index: 0 },
      { node: 'Marca Resgate Enviado', type: 'main', index: 0 },
    ]],
  };

  const put = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings }),
  });
  const pb = await put.json();
  if (!put.ok) throw new Error(`PUT falhou: ${put.status} ${JSON.stringify(pb)}`);
  const act = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}/activate`, { method: 'POST', headers: H });
  const ab = await act.json();
  const ok = ab.versionId === ab.activeVersionId;
  console.log(`PUT ${put.status} | activate ${act.status} | draft==active=${ok}`);
  if (!ok) throw new Error('verificacao FALHOU -- conferir na UI');
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
