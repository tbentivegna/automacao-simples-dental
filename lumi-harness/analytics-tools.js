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
        'Retorna um resumo com todas as métricas principais para uma janela de tempo: agendamentos criados/confirmados/cancelados/remarcados (total e por categoria), novos pacientes, mensagens trocadas com a Lumi, um resumo de pendências (total em aberto, abertas na janela, e quantas são urgência/dor), a taxa de conversão de contato novo em agendamento criado nessa janela, e quantos dos agendamentos criados são de paciente na primeira vez vs. recorrente. Use esta ferramenta pra qualquer pergunta sobre números/estatísticas de um único período -- ela já traz tudo de uma vez, não precisa chamar de novo pra cada métrica separada. Pra comparar dois períodos (crescimento/queda), use comparar_periodos em vez desta.',
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
  {
    type: 'function',
    function: {
      name: 'comparar_periodos',
      description:
        'Compara o período atual contra o período imediatamente anterior de mesmo tamanho (últimos 7 dias vs. os 7 anteriores, ou últimos 30 dias vs. os 30 anteriores) -- agendamentos criados/confirmados/cancelados/remarcados e novos contatos nos dois períodos, lado a lado. Use quando perguntarem se algo cresceu, caiu, "tá melhor ou pior", ou pedirem uma visão de tendência. Não use pra um número isolado de um único período -- aí é relatorio_geral. Retorna os números brutos dos dois períodos; a variação percentual deve ser calculada por quem apresenta a resposta em cima desses números reais.',
      parameters: {
        type: 'object',
        properties: {
          periodo: {
            type: 'string',
            enum: ['semana', 'mes'],
            description:
              'Tamanho do período a comparar. "semana" = últimos 7 dias vs. 7 dias anteriores. "mes" = últimos 30 dias vs. 30 dias anteriores. Se não ficar claro qual dos dois, pergunte antes de assumir.',
          },
        },
        required: ['periodo'],
      },
    },
  },
];

module.exports = { tools };
