'use strict';

// Roda a MESMA situação várias vezes em sessões independentes, pra medir
// se um comportamento é consistente ou só "deu sorte" numa execução.
// Não decide sozinho se passou/falhou -- imprime cada resultado bruto pra
// leitura humana, já que classificar "isso foi um chute ou um pedido de
// esclarecimento" por regex seria pouco confiável.
//
// Uso: node lumi-harness/stress-test.js scenarios/04-escolha-ambigua.js 8

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const path = require('path');
const { criarSessao } = require('./run');

function corTerminal(texto, codigo) {
  if (process.env.NO_COLOR) return texto;
  return `\x1b[${codigo}m${texto}\x1b[0m`;
}

async function rodar(configPath, repeticoes) {
  const cfg = require(path.resolve(configPath));

  console.log(corTerminal(`\n=== Stress test: ${cfg.nome || configPath} (${repeticoes}x) ===`, '1'));
  console.log(corTerminal(`Prefixo: ${JSON.stringify(cfg.prefixo)}`, '2'));
  console.log(corTerminal(`Mensagem de teste (repetida): "${cfg.mensagemTeste}"\n`, '2'));

  const resumo = [];

  for (let i = 1; i <= repeticoes; i++) {
    const sessao = criarSessao({
      telefonePaciente: cfg.telefonePaciente,
      seedAgendamentos: cfg.seedAgendamentos || [],
    });

    for (const m of cfg.prefixo) {
      await sessao.enviarMensagemPaciente(m, () => {});
    }

    const eventos = [];
    const resultado = await sessao.enviarMensagemPaciente(cfg.mensagemTeste, (e) => eventos.push(e));

    const toolCalls = eventos.filter((e) => e.tipo === 'tool_call');
    const chamouToolDeAcao = toolCalls.find((tc) => (cfg.toolsDeAcao || []).includes(tc.nomeTool));

    console.log(corTerminal(`--- Execução ${i} ---`, '1'));
    if (toolCalls.length) {
      for (const tc of toolCalls) console.log(corTerminal(`   [chamar ${tc.nomeTool}(${JSON.stringify(tc.args)})]`, '33'));
    }
    console.log(corTerminal(`🤎 LUMI: ${resultado.mensagem}`, '35'));
    console.log('');

    resumo.push({
      execucao: i,
      chamouToolDeAcaoSemEscolhaExplicita: !!chamouToolDeAcao,
      toolArgs: chamouToolDeAcao ? chamouToolDeAcao.args : null,
      texto: resultado.mensagem,
    });
  }

  console.log(corTerminal('=== Resumo ===', '1'));
  const comChamadaDireta = resumo.filter((r) => r.chamouToolDeAcaoSemEscolhaExplicita);
  console.log(`Execuções que chamaram uma tool de ação (${(cfg.toolsDeAcao || []).join('/')}) direto na mensagem ambígua: ${comChamadaDireta.length}/${repeticoes}`);
  for (const r of comChamadaDireta) {
    console.log(corTerminal(`  - Execução ${r.execucao}: ${JSON.stringify(r.toolArgs)}`, '31'));
  }
  console.log(corTerminal('\n(leia as respostas acima pra ver, nas outras execuções, se ela pediu esclarecimento ou "chutou" um horário específico em texto antes de confirmar)\n', '2'));
}

if (require.main === module) {
  const [, , configPath, repeticoesArg] = process.argv;
  if (!configPath) {
    console.error('Uso: node lumi-harness/stress-test.js <arquivo-de-config> <repeticoes>');
    process.exit(1);
  }
  rodar(configPath, Number(repeticoesArg || 6)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
