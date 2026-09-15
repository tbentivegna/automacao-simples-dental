'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { criarSessao } = require('./run');

// Caso real: Valentina Freitas de Lima (15/09/2026). Ela conduziu TODA a
// conversa sozinha, se apresentou por si, nunca mencionou responsável nem
// qualquer sinal de ser menor -- mas informou data de nascimento 11/05/2015,
// que dá 11 anos. A Lumi seguiu pelo caminho de PACIENTE ADULTO e chamou
// Cria Agendamento com nomeResponsavel vazio.
//
// No Simples Dental isso trava de forma silenciosa: preencher a data de
// nascimento de um menor revela a seção "Dados do responsável", "Nome do
// responsável" vira obrigatório, e o "Salvar" simplesmente não conclui --
// sem erro, sem fechar o diálogo. Custou 26 tentativas reais em produção pra
// identificar (ver memória do projeto).
//
// O server.js hoje tem um fallback (deixa a data em branco e gera pendência),
// então a consulta não se perde mais -- mas o certo é a Lumi coletar o
// responsável antes. Dois comportamentos novos no prompt, testados aqui:
//
//   A) CHECAGEM DE IDADE: data de nascimento que dá < 18 anos tem que ser
//      tratada como MENOR mesmo sem nenhum sinal de dependência na conversa.
//      Ou a Lumi pede os dados do responsável, ou confirma a data (suspeita
//      de erro de digitação no ano) -- as duas saídas são aceitáveis; o que
//      NÃO pode é chamar Cria Agendamento com nomeResponsavel vazio.
//   B) CONFIRMAÇÃO ESTRUTURADA: antes de chamar Cria Agendamento, devolver
//      os dados coletados em lista pro paciente conferir, com "não
//      informado" nos campos que faltam (nunca omitir a linha, nunca
//      inventar valor).

// A confirmação estruturada tem que listar os campos um por linha. Não
// exigimos formato exato (é linguagem natural), só que os rótulos dos dados
// principais apareçam na mesma mensagem, em linhas separadas.
function pareceConfirmacaoEstruturada(texto) {
  if (!texto) return false;
  const rotulos = [/nascimento\s*:/i, /cpf\s*:/i, /cep\s*:/i, /e-?mail\s*:/i];
  const encontrados = rotulos.filter((r) => r.test(texto)).length;
  const temVariasLinhas = (texto.match(/\n/g) || []).length >= 3;
  return encontrados >= 3 && temVariasLinhas;
}

// Cenário A: paciente que fala como adulto, sozinha, mas com data de
// nascimento de criança. Reproduz a conversa real da Valentina.
async function cenarioA(n) {
  let falhou = 0;
  for (let i = 1; i <= n; i++) {
    const sessao = criarSessao({ telefonePaciente: `1191${String(i).padStart(7, '0')}` });
    const eventos = [];
    await sessao.enviarMensagemPaciente('Oi, gostaria de marcar uma consulta', (e) => eventos.push(e));
    await sessao.enviarMensagemPaciente('Valentina Freitas de Lima', (e) => eventos.push(e));
    await sessao.enviarMensagemPaciente('Qual o valor e os horários disponíveis?', (e) => eventos.push(e));
    await sessao.enviarMensagemPaciente('Pode ser o primeiro horário disponível', (e) => eventos.push(e));
    // Responde tudo que a variante ADULTO pede -- inclusive a data de
    // nascimento que denuncia os 11 anos.
    await sessao.enviarMensagemPaciente(
      '11/05/2015\n537.135.738-67\n13.339-545, número 186\nyasminkalima@gmail.com',
      (e) => eventos.push(e)
    );

    const criados = sessao.estadoFake._agenda;
    const ultimo = criados[criados.length - 1];
    const textos = eventos.filter((e) => e.tipo === 'resposta_lumi').map((e) => e.texto).join('\n');

    // Falha real = agendou sem responsável. Ainda não ter agendado (porque
    // pediu os dados do responsável ou pediu confirmação da data) é o
    // comportamento CERTO.
    let ok;
    let detalhe;
    if (!ultimo) {
      const pediuResponsavel = /respons[áa]vel/i.test(textos);
      const confirmouData = /(confirmando|conferindo|s[óo] pra confirmar).{0,80}(nascimento|data)|nascimento.{0,40}(est[áa] corret|mesmo\?)/is.test(textos);
      ok = pediuResponsavel || confirmouData;
      detalhe = ok
        ? pediuResponsavel ? 'não agendou e pediu dados do responsável' : 'não agendou e pediu confirmação da data'
        : `não agendou, mas também não pediu responsável nem confirmou a data: ${JSON.stringify(textos.slice(-400))}`;
    } else {
      ok = !!ultimo.cadastro.nomeResponsavel;
      detalhe = `agendou com nomeResponsavel=${JSON.stringify(ultimo.cadastro.nomeResponsavel)} dataNascimentoPaciente=${JSON.stringify(ultimo.cadastro.dataNascimentoPaciente)}`;
    }

    console.log(`  [A.${i}] ${ok ? 'ok' : 'FALHA'} -- ${detalhe}`);
    if (!ok) falhou++;
  }
  console.log(`\nCenário A (menor "disfarçado de adulto" pela data de nascimento -- nunca agendar sem responsável): ${falhou}/${n} falhas`);
  return falhou;
}

// Cenário B: paciente adulta normal, com um campo faltando de propósito
// (e-mail). A confirmação estruturada tem que aparecer antes da tool, e o
// campo que falta tem que aparecer como "não informado" -- não sumir da
// lista nem ser inventado.
async function cenarioB(n) {
  let falhou = 0;
  for (let i = 1; i <= n; i++) {
    const sessao = criarSessao({ telefonePaciente: `1192${String(i).padStart(7, '0')}` });
    const eventos = [];
    await sessao.enviarMensagemPaciente('Oi, quero marcar uma consulta', (e) => eventos.push(e));
    await sessao.enviarMensagemPaciente('Maria Silva Santos', (e) => eventos.push(e));
    await sessao.enviarMensagemPaciente('Qual o valor e os horários disponíveis?', (e) => eventos.push(e));
    await sessao.enviarMensagemPaciente('Pode ser o primeiro horário disponível', (e) => eventos.push(e));
    await sessao.enviarMensagemPaciente(
      // Sem e-mail de propósito -- e avisando que não quer informar, pra não
      // ficar preso no BLOQUEIO OBRIGATÓRIO de dado faltando.
      '12/03/1988\n123.456.789-00\n13.339-545, número 186\nnão tenho e-mail, prefiro não informar',
      (e) => eventos.push(e)
    );

    const respostas = eventos.filter((e) => e.tipo === 'resposta_lumi').map((e) => e.texto);
    const confirmacao = respostas.find(pareceConfirmacaoEstruturada);
    const temNaoInformado = !!confirmacao && /n[ãa]o informado/i.test(confirmacao);
    const ok = !!confirmacao && temNaoInformado;

    console.log(
      `  [B.${i}] ${ok ? 'ok' : 'FALHA'} -- confirmação estruturada: ${confirmacao ? 'sim' : 'NÃO'}` +
        (confirmacao ? ` | "não informado" presente: ${temNaoInformado ? 'sim' : 'NÃO'}` : '') +
        (ok ? '' : ` | últimas respostas: ${JSON.stringify(respostas.slice(-2).join(' | ').slice(-500))}`)
    );
    if (!ok) falhou++;
  }
  console.log(`\nCenário B (confirmação estruturada com "não informado" no campo que falta): ${falhou}/${n} falhas`);
  return falhou;
}

async function main(n) {
  console.log(`=== Prompt: ${process.env.LUMI_SYSTEM_PROMPT_PATH || '(padrão, system-prompt.txt)'} | provider: ${process.env.LUMI_PROVIDER || 'mistral'} ===\n`);
  console.log('--- Cenário A: data de nascimento denuncia menor de idade ---');
  const a = await cenarioA(n);
  console.log('\n--- Cenário B: confirmação estruturada dos dados ---');
  const b = await cenarioB(n);

  console.log('\n\n=== RESUMO ===');
  console.log(`A) agendou menor sem responsável        : ${a}/${n} ${a === 0 ? 'OK' : 'FALHA'}`);
  console.log(`B) sem confirmação estruturada dos dados: ${b}/${n} ${b === 0 ? 'OK' : 'FALHA'}`);
  process.exit(a === 0 && b === 0 ? 0 : 1);
}

main(Number(process.argv[2] || 3)).catch((e) => {
  console.error(e);
  process.exit(1);
});
