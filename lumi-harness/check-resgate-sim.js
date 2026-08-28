'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { criarSessao } = require('./run');

// Fix 2b: um "Sim" curto respondendo a uma mensagem de RESGATE ("ainda tem
// interesse? responde sim que eu retomo com os horários") NUNCA pode virar
// cancelar_agendamento. Caso real: Guilherme, 27/08 -- o modelo cancelou a
// consulta confirmada dele no lugar de seguir a remarcação.
//
// Passa se, nas N execuções, cancelar_agendamento nunca é chamada nesse
// "Sim" -- o esperado é verificar_disponibilidade (ou re-apresentar as
// opções / perguntar qual horário).

const amanha = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
})();

const HISTORICO = [
  { role: 'user', content: 'O Guilherme vai ter uma atividade na escola amanhã de manhã' },
  { role: 'assistant', content: 'Entendi! Vamos remarcar sua consulta para um horário melhor. Qual dia e horário você prefere? Posso verificar as opções disponíveis. 🤎' },
  { role: 'user', content: 'Qdo marquei não sabia. Podemos remarcar?' },
  { role: 'assistant', content: 'Claro! Tenho algumas opções: Segunda 31/08 às 16h30, Quarta 02/09 às 10h30, Sexta 04/09 às 10h00. Qual funciona melhor pra você? 🤎' },
  { role: 'assistant', content: 'Oi, Guilherme! 🤎 Vi que ficamos de combinar um horário pra sua consulta com a Dra. Aline e a conversa parou por aqui. Ainda tem interesse? Responde um "sim" que eu já retomo com os horários 😊' },
];

async function main(n) {
  let cancelou = 0;
  let verificouDispo = 0;
  let outro = 0;

  for (let i = 1; i <= n; i++) {
    const sessao = criarSessao({
      telefonePaciente: `1197${String(i).padStart(7, '0')}`,
      seedAgendamentos: [{ nomePaciente: 'Guilherme Chiaparini', data: amanha, hora: '08:30', observacao: 'Limpeza' }],
      historico: HISTORICO,
    });
    const eventos = [];
    const r = await sessao.enviarMensagemPaciente('Sim', (e) => eventos.push(e));
    const tools = eventos.filter((e) => e.tipo === 'tool_call').map((e) => e.nomeTool);
    const chamouCancelar = tools.includes('cancelar_agendamento');
    const chamouVerificar = tools.includes('verificar_disponibilidade');
    if (chamouCancelar) cancelou++;
    else if (chamouVerificar) verificouDispo++;
    else outro++;

    console.log(`--- Execução ${i} ---`);
    console.log('  tools:', tools.join(', ') || '(nenhuma)');
    console.log('  chamou cancelar_agendamento?', chamouCancelar ? 'SIM  <-- FALHA' : 'não');
    console.log('  texto:', r.mensagem.slice(0, 200).replace(/\n/g, ' '));
    console.log('');
  }

  console.log(`\n=== Resumo (${n} execuções, "Sim" logo após a mensagem de resgate) ===`);
  console.log(`  cancelou (FALHA)            : ${cancelou}/${n}`);
  console.log(`  chamou verificar_disponib.  : ${verificouDispo}/${n}`);
  console.log(`  outro (texto/pergunta)      : ${outro}/${n}`);
  console.log(cancelou === 0 ? '\nOK: nenhum cancelamento indevido.' : `\nFALHA: ${cancelou} cancelamento(s) indevido(s).`);
  process.exit(cancelou === 0 ? 0 : 1);
}

main(Number(process.argv[2] || 6)).catch((e) => { console.error(e); process.exit(1); });
