'use strict';

// ============================================================
// Util
// ============================================================

function escapar(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

// Nome oficial (confirmado pela Lumi) tem prioridade; sem ele, cai pro
// apelido do perfil do WhatsApp (auto-declarado, só pra identificação --
// nunca usado como nome oficial em nenhum outro lugar do sistema).
function nomeExibicao(nome, apelidoWhatsapp, textoVazio) {
  if (nome) return `<div class="nome-paciente">${escapar(nome)}</div>`;
  if (apelidoWhatsapp) {
    return `<div class="nome-paciente nome-paciente--apelido">${escapar(apelidoWhatsapp)}</div><div class="texto-fraco">perfil do WhatsApp, não confirmado</div>`;
  }
  return `<div class="nome-paciente">${escapar(textoVazio)}</div>`;
}

function formatarNumero(valor) {
  return new Intl.NumberFormat('pt-BR').format(Number(valor) || 0);
}

function formatarHoras(horas) {
  const h = Number(horas);
  if (!Number.isFinite(h) || h < 0) return '—';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 24) return `${h.toFixed(1).replace('.0', '')} h`;
  return `${Math.floor(h / 24)} d ${Math.round(h % 24)} h`;
}

const CATEGORIAS_LEGIVEIS = {
  primeira_consulta: 'Primeira Consulta',
  ortodontia: 'Ortodontia',
  odontopediatria: 'Odontopediatria',
  hof: 'HOF',
  clareamento: 'Clareamento',
  limpeza_prevencao: 'Profilaxia/Limpeza',
  consulta_estetica: 'Consulta Estética',
  dor_urgencia: 'Dor/Urgência',
  outro: 'Outro',
};

// Nome da tool como a Lumi chama internamente (n8n troca espaço por "_")
// -> rótulo legível pro preview de conversa. Cai pro nome bruto (com "_"
// virando espaço) se aparecer uma tool nova que ainda não está no mapa.
const TOOLS_LEGIVEIS = {
  Verifica_Disponibilidade: 'Verifica Disponibilidade',
  Cria_Agendamento: 'Cria Agendamento',
  Busca_Agendamentos_Paciente: 'Busca Agendamentos do Paciente',
  Confirmar_Agendamento: 'Confirma Agendamento',
  Cancelar_Agendamento: 'Cancela Agendamento',
  Remarcar_Agendamento: 'Remarca Agendamento',
  Registrar_Consentimento_Lembrete: 'Registra Consentimento de Lembrete',
  Atualiza_Nome_do_Paciente: 'Atualiza Nome do Paciente',
};

function nomeLegivelTool(nomeTool) {
  return TOOLS_LEGIVEIS[nomeTool] || nomeTool.replace(/_/g, ' ');
}

async function chamarApi(caminho, opcoes) {
  const resposta = await fetch(caminho, opcoes);
  if (resposta.status === 401) {
    window.location.href = '/login';
    throw new Error('sessão expirada');
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new Error(dados.erro || `Falha em ${caminho}`);
  }
  return dados;
}

function elementoErro(mensagem) {
  return `<div class="estado-vazio"><span class="estado-vazio__emoji">⚠️</span>${escapar(mensagem)}</div>`;
}

// ============================================================
// Navegação entre seções
// ============================================================

// Recarrega sempre que a seção é aberta -- as queries são leves (contagens
// indexadas) e isso garante que a secretária sempre vê dado fresco, sem
// precisar dar F5 depois de resolver algo em outra aba.
const secoes = {
  'visao-geral': carregarAnalytics,
  'atendimento-humano': carregarSuspensos,
  pendencias: carregarPendencias,
  oportunidades: carregarOportunidades,
  pacientes: () => carregarPacientes(document.getElementById('buscaPacientes').value, 1),
  agenda: () => mostrarAgenda(semanaAtualAgenda),
  mensagens: () => carregarConversas(document.getElementById('buscaConversas').value),
  analytics: carregarPaginaAnalytics,
  configuracoes: () => {
    carregarConfiguracaoHorarios();
    carregarLicoesAprendidas();
  },
};

document.querySelectorAll('.nav__item[data-secao]').forEach((botao) => {
  botao.addEventListener('click', () => irParaSecao(botao.dataset.secao));
});

// Menu hambúrguer (mobile): abre a barra lateral escondida, fecha sozinho
// depois que uma seção é escolhida -- em desktop essa classe não faz nada
// (o CSS só reage a ela dentro do media query mobile).
const barraLateral = document.getElementById('barraLateral');
const botaoMenu = document.getElementById('botaoMenu');
if (botaoMenu && barraLateral) {
  botaoMenu.addEventListener('click', () => {
    const aberto = barraLateral.classList.toggle('menu-aberto');
    botaoMenu.setAttribute('aria-expanded', String(aberto));
  });
}

function fecharMenuMobile() {
  if (barraLateral) barraLateral.classList.remove('menu-aberto');
  if (botaoMenu) botaoMenu.setAttribute('aria-expanded', 'false');
}

function irParaSecao(nome) {
  fecharMenuMobile();
  document.querySelectorAll('.nav__item[data-secao]').forEach((b) => {
    b.classList.toggle('ativo', b.dataset.secao === nome);
  });
  document.querySelectorAll('.secao').forEach((s) => {
    s.classList.toggle('ativa', s.id === `secao-${nome}`);
  });
  const carregar = secoes[nome];
  if (carregar) carregar();
}

// ============================================================
// Visão Geral (analytics)
// ============================================================

let janelaAtual = 'hoje';

document.getElementById('seletorJanela').addEventListener('click', (evento) => {
  const botao = evento.target.closest('button[data-janela]');
  if (!botao) return;
  janelaAtual = botao.dataset.janela;
  document.querySelectorAll('#seletorJanela button').forEach((b) => b.classList.toggle('ativo', b === botao));
  carregarAnalytics();
});

async function carregarAnalytics() {
  const alvo = document.getElementById('conteudoAnalytics');
  try {
    const d = await chamarApi(`/api/analytics?janela=${encodeURIComponent(janelaAtual)}`);
    const ag = d.agendamentos || {};
    const pend = d.pendencias || {};

    const categorias = (d.por_categoria || [])
      .map((c) => `<span class="selo selo-neutro">${escapar(CATEGORIAS_LEGIVEIS[c.categoria] || c.categoria)} · ${formatarNumero(c.total)}</span>`)
      .join(' ');

    alvo.innerHTML = `
      <div class="grade-cartoes">
        <div class="cartao-stat cartao-stat--clicavel" data-card="criado"><div class="cartao-stat__rotulo">Consultas criadas</div><div class="cartao-stat__valor">${formatarNumero(ag.criados)}</div></div>
        <div class="cartao-stat cartao-stat--clicavel" data-card="confirmado"><div class="cartao-stat__rotulo">Confirmadas</div><div class="cartao-stat__valor">${formatarNumero(ag.confirmados)}</div></div>
        <div class="cartao-stat cartao-stat--clicavel" data-card="cancelado"><div class="cartao-stat__rotulo">Canceladas</div><div class="cartao-stat__valor">${formatarNumero(ag.cancelados)}</div></div>
        <div class="cartao-stat cartao-stat--clicavel" data-card="remarcado"><div class="cartao-stat__rotulo">Remarcadas</div><div class="cartao-stat__valor">${formatarNumero(ag.remarcados)}</div></div>
        <div class="cartao-stat cartao-stat--clicavel" data-card="lembrete_enviado"><div class="cartao-stat__rotulo">Lembretes enviados</div><div class="cartao-stat__valor">${formatarNumero(ag.lembretes_enviados)}</div></div>
        <div class="cartao-stat cartao-stat--clicavel" data-card="novos_pacientes"><div class="cartao-stat__rotulo">Novos pacientes</div><div class="cartao-stat__valor">${formatarNumero(d.novos_pacientes)}</div></div>
        <div class="cartao-stat cartao-stat--clicavel" data-card="mensagens_trocadas"><div class="cartao-stat__rotulo">Mensagens trocadas</div><div class="cartao-stat__valor">${formatarNumero(d.mensagens_trocadas)}</div></div>
        <div class="cartao-stat cartao-stat--clicavel" data-card="pendencias"><div class="cartao-stat__rotulo">Pendências em aberto</div><div class="cartao-stat__valor${Number(pend.urgentes_em_aberto) > 0 ? ' destaque-urgente' : ''}">${formatarNumero(pend.total_em_aberto)}</div></div>
        <div class="cartao-stat cartao-stat--clicavel" data-card="urgencias"><div class="cartao-stat__rotulo">Urgências em aberto</div><div class="cartao-stat__valor${Number(pend.urgentes_em_aberto) > 0 ? ' destaque-urgente' : ''}">${formatarNumero(pend.urgentes_em_aberto)}</div></div>
        <div class="cartao-stat cartao-stat--clicavel" data-card="atendimento_humano"><div class="cartao-stat__rotulo">Com atendimento humano</div><div class="cartao-stat__valor${Number(d.pacientes_com_lumi_suspensa) > 0 ? ' destaque-alerta' : ''}">${formatarNumero(d.pacientes_com_lumi_suspensa)}</div></div>
      </div>
      ${categorias ? `<div class="painel"><div class="painel__cabecalho">Consultas criadas por categoria</div><div style="padding:16px 20px; display:flex; flex-wrap:wrap; gap:8px;">${categorias}</div></div>` : ''}
      <div id="detalheCard" class="detalhe-card" hidden></div>
    `;

    atualizarBadges();

    // Se já tinha um card aberto (troca de janela, ou o refresh automático
    // de 45s), mantém aberto com dado fresco em vez de simplesmente sumir.
    if (cardAberto) {
      const elCard = alvo.querySelector(`[data-card="${cardAberto}"]`);
      if (elCard) elCard.classList.add('cartao-stat--ativo');
      const container = document.getElementById('detalheCard');
      container.hidden = false;
      container.innerHTML = '<div class="carregando">Carregando…</div>';
      renderizarDetalheCard(cardAberto, container).catch((erro) => {
        container.innerHTML = elementoErro(erro.message);
      });
    }
  } catch (erro) {
    alvo.innerHTML = elementoErro(erro.message);
  }
}

// ------------------------------------------------------------
// Drill-down dos cards (clicar num card mostra detalhe embaixo do grid)
// ------------------------------------------------------------

let cardAberto = null;

const TITULOS_CARD = {
  criado: 'Consultas criadas',
  confirmado: 'Consultas confirmadas',
  cancelado: 'Consultas canceladas',
  remarcado: 'Consultas remarcadas',
  lembrete_enviado: 'Lembretes enviados',
  novos_pacientes: 'Novos pacientes',
  mensagens_trocadas: 'Pacientes mais ativos (mensagens)',
  pendencias: 'Pendências em aberto',
  urgencias: 'Urgências em aberto',
  atendimento_humano: 'Com atendimento humano',
};

const TITULOS_SECAO = {
  pacientes: 'Pacientes',
  pendencias: 'Pendências',
  'atendimento-humano': 'Atendimento Humano',
};

function vazioDetalhe(mensagem) {
  return `<div class="estado-vazio"><span class="estado-vazio__emoji">🔎</span>${escapar(mensagem)}</div>`;
}

function envolverDetalhe(titulo, corpoHtml, linkSecao) {
  return `
    <div class="painel__cabecalho detalhe-card__cabecalho">
      <span>${escapar(titulo)}</span>
      <button class="detalhe-card__fechar" data-fechar-detalhe aria-label="Fechar">✕</button>
    </div>
    ${corpoHtml}
    ${linkSecao ? `<div class="detalhe-card__rodape"><button class="botao" data-ir-secao="${linkSecao}">Ver tudo em ${escapar(TITULOS_SECAO[linkSecao] || '')} →</button></div>` : ''}
  `;
}

function renderizarTabelaAgendamentos(lista) {
  if (lista.length === 0) return vazioDetalhe('Nada por aqui nesse período.');
  const linhas = lista
    .map(
      (e) => `
        <tr>
          <td>
            ${nomeExibicao(e.nome, e.apelido_whatsapp, '(paciente não identificado)')}
            ${e.telefone ? `<div class="texto-fraco">${escapar(e.telefone)}</div>` : ''}
          </td>
          <td>${escapar(CATEGORIAS_LEGIVEIS[e.categoria] || e.categoria || '—')}</td>
          <td>${escapar(e.data_consulta_formatada || '—')}${e.hora_consulta ? ` ${escapar(e.hora_consulta)}` : ''}</td>
          <td class="texto-fraco">${escapar(e.criado_em_formatado || '—')}</td>
        </tr>`
    )
    .join('');
  return `<div class="tabela-scroll tabela-scroll--detalhe"><table class="tabela">
    <thead><tr><th>Paciente</th><th>Categoria</th><th>Consulta</th><th>Registrado em</th></tr></thead>
    <tbody>${linhas}</tbody>
  </table></div>`;
}

function renderizarTabelaNovosPacientes(lista) {
  if (lista.length === 0) return vazioDetalhe('Nenhum paciente novo nesse período.');
  const linhas = lista
    .map(
      (p) => `
        <tr>
          <td>${nomeExibicao(p.nome, p.apelido_whatsapp, '(sem nome)')}</td>
          <td>${escapar(p.telefone || '—')}</td>
          <td class="texto-fraco">${escapar(p.criado_em_formatado || '—')}</td>
        </tr>`
    )
    .join('');
  return `<div class="tabela-scroll tabela-scroll--detalhe"><table class="tabela">
    <thead><tr><th>Paciente</th><th>Telefone</th><th>Cadastrado em</th></tr></thead>
    <tbody>${linhas}</tbody>
  </table></div>`;
}

function renderizarTabelaMensagens(lista) {
  if (lista.length === 0) return vazioDetalhe('Nenhuma mensagem trocada nesse período.');
  const linhas = lista
    .map(
      (m) => `
        <tr class="linha-clicavel" data-ir-conversa="${escapar(m.telefone)}" data-ir-conversa-nome="${escapar(m.nome || m.apelido_whatsapp || m.telefone || '')}">
          <td>
            ${nomeExibicao(m.nome, m.apelido_whatsapp, '(sem nome)')}
            <div class="texto-fraco">${escapar(m.telefone || '')}</div>
          </td>
          <td>${formatarNumero(m.total_mensagens)}</td>
          <td class="texto-fraco">${escapar(m.ultima_mensagem_formatada || '—')}</td>
          <td class="texto-fraco">Ver conversa ›</td>
        </tr>`
    )
    .join('');
  return `<div class="tabela-scroll tabela-scroll--detalhe"><table class="tabela">
    <thead><tr><th>Paciente</th><th>Mensagens</th><th>Última mensagem</th><th></th></tr></thead>
    <tbody>${linhas}</tbody>
  </table></div>`;
}

function renderizarPreviewPendencias(lista) {
  if (lista.length === 0) return vazioDetalhe('Nenhuma pendência em aberto.');
  const linhas = lista
    .slice(0, 5)
    .map(
      (p) => `
        <tr>
          <td>${p.urgente ? '<span class="selo selo-urgente">Urgência</span>' : `<span class="selo selo-neutro">${escapar(p.action || '—')}</span>`}</td>
          <td>
            ${nomeExibicao(p.paciente_nome, p.paciente_apelido_whatsapp, '(paciente não identificado)')}
            <div class="texto-fraco">${escapar(p.from_phone || '')}</div>
          </td>
          <td style="max-width:280px;">${escapar(p.detail || '')}</td>
          <td class="texto-fraco">${formatarHoras(p.horas_em_aberto)} atrás</td>
        </tr>`
    )
    .join('');
  return `<div class="tabela-scroll tabela-scroll--detalhe"><table class="tabela">
    <thead><tr><th></th><th>Paciente</th><th>Detalhe</th><th>Aberta há</th></tr></thead>
    <tbody>${linhas}</tbody>
  </table></div>`;
}

function renderizarPreviewSuspensos(lista) {
  if (lista.length === 0) return vazioDetalhe('Nenhum paciente com a Lumi pausada agora.');
  const linhas = lista
    .slice(0, 5)
    .map(
      (p) => `
        <tr>
          <td>
            ${nomeExibicao(p.nome, p.apelido_whatsapp, '(sem nome)')}
            <div class="texto-fraco">${escapar(p.telefone || '')}</div>
          </td>
          <td class="texto-fraco">${formatarHoras(p.horas_desde_handoff)} parado</td>
        </tr>`
    )
    .join('');
  return `<div class="tabela-scroll tabela-scroll--detalhe"><table class="tabela">
    <thead><tr><th>Paciente</th><th>Tempo parado</th></tr></thead>
    <tbody>${linhas}</tbody>
  </table></div>`;
}

const TIPOS_AGENDAMENTO = ['criado', 'confirmado', 'cancelado', 'remarcado', 'lembrete_enviado'];

async function renderizarDetalheCard(tipo, container) {
  const titulo = TITULOS_CARD[tipo] || 'Detalhe';

  if (TIPOS_AGENDAMENTO.includes(tipo)) {
    const lista = await chamarApi(`/api/analytics/agendamentos?tipo=${tipo}&janela=${encodeURIComponent(janelaAtual)}`);
    container.innerHTML = envolverDetalhe(titulo, renderizarTabelaAgendamentos(lista));
    return;
  }
  if (tipo === 'novos_pacientes') {
    const lista = await chamarApi(`/api/analytics/novos-pacientes?janela=${encodeURIComponent(janelaAtual)}`);
    container.innerHTML = envolverDetalhe(titulo, renderizarTabelaNovosPacientes(lista), 'pacientes');
    return;
  }
  if (tipo === 'mensagens_trocadas') {
    const lista = await chamarApi(`/api/analytics/mensagens?janela=${encodeURIComponent(janelaAtual)}`);
    container.innerHTML = envolverDetalhe(titulo, renderizarTabelaMensagens(lista));
    return;
  }
  if (tipo === 'pendencias' || tipo === 'urgencias') {
    const lista = await chamarApi('/api/pendencias');
    const filtrada = tipo === 'urgencias' ? lista.filter((p) => p.urgente) : lista;
    container.innerHTML = envolverDetalhe(titulo, renderizarPreviewPendencias(filtrada), 'pendencias');
    return;
  }
  if (tipo === 'atendimento_humano') {
    const lista = await chamarApi('/api/suspensos');
    container.innerHTML = envolverDetalhe(titulo, renderizarPreviewSuspensos(lista), 'atendimento-humano');
    return;
  }
  container.innerHTML = '';
}

async function alternarDetalheCard(tipo) {
  const container = document.getElementById('detalheCard');
  if (!container) return;
  const cards = document.querySelectorAll('#conteudoAnalytics [data-card]');
  const jaAberto = cardAberto === tipo;

  if (jaAberto) {
    cardAberto = null;
    cards.forEach((c) => c.classList.remove('cartao-stat--ativo'));
    container.hidden = true;
    container.innerHTML = '';
    return;
  }

  cardAberto = tipo;
  cards.forEach((c) => c.classList.toggle('cartao-stat--ativo', c.dataset.card === tipo));
  container.hidden = false;
  container.innerHTML = '<div class="carregando">Carregando…</div>';
  try {
    await renderizarDetalheCard(tipo, container);
  } catch (erro) {
    container.innerHTML = elementoErro(erro.message);
  }
}

document.getElementById('conteudoAnalytics').addEventListener('click', (evento) => {
  const card = evento.target.closest('[data-card]');
  if (card) return alternarDetalheCard(card.dataset.card);

  const fechar = evento.target.closest('[data-fechar-detalhe]');
  if (fechar) return alternarDetalheCard(cardAberto);

  const irSecao = evento.target.closest('[data-ir-secao]');
  if (irSecao) return irParaSecao(irSecao.dataset.irSecao);

  // Clicar num paciente na lista de "Mensagens trocadas" não mostra mais a
  // conversa aqui embaixo -- vai direto pra página Mensagens, já com essa
  // conversa aberta (pedido do Tiago: um único lugar pra ler/responder,
  // sem duplicar a experiência na Visão Geral).
  const linhaMensagens = evento.target.closest('[data-ir-conversa]');
  if (linhaMensagens) {
    irParaSecao('mensagens');
    abrirConversa(linhaMensagens.dataset.irConversa, linhaMensagens.dataset.irConversaNome);
    return;
  }
});

// ============================================================
// Atendimento Humano
// ============================================================

async function carregarSuspensos() {
  const alvo = document.getElementById('conteudoSuspensos');
  try {
    const lista = await chamarApi('/api/suspensos');
    if (lista.length === 0) {
      alvo.innerHTML = '<div class="estado-vazio"><span class="estado-vazio__emoji">✅</span>Nenhum paciente com a Lumi pausada agora.</div>';
      return;
    }
    const linhas = lista
      .map((p) => {
        const horas = Number(p.horas_desde_handoff);
        let selo = '<span class="selo selo-neutro">recente</span>';
        if (horas >= 6) selo = '<span class="selo selo-urgente">passou de 6h</span>';
        else if (horas >= 3) selo = '<span class="selo selo-alerta">há um tempo</span>';
        return `
          <tr data-linha-suspenso="${p.id}">
            <td>
              ${nomeExibicao(p.nome, p.apelido_whatsapp, '(sem nome)')}
              <div class="texto-fraco">${escapar(p.telefone || '')}</div>
            </td>
            <td>${p.human_assigned ? '<span class="selo selo-info">com a equipe</span>' : '<span class="selo selo-neutro">—</span>'}</td>
            <td>${escapar(p.last_handoff_formatado || '—')}</td>
            <td>${formatarHoras(p.horas_desde_handoff)} ${selo}</td>
            <td><button class="botao" data-retomar-paciente="${p.id}">Devolver pra Lumi</button></td>
          </tr>`;
      })
      .join('');
    alvo.innerHTML = `
      <div class="tabela-scroll-x">
        <table class="tabela">
          <thead><tr><th>Paciente</th><th>Status</th><th>Assumido em</th><th>Tempo parado</th><th></th></tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>`;
    atualizarBadges(lista.length);
  } catch (erro) {
    alvo.innerHTML = elementoErro(erro.message);
  }
}

document.getElementById('conteudoSuspensos').addEventListener('click', async (evento) => {
  const botao = evento.target.closest('button[data-retomar-paciente]');
  if (!botao) return;
  const id = botao.dataset.retomarPaciente;
  botao.disabled = true;
  botao.textContent = 'Devolvendo…';
  try {
    await chamarApi(`/api/suspensos/${id}/retomar`, { method: 'POST' });
    const linha = document.querySelector(`tr[data-linha-suspenso="${id}"]`);
    if (linha) linha.remove();
    const restantes = document.querySelectorAll('[data-linha-suspenso]').length;
    atualizarBadges(restantes);
    if (restantes === 0) {
      document.getElementById('conteudoSuspensos').innerHTML =
        '<div class="estado-vazio"><span class="estado-vazio__emoji">✅</span>Nenhum paciente com a Lumi pausada agora.</div>';
    }
  } catch (erro) {
    botao.disabled = false;
    botao.textContent = 'Devolver pra Lumi';
    alert(erro.message);
  }
});

// ============================================================
// Pendências
// ============================================================

async function carregarPendencias() {
  const alvo = document.getElementById('conteudoPendencias');
  try {
    const lista = await chamarApi('/api/pendencias');
    if (lista.length === 0) {
      alvo.innerHTML = '<div class="estado-vazio"><span class="estado-vazio__emoji">✅</span>Nenhuma pendência em aberto.</div>';
      atualizarBadgePendencias(0);
      return;
    }
    const linhas = lista
      .map(
        (p) => `
          <tr data-linha-pendencia="${p.id}">
            <td>${p.urgente ? '<span class="selo selo-urgente">Urgência</span>' : `<span class="selo selo-neutro">${escapar(p.action || '—')}</span>`}</td>
            <td>
              ${nomeExibicao(p.paciente_nome, p.paciente_apelido_whatsapp, '(paciente não identificado)')}
              <div class="texto-fraco">${escapar(p.from_phone || '')}</div>
            </td>
            <td>${escapar(p.domain || '—')}</td>
            <td style="max-width:320px;">${escapar(p.detail || '')}</td>
            <td>${escapar(p.criado_em_formatado || '—')}<br><span class="texto-fraco">${formatarHoras(p.horas_em_aberto)} atrás</span></td>
            <td><button class="botao botao-primario" data-resolver="${p.id}">Marcar concluída</button></td>
          </tr>`
      )
      .join('');
    alvo.innerHTML = `
      <div class="tabela-scroll-x">
        <table class="tabela">
          <thead><tr><th></th><th>Paciente</th><th>Domínio</th><th>Detalhe</th><th>Aberta em</th><th></th></tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>`;
    atualizarBadgePendencias(lista.length);
  } catch (erro) {
    alvo.innerHTML = elementoErro(erro.message);
  }
}

// Nova pendência manual -- botão abre um formulário simples (2 campos),
// cancelar/enviar com sucesso fecham e recarregam a lista.
const formNovaPendencia = document.getElementById('formNovaPendencia');

function abrirFormNovaPendencia() {
  formNovaPendencia.hidden = false;
  document.getElementById('novaPendenciaDetalhe').focus();
}

function fecharFormNovaPendencia() {
  formNovaPendencia.hidden = true;
  formNovaPendencia.reset();
}

document.getElementById('botaoNovaPendencia').addEventListener('click', abrirFormNovaPendencia);
document.getElementById('botaoCancelarNovaPendencia').addEventListener('click', fecharFormNovaPendencia);

// Autocomplete do campo Paciente -- sugere paciente real conforme digita,
// mas nunca trava: se não achar nada, ou se for algo que não é paciente
// (ex: "Comprar botox"), o campo aceita o texto livre normalmente.
let timeoutSugestoesPaciente = null;
document.getElementById('novaPendenciaPaciente').addEventListener('input', (evento) => {
  clearTimeout(timeoutSugestoesPaciente);
  const termo = evento.target.value.trim();
  const lista = document.getElementById('sugestoesPacientePendencia');
  if (termo.length < 2) {
    lista.innerHTML = '';
    return;
  }
  timeoutSugestoesPaciente = setTimeout(async () => {
    try {
      const sugestoes = await chamarApi(`/api/pacientes/sugestoes?q=${encodeURIComponent(termo)}`);
      lista.innerHTML = sugestoes
        .map((p) => {
          const nome = p.nome || p.apelido_whatsapp || p.telefone;
          return `<option value="${escapar(p.telefone)}" label="${escapar(nome)}">${escapar(nome)}</option>`;
        })
        .join('');
    } catch {
      // busca de sugestão falhando não pode atrapalhar quem só quer digitar
      lista.innerHTML = '';
    }
  }, 250);
});

formNovaPendencia.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const paciente = document.getElementById('novaPendenciaPaciente').value;
  const detalhe = document.getElementById('novaPendenciaDetalhe').value.trim();
  if (!detalhe) return;
  const botaoEnviar = formNovaPendencia.querySelector('button[type="submit"]');
  botaoEnviar.disabled = true;
  botaoEnviar.textContent = 'Adicionando…';
  try {
    await chamarApi('/api/pendencias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paciente, detalhe }),
    });
    fecharFormNovaPendencia();
    await carregarPendencias();
  } catch (erro) {
    alert(erro.message);
  } finally {
    botaoEnviar.disabled = false;
    botaoEnviar.textContent = 'Adicionar';
  }
});

document.getElementById('conteudoPendencias').addEventListener('click', async (evento) => {
  const botao = evento.target.closest('button[data-resolver]');
  if (!botao) return;
  const id = botao.dataset.resolver;
  botao.disabled = true;
  botao.textContent = 'Marcando…';
  try {
    await chamarApi(`/api/pendencias/${id}/resolver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolvidoPor: 'painel administrativo' }),
    });
    const linha = document.querySelector(`tr[data-linha-pendencia="${id}"]`);
    if (linha) linha.remove();
    const restantes = document.querySelectorAll('[data-linha-pendencia]').length;
    atualizarBadgePendencias(restantes);
    if (restantes === 0) {
      document.getElementById('conteudoPendencias').innerHTML =
        '<div class="estado-vazio"><span class="estado-vazio__emoji">✅</span>Nenhuma pendência em aberto.</div>';
    }
  } catch (erro) {
    botao.disabled = false;
    botao.textContent = 'Marcar concluída';
    alert(erro.message);
  }
});

// ============================================================
// Oportunidades (funil de resgate)
// ============================================================

const ETAPA_LEGIVEL = {
  interesse: '<span class="selo selo-info">Interesse</span>',
  horario_oferecido: '<span class="selo selo-alerta">Horário oferecido</span>',
};

const STATUS_OPORTUNIDADE_LEGIVEL = {
  em_andamento: '<span class="selo selo-alerta">Em andamento</span>',
  resgate_enviado: '<span class="selo selo-info">Resgate enviado</span>',
  concluido: '<span class="selo selo-sucesso">Convertido</span>',
  expirado: '<span class="selo selo-neutro">Expirado</span>',
};

// Calculado no front (não no SQL) pra ficar fácil de ajustar o texto sem
// mexer na query -- depende só de status + tempo desde a última interação,
// os mesmos dados que já vêm na resposta da API.
function proximoPassoOportunidade(o) {
  if (o.status === 'concluido') return 'Nada a fazer — já agendou 🎉';
  if (o.status === 'expirado') return 'Resgate enviado, sem retorno do paciente';
  if (o.status === 'resgate_enviado') return 'Resgate enviado, aguardando resposta';
  // consulta já marcada (inclusive na mão, no Simples Dental) -- o resgate
  // não entra. Vem do espelho public.consultas via /sincronizar-agenda.
  if (o.tem_consulta_futura) {
    return o.proxima_consulta_formatada
      ? `Já tem consulta em ${o.proxima_consulta_formatada} — resgate não será enviado`
      : 'Já tem consulta marcada — resgate não será enviado';
  }
  if (o.atendimento_humano_ativo) return 'Com atendimento humano — resgate automático não entra';
  // silencio_real_4h reflete a MESMA checagem que "Busca Funil Parado" usa
  // pra decidir se dispara (silêncio de verdade nas últimas 4h desde a
  // última mensagem do paciente, não desde a última marcação) -- ver fix
  // 25/08/2026 (fix-resgate-checagem-silencio-real.js) e o comentário na
  // query em queries.js.
  if (!o.silencio_real_4h) return 'Paciente respondeu recentemente — resgate entra em 4h de silêncio sem nova resposta';
  return 'Resgate será enviado no próximo horário comercial';
}

// Filtro é só client-side (a lista inteira já cabe numa página, sem
// paginação) -- guarda a última resposta da API aqui e re-renderiza na
// hora quando o usuário digita/troca um filtro, sem bater na API de novo.
let oportunidadesCache = [];

const PODE_REATIVAR = new Set(['resgate_enviado', 'expirado']);

async function carregarOportunidades() {
  const alvo = document.getElementById('conteudoOportunidades');
  alvo.innerHTML = '<div class="carregando">Carregando…</div>';
  try {
    oportunidadesCache = await chamarApi('/api/oportunidades');
    renderizarOportunidades();
  } catch (erro) {
    alvo.innerHTML = elementoErro(erro.message);
  }
}

function renderizarOportunidades() {
  const alvo = document.getElementById('conteudoOportunidades');
  const termo = (document.getElementById('buscaOportunidades')?.value || '').trim().toLowerCase();
  const etapaFiltro = document.getElementById('filtroEtapaOportunidades')?.value || '';
  const statusFiltro = document.getElementById('filtroStatusOportunidades')?.value || '';

  const lista = oportunidadesCache.filter((o) => {
    if (etapaFiltro && o.etapa !== etapaFiltro) return false;
    if (statusFiltro && o.status !== statusFiltro) return false;
    if (termo) {
      const alvoTexto = `${o.nome || ''} ${o.telefone || ''}`.toLowerCase();
      if (!alvoTexto.includes(termo)) return false;
    }
    return true;
  });

  if (oportunidadesCache.length === 0) {
    alvo.innerHTML =
      '<div class="estado-vazio"><span class="estado-vazio__emoji">🎯</span>Nenhuma oportunidade registrada ainda.</div>';
    return;
  }
  if (lista.length === 0) {
    alvo.innerHTML = '<div class="estado-vazio"><span class="estado-vazio__emoji">🔍</span>Nada encontrado com esse filtro.</div>';
    return;
  }

  const linhas = lista
    .map((o) => {
      const nomeCurto = o.nome || '(sem nome)';
      const botaoReativar = PODE_REATIVAR.has(o.status)
        ? `<button class="botao" data-reativar-oportunidade="${o.id}">Reativar</button>`
        : '<span class="texto-fraco">—</span>';
      const verMensagem = o.ultima_mensagem_paciente
        ? `<button type="button" class="botao-ver" data-ver-mensagem-oportunidade="${o.id}">Ver</button>`
        : '<span class="texto-fraco">—</span>';
      return `
        <tr data-linha-oportunidade="${o.id}">
          <td>${escapar(nomeCurto)}</td>
          <td>${ETAPA_LEGIVEL[o.etapa] || escapar(o.etapa || '—')}</td>
          <td>${STATUS_OPORTUNIDADE_LEGIVEL[o.status] || escapar(o.status || '—')}</td>
          <td>${verMensagem}</td>
          <td>${escapar(o.ultima_interacao_formatado || '—')}</td>
          <td>${escapar(proximoPassoOportunidade(o))}</td>
          <td>${botaoReativar}</td>
        </tr>`;
    })
    .join('');
  alvo.innerHTML = `
    <div class="tabela-scroll-x">
      <table class="tabela tabela--oportunidades">
        <colgroup>
          <col style="width:18%"><col style="width:11%"><col style="width:11%">
          <col style="width:8%"><col style="width:16%"><col style="width:22%"><col style="width:14%">
        </colgroup>
        <thead><tr><th>Paciente</th><th>Etapa</th><th>Status</th><th>Mensagem</th><th>Última interação</th><th>Próximo passo</th><th></th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>`;
}

['buscaOportunidades', 'filtroEtapaOportunidades', 'filtroStatusOportunidades'].forEach((id) => {
  document.getElementById(id)?.addEventListener('input', renderizarOportunidades);
});

document.getElementById('botaoLimparFiltrosOportunidades')?.addEventListener('click', () => {
  document.getElementById('buscaOportunidades').value = '';
  document.getElementById('filtroEtapaOportunidades').value = '';
  document.getElementById('filtroStatusOportunidades').value = '';
  renderizarOportunidades();
});

document.getElementById('conteudoOportunidades').addEventListener('click', async (evento) => {
  const botaoVer = evento.target.closest('button[data-ver-mensagem-oportunidade]');
  if (botaoVer) {
    const oportunidade = oportunidadesCache.find((o) => String(o.id) === botaoVer.dataset.verMensagemOportunidade);
    if (oportunidade) abrirModalMensagem(oportunidade);
    return;
  }
  const botao = evento.target.closest('button[data-reativar-oportunidade]');
  if (!botao) return;
  const id = botao.dataset.reativarOportunidade;
  botao.disabled = true;
  botao.textContent = 'Reativando…';
  try {
    await chamarApi(`/api/oportunidades/${id}/reativar`, { method: 'POST' });
    await carregarOportunidades();
  } catch (erro) {
    botao.disabled = false;
    botao.textContent = 'Reativar';
    alert(erro.message);
  }
});

// Modal "Ver mensagem" -- ocupa o centro da tela em vez de um balão
// espremido dentro da célula estreita da tabela.
function abrirModalMensagem(oportunidade) {
  document.getElementById('modalMensagemTitulo').textContent = `Mensagem de ${oportunidade.nome || 'paciente'}`;
  document.getElementById('modalMensagemCorpo').textContent = oportunidade.ultima_mensagem_paciente || '';
  document.getElementById('modalMensagem').hidden = false;
}

function fecharModalMensagem() {
  document.getElementById('modalMensagem').hidden = true;
}

document.getElementById('botaoFecharModalMensagem')?.addEventListener('click', fecharModalMensagem);

document.getElementById('modalMensagem')?.addEventListener('click', (evento) => {
  if (evento.target.id === 'modalMensagem') fecharModalMensagem();
});

document.addEventListener('keydown', (evento) => {
  if (evento.key === 'Escape' && !document.getElementById('modalMensagem').hidden) fecharModalMensagem();
});

// ============================================================
// Agenda (lê/cria/altera consultas de verdade no Simples Dental, via o
// serviço de automação -- server.js na raiz do repo, chamado pelo painel
// através de /api/agenda*)
// ============================================================

// Mesma lista de STATUS_VALIDOS do servidor de automação (server.js) --
// são só 6 valores fixos do Simples Dental, sem endpoint pra buscar isso
// dinamicamente. Se um dia mudar lá, precisa mudar aqui também.
const STATUS_CONSULTA = [
  'Agendada',
  'Confirmada',
  'Em atendimento',
  'Falta',
  'Cancelada pelo paciente',
  'Cancelada pelo profissional',
];

let semanaAtualAgenda = 0;
let agendaCache = [];
// Até qual aba de semana o agendaCache já cobre (-1 = nunca buscou). A
// automação contra o Simples Dental é lenta, então evitamos rebuscar toda
// vez que a secretária só troca de aba ou reabre a seção -- só busca de
// novo quando a aba pedida ainda não está coberta, ou quando alguém pede
// "Atualizar" de propósito (ver atualizarAgendaCompleta).
let agendaCacheAteSemanas = -1;
let agendaAtualizadoEm = null;
let consultaSelecionada = null;

async function carregarAgenda(semanas) {
  const alvo = document.getElementById('conteudoAgenda');
  alvo.innerHTML = '<div class="carregando">Carregando…</div>';
  try {
    const dados = await chamarApi(`/api/agenda?semanas=${semanas + 1}`);
    agendaCache = dados.compromissos || [];
    agendaCacheAteSemanas = semanas;
    agendaAtualizadoEm = new Date();
    atualizarSeloAgendaAtualizadoEm();
    renderizarAgenda();
  } catch (erro) {
    alvo.innerHTML = elementoErro(erro.message);
  }
}

// Busca as 4 semanas (todas as abas do seletor) de uma vez -- usado no
// pré-carregamento ao entrar no painel e sempre que algo muda de verdade
// (Atualizar manual, criar/remarcar/mudar status/rótulo de consulta),
// assim a troca de aba fica instantânea depois.
function atualizarAgendaCompleta() {
  return carregarAgenda(3);
}

function atualizarSeloAgendaAtualizadoEm() {
  const alvo = document.getElementById('agendaAtualizadoEm');
  if (!alvo) return;
  alvo.textContent = agendaAtualizadoEm
    ? `Atualizado às ${agendaAtualizadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`
    : '';
}

// Mostra a semana pedida -- se já estiver em cache (login já pré-carregou
// as 4 semanas), só re-renderiza na hora, sem bater no servidor.
function mostrarAgenda(semanas) {
  if (semanas <= agendaCacheAteSemanas) {
    renderizarAgenda();
    return;
  }
  carregarAgenda(semanas);
}

// Segunda-feira da semana atual + deslocamento de N semanas -- usado só
// pra filtrar, no navegador, qual fatia do lote já buscado (carregarAgenda
// pede sempre "semanas+1" semanas inteiras) mostrar na aba selecionada.
function limitesSemana(deslocamentoSemanas) {
  const agora = new Date();
  const diaSemana = agora.getDay(); // 0 = domingo
  const deslocamentoAteSegunda = diaSemana === 0 ? -6 : 1 - diaSemana;
  const segunda = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + deslocamentoAteSegunda);
  segunda.setDate(segunda.getDate() + deslocamentoSemanas * 7);
  segunda.setHours(0, 0, 0, 0);
  const proximaSegunda = new Date(segunda);
  proximaSegunda.setDate(proximaSegunda.getDate() + 7);
  return { inicioSemana: segunda.getTime(), fimSemana: proximaSegunda.getTime() };
}

function renderizarAgenda() {
  const alvo = document.getElementById('conteudoAgenda');
  const { inicioSemana, fimSemana } = limitesSemana(semanaAtualAgenda);
  const daSemana = agendaCache
    .filter((c) => c.fim > c.inicio) // descarta bloqueios de dia inteiro
    .filter((c) => c.inicio >= inicioSemana && c.inicio < fimSemana)
    .sort((a, b) => a.inicio - b.inicio);

  if (daSemana.length === 0) {
    alvo.innerHTML = '<div class="estado-vazio"><span class="estado-vazio__emoji">🗓️</span>Nenhuma consulta nessa semana.</div>';
    return;
  }

  const agora = Date.now();
  const linhas = daSemana
    .map((c) => {
      const cancelada = (c.status || '').startsWith('Cancelada');
      const passada = c.fim < agora;
      const classes = [cancelada && 'linha-cancelada', !cancelada && passada && 'linha-passada'].filter(Boolean).join(' ');
      const rotulo = c.rotulo
        ? `<span class="ponto-rotulo" style="background:${escapar(c.rotuloCor || '#999')}"></span>${escapar(c.rotulo)}`
        : '<span class="texto-fraco">—</span>';
      const horario = c.fimFormatado ? `${escapar(c.inicioFormatado || '—')} – ${escapar(c.fimFormatado)}` : escapar(c.inicioFormatado || '—');
      return `
        <tr data-consulta-id="${escapar(c.id || '')}"${classes ? ` class="${classes}"` : ''}>
          <td>${horario}</td>
          <td>${escapar(c.paciente || '(sem nome)')}</td>
          <td><span class="selo selo-neutro">${escapar(c.status || '—')}</span></td>
          <td>${rotulo}</td>
        </tr>`;
    })
    .join('');

  alvo.innerHTML = `
    <div class="tabela-scroll-x">
      <table class="tabela">
        <thead><tr><th>Horário</th><th>Paciente</th><th>Status</th><th>Rótulo</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>`;
}

document.getElementById('conteudoAgenda').addEventListener('click', (evento) => {
  const linha = evento.target.closest('tr[data-consulta-id]');
  if (!linha || !linha.dataset.consultaId) return;
  const compromisso = agendaCache.find((c) => String(c.id) === linha.dataset.consultaId);
  if (compromisso) abrirModalConsulta(compromisso);
});

document.getElementById('seletorSemanaAgenda').addEventListener('click', (evento) => {
  const botao = evento.target.closest('button[data-semana]');
  if (!botao) return;
  semanaAtualAgenda = Number(botao.dataset.semana);
  document.querySelectorAll('#seletorSemanaAgenda button').forEach((b) => b.classList.toggle('ativo', b === botao));
  mostrarAgenda(semanaAtualAgenda);
});

document.getElementById('botaoAtualizarAgenda').addEventListener('click', atualizarAgendaCompleta);

// Força o /sincronizar-agenda no bridge -> atualiza public.consultas (o
// espelho que o resgate automático consulta). Mais pesado que "Atualizar"
// (resolve telefone e escreve no banco por consulta), então é um botão à
// parte.
document.getElementById('botaoSincronizarEspelho').addEventListener('click', async (ev) => {
  const btn = ev.currentTarget;
  const rotulo = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⟳ Sincronizando…';
  try {
    const r = await chamarApi('/api/agenda/sincronizar', {
      method: 'POST',
      body: JSON.stringify({ semanas: 4 }),
    });
    alert(
      'Espelho da agenda sincronizado.\n\n' +
        `${r.total} consulta(s) nas próximas ${r.semanas} semanas\n` +
        `${r.novos} nova(s) · ${r.atualizados} atualizada(s) · ${r.removidos} sumiram do calendário` +
        (r.sem_telefone
          ? `\n\n${r.sem_telefone} sem telefone vinculado (o nome não bate com o cadastro nem com um dependente).`
          : '')
    );
    await atualizarAgendaCompleta();
  } catch (erro) {
    alert('Falha ao sincronizar o espelho: ' + erro.message);
  } finally {
    btn.disabled = false;
    btn.textContent = rotulo;
  }
});

// Nova consulta -- mesmo padrão do formulário de nova pendência (abre/
// fecha, autocomplete de paciente por datalist que nunca trava digitação
// livre).
const formNovaConsulta = document.getElementById('formNovaConsulta');

function abrirFormNovaConsulta() {
  formNovaConsulta.hidden = false;
  document.getElementById('novaConsultaPaciente').focus();
}

function fecharFormNovaConsulta() {
  formNovaConsulta.hidden = true;
  formNovaConsulta.reset();
}

document.getElementById('botaoNovaConsulta').addEventListener('click', abrirFormNovaConsulta);
document.getElementById('botaoCancelarNovaConsulta').addEventListener('click', fecharFormNovaConsulta);

// Reaproveita CATEGORIAS_LEGIVEIS (já existe, usado na Visão Geral) --
// mesma lista que a Lumi usa, sem duplicar os valores aqui.
(function popularCategoriaNovaConsulta() {
  const select = document.getElementById('novaConsultaCategoria');
  for (const [valor, rotulo] of Object.entries(CATEGORIAS_LEGIVEIS)) {
    const option = document.createElement('option');
    option.value = valor;
    option.textContent = rotulo;
    select.appendChild(option);
  }
})();

let timeoutSugestoesConsulta = null;
document.getElementById('novaConsultaPaciente').addEventListener('input', (evento) => {
  clearTimeout(timeoutSugestoesConsulta);
  const termo = evento.target.value.trim();
  const lista = document.getElementById('sugestoesPacienteConsulta');
  if (termo.length < 2) {
    lista.innerHTML = '';
    return;
  }
  timeoutSugestoesConsulta = setTimeout(async () => {
    try {
      const sugestoes = await chamarApi(`/api/pacientes/sugestoes?q=${encodeURIComponent(termo)}`);
      lista.innerHTML = sugestoes
        .map((p) => {
          const nome = p.nome || p.apelido_whatsapp || p.telefone;
          return `<option value="${escapar(p.telefone)}" label="${escapar(nome)}">${escapar(nome)}</option>`;
        })
        .join('');
    } catch {
      lista.innerHTML = '';
    }
  }, 250);
});

formNovaConsulta.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const telefone = document.getElementById('novaConsultaPaciente').value.trim();
  const dataInput = document.getElementById('novaConsultaData').value; // YYYY-MM-DD
  const hora = document.getElementById('novaConsultaHora').value; // HH:MM
  if (!telefone || !dataInput || !hora) return;
  const [ano, mes, dia] = dataInput.split('-');
  const duracaoMinutos = document.getElementById('novaConsultaDuracao').value;
  const categoria = document.getElementById('novaConsultaCategoria').value;
  const rotulo = document.getElementById('novaConsultaRotulo').value.trim();
  const observacao = document.getElementById('novaConsultaObservacao').value.trim();

  const botaoEnviar = formNovaConsulta.querySelector('button[type="submit"]');
  botaoEnviar.disabled = true;
  botaoEnviar.textContent = 'Agendando…';
  try {
    await chamarApi('/api/agenda/consultas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telefone,
        data: `${dia}/${mes}/${ano}`,
        hora,
        duracaoMinutos: duracaoMinutos ? Number(duracaoMinutos) : undefined,
        categoria: categoria || undefined,
        rotulo: rotulo || undefined,
        observacao: observacao || undefined,
      }),
    });
    fecharFormNovaConsulta();
    await atualizarAgendaCompleta();
  } catch (erro) {
    alert(erro.message);
  } finally {
    botaoEnviar.disabled = false;
    botaoEnviar.textContent = 'Agendar';
  }
});

// Modal de detalhe da consulta -- mesmo padrão open/close/Escape/clique-
// fora do modal de "ver mensagem" da Oportunidades.
function abrirModalConsulta(compromisso) {
  consultaSelecionada = compromisso;

  const rotuloHtml = compromisso.rotulo
    ? `<span class="ponto-rotulo" style="background:${escapar(compromisso.rotuloCor || '#999')}"></span>${escapar(compromisso.rotulo)}`
    : 'Sem rótulo';
  const horario = compromisso.fimFormatado
    ? `${escapar(compromisso.inicioFormatado || '—')} – ${escapar(compromisso.fimFormatado)}`
    : escapar(compromisso.inicioFormatado || '—');
  document.getElementById('modalConsultaInfo').innerHTML = `
    <p><strong>${escapar(compromisso.paciente || '(sem nome)')}</strong></p>
    <p>${horario}</p>
    <p>${rotuloHtml}</p>
  `;

  const selectStatus = document.getElementById('modalConsultaStatus');
  selectStatus.innerHTML = STATUS_CONSULTA.map(
    (s) => `<option value="${escapar(s)}"${s === compromisso.status ? ' selected' : ''}>${escapar(s)}</option>`
  ).join('');

  document.getElementById('modalConsultaRotulo').value = compromisso.rotulo || '';

  document.getElementById('modalConsultaRemarcarData').value = '';
  document.getElementById('modalConsultaRemarcarHora').value = '';
  document.getElementById('modalConsultaRemarcarDuracao').value = '';
  document.getElementById('modalConsultaRemarcarObservacao').value = '';

  document.getElementById('modalConsultaTitulo').textContent = compromisso.paciente || 'Consulta';
  document.getElementById('modalConsulta').hidden = false;
}

function fecharModalConsulta() {
  document.getElementById('modalConsulta').hidden = true;
  consultaSelecionada = null;
}

document.getElementById('botaoFecharModalConsulta')?.addEventListener('click', fecharModalConsulta);

document.getElementById('modalConsulta')?.addEventListener('click', (evento) => {
  if (evento.target.id === 'modalConsulta') fecharModalConsulta();
});

document.addEventListener('keydown', (evento) => {
  if (evento.key === 'Escape' && !document.getElementById('modalConsulta').hidden) fecharModalConsulta();
});

document.getElementById('botaoSalvarStatusConsulta').addEventListener('click', async () => {
  if (!consultaSelecionada) return;
  const status = document.getElementById('modalConsultaStatus').value;
  const botao = document.getElementById('botaoSalvarStatusConsulta');
  botao.disabled = true;
  botao.textContent = 'Salvando…';
  try {
    await chamarApi(`/api/agenda/consultas/${consultaSelecionada.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    fecharModalConsulta();
    await atualizarAgendaCompleta();
  } catch (erro) {
    alert(erro.message);
  } finally {
    botao.disabled = false;
    botao.textContent = 'Salvar status';
  }
});

document.getElementById('botaoSalvarRotuloConsulta').addEventListener('click', async () => {
  if (!consultaSelecionada) return;
  const rotulo = document.getElementById('modalConsultaRotulo').value.trim();
  if (!rotulo) {
    alert('Digite o nome exato de um rótulo já existente no Simples Dental.');
    return;
  }
  const botao = document.getElementById('botaoSalvarRotuloConsulta');
  botao.disabled = true;
  botao.textContent = 'Salvando…';
  try {
    await chamarApi(`/api/agenda/consultas/${consultaSelecionada.id}/rotulo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rotulo }),
    });
    fecharModalConsulta();
    await atualizarAgendaCompleta();
  } catch (erro) {
    alert(erro.message);
  } finally {
    botao.disabled = false;
    botao.textContent = 'Salvar rótulo';
  }
});

document.getElementById('botaoRemarcarConsulta').addEventListener('click', async () => {
  if (!consultaSelecionada) return;
  const dataInput = document.getElementById('modalConsultaRemarcarData').value;
  const hora = document.getElementById('modalConsultaRemarcarHora').value;
  if (!dataInput || !hora) {
    alert('Informe data e hora pra remarcar.');
    return;
  }
  const [ano, mes, dia] = dataInput.split('-');
  const duracaoMinutos = document.getElementById('modalConsultaRemarcarDuracao').value;
  const observacao = document.getElementById('modalConsultaRemarcarObservacao').value.trim();

  const botao = document.getElementById('botaoRemarcarConsulta');
  botao.disabled = true;
  botao.textContent = 'Remarcando…';
  try {
    await chamarApi(`/api/agenda/consultas/${consultaSelecionada.id}/remarcar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: `${dia}/${mes}/${ano}`,
        hora,
        duracaoMinutos: duracaoMinutos ? Number(duracaoMinutos) : undefined,
        observacao: observacao || undefined,
      }),
    });
    fecharModalConsulta();
    await atualizarAgendaCompleta();
  } catch (erro) {
    alert(erro.message);
  } finally {
    botao.disabled = false;
    botao.textContent = 'Remarcar';
  }
});

// ============================================================
// Mensagens (chat direto com o paciente -- envia pela Evolution API; o
// próprio n8n detecta que não foi a Lumi que mandou -- texto sem "[Lumi]" --
// e pausa a IA + grava a mensagem sozinho, o painel não escreve no banco
// nesse caminho)
// ============================================================

let conversaAtivaTelefone = null;
let conversaAtivaNome = '';

async function carregarConversas(termo) {
  const alvo = document.getElementById('listaConversas');
  try {
    const conversas = await chamarApi(`/api/mensagens/conversas?termo=${encodeURIComponent(termo || '')}`);
    if (!conversas.length) {
      alvo.innerHTML = vazioDetalhe('Nenhuma conversa encontrada.');
      return;
    }
    alvo.innerHTML = conversas
      .map((c) => {
        const nome = c.nome || c.apelido_whatsapp || c.telefone;
        const ativo = c.telefone === conversaAtivaTelefone;
        const aguardando = c.ultimo_tipo === 'human';
        let previa = c.ultima_mensagem || '';
        if (previa.startsWith('[Equipe da clínica]: ')) previa = previa.slice('[Equipe da clínica]: '.length);
        return `
          <button class="lista-conversas__item${ativo ? ' lista-conversas__item--ativo' : ''}" data-telefone="${escapar(c.telefone)}" data-nome="${escapar(nome)}">
            <div class="lista-conversas__topo">
              <span class="lista-conversas__nome">${escapar(nome)}</span>
              ${c.bot_disabled ? '<span class="selo selo-alerta">🤖 pausada</span>' : ''}
            </div>
            <div class="lista-conversas__previa${aguardando ? ' lista-conversas__previa--aguardando' : ''}">${escapar(previa).slice(0, 80)}</div>
            <div class="lista-conversas__hora">${escapar(c.ultima_em_formatada || '')}</div>
          </button>`;
      })
      .join('');
  } catch (erro) {
    alvo.innerHTML = elementoErro(erro.message);
  }
}

document.getElementById('listaConversas').addEventListener('click', (evento) => {
  const item = evento.target.closest('[data-telefone]');
  if (!item) return;
  abrirConversa(item.dataset.telefone, item.dataset.nome);
});

let temporizadorBuscaConversas = null;
document.getElementById('buscaConversas').addEventListener('input', (evento) => {
  clearTimeout(temporizadorBuscaConversas);
  const valor = evento.target.value;
  temporizadorBuscaConversas = setTimeout(() => carregarConversas(valor), 300);
});

function bolhaMensagem(m) {
  const chamouTool = m.tipo === 'ai' && (!m.conteudo || m.conteudo === '[]') && m.tool_chamada;
  if (chamouTool) {
    return `
      <div class="bolha-mensagem bolha-mensagem--tool">
        <div class="bolha-mensagem__texto">🔧 chamou ${escapar(nomeLegivelTool(m.tool_chamada))}</div>
        <div class="bolha-mensagem__hora">${escapar(m.enviado_em_formatado || '')}</div>
      </div>`;
  }
  const prefixoEquipe = '[Equipe da clínica]: ';
  const daEquipe = m.tipo === 'ai' && (m.conteudo || '').startsWith(prefixoEquipe);
  const texto = daEquipe ? m.conteudo.slice(prefixoEquipe.length) : m.conteudo || '';
  const classe = m.tipo === 'human' ? 'bolha-mensagem--paciente' : daEquipe ? 'bolha-mensagem--equipe' : 'bolha-mensagem--lumi';
  return `
    <div class="bolha-mensagem ${classe}">
      <div class="bolha-mensagem__texto">${escapar(texto)}</div>
      <div class="bolha-mensagem__hora">${escapar(m.enviado_em_formatado || '')}</div>
    </div>`;
}

async function abrirConversa(telefone, nome) {
  conversaAtivaTelefone = telefone;
  conversaAtivaNome = nome;
  document.querySelectorAll('#listaConversas [data-telefone]').forEach((el) => {
    el.classList.toggle('lista-conversas__item--ativo', el.dataset.telefone === telefone);
  });

  const alvo = document.getElementById('threadMensagens');
  alvo.innerHTML = '<div class="carregando">Carregando…</div>';
  try {
    const mensagens = await chamarApi(`/api/mensagens?telefone=${encodeURIComponent(telefone)}&limite=50`);
    renderizarThread(nome, [...mensagens].reverse());
  } catch (erro) {
    alvo.innerHTML = elementoErro(erro.message);
  }
}

function renderizarThread(nome, mensagensCronologicas) {
  const alvo = document.getElementById('threadMensagens');
  alvo.innerHTML = `
    <div class="thread-mensagens__cabecalho">${escapar(nome || 'Conversa')}</div>
    <div class="thread-mensagens__corpo" id="threadMensagensCorpo"></div>
    <form class="composer-mensagem" id="composerMensagem">
      <textarea id="composerMensagemTexto" placeholder="Escreva uma mensagem…" rows="2" required></textarea>
      <button type="submit" class="botao botao-primario">Enviar</button>
    </form>
  `;
  preencherCorpoThread(mensagensCronologicas, true);
  document.getElementById('composerMensagem').addEventListener('submit', enviarMensagemPainel);
}

// Troca só as bolhas de mensagem, sem mexer no composer -- usado tanto no
// primeiro carregamento (forcarScroll=true) quanto no poll em segundo plano
// (forcarScroll=false, só desce o scroll se já estava perto do fim, pra não
// puxar a tela embaixo de quem está lendo mensagens antigas).
function preencherCorpoThread(mensagensCronologicas, forcarScroll) {
  const corpo = document.getElementById('threadMensagensCorpo');
  if (!corpo) return;
  const pertoDoFim = corpo.scrollHeight - corpo.scrollTop - corpo.clientHeight < 80;
  corpo.innerHTML = mensagensCronologicas.map(bolhaMensagem).join('') || vazioDetalhe('Sem mensagens registradas pra esse paciente.');
  if (forcarScroll || pertoDoFim) corpo.scrollTop = corpo.scrollHeight;
}

// true enquanto um envio está em andamento (da chamada à Evolution API até a
// reconciliação da bolha otimista, ~2.5s depois) -- o poll em segundo plano
// pula esse intervalo pra não apagar a bolha "enviando…" por baixo do envio.
let enviandoMensagemAgora = false;

// Atualiza a conversa aberta em segundo plano (poll periódico), sem apagar
// o que a secretária estiver digitando nem mostrar "Carregando…" por cima.
async function atualizarConversaAtivaSilenciosamente() {
  const telefone = conversaAtivaTelefone;
  if (!telefone || enviandoMensagemAgora) return;
  try {
    const mensagens = await chamarApi(`/api/mensagens?telefone=${encodeURIComponent(telefone)}&limite=50`);
    if (conversaAtivaTelefone !== telefone) return; // trocou de conversa enquanto buscava
    preencherCorpoThread([...mensagens].reverse(), false);
  } catch (erro) {
    // silencioso -- o próximo poll tenta de novo, uma falha passageira aqui
    // não deve interromper o que a secretária estiver fazendo
  }
}

// Enquanto a seção Mensagens estiver aberta, atualiza a lista de conversas
// e a conversa ativa a cada poucos segundos -- resposta de paciente aparece
// sozinha, sem precisar trocar de aba/dar F5 (bem mais rápido que os 45s do
// refresh automático geral, que nem cobre esta seção).
const INTERVALO_ATUALIZACAO_MENSAGENS_MS = 6000;
setInterval(() => {
  if (document.hidden) return;
  if (!document.getElementById('secao-mensagens').classList.contains('ativa')) return;
  carregarConversas(document.getElementById('buscaConversas').value);
  atualizarConversaAtivaSilenciosamente();
}, INTERVALO_ATUALIZACAO_MENSAGENS_MS);

async function enviarMensagemPainel(evento) {
  evento.preventDefault();
  const textarea = document.getElementById('composerMensagemTexto');
  const botao = evento.target.querySelector('button[type="submit"]');
  const texto = textarea.value.trim();
  if (!texto || !conversaAtivaTelefone) return;

  const telefone = conversaAtivaTelefone;
  enviandoMensagemAgora = true;
  botao.disabled = true;
  botao.textContent = 'Enviando…';

  const corpo = document.getElementById('threadMensagensCorpo');
  const bolhaOtimista = document.createElement('div');
  bolhaOtimista.className = 'bolha-mensagem bolha-mensagem--equipe bolha-mensagem--enviando';
  bolhaOtimista.innerHTML = `<div class="bolha-mensagem__texto">${escapar(texto)}</div><div class="bolha-mensagem__hora">enviando…</div>`;
  corpo.appendChild(bolhaOtimista);
  corpo.scrollTop = corpo.scrollHeight;

  try {
    await chamarApi('/api/mensagens/enviar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telefone, texto }),
    });
    textarea.value = '';
    botao.disabled = false;
    botao.textContent = 'Enviar';
    // /api/mensagens/enviar já espera o registro no banco terminar antes de
    // responder (registrarMensagemEquipe), então a linha real já existe --
    // busca de novo na hora pra trocar a bolha otimista pela real (com hora
    // e prefixo certos). Sem passar por abrirConversa: isso reconstruiria o
    // composer inteiro à toa (e mostraria "Carregando…" por cima) -- aqui só
    // as bolhas precisam trocar.
    enviandoMensagemAgora = false;
    if (conversaAtivaTelefone === telefone) await atualizarConversaAtivaSilenciosamente();
    carregarConversas(document.getElementById('buscaConversas').value);
  } catch (erro) {
    enviandoMensagemAgora = false;
    bolhaOtimista.classList.add('bolha-mensagem--erro');
    bolhaOtimista.querySelector('.bolha-mensagem__hora').textContent = `falhou: ${erro.message}`;
    botao.disabled = false;
    botao.textContent = 'Enviar';
  }
}

// ============================================================
// Analytics (tendência + funil de resgate + nuvem de palavras)
// ============================================================

const METRICAS_TENDENCIA = {
  consultas_criadas: 'Consultas criadas',
  confirmados: 'Confirmadas',
  cancelados: 'Canceladas',
  remarcados: 'Remarcadas',
  lembretes_enviados: 'Lembretes enviados',
  novos_pacientes: 'Novos pacientes',
  mensagens_trocadas: 'Mensagens trocadas',
  pendencias_abertas: 'Pendências abertas',
  urgencias_abertas: 'Urgências abertas',
  tentativas_resgate: 'Tentativas de resgate',
  recuperados: 'Recuperados',
};

let granularidadeAtual = 'mes';
let origemNuvemAtual = 'paciente';
let tendenciaCache = null;
let chartTendencia = null;

async function carregarPaginaAnalytics() {
  await carregarTendencia();
  carregarNuvem();
}

document.getElementById('seletorGranularidade')?.addEventListener('click', (evento) => {
  const botao = evento.target.closest('button[data-granularidade]');
  if (!botao) return;
  granularidadeAtual = botao.dataset.granularidade;
  document.querySelectorAll('#seletorGranularidade button').forEach((b) => b.classList.toggle('ativo', b === botao));
  carregarTendencia();
});

document.getElementById('seletorMetrica')?.addEventListener('change', renderizarGraficoTendencia);

async function carregarTendencia() {
  const cartoesEl = document.getElementById('cartoesOportunidadesAnalytics');
  try {
    tendenciaCache = await chamarApi(`/api/analytics/tendencia?granularidade=${encodeURIComponent(granularidadeAtual)}`);
    const nota = document.getElementById('tendenciaDadosDesde');
    if (nota) nota.textContent = tendenciaCache.desdeFormatado ? `Dados desde ${tendenciaCache.desdeFormatado}` : '';
    renderizarGraficoTendencia();
    renderizarCartoesOportunidades(tendenciaCache.resumoOportunidades);
  } catch (erro) {
    cartoesEl.innerHTML = elementoErro(erro.message);
  }
}

function renderizarGraficoTendencia() {
  if (!tendenciaCache) return;
  const metrica = document.getElementById('seletorMetrica').value;
  const labels = tendenciaCache.buckets.map((b) => b.rotulo);
  const dados = tendenciaCache.buckets.map((b) => b[metrica]);

  if (chartTendencia) chartTendencia.destroy();
  const ctx = document.getElementById('graficoTendencia').getContext('2d');
  chartTendencia = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: METRICAS_TENDENCIA[metrica] || metrica,
          data: dados,
          borderColor: '#96794f',
          backgroundColor: 'rgba(184, 154, 104, 0.15)',
          tension: 0.3,
          fill: true,
          pointRadius: 3,
          pointBackgroundColor: '#96794f',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function renderizarCartoesOportunidades(resumo) {
  const el = document.getElementById('cartoesOportunidadesAnalytics');
  const taxaTexto = resumo.taxa_recuperacao === null ? '—' : `${Math.round(resumo.taxa_recuperacao * 100)}%`;
  el.innerHTML = `
    <div class="cartao-stat"><div class="cartao-stat__rotulo">Recuperados</div><div class="cartao-stat__valor">${formatarNumero(resumo.recuperados)}</div></div>
    <div class="cartao-stat"><div class="cartao-stat__rotulo">Tentativas de resgate</div><div class="cartao-stat__valor">${formatarNumero(resumo.tentativas_resgate)}</div></div>
    <div class="cartao-stat"><div class="cartao-stat__rotulo">Taxa de recuperação</div><div class="cartao-stat__valor">${taxaTexto}</div></div>
    <div class="cartao-stat"><div class="cartao-stat__rotulo">Em andamento agora</div><div class="cartao-stat__valor">${formatarNumero(resumo.em_andamento_agora)}</div></div>
    <div class="cartao-stat"><div class="cartao-stat__rotulo">Expirados agora</div><div class="cartao-stat__valor">${formatarNumero(resumo.expirados_agora)}</div></div>
  `;
}

document.getElementById('seletorOrigemNuvem')?.addEventListener('click', (evento) => {
  const botao = evento.target.closest('button[data-origem]');
  if (!botao) return;
  origemNuvemAtual = botao.dataset.origem;
  document.querySelectorAll('#seletorOrigemNuvem button').forEach((b) => b.classList.toggle('ativo', b === botao));
  carregarNuvem();
});

async function carregarNuvem() {
  const el = document.getElementById('conteudoNuvem');
  el.innerHTML = '<div class="carregando">Carregando…</div>';
  try {
    const dados = await chamarApi(`/api/analytics/nuvem?origem=${encodeURIComponent(origemNuvemAtual)}`);
    const legenda = document.getElementById('nuvemLegendaPeriodo');
    if (legenda && dados.desdeFormatado) legenda.textContent = `Desde ${dados.desdeFormatado}.`;
    renderizarNuvem(dados.palavras);
  } catch (erro) {
    el.innerHTML = elementoErro(erro.message);
  }
}

function embaralhar(lista) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

// Tamanho da fonte proporcional à frequência (14px a 44px) -- palavra mais
// citada fica bem maior que a menos citada, ordem embaralhada pra parecer
// nuvem de verdade em vez de ranking.
function renderizarNuvem(palavras) {
  const el = document.getElementById('conteudoNuvem');
  if (!palavras || palavras.length === 0) {
    el.innerHTML = '<div class="estado-vazio"><span class="estado-vazio__emoji">💬</span>Sem mensagens suficientes nesse período.</div>';
    return;
  }
  const contagens = palavras.map((p) => p.contagem);
  const max = Math.max(...contagens);
  const min = Math.min(...contagens);
  const itens = embaralhar(palavras)
    .map((p) => {
      const proporcao = max === min ? 1 : (p.contagem - min) / (max - min);
      const tamanho = (14 + proporcao * 30).toFixed(1);
      return `<span class="nuvem-palavras__item" style="font-size:${tamanho}px" title="${p.contagem}x">${escapar(p.palavra)}</span>`;
    })
    .join('');
  el.innerHTML = `<div class="nuvem-palavras">${itens}</div>`;
}

// ============================================================
// Pacientes
// ============================================================

let paginaAtualPacientes = 1;

function renderizarPaginacao(info) {
  const { pagina, totalPaginas, total } = info;
  if (totalPaginas <= 1) {
    return `<div class="paginacao__resumo">${formatarNumero(total)} paciente${total === 1 ? '' : 's'}</div>`;
  }
  return `
    <div class="paginacao">
      <span class="paginacao__resumo">${formatarNumero(total)} pacientes · página ${pagina} de ${totalPaginas}</span>
      <div class="paginacao__botoes">
        <button class="botao" data-pagina-pacientes="${pagina - 1}" ${pagina <= 1 ? 'disabled' : ''}>‹ Anterior</button>
        <button class="botao" data-pagina-pacientes="${pagina + 1}" ${pagina >= totalPaginas ? 'disabled' : ''}>Próxima ›</button>
      </div>
    </div>`;
}

function renderizarPacientes(resultado) {
  const alvo = document.getElementById('conteudoPacientes');
  const lista = resultado.pacientes;
  if (lista.length === 0) {
    alvo.innerHTML = '<div class="estado-vazio"><span class="estado-vazio__emoji">🔎</span>Nenhum paciente encontrado.</div>';
    return;
  }
  const linhas = lista
    .map(
      (p) => `
        <tr>
          <td>
            ${nomeExibicao(p.nome, p.apelido_whatsapp, '(sem nome)')}
            ${p.email ? `<div class="texto-fraco">${escapar(p.email)}</div>` : ''}
          </td>
          <td>${escapar(p.telefone || '—')}</td>
          <td>${escapar(p.criado_em_formatado || '—')}</td>
          <td>
            <div class="atendimento-toggle">
              <label class="switch-atendimento" title="${p.bot_disabled ? 'Devolver pra Lumi' : 'Pausar a Lumi pra esse paciente'}">
                <input type="checkbox" data-toggle-paciente="${p.id}" ${p.bot_disabled ? '' : 'checked'} />
                <span class="switch-atendimento__slider"></span>
              </label>
              <span class="selo ${p.bot_disabled ? 'selo-alerta' : 'selo-sucesso'}" data-selo-atendimento>${p.bot_disabled ? 'Com a equipe' : 'Lumi ativa'}</span>
            </div>
          </td>
          <td>
            <div class="atendimento-toggle">
              <label class="switch-atendimento" title="${p.consentimento_lembrete === true ? 'Desativar lembrete' : 'Ativar lembrete'}">
                <input type="checkbox" data-toggle-consentimento="${p.id}" ${p.consentimento_lembrete === true ? 'checked' : ''} />
                <span class="switch-atendimento__slider"></span>
              </label>
              <span class="selo ${
                p.consentimento_lembrete === true ? 'selo-sucesso' : p.consentimento_lembrete === false ? 'selo-neutro' : 'selo-neutro'
              }" data-selo-consentimento>${
                p.consentimento_lembrete === true ? 'Aceitou' : p.consentimento_lembrete === false ? 'Recusou' : 'Não perguntado'
              }</span>
            </div>
          </td>
        </tr>`
    )
    .join('');
  alvo.innerHTML = `
    <div class="tabela-scroll">
      <table class="tabela">
        <thead><tr><th>Paciente</th><th>Telefone</th><th>Cadastrado em</th><th>Atendimento</th><th>Lembrete</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
    ${renderizarPaginacao(resultado)}`;
}

async function carregarPacientes(busca, pagina = 1) {
  const alvo = document.getElementById('conteudoPacientes');
  paginaAtualPacientes = pagina;
  alvo.innerHTML = '<div class="carregando">Carregando…</div>';
  try {
    const resultado = await chamarApi(
      `/api/pacientes?busca=${encodeURIComponent(busca || '')}&pagina=${pagina}`
    );
    renderizarPacientes(resultado);
  } catch (erro) {
    alvo.innerHTML = elementoErro(erro.message);
  }
}

// Switch por linha: liga = Lumi ativa, desliga = pausa só pra esse
// paciente (equivalente a um handoff manual). Atualiza o selo na hora e
// desfaz o toggle se a chamada falhar.
document.getElementById('conteudoPacientes').addEventListener('change', async (evento) => {
  const inputAtendimento = evento.target.closest('input[data-toggle-paciente]');
  if (inputAtendimento) {
    const id = inputAtendimento.dataset.togglePaciente;
    const querAtivar = inputAtendimento.checked;
    const selo = inputAtendimento.closest('td').querySelector('[data-selo-atendimento]');
    inputAtendimento.disabled = true;
    try {
      await chamarApi(`/api/pacientes/${id}/${querAtivar ? 'retomar' : 'pausar'}`, { method: 'POST' });
      selo.textContent = querAtivar ? 'Lumi ativa' : 'Com a equipe';
      selo.className = `selo ${querAtivar ? 'selo-sucesso' : 'selo-alerta'}`;
      inputAtendimento.closest('label').title = querAtivar ? 'Pausar a Lumi pra esse paciente' : 'Devolver pra Lumi';
      carregarSuspensos();
    } catch (erro) {
      inputAtendimento.checked = !querAtivar;
      alert(erro.message);
    } finally {
      inputAtendimento.disabled = false;
    }
    return;
  }

  // Switch de consentimento de lembrete -- ajuste manual pra quando o
  // paciente pede diretamente pra secretária, sem passar pela Lumi.
  const inputConsentimento = evento.target.closest('input[data-toggle-consentimento]');
  if (inputConsentimento) {
    const id = inputConsentimento.dataset.toggleConsentimento;
    const querAceitar = inputConsentimento.checked;
    const selo = inputConsentimento.closest('td').querySelector('[data-selo-consentimento]');
    inputConsentimento.disabled = true;
    try {
      await chamarApi(`/api/pacientes/${id}/consentimento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consentimento: querAceitar }),
      });
      selo.textContent = querAceitar ? 'Aceitou' : 'Recusou';
      selo.className = `selo ${querAceitar ? 'selo-sucesso' : 'selo-neutro'}`;
      inputConsentimento.closest('label').title = querAceitar ? 'Desativar lembrete' : 'Ativar lembrete';
    } catch (erro) {
      inputConsentimento.checked = !querAceitar;
      alert(erro.message);
    } finally {
      inputConsentimento.disabled = false;
    }
  }
});

document.getElementById('conteudoPacientes').addEventListener('click', (evento) => {
  const botao = evento.target.closest('button[data-pagina-pacientes]');
  if (!botao || botao.disabled) return;
  const pagina = parseInt(botao.dataset.paginaPacientes, 10);
  carregarPacientes(document.getElementById('buscaPacientes').value, pagina);
});

let temporizadorBusca = null;
document.getElementById('buscaPacientes').addEventListener('input', (evento) => {
  clearTimeout(temporizadorBusca);
  const valor = evento.target.value;
  temporizadorBusca = setTimeout(() => carregarPacientes(valor, 1), 300);
});

// ============================================================
// Badges na barra lateral
// ============================================================

function atualizarBadgePendencias(quantidade) {
  const el = document.getElementById('badgePendencias');
  el.textContent = quantidade > 0 ? quantidade : '';
  el.dataset.zero = quantidade > 0 ? 'false' : 'true';
}

function atualizarBadges(quantidadeSuspensos) {
  if (typeof quantidadeSuspensos === 'number') {
    const el = document.getElementById('badgeSuspensos');
    el.textContent = quantidadeSuspensos > 0 ? quantidadeSuspensos : '';
    el.dataset.zero = quantidadeSuspensos > 0 ? 'false' : 'true';
  }
}

// ============================================================
// Status global (equivalente a ##pausar / ##retomar)
// ============================================================

async function carregarStatusGlobal() {
  try {
    const status = await chamarApi('/api/status-global');
    renderizarStatusGlobal(status);
  } catch (erro) {
    document.getElementById('statusBotTexto').textContent = 'Falha ao carregar status';
  }
}

function renderizarStatusGlobal(status) {
  const pausado = !!status.bot_pausado;

  const ponto = document.getElementById('statusBotPonto');
  const texto = document.getElementById('statusBotTexto');
  const detalhe = document.getElementById('statusBotDetalhe');
  const botao = document.getElementById('botaoStatusBot');
  const banner = document.getElementById('bannerPausado');
  const bannerDetalhe = document.getElementById('bannerPausadoDetalhe');

  ponto.className = `status-bot__ponto ${pausado ? 'pausado' : 'ativo'}`;
  texto.textContent = pausado ? 'Lumi pausada' : 'Lumi ativa';

  if (pausado) {
    detalhe.textContent = status.pausado_em_formatado
      ? `Pausada em ${status.pausado_em_formatado}${status.pausado_por ? ` por ${status.pausado_por}` : ''}.`
      : 'Pausada.';
    botao.textContent = 'Retomar Lumi';
    botao.dataset.acao = 'retomar';
    banner.hidden = false;
    bannerDetalhe.textContent = status.pausado_em_formatado ? `Desde ${status.pausado_em_formatado}.` : '';
  } else {
    detalhe.textContent = status.retomado_em_formatado ? `Retomada em ${status.retomado_em_formatado}.` : 'Respondendo normalmente.';
    botao.textContent = 'Pausar Lumi';
    botao.dataset.acao = 'pausar';
    banner.hidden = true;
  }
  botao.hidden = false;
}

async function alterarStatusGlobal(acao) {
  const confirmacoes = {
    pausar: 'Pausar a Lumi para TODOS os pacientes agora? Ninguém vai receber resposta automática até você retomar.',
    retomar: 'Retomar a Lumi para todos os pacientes agora?',
  };
  if (!confirm(confirmacoes[acao])) return;

  const botoes = [document.getElementById('botaoStatusBot'), document.getElementById('botaoRetomarBanner')];
  botoes.forEach((b) => (b.disabled = true));
  try {
    await chamarApi(`/api/status-global/${acao}`, { method: 'POST' });
    await carregarStatusGlobal();
  } catch (erro) {
    alert(erro.message);
  } finally {
    botoes.forEach((b) => (b.disabled = false));
  }
}

document.getElementById('botaoStatusBot').addEventListener('click', (evento) => {
  alterarStatusGlobal(evento.target.dataset.acao);
});
document.getElementById('botaoRetomarBanner').addEventListener('click', () => alterarStatusGlobal('retomar'));

// ============================================================
// Configurações (horários de atendimento)
// ============================================================

const DIAS_CONFIGURACAO_HORARIOS = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'];

// "08:30, 09:30, 10:30" -> ["08:30", "09:30", "10:30"] -- aceita espaços
// variados e ignora entradas vazias (campo em branco = dia sem expediente).
function parseListaHorarios(texto) {
  return (texto || '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
}

async function carregarConfiguracaoHorarios() {
  const feedback = document.getElementById('configuracaoHorariosFeedback');
  feedback.textContent = '';
  feedback.className = 'form-configuracao-horarios__feedback';
  try {
    const config = await chamarApi('/api/configuracoes/horarios');
    for (const dia of DIAS_CONFIGURACAO_HORARIOS) {
      const campo = document.querySelector(`[data-dia="${dia}"]`);
      if (campo) campo.value = (config.horarios[dia] || []).join(', ');
    }
    document.getElementById('configuracaoDuracaoConsulta').value = config.duracaoConsultaMinutos;
    document.getElementById('configuracaoSabadoReferencia').value = config.sabadoDataReferencia || '';
  } catch (erro) {
    feedback.textContent = erro.message;
    feedback.className = 'form-configuracao-horarios__feedback form-configuracao-horarios__feedback--erro';
  }
}

document.getElementById('formConfiguracaoHorarios').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const feedback = document.getElementById('configuracaoHorariosFeedback');
  const botao = evento.target.querySelector('button[type="submit"]');

  const horarios = {};
  for (const dia of DIAS_CONFIGURACAO_HORARIOS) {
    horarios[dia] = parseListaHorarios(document.querySelector(`[data-dia="${dia}"]`).value);
  }
  const duracaoConsultaMinutos = Number(document.getElementById('configuracaoDuracaoConsulta').value);
  const sabadoDataReferencia = document.getElementById('configuracaoSabadoReferencia').value || null;

  botao.disabled = true;
  botao.textContent = 'Salvando…';
  feedback.textContent = '';
  feedback.className = 'form-configuracao-horarios__feedback';
  try {
    await chamarApi('/api/configuracoes/horarios', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ horarios, duracaoConsultaMinutos, sabadoDataReferencia }),
    });
    // carregarConfiguracaoHorarios() reseta o feedback no início (pra
    // limpar erro de uma tentativa anterior) -- por isso a mensagem de
    // sucesso só é escrita DEPOIS do reload, senão ele mesmo apaga a
    // mensagem que acabou de mostrar.
    await carregarConfiguracaoHorarios();
    feedback.textContent = 'Salvo! Pode levar até 1 minuto pra valer na Lumi.';
    feedback.className = 'form-configuracao-horarios__feedback form-configuracao-horarios__feedback--sucesso';
  } catch (erro) {
    feedback.textContent = erro.message;
    feedback.className = 'form-configuracao-horarios__feedback form-configuracao-horarios__feedback--erro';
  } finally {
    botao.disabled = false;
    botao.textContent = 'Salvar';
  }
});

// ============================================================
// Lições aprendidas (análise semanal de intervenções da equipe)
// ============================================================

const ROTULOS_TIPO_SUGESTAO = { prompt: 'Ajuste de prompt', codigo: 'Ajuste de código', harness_only: 'Só cenário de teste' };
const ROTULOS_CONFIANCA = { alta: 'Confiança alta', media: 'Confiança média', baixa: 'Confiança baixa' };

async function carregarLicoesAprendidas() {
  const alvo = document.getElementById('conteudoLicoesAprendidas');
  try {
    const lista = await chamarApi('/api/licoes-aprendidas');
    if (lista.length === 0) {
      alvo.innerHTML =
        '<div class="estado-vazio"><span class="estado-vazio__emoji">🧠</span>Nenhum achado ainda. A análise semanal ainda não rodou, ou não encontrou nenhuma correção real nas últimas rodadas.</div>';
      return;
    }
    alvo.innerHTML = lista.map(renderizarLicaoAprendida).join('');
  } catch (erro) {
    alvo.innerHTML = elementoErro(erro.message);
  }
}

function renderizarLicaoAprendida(l) {
  const seloStatus =
    l.status === 'pendente'
      ? '<span class="selo selo-urgente">Aguardando revisão</span>'
      : l.status === 'aprovado'
        ? '<span class="selo selo-neutro">Aprovado — aguardando aplicação</span>'
        : l.status === 'aplicado'
          ? '<span class="selo selo-neutro">Aplicado</span>'
          : '<span class="selo selo-neutro">Rejeitado</span>';
  return `
    <div class="cartao-licao" data-linha-licao="${l.id}">
      <div class="cartao-licao__cabecalho">
        ${seloStatus}
        <span class="selo selo-neutro">${escapar(ROTULOS_TIPO_SUGESTAO[l.tipo_sugestao] || l.tipo_sugestao)}</span>
        <span class="selo selo-neutro">${escapar(ROTULOS_CONFIANCA[l.confianca] || l.confianca)}</span>
        <span class="texto-fraco">período ${escapar(l.periodo_inicio || '')} – ${escapar(l.periodo_fim || '')}</span>
      </div>
      <div class="cartao-licao__paciente">
        ${nomeExibicao(l.paciente_nome, l.paciente_apelido_whatsapp, l.paciente_telefone ? '(paciente sem nome salvo)' : '(sem paciente vinculado)')}
        ${l.paciente_telefone ? `<span class="texto-fraco"> · ${escapar(l.paciente_telefone)}</span>` : ''}
      </div>
      <p class="cartao-licao__resumo">${escapar(l.resumo || '')}</p>
      ${l.trecho_sugerido ? `<pre class="cartao-licao__trecho">${escapar(l.trecho_sugerido)}</pre>` : ''}
      ${
        l.status === 'pendente'
          ? `
        <div class="cartao-licao__acoes">
          <input type="text" class="cartao-licao__comentario" data-comentario="${l.id}" placeholder="Comentário (opcional)" />
          <button class="botao botao-primario" data-decidir="${l.id}" data-decisao="aprovado">Aprovar</button>
          <button class="botao" data-decidir="${l.id}" data-decisao="rejeitado">Rejeitar</button>
        </div>`
          : `
        <div class="texto-fraco">
          Decidido em ${escapar(l.decidido_em_formatado || '—')}${l.comentario_tiago ? ` — "${escapar(l.comentario_tiago)}"` : ''}
        </div>`
      }
    </div>`;
}

document.getElementById('conteudoLicoesAprendidas').addEventListener('click', async (evento) => {
  const botao = evento.target.closest('button[data-decidir]');
  if (!botao) return;
  const id = botao.dataset.decidir;
  const decisao = botao.dataset.decisao;
  const campoComentario = document.querySelector(`[data-comentario="${id}"]`);
  const comentario = campoComentario ? campoComentario.value : '';
  const cartao = document.querySelector(`[data-linha-licao="${id}"]`);
  cartao.querySelectorAll('button[data-decidir]').forEach((b) => (b.disabled = true));
  try {
    await chamarApi(`/api/licoes-aprendidas/${id}/decidir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisao, comentario }),
    });
    await carregarLicoesAprendidas();
  } catch (erro) {
    alert(erro.message);
    cartao.querySelectorAll('button[data-decidir]').forEach((b) => (b.disabled = false));
  }
});

// Badges e status carregam de leve assim que a página abre, mesmo antes de
// o usuário clicar na seção -- pra secretária ver de cara se tem algo
// pendente ou se a Lumi está pausada, sem precisar navegar.
carregarPendencias();
carregarSuspensos();
carregarAnalytics();
carregarStatusGlobal();
// Agenda depende de automação de navegador contra o Simples Dental (lenta,
// alguns segundos) -- pré-carrega as 4 semanas aqui, em segundo plano,
// assim quando a secretária clicar em Agenda já tem algo na tela na hora
// (mostrarAgenda só busca de novo se essa semana ainda não estiver em
// cache -- ver comentário perto de agendaCacheAteSemanas).
atualizarAgendaCompleta();

// ============================================================
// Atualização automática
// ============================================================

// Refresca sozinho o que é leve e não atrapalha se recarregar por baixo do
// usuário (badges, status da Lumi, e a seção de Visão Geral se for a que
// está aberta). Pendências e Atendimento Humano têm poucas linhas e são
// sempre recarregadas -- é o mesmo dado que já mostramos na sidebar.
// Pacientes fica de fora: recarregar embaixo de uma busca em andamento
// atrapalharia mais do que ajudaria; lá o F5/troca de página já resolve.
const INTERVALO_ATUALIZACAO_MS = 45000;

setInterval(() => {
  if (document.hidden) return; // aba em segundo plano -- não gasta query à toa
  carregarPendencias();
  carregarSuspensos();
  carregarStatusGlobal();
  if (document.getElementById('secao-visao-geral').classList.contains('ativa')) {
    carregarAnalytics();
  }
}, INTERVALO_ATUALIZACAO_MS);

// ============================================================
// Sair
// ============================================================

document.getElementById('botaoSair').addEventListener('click', async () => {
  await fetch('/logout', { method: 'POST' }).catch(() => {});
  window.location.href = '/login';
});
