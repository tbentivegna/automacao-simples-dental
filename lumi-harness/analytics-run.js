'use strict';

// Harness de teste do Analytics Agent (separado da Lumi -- persona e tools
// diferentes). Mesmo esquema do run.js: tools mockadas, sem tocar no
// Postgres real.
//
// Uso:
//   node lumi-harness/analytics-run.js scenarios-analytics/nome.js

const fs = require('fs');
const path = require('path');
const { tools } = require('./analytics-tools');
const { criarEstadoAnalyticsFake } = require('./analytics-mock-tools');
const { criarClienteLLM, corTerminal } = require('./llm-client');

const { chamarLLM } = criarClienteLLM(tools);

const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'analytics-system-prompt.txt'), 'utf8');

function criarSessao({ dadosFake = {} } = {}) {
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  const estadoFake = criarEstadoAnalyticsFake(dadosFake);

  async function enviarMensagemMaster(texto, onEvent = () => {}) {
    messages.push({ role: 'user', content: texto });
    onEvent({ tipo: 'master', texto });

    for (let iteracao = 0; iteracao < 8; iteracao++) {
      const resposta = await chamarLLM(messages);
      const msg = resposta.choices[0].message;
      messages.push(msg);

      const toolCalls = msg.tool_calls || [];

      if (toolCalls.length === 0) {
        onEvent({ tipo: 'resposta_agent', texto: msg.content || '' });
        return { mensagem: msg.content || '' };
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

  return { enviarMensagemMaster, estadoFake, messages };
}

function logEvento(evento) {
  switch (evento.tipo) {
    case 'master':
      console.log(corTerminal(`\n👤 MASTER: ${evento.texto}`, '36'));
      break;
    case 'tool_call':
      console.log(corTerminal(`   [chamar ${evento.nomeTool}(${JSON.stringify(evento.args)})]`, '33'));
      break;
    case 'tool_result': {
      const resumo = evento.erro ? `ERRO: ${evento.erro}` : JSON.stringify(evento.resultado);
      console.log(corTerminal(`   ↳ resultado: ${resumo.slice(0, 500)}`, '90'));
      break;
    }
    case 'resposta_agent':
      console.log(corTerminal(`📊 ANALYTICS: ${evento.texto}`, '35'));
      break;
    default:
      break;
  }
}

async function rodarCenario(caminhoArquivo) {
  const cenario = require(path.resolve(caminhoArquivo));
  const sessao = criarSessao({ dadosFake: cenario.dadosFake || {} });

  console.log(corTerminal(`\n=== Cenário: ${cenario.nome || caminhoArquivo} ===`, '1'));
  if (cenario.descricao) console.log(corTerminal(cenario.descricao, '2'));

  for (const mensagem of cenario.mensagens) {
    await sessao.enviarMensagemMaster(mensagem, logEvento);
  }

  console.log(corTerminal('\n=== Fim do cenário ===\n', '1'));
}

if (require.main === module) {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Uso: node lumi-harness/analytics-run.js <arquivo-de-cenario>');
    process.exit(1);
  }
  rodarCenario(arg).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { criarSessao, logEvento };
