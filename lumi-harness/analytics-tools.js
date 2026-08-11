'use strict';

// Tools do Analytics Agent -- consulta pura no Postgres, nada de Simples
// Dental/Playwright. Espelham o que o node de Postgres Tool no n8n deve
// expor (ver db/analytics-queries.sql pro SQL real).

const tools = [
  {
    type: 'function',
    function: {
      name: 'relatorio_geral',
      description:
        'Retorna um resumo com todas as métricas principais para uma janela de tempo: agendamentos criados/confirmados/cancelados/remarcados (total e por categoria), novos pacientes, mensagens trocadas com a Lumi, e um resumo de pendências (total em aberto, abertas na janela, e quantas são urgência/dor). Use esta ferramenta pra qualquer pergunta sobre números/estatísticas -- ela já traz tudo de uma vez, não precisa chamar de novo pra cada métrica separada.',
      parameters: {
        type: 'object',
        properties: {
          janela: {
            type: 'string',
            enum: ['hoje', 'ultimas_24h', 'ultima_semana', 'ultimo_mes', 'tudo'],
            description:
              'Período do relatório. "hoje" = desde meia-noite de hoje. "ultimas_24h" = últimas 24 horas corridas. "ultima_semana" = últimos 7 dias. "ultimo_mes" = últimos 30 dias. "tudo" = sem filtro de data, desde o início. Escolha com base no que o número master pediu ("hoje", "essa semana", "esse mês", "no total" etc.) -- se não ficar claro, pergunte antes de assumir.',
          },
        },
        required: ['janela'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_pendencias',
      description:
        'Retorna a LISTA (não só a contagem) de pendências em aberto (agent_actions ainda não resolvidas) -- use quando o número master pedir pra ver quais são as pendências, não só quantas existem. Sempre ordenado da mais antiga pra mais recente.',
      parameters: {
        type: 'object',
        properties: {
          apenasUrgentes: {
            type: 'boolean',
            description: 'true para listar só as pendências de urgência/dor. Deixe de fora ou false para listar todas.',
          },
        },
      },
    },
  },
];

module.exports = { tools };
