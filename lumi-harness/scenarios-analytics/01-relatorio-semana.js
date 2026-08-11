const horasAtras = (h) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
const diasAtras = (d) => horasAtras(d * 24);

module.exports = {
  nome: 'Relatório da última semana + pergunta específica de pendências urgentes',
  dadosFake: {
    eventosAgenda: [
      { tipo: 'criado', categoria: 'ortodontia', criado_em: horasAtras(3) },
      { tipo: 'criado', categoria: 'ortodontia', criado_em: diasAtras(2) },
      { tipo: 'criado', categoria: 'hof', criado_em: diasAtras(4) },
      { tipo: 'criado', categoria: 'primeira_consulta', criado_em: diasAtras(6) },
      { tipo: 'criado', categoria: 'limpeza_prevencao', criado_em: diasAtras(15) }, // fora da semana
      { tipo: 'confirmado', categoria: null, criado_em: horasAtras(5) },
      { tipo: 'confirmado', categoria: null, criado_em: diasAtras(3) },
      { tipo: 'cancelado', categoria: null, criado_em: diasAtras(1) },
      { tipo: 'remarcado', categoria: null, criado_em: diasAtras(2) },
    ],
    clientes: [
      { created_at: horasAtras(10) },
      { created_at: diasAtras(3) },
      { created_at: diasAtras(20) }, // fora da semana
    ],
    mensagens: Array.from({ length: 40 }, (_, i) => ({ created_at: diasAtras(i % 10) })),
    agentActions: [
      { resolved_at: null, created_at: horasAtras(2), action: 'OUTROS', domain: 'Geral', detail: 'URGÊNCIA/DOR: paciente com dor forte' },
      { resolved_at: null, created_at: diasAtras(1), action: 'DUVIDA_PROCEDIMENTO', domain: 'HOF', detail: 'Quer saber valor de botox' },
      { resolved_at: diasAtras(5), created_at: diasAtras(6), action: 'AGENDAR_CONSULTA', domain: 'Agenda', detail: 'Falha ao criar, já resolvido' },
    ],
  },
  mensagens: ['oi, me manda um relatório da última semana', 'e tem alguma pendência urgente?'],
};
