'use strict';

// Mock das tools de analytics -- estado fake em memória (eventos_agenda,
// clientes, mensagens, agent_actions), pra testar se o Analytics Agent
// interpreta corretamente a janela de tempo e escolhe a tool certa.

function cortesPorJanela(agora = new Date()) {
  const meiaNoite = new Date(agora);
  meiaNoite.setHours(0, 0, 0, 0);

  return {
    hoje: meiaNoite,
    ultimas_24h: new Date(agora.getTime() - 24 * 60 * 60 * 1000),
    ultima_semana: new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000),
    ultimo_mes: new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000),
    tudo: new Date(0),
  };
}

function criarEstadoAnalyticsFake({
  eventosAgenda = [],
  clientes = [],
  mensagens = [],
  agentActions = [],
} = {}) {
  function relatorio_geral({ janela } = {}) {
    if (!janela) throw new Error('Parâmetro obrigatório faltando: janela.');
    const cortes = cortesPorJanela();
    if (!(janela in cortes)) throw new Error(`Janela inválida: "${janela}"`);
    const desde = cortes[janela];

    const eventosNaJanela = eventosAgenda.filter((e) => new Date(e.criado_em) >= desde);

    const porTipo = {};
    for (const e of eventosNaJanela) {
      porTipo[e.tipo] = (porTipo[e.tipo] || 0) + 1;
    }

    const porCategoria = {};
    for (const e of eventosNaJanela.filter((e) => e.tipo === 'criado')) {
      const cat = e.categoria || 'outro';
      porCategoria[cat] = (porCategoria[cat] || 0) + 1;
    }

    const novosPacientes = clientes.filter((c) => new Date(c.created_at) >= desde).length;
    const mensagensTrocadas = mensagens.filter((m) => new Date(m.created_at) >= desde).length;

    const pendenciasAbertas = agentActions.filter((a) => !a.resolved_at);
    const pendenciasAbertasNaJanela = pendenciasAbertas.filter((a) => new Date(a.created_at) >= desde);
    const pendenciasUrgentes = pendenciasAbertas.filter((a) => (a.detail || '').startsWith('URGÊNCIA'));

    const agendamentosCriados = porTipo.criado || 0;
    const taxaConversaoPct =
      novosPacientes === 0 ? null : Math.round(((agendamentosCriados / novosPacientes) * 100 + Number.EPSILON) * 10) / 10;

    // Recorrência: pra cada agendamento 'criado' na janela, verifica se o
    // mesmo telefone já tinha um 'criado' anterior (em toda a base, não só
    // na janela) -- eventos sem telefone (fixtures antigas) são ignorados,
    // igual ao filtro `telefone IS NOT NULL` da query real.
    const criadosNaJanelaComTelefone = eventosNaJanela.filter((e) => e.tipo === 'criado' && e.telefone);
    let agendamentosPrimeiraVez = 0;
    let agendamentosRecorrentes = 0;
    for (const evento of criadosNaJanelaComTelefone) {
      const teveAntes = eventosAgenda.some(
        (e) => e.tipo === 'criado' && e.telefone === evento.telefone && new Date(e.criado_em) < new Date(evento.criado_em)
      );
      if (teveAntes) agendamentosRecorrentes += 1;
      else agendamentosPrimeiraVez += 1;
    }

    return {
      janela,
      agendamentos: {
        criados: agendamentosCriados,
        confirmados: porTipo.confirmado || 0,
        cancelados: porTipo.cancelado || 0,
        remarcados: porTipo.remarcado || 0,
        porCategoria,
      },
      novosPacientes,
      mensagensTrocadas,
      pendencias: {
        totalEmAberto: pendenciasAbertas.length,
        abertasNaJanela: pendenciasAbertasNaJanela.length,
        urgentesEmAberto: pendenciasUrgentes.length,
      },
      conversao: {
        contatosNovos: novosPacientes,
        agendamentosCriados,
        taxaConversaoPct,
      },
      agendamentosPorRecorrencia: {
        primeiraVez: agendamentosPrimeiraVez,
        recorrentes: agendamentosRecorrentes,
      },
    };
  }

  function comparar_periodos({ periodo } = {}) {
    if (!periodo) throw new Error('Parâmetro obrigatório faltando: periodo.');
    if (periodo !== 'semana' && periodo !== 'mes') throw new Error(`Periodo inválido: "${periodo}"`);

    const agora = new Date();
    const dias = periodo === 'mes' ? 30 : 7;
    const msPorDia = 24 * 60 * 60 * 1000;
    const atualDesde = new Date(agora.getTime() - dias * msPorDia);
    const anteriorDesde = new Date(agora.getTime() - dias * 2 * msPorDia);
    const anteriorAte = atualDesde;

    function contarAgendamentos(desde, ate) {
      const naJanela = eventosAgenda.filter((e) => {
        const t = new Date(e.criado_em);
        return t >= desde && t < ate;
      });
      const porTipo = {};
      for (const e of naJanela) porTipo[e.tipo] = (porTipo[e.tipo] || 0) + 1;
      return {
        criados: porTipo.criado || 0,
        confirmados: porTipo.confirmado || 0,
        cancelados: porTipo.cancelado || 0,
        remarcados: porTipo.remarcado || 0,
      };
    }

    function contarContatos(desde, ate) {
      return clientes.filter((c) => {
        const t = new Date(c.created_at);
        return t >= desde && t < ate;
      }).length;
    }

    return {
      diasPorPeriodo: dias,
      agendamentosPeriodoAtual: contarAgendamentos(atualDesde, agora),
      agendamentosPeriodoAnterior: contarAgendamentos(anteriorDesde, anteriorAte),
      novosContatosPeriodoAtual: contarContatos(atualDesde, agora),
      novosContatosPeriodoAnterior: contarContatos(anteriorDesde, anteriorAte),
    };
  }

  function listar_pendencias({ apenasUrgentes } = {}) {
    let abertas = agentActions.filter((a) => !a.resolved_at);
    if (apenasUrgentes) abertas = abertas.filter((a) => (a.detail || '').startsWith('URGÊNCIA'));

    abertas.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    return {
      total: abertas.length,
      pendencias: abertas.map((a) => ({
        action: a.action,
        domain: a.domain,
        detail: a.detail,
        criadoEm: a.created_at,
      })),
    };
  }

  return { handlers: { relatorio_geral, listar_pendencias, comparar_periodos } };
}

module.exports = { criarEstadoAnalyticsFake };
