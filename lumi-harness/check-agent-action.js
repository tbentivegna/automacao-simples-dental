'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { criarSessao } = require('./run');

const TOOLS_VALIDAS = new Set([
  'verificar_disponibilidade',
  'criar_agendamento',
  'buscar_agendamentos_paciente',
  'confirmar_agendamento',
  'cancelar_agendamento',
  'remarcar_agendamento',
]);

async function main(n) {
  let comAgentActionValido = 0;
  let tentouToolFantasma = 0;
  let afirmouSemAgentAction = 0;

  const VERBOS_AFIRMACAO = /registr|encaminh|acion|avis/i;

  for (let i = 1; i <= n; i++) {
    const sessao = criarSessao({ telefonePaciente: `1199${String(i).padStart(6, '0')}` });
    const eventos = [];
    await sessao.enviarMensagemPaciente('socorro, estou com uma dor de dente insuportável', (e) => eventos.push(e));
    await sessao.enviarMensagemPaciente('Fernanda Souza', (e) => eventos.push(e));
    const r = await sessao.enviarMensagemPaciente(
      'começou ontem à noite, não tive nenhum trauma nem fiz procedimento recente, mas está inchado',
      (e) => eventos.push(e)
    );

    const chamouFantasma = eventos.some((e) => e.tipo === 'tool_call' && !TOOLS_VALIDAS.has(e.nomeTool));
    const afirmouAcaoSemJson = !r.agentAction && VERBOS_AFIRMACAO.test(r.mensagem);

    if (chamouFantasma) tentouToolFantasma++;
    if (r.agentAction) comAgentActionValido++;
    if (afirmouAcaoSemJson) afirmouSemAgentAction++;

    console.log(`--- Execução ${i} ---`);
    console.log('  tentou tool fantasma?', chamouFantasma);
    console.log('  agent_action JSON válido?', !!r.agentAction, r.agentAction || '');
    console.log('  afirma ter registrado/encaminhado SEM json?', afirmouAcaoSemJson);
    console.log('  texto final:', r.mensagem.slice(0, 250));
    console.log('');
  }

  console.log(`\n=== Resumo (${n} execuções, após as 3 respostas de triagem de urgência) ===`);
  console.log(`Tentaram chamar uma tool inexistente pro agent_action: ${tentouToolFantasma}/${n}`);
  console.log(`Produziram agent_action JSON válido (o que o n8n consegue extrair de fato): ${comAgentActionValido}/${n}`);
  console.log(`Disseram ao paciente que já registrou/encaminhou, SEM o JSON correspondente: ${afirmouSemAgentAction}/${n}`);
}

main(Number(process.argv[2] || 8)).catch((e) => {
  console.error(e);
  process.exit(1);
});
