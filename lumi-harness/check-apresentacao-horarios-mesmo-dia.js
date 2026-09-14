'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { criarSessao } = require('./run');

// Caso real (14/09/2026, mesma conversa da Alessandra Saito): perguntada
// "e no final do dia? quais horários disponíveis", a Lumi respondeu:
//   "quarta, 16/09, às 14:30 / quarta, 16/09, às 15:30 / quarta, 16/09, às
//   16:30. Se preferir, também tenho: segunda, 21/09, às 13:30 / segunda,
//   21/09, às 16:30" -- 5 opções, só 2 dias, cada um repetido 2-3x. Viola a
// regra já existente ("nunca repita o mesmo dia", "no máximo 3 opções").
//
// Reproduz o mesmo gatilho (pedido de período específico onde o dia mais
// próximo tem vários horários livres) e checa: nenhuma DATA se repete na
// resposta, e no máximo 3 opções no total.

const REGEX_DATA = /\b(\d{2}\/\d{2})\b/g;

async function cenarioA(n) {
  let falhou = 0;
  for (let i = 1; i <= n; i++) {
    const sessao = criarSessao({ telefonePaciente: `1199${String(i).padStart(7, '0')}` });
    const eventos = [];
    await sessao.enviarMensagemPaciente('Oi, queria marcar uma limpeza', (e) => eventos.push(e));
    await sessao.enviarMensagemPaciente('Marina', (e) => eventos.push(e));
    const r = await sessao.enviarMensagemPaciente('Tem horário no final do dia, tipo depois das 14h?', (e) => eventos.push(e));

    const datas = (r.mensagem.match(REGEX_DATA) || []);
    const datasUnicas = new Set(datas);
    const semRepeticao = datas.length === datasUnicas.size;
    const maxTres = datas.length <= 3;
    const ok = semRepeticao && maxTres;

    console.log(`  [A.${i}] ${ok ? 'ok' : 'FALHA'} -- datas oferecidas: [${datas.join(', ')}]`);
    if (!ok) {
      console.log('     resposta: ' + JSON.stringify(r.mensagem.slice(0, 350)));
      falhou++;
    }
  }
  console.log(`\nCenário A (não repete a mesma data, no máx. 3 opções): ${falhou}/${n} falhas`);
  return falhou;
}

async function main(n) {
  console.log(`=== Prompt: ${process.env.LUMI_SYSTEM_PROMPT_PATH || '(padrão, system-prompt.txt)'} | provider: ${process.env.LUMI_PROVIDER || 'mistral'} ===\n`);
  const a = await cenarioA(n);
  console.log('\n\n=== RESUMO ===');
  console.log(`A) repetiu data ou ofereceu mais de 3 : ${a}/${n} ${a === 0 ? 'OK' : 'FALHA'}`);
  process.exit(a === 0 ? 0 : 1);
}

main(Number(process.argv[2] || 3)).catch((e) => {
  console.error(e);
  process.exit(1);
});
