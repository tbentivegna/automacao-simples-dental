const horasAtras = (h) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

module.exports = {
  nome: 'Pergunta sem janela de tempo (deve perguntar) + pedido de lista de pendências',
  dadosFake: {
    eventosAgenda: [{ tipo: 'criado', categoria: 'ortodontia', criado_em: horasAtras(3) }],
    clientes: [],
    mensagens: [],
    agentActions: [
      { resolved_at: null, created_at: horasAtras(50), action: 'OUTROS', domain: 'Geral', detail: 'URGÊNCIA/DOR: paciente com dor forte' },
      { resolved_at: null, created_at: horasAtras(10), action: 'DUVIDA_PROCEDIMENTO', domain: 'HOF', detail: 'Quer saber valor de botox' },
    ],
  },
  mensagens: ['quantos agendamentos temos?', 'ah desculpa, essa semana', 'me manda a lista de pendências em aberto'],
};
