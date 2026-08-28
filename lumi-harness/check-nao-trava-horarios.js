'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { criarSessao } = require('./run');

// Caso Ana Paula (28/08, exec 3087): "podemos agendar quinta ou sexta da
// semana que vem?" -> a Lumi disse "vamos verificar os horarios... um
// momento" e ENCERROU sem chamar verificar_disponibilidade.
//
// Passa se, nas N execucoes, a Lumi chamar verificar_disponibilidade (ou
// fizer uma pergunta objetiva tipo manha/tarde) -- nunca terminar com "um
// momento" sem tool.

const PROMETEU = /(vou|vamos|deixa eu|posso|irei)\s+(verificar|checar|consultar|ver|conferir)[^.!?\n]{0,40}(hor[áa]rio|disponibilidade|agenda)|um\s+(momento|instante|minuto)\b[^.!?\n]{0,60}(hor[áa]rio|verific|disponib|agenda)|j[áa]\s+(te )?retorno com os hor[áa]rios/i;
const TEM_HORARIO = /\d{1,2}\s*[:h]\s*\d{2}|\b[àa]s?\s+\d{1,2}\s*(h\b|hora|:)/i;
const PERGUNTA_PREF = /manh[ãa].{0,8}tarde|tarde.{0,8}manh[ãa]|qual (dia|per[íi]odo)|algum dia|prefer/i;

async function main(n) {
  let chamou = 0, perguntou = 0, travou = 0;
  for (let i = 1; i <= n; i++) {
    const sessao = criarSessao({ telefonePaciente: `1198${String(i).padStart(7, '0')}` });
    const ev = [];
    const r = await sessao.enviarMensagemPaciente(
      'Bom dia! Me perdoa só responder agora, essa semana foi uma loucura. Podemos agendar para quinta ou sexta da semana que vem?',
      (e) => ev.push(e)
    );
    const tools = ev.filter((e) => e.tipo === 'tool_call').map((e) => e.nomeTool);
    const chamouVD = tools.includes('verificar_disponibilidade');
    const perguntouPref = !chamouVD && PERGUNTA_PREF.test(r.mensagem);
    const stall = !chamouVD && PROMETEU.test(r.mensagem) && !TEM_HORARIO.test(r.mensagem);
    if (chamouVD) chamou++;
    else if (perguntouPref) perguntou++;
    if (stall) travou++;
    console.log(`--- Exec ${i} --- tools:[${tools.join(',')}]  ${chamouVD ? 'chamou VD' : perguntouPref ? 'perguntou preferencia' : stall ? 'TRAVOU <-- FALHA' : 'outro'}`);
    console.log('   ' + r.mensagem.slice(0, 180).replace(/\n/g, ' '));
  }
  console.log(`\n=== Resumo (${n}) ===`);
  console.log(`  chamou verificar_disponibilidade: ${chamou}/${n}`);
  console.log(`  perguntou preferencia (ok):       ${perguntou}/${n}`);
  console.log(`  TRAVOU (promessa sem tool):        ${travou}/${n}`);
  process.exit(travou === 0 ? 0 : 1);
}
main(Number(process.argv[2] || 6)).catch((e) => { console.error(e); process.exit(1); });
