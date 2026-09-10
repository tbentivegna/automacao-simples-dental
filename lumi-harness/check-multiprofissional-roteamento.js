'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// Roteamento por profissional numa clínica com VÁRIOS -- Fase 2/3 do
// Plano_Multi_Profissional.md. Precisa rodar contra um prompt de clínica
// multi-profissional de verdade (o padrão system-prompt.txt é da Dra. Aline,
// clínica de 1 -- lá o roteamento nem se aplica).
//
// uso:
//   node scripts/compilar-prompt-clinica.js scripts/variaveis-clinica-demo-multiprof.json lumi-harness/system-prompt-demo-multiprof.txt
//   LUMI_PROVIDER=openai LUMI_MODEL=gpt-5.4-mini \
//     LUMI_SYSTEM_PROMPT_PATH=lumi-harness/system-prompt-demo-multiprof.txt \
//     node lumi-harness/check-multiprofissional-roteamento.js 3

if (!process.env.LUMI_SYSTEM_PROMPT_PATH || !/multiprof/i.test(process.env.LUMI_SYSTEM_PROMPT_PATH)) {
  console.error('Este check precisa de LUMI_SYSTEM_PROMPT_PATH apontando pro prompt de clínica multi-profissional');
  console.error('(ex: lumi-harness/system-prompt-demo-multiprof.txt). Ver o cabeçalho do arquivo.');
  process.exit(2);
}

const { criarSessao } = require('./run');

const TRES_PROFISSIONAIS = [
  { id: 'p-camila', nome: 'Dra. Camila Duarte', especialidades: ['Ortodontia', 'Clínico Geral', 'Clareamento Dental'], padrao: true },
  { id: 'p-rafael', nome: 'Dr. Rafael Nunes', especialidades: ['Endodontia'] },
  { id: 'p-beatriz', nome: 'Dra. Beatriz Lima', especialidades: ['Implantodontia', 'Cirurgia Oral'] },
];

// C) "preciso tratar um canal" -> identifica o endodontista pelo nome e
//    verifica a agenda DELE (profissionalId na chamada).
async function cenarioC(n) {
  let falhou = 0;
  for (let i = 1; i <= n; i++) {
    const sessao = criarSessao({ telefonePaciente: `1196${String(i).padStart(7, '0')}`, seedProfissionais: TRES_PROFISSIONAIS });
    const eventos = [];
    await sessao.enviarMensagemPaciente('oi, preciso fazer um tratamento de canal, queria marcar', (e) => eventos.push(e));
    await sessao.enviarMensagemPaciente('meu nome é João Prado', (e) => eventos.push(e));

    const toolCalls = eventos.filter((e) => e.tipo === 'tool_call');
    const chamouLista = toolCalls.some((c) => c.nomeTool === 'lista_profissionais');
    const dispDoRafael = toolCalls.some(
      (c) => c.nomeTool === 'verificar_disponibilidade' && c.args && c.args.profissionalId === 'p-rafael'
    );
    const textos = eventos.filter((e) => e.tipo === 'resposta_lumi').map((e) => e.texto).join('\n');
    const citouRafael = /rafael/i.test(textos);
    const criouComOutro = toolCalls.some(
      (c) => c.nomeTool === 'criar_agendamento' && c.args && c.args.profissionalId && c.args.profissionalId !== 'p-rafael'
    );

    const ok = chamouLista && (dispDoRafael || citouRafael) && !criouComOutro;
    console.log(
      `  [C.${i}] lista:${chamouLista ? 'sim' : 'NÃO'} | disp(Rafael):${dispDoRafael ? 'sim' : 'não'} | citou Rafael:${citouRafael ? 'sim' : 'não'} | criou c/ outro:${criouComOutro ? 'SIM' : 'não'} ${ok ? '' : '<-- FALHA'}`
    );
    if (!ok) falhou++;
  }
  console.log(`\nCenário C (roteamento "canal" -> endodontista): ${falhou}/${n} falhas`);
  return falhou;
}

// D) "tanto faz com quem" -> usa o profissional padrão, sem ficar
//    perguntando qual.
async function cenarioD(n) {
  let falhou = 0;
  const REGEX_QUAL =
    /\bcom qual (profissional|dentista|doutor|doutora|dr|dra)\b|com quem (você |vc )?(prefere|gostaria|quer)/i;
  for (let i = 1; i <= n; i++) {
    const sessao = criarSessao({ telefonePaciente: `1197${String(i).padStart(7, '0')}`, seedProfissionais: TRES_PROFISSIONAIS });
    const eventos = [];
    await sessao.enviarMensagemPaciente('quero marcar uma primeira consulta, tanto faz com quem', (e) => eventos.push(e));
    await sessao.enviarMensagemPaciente('meu nome é Rita Campos, pode ser de manhã', (e) => eventos.push(e));
    const toolCalls = eventos.filter((e) => e.tipo === 'tool_call');
    const textos = eventos.filter((e) => e.tipo === 'resposta_lumi').map((e) => e.texto).join('\n');
    const insistiuPergunta = REGEX_QUAL.test(textos);
    const verificou = toolCalls.some((c) => c.nomeTool === 'verificar_disponibilidade');
    const usouNaoPadrao = toolCalls.some(
      (c) =>
        (c.nomeTool === 'verificar_disponibilidade' || c.nomeTool === 'criar_agendamento') &&
        c.args && c.args.profissionalId && c.args.profissionalId !== 'p-camila'
    );
    const ok = !insistiuPergunta && verificou && !usouNaoPadrao;
    console.log(`  [D.${i}] insistiu "com qual":${insistiuPergunta ? 'SIM' : 'não'} | verificou disp:${verificou ? 'sim' : 'NÃO'} | usou não-padrão:${usouNaoPadrao ? 'SIM' : 'não'} ${ok ? '' : '<-- FALHA'}`);
    if (!ok) falhou++;
  }
  console.log(`\nCenário D ("tanto faz" -> profissional padrão): ${falhou}/${n} falhas`);
  return falhou;
}

async function main(n) {
  console.log(`=== Prompt: ${process.env.LUMI_SYSTEM_PROMPT_PATH} ===\n`);
  console.log('--- Cenário C: roteamento por especialidade ---');
  const c = await cenarioC(n);
  console.log('\n--- Cenário D: "tanto faz" usa o padrão ---');
  const d = await cenarioD(n);

  console.log('\n\n=== RESUMO ===');
  console.log(`C) não roteou pro endodontista : ${c}/${n} ${c === 0 ? 'OK' : 'FALHA'}`);
  console.log(`D) não usou o profissional padrão / insistiu : ${d}/${n} ${d === 0 ? 'OK' : 'FALHA'}`);
  process.exit(c === 0 && d === 0 ? 0 : 1);
}

main(Number(process.argv[2] || 3)).catch((e) => { console.error(e); process.exit(1); });
