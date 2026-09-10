'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { criarSessao } = require('./run');

// Fase 2 do Plano_Multi_Profissional.md -- prompt + tools multi-profissional.
// Este arquivo roda contra o PROMPT PADRÃO (system-prompt.txt = Dra. Aline,
// clínica de UM profissional). Objetivo: garantir que o módulo novo é
// INERTE numa clínica de um profissional só.
//   A) sem profissionais seedados (lista_profissionais devolve []) -- a Lumi
//      NUNCA pode perguntar "com qual profissional?".
//   B) com profissionalNome preenchido no resultado de Busca Agendamentos,
//      a Lumi cita o nome do profissional ao falar da consulta.
// O roteamento por especialidade (clínica com vários) é testado à parte, em
// check-multiprofissional-roteamento.js, contra um prompt de clínica
// multi-profissional de verdade.

const REGEX_PERGUNTOU_QUAL_PROF =
  /\bcom qual (profissional|dentista|doutor|doutora|dr|dra)\b|\bqual (dos )?(profissionai|dentista|doutor)|prefere (o |a )?(dr|dra)\.? ?\w|com quem (você |vc )?(prefere|gostaria|quer)/i;

async function cenarioA(n) {
  let falhou = 0;
  for (let i = 1; i <= n; i++) {
    const sessao = criarSessao({ telefonePaciente: `1194${String(i).padStart(7, '0')}`, seedProfissionais: [] });
    const eventos = [];
    await sessao.enviarMensagemPaciente('Oi! Queria marcar uma consulta de rotina, uma limpeza', (e) => eventos.push(e));
    const textos = eventos.filter((e) => e.tipo === 'resposta_lumi').map((e) => e.texto).join('\n');
    const perguntouQual = REGEX_PERGUNTOU_QUAL_PROF.test(textos);
    console.log(`  [A.${i}] ${perguntouQual ? 'FALHA -- perguntou com qual profissional: ' + JSON.stringify(textos.slice(0, 160)) : 'ok'}`);
    if (perguntouQual) falhou++;
  }
  console.log(`\nCenário A (1 profissional -- não pode perguntar "com qual"): ${falhou}/${n} falhas`);
  return falhou;
}

async function cenarioB(n) {
  let falhou = 0;
  for (let i = 1; i <= n; i++) {
    const sessao = criarSessao({
      telefonePaciente: `1195${String(i).padStart(7, '0')}`,
      seedProfissionais: [{ id: 'p-aline', nome: 'Dra. Aline Bentivegna', especialidades: ['Ortodontia'], padrao: true }],
      seedAgendamentos: [
        { nomePaciente: 'Marina Alves', data: proximaData(), hora: '14:30', status: 'Agendada', profissionalNome: 'Dra. Aline Bentivegna' },
      ],
      historico: [{ role: 'assistant', content: 'Oi, Marina! Como posso te ajudar?' }],
    });
    const eventos = [];
    await sessao.enviarMensagemPaciente('tenho consulta marcada?', (e) => eventos.push(e));
    const textos = eventos.filter((e) => e.tipo === 'resposta_lumi').map((e) => e.texto).join('\n');
    const citouProfissional = /aline/i.test(textos);
    console.log(`  [B.${i}] ${citouProfissional ? 'ok -- citou a profissional' : 'FALHA -- não citou o nome: ' + JSON.stringify(textos.slice(0, 200))}`);
    if (!citouProfissional) falhou++;
  }
  console.log(`\nCenário B (cita profissionalNome ao ler a consulta): ${falhou}/${n} falhas`);
  return falhou;
}

function proximaData() {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

async function main(n) {
  console.log(`=== Prompt: ${process.env.LUMI_SYSTEM_PROMPT_PATH || '(padrão, system-prompt.txt)'} ===\n`);
  console.log('--- Cenário A: clínica de 1 profissional (regressão) ---');
  const a = await cenarioA(n);
  console.log('\n--- Cenário B: cita o nome do profissional ---');
  const b = await cenarioB(n);

  console.log('\n\n=== RESUMO ===');
  console.log(`A) perguntou "com qual" com 1 prof : ${a}/${n} ${a === 0 ? 'OK' : 'FALHA'}`);
  console.log(`B) não citou o profissional        : ${b}/${n} ${b === 0 ? 'OK' : 'FALHA'}`);
  process.exit(a === 0 && b === 0 ? 0 : 1);
}

main(Number(process.argv[2] || 3)).catch((e) => { console.error(e); process.exit(1); });
