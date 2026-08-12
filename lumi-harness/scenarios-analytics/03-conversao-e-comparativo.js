const horasAtras = (h) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
const diasAtras = (d) => horasAtras(d * 24);

module.exports = {
  nome: 'Taxa de conversão/recorrência em relatorio_geral + comparação com o período anterior',
  dadosFake: {
    eventosAgenda: [
      // Semana atual: 2 agendamentos criados, um de telefone novo (primeira vez)
      // e um de telefone que já tinha agendado antes (recorrente).
      { tipo: 'criado', categoria: 'ortodontia', telefone: '5511900000001', criado_em: diasAtras(1) },
      { tipo: 'criado', categoria: 'limpeza_prevencao', telefone: '5511900000002', criado_em: diasAtras(2) },
      // Agendamento anterior do telefone 002, fora da janela atual -- é o que torna o de cima "recorrente".
      { tipo: 'criado', categoria: 'primeira_consulta', telefone: '5511900000002', criado_em: diasAtras(40) },
      // Semana anterior (8-14 dias atrás): pra alimentar comparar_periodos.
      { tipo: 'criado', categoria: 'hof', telefone: '5511900000003', criado_em: diasAtras(10) },
      { tipo: 'confirmado', categoria: null, criado_em: diasAtras(9) },
      { tipo: 'cancelado', categoria: null, criado_em: diasAtras(11) },
    ],
    clientes: [
      { created_at: diasAtras(1) }, // contato novo essa semana
      { created_at: diasAtras(9) }, // contato novo semana anterior
    ],
    mensagens: [],
    agentActions: [],
  },
  mensagens: [
    'qual a taxa de conversão de contato pra agendamento essa semana?',
    'e comparado com a semana anterior, melhorou?',
  ],
};
