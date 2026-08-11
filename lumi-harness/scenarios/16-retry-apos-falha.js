module.exports = {
  nome: 'Reprodução real: paciente pede pra tentar agendar de novo após falha',
  descricao:
    'Primeira tentativa de Cria Agendamento falha de verdade (timeout simulado). Paciente pergunta se ficou agendado, Lumi não encontra, e paciente pede explicitamente pra tentar de novo. Testa se ela tenta de novo ou foge pro agent_action mesmo com pedido explícito e todas as informações já em mãos.',
  telefonePaciente: '11900003333',
  falharProximaCriacao: true,
  mensagens: [
    'oi, quero marcar uma consulta de HOF',
    'Tiago Bentivegna',
    'pode ser quarta de manhã',
    'pode ser 19/08 às 10h',
    'pode agendar sim',
    'consegue confirmar se minha consulta está ou não agendada por favor?',
    'ao invés de aguardar, vamos tentar agendar novamente por favor? mesmo dia e horário',
  ],
};
