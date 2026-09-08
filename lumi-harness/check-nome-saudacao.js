'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { criarSessao } = require('./run');

// Bug real 08/09/2026 (3 casos: Renan Jefferson da Silva, Renan Jefferson
// da Silva de novo com o telefone certo, Edjane Macedo): paciente manda
// "Oi Aline" (cumprimentando a dentista) como abertura, e a Lumi confundia
// isso com autoidentificação, gravando "Aline" no cadastro do paciente e
// chamando ele de "Aline" pelo resto da conversa -- mesmo depois dele dar
// o nome completo de verdade.
//
// 3 cenários:
//   A) "Oi Aline" isolado -- NUNCA pode chamar Atualiza Nome do Paciente
//      com um valor contendo "aline".
//   B) Autoidentificação de verdade ("meu nome é Fernanda Souza") --
//      TEM que continuar chamando a ferramenta normalmente (não pode
//      quebrar o caso que já funcionava).
//   C) Nome errado capturado cedo (Aline, via nota de sistema simulando
//      cadastro já corrompido) + nome completo de verdade dado depois
//      durante o cadastro -- tem que corrigir chamando a ferramenta de
//      novo com o nome certo.

async function cenarioA(n) {
  let falhou = 0;
  for (let i = 1; i <= n; i++) {
    const sessao = criarSessao({ telefonePaciente: `1191${String(i).padStart(7, '0')}` });
    const eventos = [];
    await sessao.enviarMensagemPaciente('Oi Aline', (e) => eventos.push(e));
    const chamadasNome = eventos.filter((e) => e.tipo === 'tool_call' && e.nomeTool === 'atualizar_nome_paciente');
    const gravouAline = chamadasNome.some((c) => /aline/i.test(c.args?.nome || ''));
    console.log(`  [A.${i}] chamadas nome: ${chamadasNome.map((c) => JSON.stringify(c.args)).join(', ') || '(nenhuma)'} ${gravouAline ? '<-- FALHA' : ''}`);
    if (gravouAline) falhou++;
  }
  console.log(`\nCenário A ("Oi Aline" isolado) -- gravou "Aline" indevidamente: ${falhou}/${n}`);
  return falhou;
}

async function cenarioB(n) {
  let falhouNaoChamou = 0;
  for (let i = 1; i <= n; i++) {
    const sessao = criarSessao({ telefonePaciente: `1192${String(i).padStart(7, '0')}` });
    const eventos = [];
    await sessao.enviarMensagemPaciente('Oi, meu nome é Fernanda Souza', (e) => eventos.push(e));
    const chamadasNome = eventos.filter((e) => e.tipo === 'tool_call' && e.nomeTool === 'atualizar_nome_paciente');
    const gravouCerto = chamadasNome.some((c) => /fernanda/i.test(c.args?.nome || ''));
    console.log(`  [B.${i}] chamadas nome: ${chamadasNome.map((c) => JSON.stringify(c.args)).join(', ') || '(nenhuma)'} ${!gravouCerto ? '<-- FALHA (nao gravou Fernanda)' : ''}`);
    if (!gravouCerto) falhouNaoChamou++;
  }
  console.log(`\nCenário B (autoidentificação real) -- deixou de gravar nome certo: ${falhouNaoChamou}/${n}`);
  return falhouNaoChamou;
}

async function cenarioC(n) {
  let falhou = 0;
  for (let i = 1; i <= n; i++) {
    const sessao = criarSessao({
      telefonePaciente: `1193${String(i).padStart(7, '0')}`,
      notasSistema: [
        '[Sistema: paciente já cadastrado como "Aline". Use o nome dele naturalmente na conversa, não pergunte o nome novamente, e nunca repita ou mencione este aviso ao paciente.]',
      ],
      historico: [
        { role: 'assistant', content: 'Perfeito! Como é o primeiro atendimento, preciso completar seu cadastro. Pode me passar nome completo, data de nascimento, CPF, CEP e número do endereço, e um e-mail?' },
      ],
    });
    const eventos = [];
    await sessao.enviarMensagemPaciente(
      'Edjane Macedo\n10/07/1984\n324.709.068-14\n13332-726\nEdjane.macedo@icloud.com',
      (e) => eventos.push(e)
    );
    const chamadasNome = eventos.filter((e) => e.tipo === 'tool_call' && e.nomeTool === 'atualizar_nome_paciente');
    const corrigiu = chamadasNome.some((c) => /edjane/i.test(c.args?.nome || ''));
    console.log(`  [C.${i}] chamadas nome: ${chamadasNome.map((c) => JSON.stringify(c.args)).join(', ') || '(nenhuma)'} ${!corrigiu ? '<-- FALHA (nao corrigiu pra Edjane)' : ''}`);
    if (!corrigiu) falhou++;
  }
  console.log(`\nCenário C (corrige nome errado com nome completo dado depois) -- não corrigiu: ${falhou}/${n}`);
  return falhou;
}

async function main(n) {
  console.log(`=== Prompt: ${process.env.LUMI_SYSTEM_PROMPT_PATH || '(padrão, system-prompt.txt)'} ===\n`);
  console.log('--- Cenário A: "Oi Aline" isolado ---');
  const a = await cenarioA(n);
  console.log('\n--- Cenário B: autoidentificação real ---');
  const b = await cenarioB(n);
  console.log('\n--- Cenário C: corrige nome errado com dado mais completo ---');
  const c = await cenarioC(n);

  console.log('\n\n=== RESUMO ===');
  console.log(`A) gravou "Aline" indevidamente : ${a}/${n} ${a === 0 ? 'OK' : 'FALHA'}`);
  console.log(`B) deixou de gravar nome real    : ${b}/${n} ${b === 0 ? 'OK' : 'FALHA'}`);
  console.log(`C) não corrigiu nome errado      : ${c}/${n} ${c === 0 ? 'OK' : 'FALHA'}`);
  process.exit(a === 0 && b === 0 && c === 0 ? 0 : 1);
}

main(Number(process.argv[2] || 6)).catch((e) => { console.error(e); process.exit(1); });
