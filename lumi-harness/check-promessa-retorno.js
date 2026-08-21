'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { criarSessao } = require('./run');

// Caso real que motivou a regra: paciente "Eduardo" (mãe dele), pediu
// indicações de exames -- algo que só a Dra. Aline pode passar, as tools não
// cobrem. A Lumi respondeu "vou verificar com a Dra. Aline e te retorno em
// breve" e NÃO gerou agent_action nenhum (2026-08-21, produção). Este check
// roda o mesmo cenário N vezes contra a regra nova "PROMESSA DE RETORNO".

async function main(n) {
  let comAgentAction = 0;
  let prometeuSemAgentAction = 0;

  const VERBOS_PROMESSA = /verificar|retorn|repass|encaminh/i;

  for (let i = 1; i <= n; i++) {
    const sessao = criarSessao({ telefonePaciente: `1198${String(i).padStart(6, '0')}` });
    const eventos = [];
    const r1 = await sessao.enviarMensagemPaciente('Bom dia Dra Aline\nTudo bem?\n\nDra por favor poderia me passar as indicações para fazer os exames do Eduardo.\n\nObrigada', (e) => eventos.push(e));
    const r2 = await sessao.enviarMensagemPaciente('Selma', (e) => eventos.push(e));

    const turnoComPromessa = VERBOS_PROMESSA.test(r1.mensagem) ? r1 : (VERBOS_PROMESSA.test(r2.mensagem) ? r2 : null);
    const prometeuRetorno = !!turnoComPromessa;
    const semAgentAction = prometeuRetorno && !turnoComPromessa.agentAction;
    const teveAgentAction = !!r1.agentAction || !!r2.agentAction;

    if (teveAgentAction) comAgentAction++;
    if (semAgentAction) prometeuSemAgentAction++;

    console.log(`--- Execução ${i} ---`);
    console.log('  prometeu verificar/retornar?', prometeuRetorno);
    console.log('  agent_action JSON válido (turno 1 / turno 2)?', !!r1.agentAction, '/', !!r2.agentAction);
    console.log('  texto turno 1:', r1.mensagem.slice(0, 250));
    console.log('  texto turno 2:', r2.mensagem.slice(0, 250));
    console.log('');
  }

  console.log(`\n=== Resumo (${n} execuções) ===`);
  console.log(`Tiveram agent_action em algum dos 2 turnos: ${comAgentAction}/${n}`);
  console.log(`Prometeram retorno SEM agent_action no mesmo turno (a falha original): ${prometeuSemAgentAction}/${n}`);
}

main(Number(process.argv[2] || 6)).catch((e) => {
  console.error(e);
  process.exit(1);
});
