'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { criarSessao } = require('./run');

// Caso real: Alessandra Saito (11/09/2026) -- pediu consulta pro bebê de 14
// meses sem usar uma palavra de parentesco explícita ("meu filho"/"minha
// filha"), só "bebê de X meses". A Lumi nunca ativou a seção CONSULTA PARA
// DEPENDENTE (o gatilho só cobria frases com parentesco explícito), foi
// direto pro cadastro-completo genérico ("preciso completar SEU cadastro"),
// e a paciente respondeu misturando dado dela com dado do bebê. A tool call
// final ficou com nomePaciente = nome da mãe + dataNascimentoPaciente = data
// de nascimento do bebê (inconsistente) e nomeResponsavel vazio.
//
//   A) Mensagem só com "bebê de X meses" (sem parentesco explícito) tem que
//      disparar a pergunta de nome completo + data de nascimento do
//      dependente -- ANTES de avançar pro agendamento.
//   B) Fluxo completo (disponibilidade -> escolha -> cadastro -> Cria
//      Agendamento): o campo nomePaciente da tool call final tem que ser o
//      nome do DEPENDENTE (nunca o da mãe/responsável), e nomeResponsavel
//      tem que estar preenchido com o nome de quem está conversando.

const REGEX_PEDIU_NOME_E_NASCIMENTO_DEPENDENTE =
  /nome completo.{0,60}(nascimento|nasceu)|(nascimento|nasceu).{0,60}nome completo/is;

// Reproduz a conversa real da Alessandra até o ponto em que ela decide
// agendar -- na real, a Lumi só respondeu a pergunta genérica (FAQ) sem
// nunca pedir nome+nascimento do bebê, nem antes nem depois da paciente
// confirmar que queria agendar. Testamos até esse ponto (sem entrar no
// cadastro-completo ainda, isso é o cenário B) porque é exatamente onde a
// falha real aconteceu.
async function cenarioA(n) {
  let falhou = 0;
  for (let i = 1; i <= n; i++) {
    const sessao = criarSessao({ telefonePaciente: `1196${String(i).padStart(7, '0')}` });
    const eventos = [];
    await sessao.enviarMensagemPaciente('Olá', (e) => eventos.push(e));
    await sessao.enviarMensagemPaciente('Alessandra', (e) => eventos.push(e));
    await sessao.enviarMensagemPaciente('A odonto realiza consulta com bebê de 14 meses?', (e) => eventos.push(e));
    await sessao.enviarMensagemPaciente('Qual o valor da consulta e quando seria a data de disponibilidade?', (e) => eventos.push(e));
    await sessao.enviarMensagemPaciente('Podemos seguir com o primeiro horário disponível', (e) => eventos.push(e));

    const textos = eventos.filter((e) => e.tipo === 'resposta_lumi').map((e) => e.texto).join('\n');
    const perguntou = REGEX_PEDIU_NOME_E_NASCIMENTO_DEPENDENTE.test(textos);
    console.log(`  [A.${i}] ${perguntou ? 'ok -- perguntou nome+nascimento do bebê' : 'FALHA -- não identificou dependente: ' + JSON.stringify(textos.slice(-400))}`);
    if (!perguntou) falhou++;
  }
  console.log(`\nCenário A ("bebê" sem parentesco explícito, até decidir agendar -- tem que perguntar nome+nascimento do dependente): ${falhou}/${n} falhas`);
  return falhou;
}

async function cenarioB(n) {
  let falhou = 0;
  for (let i = 1; i <= n; i++) {
    const sessao = criarSessao({ telefonePaciente: `1197${String(i).padStart(7, '0')}` });
    const eventos = [];
    await sessao.enviarMensagemPaciente('Olá', (e) => eventos.push(e));
    await sessao.enviarMensagemPaciente('Alessandra', (e) => eventos.push(e));
    await sessao.enviarMensagemPaciente('A odonto realiza consulta com bebê de 14 meses?', (e) => eventos.push(e));
    await sessao.enviarMensagemPaciente('Sim, ela se chama Sofia Saito, nasceu em 09/07/2025', (e) => eventos.push(e));
    await sessao.enviarMensagemPaciente('Qual o valor da consulta e quando seria a data de disponibilidade?', (e) => eventos.push(e));
    await sessao.enviarMensagemPaciente('Podemos seguir com o primeiro horário disponível', (e) => eventos.push(e));
    await sessao.enviarMensagemPaciente(
      // Inclui a data de nascimento DELA (responsável) além do CPF/CEP/e-mail --
      // sem isso, o modelo corretamente bloqueia Cria Agendamento por falta de
      // um dado obrigatório da variante MENOR DE IDADE (não é bug, é o
      // BLOQUEIO OBRIGATÓRIO funcionando; o teste tem que fornecer tudo que a
      // Lumi pediu pra validar o comportamento de fato.
      '15/03/1990\n109.824.568-75\n13348-724, Rua senhora marines de menezes, 114 - jardins do império - Indaiatuba\nalessandra.saito@icloud.com',
      (e) => eventos.push(e)
    );

    const criados = sessao.estadoFake._agenda;
    const ultimo = criados[criados.length - 1];

    if (!ultimo) {
      const textos = eventos.filter((e) => e.tipo === 'resposta_lumi').map((e) => e.texto).join(' | ');
      console.log(`  [B.${i}] FALHA -- Cria Agendamento nunca foi chamada. Última(s) resposta(s): ${JSON.stringify(textos.slice(-400))}`);
      falhou++;
      continue;
    }

    const nomePacienteCorreto = /sofia/i.test(ultimo.paciente) && !/alessandra/i.test(ultimo.paciente);
    const responsavelPreenchido = !!ultimo.cadastro.nomeResponsavel && /alessandra/i.test(ultimo.cadastro.nomeResponsavel);
    const ok = nomePacienteCorreto && responsavelPreenchido;

    console.log(
      `  [B.${i}] ${ok ? 'ok' : 'FALHA'} -- nomePaciente=${JSON.stringify(ultimo.paciente)} nomeResponsavel=${JSON.stringify(ultimo.cadastro.nomeResponsavel)} dataNascimentoPaciente=${JSON.stringify(ultimo.cadastro.dataNascimentoPaciente)}`
    );
    if (!ok) falhou++;
  }
  console.log(`\nCenário B (Cria Agendamento com paciente=dependente, responsável separado): ${falhou}/${n} falhas`);
  return falhou;
}

async function main(n) {
  console.log(`=== Prompt: ${process.env.LUMI_SYSTEM_PROMPT_PATH || '(padrão, system-prompt.txt)'} | provider: ${process.env.LUMI_PROVIDER || 'mistral'} ===\n`);
  console.log('--- Cenário A: "bebê" sem parentesco explícito ---');
  const a = await cenarioA(n);
  console.log('\n--- Cenário B: fluxo completo até Cria Agendamento ---');
  const b = await cenarioB(n);

  console.log('\n\n=== RESUMO ===');
  console.log(`A) não perguntou nome+nascimento do dependente : ${a}/${n} ${a === 0 ? 'OK' : 'FALHA'}`);
  console.log(`B) campos trocados na Cria Agendamento          : ${b}/${n} ${b === 0 ? 'OK' : 'FALHA'}`);
  process.exit(a === 0 && b === 0 ? 0 : 1);
}

main(Number(process.argv[2] || 3)).catch((e) => {
  console.error(e);
  process.exit(1);
});
