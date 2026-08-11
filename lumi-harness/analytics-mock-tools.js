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

    return {
      janela,
      agendamentos: {
        criados: porTipo.criado || 0,
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

  return { handlers: { relatorio_geral, listar_pendencias } };
}

module.exports = { criarEstadoAnalyticsFake };
