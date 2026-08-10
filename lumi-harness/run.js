'use strict';

// Harness de teste da Lumi, isolado do fluxo n8n/WhatsApp real.
//
// Fala direto com a API da Mistral usando o mesmo system prompt e o mesmo
// modelo/temperatura configurados no node "AI Agent" do n8n (devstral-latest,
// temperature 0.1). As 6 tools reais (que no fluxo real chamam o server.js /
// Simples Dental) são mockadas: nenhuma ação real é executada. Cada chamada
// de tool é impressa como "[chamar nomeDaTool({...})]" e respondida com um
// resultado fake (mock-tools.js), pra conversa poder continuar.
//
// Uso:
//   node lumi-harness/run.js scenarios/nome-do-cenario.js   -> roda um cenário fixo e imprime a transcrição inteira
//   node lumi-harness/run.js                                -> modo interativo (você digita, Lumi responde)

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { tools } = require('./tools');
const { criarEstadoFake } = require('./mock-tools');

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MODEL = process.env.LUMI_MODEL || 'devstral-latest';
const TEMPERATURE = 0.1;

if (!MISTRAL_API_KEY) {
  console.error('Falta MISTRAL_API_KEY. Crie lumi-harness/.env com MISTRAL_API_KEY=... (veja .env.example).');
  process.exit(1);
}

const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'system-prompt.txt'), 'utf8');

function corTerminal(texto, codigo) {
  if (process.env.NO_COLOR) return texto;
  return `\x1b[${codigo}m${texto}\x1b[0m`;
}

function extraiAgentAction(texto) {
  const start = texto.indexOf('{');
  const end = texto.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return { mensagem: texto, agentAction: null };

  const possivelJson = texto.substring(start, end + 1);
  let parsed;
  try {
    parsed = JSON.parse(possivelJson);
  } catch {
    return { mensagem: texto, agentAction: null };
  }
  if (!parsed.agent_action) return { mensagem: texto.replace(possivelJson, '').trim(), agentAction: null };
  return { mensagem: texto.replace(possivelJson, '').trim(), agentAction: parsed.agent_action };
}

async function chamarMistral(messages) {
  const resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: TEMPERATURE,
      messages,
      tools,
      tool_choice: 'auto',
    }),
  });

  if (!resp.ok) {
    const texto = await resp.text().catch(() => '');
    throw new Error(`Mistral API respondeu ${resp.status}: ${texto}`);
  }

  return resp.json();
}

// Roda uma sessão de conversa completa. `onEvent(evento)` é chamado a cada
// passo (mensagem do paciente, tool call, resultado mockado, resposta da
// Lumi) pra quem estiver rodando poder acompanhar/logar em tempo real.
function criarSessao({ telefonePaciente = '11999998888', seedAgendamentos = [], historico = [] } = {}) {
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  const estadoFake = criarEstadoFake({ telefonePaciente });

  for (const s of seedAgendamentos) estadoFake.seed(s);

  // Simula mensagens que já estariam na memória Postgres (mesmo telefone,
  // conversa anterior) -- sem isso, toda sessão de teste é sempre "primeira
  // interação" do ponto de vista do modelo, mesmo pra cenários que deveriam
  // representar um paciente que já falou com a Lumi antes.
  for (const h of historico) messages.push({ role: h.role, content: h.content });

  async function enviarMensagemPaciente(texto, onEvent = () => {}) {
    messages.push({ role: 'user', content: texto });
    onEvent({ tipo: 'paciente', texto });

    // Um turno pode envolver várias idas e vindas de tool calls antes da
    // resposta final em texto -- looping até o modelo parar de chamar tools.
    for (let iteracao = 0; iteracao < 8; iteracao++) {
      const resposta = await chamarMistral(messages);
      const msg = resposta.choices[0].message;
      messages.push(msg);

      const toolCalls = msg.tool_calls || [];

      if (toolCalls.length === 0) {
        const { mensagem, agentAction } = extraiAgentAction(msg.content || '');
        onEvent({ tipo: 'resposta_lumi', texto: mensagem, agentAction });
        return { mensagem, agentAction };
      }

      for (const tc of toolCalls) {
        const nomeTool = tc.function.name;
        let args = {};
        try {
          args = JSON.parse(tc.function.arguments || '{}');
        } catch {
          args = {};
        }

        onEvent({ tipo: 'tool_call', nomeTool, args });

        let resultado;
        let erro = null;
        try {
          const handler = estadoFake.handlers[nomeTool];
          if (!handler) throw new Error(`Tool desconhecida: ${nomeTool}`);
          resultado = handler(args);
        } catch (e) {
          erro = e;
          resultado = { erro: e.message };
        }

        onEvent({ tipo: 'tool_result', nomeTool, resultado, erro: erro ? erro.message : null });

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: nomeTool,
          content: JSON.stringify(resultado),
        });
      }
    }

    throw new Error('Excedeu limite de iterações de tool calls em um único turno (possível loop).');
  }

  return { enviarMensagemPaciente, estadoFake, messages };
}

function logEvento(evento) {
  switch (evento.tipo) {
    case 'paciente':
      console.log(corTerminal(`\n👤 PACIENTE: ${evento.texto}`, '36'));
      break;
    case 'tool_call':
      console.log(corTerminal(`   [chamar ${evento.nomeTool}(${JSON.stringify(evento.args)})]`, '33'));
      break;
    case 'tool_result': {
      const resumo = evento.erro ? `ERRO: ${evento.erro}` : JSON.stringify(evento.resultado);
      console.log(corTerminal(`   ↳ resultado: ${resumo.slice(0, 400)}`, '90'));
      break;
    }
    case 'resposta_lumi':
      console.log(corTerminal(`🤎 LUMI: ${evento.texto}`, '35'));
      if (evento.agentAction) {
        console.log(corTerminal(`   [agent_action -> ${evento.agentAction.action} / ${evento.agentAction.domain}: ${evento.agentAction.detail}]`, '31'));
      }
      break;
    default:
      break;
  }
}

async function rodarCenario(caminhoArquivo) {
  const cenario = require(path.resolve(caminhoArquivo));
  const sessao = criarSessao({
    telefonePaciente: cenario.telefonePaciente,
    seedAgendamentos: cenario.seedAgendamentos || [],
    historico: cenario.historico || [],
  });

  console.log(corTerminal(`\n=== Cenário: ${cenario.nome || caminhoArquivo} ===`, '1'));
  if (cenario.descricao) console.log(corTerminal(cenario.descricao, '2'));

  for (const mensagem of cenario.mensagens) {
    await sessao.enviarMensagemPaciente(mensagem, logEvento);
  }

  console.log(corTerminal('\n=== Fim do cenário ===\n', '1'));
}

async function modoInterativo() {
  const sessao = criarSessao({});
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(corTerminal('Modo interativo. Digite como se fosse o paciente. Ctrl+C para sair.\n', '1'));

  const pergunta = () =>
    rl.question('> ', async (texto) => {
      if (texto.trim()) {
        try {
          await sessao.enviarMensagemPaciente(texto, logEvento);
        } catch (e) {
          console.error(corTerminal(`Erro: ${e.message}`, '31'));
        }
      }
      pergunta();
    });

  pergunta();
}

if (require.main === module) {
  const arg = process.argv[2];
  if (arg) {
    rodarCenario(arg).catch((e) => {
      console.error(e);
      process.exit(1);
    });
  } else {
    modoInterativo();
  }
}

module.exports = { criarSessao, logEvento };
