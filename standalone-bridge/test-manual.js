// Teste de ponta a ponta contra um Postgres REAL (precisa de DATABASE_URL
// em .env) -- diferente de um selfcheck offline, este grava e apaga dado
// de verdade, sempre com telefone/nome claramente marcados como teste e
// limpeza automática (mesmo em caso de falha). Uso: node test-manual.js
require('dotenv').config();
const consultas = require('./consultas');
const { pool, deveBloquearCancelamentoPorRemarcacao } = require('./db');

// Local-only (sem prefixo 55), igual ao que o n8n sempre manda de verdade
// (a tool extrai .match(/^55(\d+)@/)[1] antes de chamar o bridge).
const TELEFONE_TESTE = '99999990000'; // claramente falso, fácil de identificar/limpar
const NOME_TESTE = 'TESTE STANDALONE -- NAO E PACIENTE REAL';

async function limpar() {
  const jid = '55' + TELEFONE_TESTE.replace(/^55/, '') + '@s.whatsapp.net';
  await pool.query('DELETE FROM public.consultas WHERE telefone = $1', [jid]);
  await pool.query('DELETE FROM public.funil_agendamento WHERE telefone = $1', [jid]);
  await pool.query('DELETE FROM public.eventos_agenda WHERE telefone = $1', [jid]);
  await pool.query('DELETE FROM public.paciente_dependente WHERE responsavel_telefone = $1', [jid]);
  await pool.query('DELETE FROM public.n8n_chat_histories WHERE session_id = $1', [jid]);
}

async function main() {
  console.log('--- limpando qualquer resquício de teste anterior ---');
  await limpar();

  console.log('\n--- 1. verificarDisponibilidade (sem filtro) ---');
  const disp1 = await consultas.verificarDisponibilidade({});
  const primeirosDias = Object.keys(disp1.horarios).slice(0, 3);
  console.log('dias com horário livre (amostra):', primeirosDias);
  console.log('semanasVerificadas:', disp1.semanasVerificadas);
  if (primeirosDias.length === 0) throw new Error('FALHOU: nenhum horário livre encontrado -- configuracao_horarios existe?');

  // Pega o primeiro horário livre pra usar no resto do teste
  const primeiroDia = primeirosDias[0];
  const primeiroHorario = disp1.horarios[primeiroDia].horariosDisponiveis[0];
  console.log('vou usar pro teste:', primeiroDia, primeiroHorario);
  const [dd, mm, yyyy] = primeiroDia.split('/');
  const dataParaCriar = `${dd}/${mm}/${yyyy}`;

  console.log('\n--- 2. criarAgendamento ---');
  const criado = await consultas.criarAgendamento({
    telefone: TELEFONE_TESTE,
    nomePaciente: NOME_TESTE,
    data: dataParaCriar,
    hora: primeiroHorario,
    categoria: 'outro',
    observacao: 'teste automatizado standalone-bridge',
  });
  console.log(JSON.stringify(criado, null, 2));
  if (!criado.sucesso) throw new Error('FALHOU: criarAgendamento não retornou sucesso');
  if (criado.pacienteNovo !== true) throw new Error('FALHOU: pacienteNovo deveria ser true na 1a consulta desse telefone');

  console.log('\n--- 3. verificarDisponibilidade de novo (o horário deve ter sumido) ---');
  const disp2 = await consultas.verificarDisponibilidade({});
  const aindaLivre = (disp2.horarios[primeiroDia]?.horariosDisponiveis || []).includes(primeiroHorario);
  console.log('horário ainda aparece como livre?', aindaLivre);
  if (aindaLivre) throw new Error('FALHOU: horário recém-ocupado ainda aparece como disponível');

  console.log('\n--- 4. criarAgendamento no MESMO horário (deve dar CONFLITO_HORARIO) ---');
  let conflitoDetectado = false;
  try {
    await consultas.criarAgendamento({
      telefone: '5511900001111',
      nomePaciente: 'TESTE STANDALONE -- OUTRO PACIENTE',
      data: dataParaCriar,
      hora: primeiroHorario,
    });
  } catch (erro) {
    conflitoDetectado = String(erro.message).startsWith('CONFLITO_HORARIO');
    console.log('erro esperado:', erro.message);
  }
  await pool.query("DELETE FROM public.consultas WHERE paciente_nome = 'TESTE STANDALONE -- OUTRO PACIENTE'");
  if (!conflitoDetectado) throw new Error('FALHOU: deveria ter bloqueado por conflito de horário');

  console.log('\n--- 5. buscarAgendamentosPaciente ---');
  const busca = await consultas.buscarAgendamentosPaciente({ telefone: TELEFONE_TESTE });
  console.log(JSON.stringify(busca, null, 2));
  if (!busca.encontrado || busca.agendamentos.length !== 1) throw new Error('FALHOU: deveria encontrar exatamente 1 agendamento');
  const idCriado = busca.agendamentos[0].id;
  console.log('jaOcorreu (deve ser false, é no futuro):', busca.agendamentos[0].jaOcorreu);
  if (busca.agendamentos[0].jaOcorreu !== false) throw new Error('FALHOU: jaOcorreu deveria ser false pra consulta futura');

  console.log('\n--- 6. mudarStatusAgendamento (confirmar) ---');
  const confirmado = await consultas.mudarStatusAgendamento({ id: idCriado, status: 'Confirmada', telefone: TELEFONE_TESTE });
  console.log(JSON.stringify(confirmado, null, 2));
  if (confirmado.status !== 'Confirmada') throw new Error('FALHOU: status não ficou Confirmada');

  console.log('\n--- 7. deveBloquearCancelamentoPorRemarcacao (paciente diz "quero remarcar", sem funil ativo) ---');
  await pool.query(
    `INSERT INTO n8n_chat_histories (session_id, message) VALUES ($1, jsonb_build_object('type','human','content','quero remarcar minha consulta pra outro dia'))`,
    ['55' + TELEFONE_TESTE.replace(/^55/, '') + '@s.whatsapp.net']
  );
  const deveBloquear = await deveBloquearCancelamentoPorRemarcacao(TELEFONE_TESTE);
  console.log('deve bloquear cancelamento?', deveBloquear);
  if (deveBloquear !== true) throw new Error('FALHOU: deveria bloquear (linguagem de remarcação, sem pedido explícito de cancelar)');

  console.log('\n--- 8. remarcarAgendamento ---');
  // Pega outro horário livre pra remarcar
  const disp3 = await consultas.verificarDisponibilidade({});
  const outroDia = Object.keys(disp3.horarios).find((d) => d !== primeiroDia);
  const outroHorario = disp3.horarios[outroDia].horariosDisponiveis[0];
  const [dd2, mm2, yyyy2] = outroDia.split('/');
  const remarcado = await consultas.remarcarAgendamento({
    id: idCriado,
    data: `${dd2}/${mm2}/${yyyy2}`,
    hora: outroHorario,
    telefone: TELEFONE_TESTE,
  });
  console.log(JSON.stringify(remarcado, null, 2));
  if (!remarcado.sucesso) throw new Error('FALHOU: remarcarAgendamento não retornou sucesso');

  console.log('\n--- 9. mudarStatusAgendamento (cancelar, motivo profissional -- não deve ser bloqueado) ---');
  const cancelado = await consultas.mudarStatusAgendamento({ id: idCriado, status: 'Cancelada pelo profissional', telefone: TELEFONE_TESTE });
  console.log(JSON.stringify(cancelado, null, 2));

  console.log('\n--- 10. buscarAgendamentosPaciente com nomePaciente errado (não deve achar) ---');
  const buscaErrada = await consultas.buscarAgendamentosPaciente({ telefone: TELEFONE_TESTE, nomePaciente: 'Fulano Que Nao Existe' });
  console.log('encontrado (deve ser false):', buscaErrada.encontrado);
  if (buscaErrada.encontrado !== false) throw new Error('FALHOU: não deveria encontrar com nome errado');

  console.log('\n=== TODOS OS TESTES PASSARAM ===');
}

main()
  .then(async () => {
    console.log('\n--- limpando dado de teste ---');
    await limpar();
    await pool.end();
  })
  .catch(async (erro) => {
    console.error('\n!!! TESTE FALHOU:', erro.message);
    console.error(erro.stack);
    console.log('--- limpando dado de teste mesmo assim ---');
    await limpar().catch(() => {});
    await pool.end();
    process.exit(1);
  });
