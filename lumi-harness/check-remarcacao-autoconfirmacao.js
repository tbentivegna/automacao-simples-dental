'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { criarSessao } = require('./run');

// Caso real 09/09/2026 (Fernanda Semente Figueira Ambrust): depois de uma
// sequência de mensagens reais da equipe ("[Equipe da clínica]: ...") na
// mesma conversa, a Lumi -- ao perguntar "posso confirmar essa mudança
// para você?" -- completou a PRÓPRIA resposta com "Perfeito, então vamos
// deixar para o dia 16 às 13h30", como se alguém já tivesse concordado.
// Ninguém tinha dito isso. Investigação (ver memória
// project_lumi_marcador_equipe_meio_mensagem_bug) confirmou que o texto
// realmente enviado pro WhatsApp da paciente não tinha o marcador
// "[Equipe da clínica]:" (removido por um filtro redundante no split de
// blocos) -- então o problema não é o marcador vazar, é a Lumi inventar
// uma confirmação que ninguém deu, na própria voz.
//
// A mesma mensagem real também mostra um segundo problema: a paciente
// justificou o horário apertado dizendo que a reavaliação "seria rápida"
// -- e a Lumi aceitou isso como motivo suficiente, sem checar a
// disponibilidade real (13:30 não estava entre os horários oferecidos
// nesse dia).
//
// Dois cenários, cada um testando um dos dois fixes novos no prompt:
//
// A) AUTOCONFIRMAÇÃO FANTASMA -- com o histórico "primado" por várias
//    mensagens reais da equipe (mesma condição da conversa real), o
//    paciente pede uma remarcação. FALHA se a resposta contiver uma
//    pergunta de confirmação seguida, na mesma mensagem, de uma frase que
//    soa como resposta/decisão já tomada por outra pessoa.
//
// B) HORÁRIO NÃO OFERECIDO JUSTIFICADO POR "VAI SER RÁPIDO" -- paciente
//    sugere um horário fora da lista que a Verifica Disponibilidade
//    acabou de retornar, justificando com duração. FALHA se a Lumi tratar
//    isso como aceito (afirmar o horário como certo, ou chamar
//    Remarcar/Confirmar Agendamento pra ele) sem antes reverificar ou
//    avisar que não está disponível.

function proximasQuartas(quantidade) {
  const hoje = new Date();
  const datas = [];
  const d = new Date(hoje);
  d.setHours(12, 0, 0, 0);
  while (datas.length < quantidade) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() === 3) datas.push(new Date(d));
  }
  return datas;
}
function paraBR(data) {
  return data.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

const HISTORICO_PRIMADO_EQUIPE = [
  { role: 'user', content: 'Oi, será que consigo remarcar minha consulta?' },
  { role: 'assistant', content: 'Oi! 🤎 Deixa eu ver aqui pra você.' },
  { role: 'assistant', content: '[Equipe da clínica]: Oi, tudo bem?' },
  { role: 'user', content: 'Tudo sim, e você?' },
  { role: 'assistant', content: '[Equipe da clínica]: Deixa eu verificar uma coisa aqui, já te retorno.' },
  { role: 'assistant', content: '[Equipe da clínica]: Perfeito, entendi a situação!' },
  { role: 'user', content: 'Combinado então' },
  { role: 'assistant', content: '[Equipe da clínica]: Qualquer coisa me avisa 🤎' },
];

async function cenarioA(n) {
  let falhas = 0;
  const [, , quartaAlvo] = proximasQuartas(3);
  const dataAlvoBR = paraBR(quartaAlvo);

  for (let i = 1; i <= n; i++) {
    const sessao = criarSessao({
      telefonePaciente: `1195${String(i).padStart(7, '0')}`,
      seedAgendamentos: [{ nomePaciente: 'Camila Torres', data: dataAlvoBR, hora: '09:30', status: 'Agendada' }],
      historico: HISTORICO_PRIMADO_EQUIPE,
    });
    const eventos = [];
    const { mensagem } = await sessao.enviarMensagemPaciente(
      `Você consegue remarcar minha consulta pra ${dataAlvoBR} de manhã? Se puder já confirmar seria ótimo`,
      (e) => eventos.push(e)
    );

    // pega o trecho depois da ULTIMA "?" da mensagem -- se tiver algo ali
    // que soa como confirmacao/decisao ja tomada, e autoconfirmacao fantasma.
    const idxUltimaPergunta = mensagem.lastIndexOf('?');
    const depoisDaPergunta = idxUltimaPergunta === -1 ? '' : mensagem.slice(idxUltimaPergunta + 1);
    const autoconfirmou = /\b(perfeito|combinado|confirmado|vamos deixar|fechado|tudo certo|certo,? (vamos|fica|ficou))\b/i.test(
      depoisDaPergunta
    );

    console.log(`  [A.${i}] autoconfirmação fantasma: ${autoconfirmou} | resposta: "${mensagem.slice(0, 180)}"${autoconfirmou ? '  <-- FALHA' : ''}`);
    if (autoconfirmou) falhas++;
  }
  console.log(`\nCenário A (autoconfirmação fantasma, histórico primado por equipe): ${falhas}/${n}`);
  return falhas;
}

async function cenarioB(n) {
  let falhas = 0;
  const [quartaAtual, , quartaAlvo] = proximasQuartas(3);
  const dataAtualBR = paraBR(quartaAtual);
  const dataAlvoBR = paraBR(quartaAlvo);

  for (let i = 1; i <= n; i++) {
    const sessao = criarSessao({
      telefonePaciente: `1196${String(i).padStart(7, '0')}`,
      seedAgendamentos: [
        { nomePaciente: 'Fernanda Souza', data: dataAtualBR, hora: '13:30', status: 'Agendada' },
        { nomePaciente: 'Paciente Outro', data: dataAlvoBR, hora: '13:30', status: 'Agendada' },
      ],
      historico: [
        { role: 'user', content: 'Oi, meu nome é Fernanda Souza' },
        { role: 'assistant', content: 'Oi Fernanda! Como posso te ajudar? 😊' },
      ],
    });

    await sessao.enviarMensagemPaciente(
      `Preciso remarcar minha consulta de ${dataAtualBR}. Você tem horário disponível na quarta dia ${dataAlvoBR} à tarde?`,
      () => {}
    );
    const eventos2 = [];
    const { mensagem } = await sessao.enviarMensagemPaciente(
      'Se for uma reavaliação rápida acho que dá tempo 13:30 nesse dia mesmo',
      (e) => eventos2.push(e)
    );

    const chamouComHorarioRuim = eventos2.some(
      (e) => e.tipo === 'tool_call' && (e.nomeTool === 'remarcar_agendamento' || e.nomeTool === 'confirmar_agendamento') && e.args?.hora === '13:30'
    );
    const reverificou = eventos2.some((e) => e.tipo === 'tool_call' && e.nomeTool === 'verificar_disponibilidade');
    const aceitouSemChecar = /\*\*?13:?30\*\*?.{0,20}(dia 16|nesse dia|nessa data)|posso (seguir|confirmar) com.{0,15}13:?30|13:?30.{0,15}(pode funcionar|deve funcionar|dá tempo)/i.test(
      mensagem
    ) && !/n[ãa]o (est[áa]|tem|h[áa]) (dispon[íi]vel|hor[áa]rio)|indispon[íi]vel/i.test(mensagem);

    const falhou = (chamouComHorarioRuim && !reverificou) || aceitouSemChecar;
    console.log(
      `  [B.${i}] chamou tool p/ 13:30 sem re-checar: ${chamouComHorarioRuim && !reverificou} | texto aceita sem checar: ${aceitouSemChecar} | resposta: "${mensagem.slice(0, 160)}"${falhou ? '  <-- FALHA' : ''}`
    );
    if (falhou) falhas++;
  }
  console.log(`\nCenário B (aceita horário não oferecido por causa de "vai ser rápido"): ${falhas}/${n}`);
  return falhas;
}

async function main(n) {
  console.log(`=== Prompt: ${process.env.LUMI_SYSTEM_PROMPT_PATH || '(padrão, system-prompt.txt)'} | modelo: ${process.env.LUMI_PROVIDER || 'mistral'}/${process.env.LUMI_MODEL || '(padrão)'} ===\n`);
  console.log('--- Cenário A: autoconfirmação fantasma ---');
  const a = await cenarioA(n);
  console.log('\n--- Cenário B: horário não oferecido, justificado por duração ---');
  const b = await cenarioB(n);

  console.log('\n\n=== RESUMO ===');
  console.log(`A) autoconfirmação fantasma : ${a}/${n} ${a === 0 ? 'OK' : 'FALHA'}`);
  console.log(`B) aceitou horário indevido : ${b}/${n} ${b === 0 ? 'OK' : 'FALHA'}`);
  process.exit(a === 0 && b === 0 ? 0 : 1);
}

main(Number(process.argv[2] || 5)).catch((e) => {
  console.error(e);
  process.exit(1);
});
