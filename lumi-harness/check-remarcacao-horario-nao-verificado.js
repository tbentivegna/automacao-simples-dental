'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { criarSessao } = require('./run');

// Bug real 09/09/2026 (caso Fernanda Semente Figueira Ambrust): paciente
// pediu remarcação, a Lumi verificou disponibilidade num dia específico e
// achou 14:30/15:30/16:30 livres (13:30 NÃO estava na lista -- alguém já
// tinha aquele horário). A paciente sugeriu por conta própria "13:30"
// (coincidência: é o mesmo horário da consulta atual dela, só que em outro
// dia). A Lumi aceitou sem cruzar com a disponibilidade que ela mesma
// tinha acabado de checar, perguntou "posso confirmar?", e só na hora de
// chamar a ferramenta de verdade é que o Simples Dental recusou (409,
// CONFLITO_HORARIO) -- a paciente ficou sem solução na hora e a consulta
// (que era hoje) ficou com status incerto até a equipe resolver.
//
// O sistema de segurança funcionou (nunca disse "remarcado" sem ser
// verdade), mas o vaivém era evitável: a Lumi já TINHA a informação de que
// 13:30 não estava livre nesse dia antes mesmo de perguntar "posso
// confirmar?".
//
// Este teste recria a mesma armadilha com o mock (que já simula conflito
// de horário de verdade -- server.js real faria o mesmo 409): semeia a
// consulta atual da paciente + um "outro compromisso" ocupando 13:30 na
// data-alvo, pede pra verificar disponibilidade nessa data (retorna tudo
// MENOS 13:30), e a paciente propõe 13:30 mesmo assim.
//
// PASSA se a Lumi, na resposta a essa proposta, NÃO tratar 13:30 como
// aceito/em vias de confirmar pra essa data -- ou seja: ou já avisa que
// não está disponível e reoferece os horários reais, ou re-verifica antes
// de aceitar, mas NUNCA chama Remarcar/Confirmar Agendamento com esse
// horário sem antes ter confirmado (via tool) que está livre.

function proximasQuartas(quantidade) {
  const hoje = new Date();
  const datas = [];
  const d = new Date(hoje);
  d.setHours(12, 0, 0, 0);
  while (datas.length < quantidade) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() === 3) datas.push(new Date(d)); // 3 = quarta
  }
  return datas;
}

function paraBR(data) {
  return data.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

async function cenario(n) {
  let falhas = 0;
  const [quartaAtual, , quartaAlvo] = proximasQuartas(3); // usa a 3a quarta como alvo (dentro das 4 semanas verificadas)
  const dataAtualBR = paraBR(quartaAtual);
  const dataAlvoBR = paraBR(quartaAlvo);

  for (let i = 1; i <= n; i++) {
    const sessao = criarSessao({
      telefonePaciente: `1194${String(i).padStart(7, '0')}`,
      seedAgendamentos: [
        { nomePaciente: 'Fernanda Souza', data: dataAtualBR, hora: '13:30', status: 'Agendada' },
        // "outro compromisso" -- mesmo telefone no mock (não afeta a busca,
        // que filtra por nome), só existe pra ocupar o slot de verdade.
        { nomePaciente: 'Paciente Outro', data: dataAlvoBR, hora: '13:30', status: 'Agendada' },
      ],
      historico: [
        { role: 'user', content: 'Oi, meu nome é Fernanda Souza' },
        { role: 'assistant', content: 'Oi Fernanda! Como posso te ajudar? 😊' },
      ],
    });

    const eventos = [];
    await sessao.enviarMensagemPaciente(
      `Preciso remarcar minha consulta de ${dataAtualBR}. Você tem horário disponível na quarta dia ${dataAlvoBR} à tarde?`,
      (e) => eventos.push(e)
    );

    const eventos2 = [];
    const { mensagem } = await sessao.enviarMensagemPaciente('Pode ser 13:30 nesse dia mesmo, é rapidinho', (e) => eventos2.push(e));

    const chamouRemarcarComHorarioRuim = eventos2.some(
      (e) =>
        e.tipo === 'tool_call' &&
        (e.nomeTool === 'remarcar_agendamento' || e.nomeTool === 'confirmar_agendamento') &&
        e.args?.hora === '13:30' &&
        !(e.resultado || {}).erro
    );
    // Se chamou a tool e ela retornou erro de conflito, isso é o
    // comportamento ANTIGO (tentou sem checar antes) -- também conta como
    // falha, mesmo não tendo "confirmado" nada errado pro paciente, porque
    // o objetivo do fix é EVITAR a tentativa/vaivém, não só evitar mentir.
    const tentouRemarcarHorarioOcupado = eventos2.some(
      (e) => e.tipo === 'tool_call' && e.nomeTool === 'remarcar_agendamento' && e.args?.hora === '13:30'
    );
    const reverificouAntes = eventos2.some((e) => e.tipo === 'tool_call' && e.nomeTool === 'verificar_disponibilidade');
    const avisouIndisponivel = /n[ãa]o (est[áa]|tem|h[áa])|indispon[íi]vel|ocupad[oa]|j[áa] (est[áa]|foi) (marcad|reservad|ocupad)/i.test(mensagem);

    const falhou = tentouRemarcarHorarioOcupado && !reverificouAntes;
    console.log(
      `  [${i}] tentou remarcar p/ 13:30 sem re-checar: ${tentouRemarcarHorarioOcupado && !reverificouAntes} | re-verificou antes: ${reverificouAntes} | avisou indisponível no texto: ${avisouIndisponivel} | resposta: "${mensagem.slice(0, 140)}"${falhou ? '  <-- FALHA' : ''}`
    );
    if (falhou) falhas++;
  }

  console.log(`\nData atual (seed) usada: ${dataAtualBR} | data-alvo (13:30 ocupado): ${dataAlvoBR}`);
  console.log(`Total: tentou remarcar pro horário ocupado sem re-checar antes: ${falhas}/${n}`);
  return falhas;
}

async function main(n) {
  console.log(`=== Prompt: ${process.env.LUMI_SYSTEM_PROMPT_PATH || '(padrão, system-prompt.txt)'} | modelo: ${process.env.LUMI_PROVIDER || 'mistral'}/${process.env.LUMI_MODEL || '(padrão)'} ===\n`);
  const falhas = await cenario(n);
  console.log(`\n=== RESUMO ===`);
  console.log(`Aceitou horário proposto sem checar disponibilidade antes: ${falhas}/${n} ${falhas === 0 ? 'OK' : 'FALHA'}`);
  process.exit(falhas === 0 ? 0 : 1);
}

main(Number(process.argv[2] || 6)).catch((e) => {
  console.error(e);
  process.exit(1);
});
