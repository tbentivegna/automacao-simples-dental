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
      if (previewMensagensAberto) {
        // usuário está dentro da conversa de UM paciente -- reabre a mesma
        // conversa, não a lista do card (ver previewMensagensAberto acima).
        const { telefone, nome } = previewMensagensAberto;
        abrirPreviewMensagens(telefone, nome);
      } else {
        container.innerHTML = '<div class="carregando">Carregando…</div>';
        renderizarDetalheCard(cardAberto, container).catch((erro) => {
          container.innerHTML = elementoErro(erro.message);
        });
      }
    }
  } catch (erro) {
    alvo.innerHTML = elementoErro(erro.message);
  }
}

// ------------------------------------------------------------
// Drill-down dos cards (clicar num card mostra detalhe embaixo do grid)
// ------------------------------------------------------------

let cardAberto = null;

// Quando o usuário entra na conversa de UM paciente dentro do card
// "mensagens_trocadas", guarda quem é -- senão o refresh automático de 45s
// (carregarAnalytics) só sabia reabrir a LISTA do card, jogando o usuário de
// volta pra fora da conversa que ele estava lendo.
let previewMensagensAberto = null;

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

function envolverDetalhe(titulo, corpoHtml, linkSecao, comVoltar) {
  return `
    <div class="painel__cabecalho detalhe-card__cabecalho">
      ${comVoltar ? '<button class="detalhe-card__voltar" data-voltar-mensagens>‹ Voltar</button>' : ''}
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
        <tr class="linha-clicavel" data-preview-mensagens="${escapar(m.telefone)}" data-preview-nome="${escapar(m.nome || m.apelido_whatsapp || m.telefone || '')}">
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
  previewMensagensAberto = null;

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

async function abrirPreviewMensagens(telefone, nome) {
  const container = document.getElementById('detalheCard');
  if (!container) return;
  previewMensagensAberto = { telefone, nome };
  container.innerHTML = '<div class="carregando">Carregando…</div>';
  try {
    const mensagens = await chamarApi(`/api/mensagens?telefone=${encodeURIComponent(telefone)}`);
    const bolhas = mensagens
      .map((m) => {
        const chamouTool = m.tipo === 'ai' && (!m.conteudo || m.conteudo === '[]') && m.tool_chamada;
        if (chamouTool) {
          return `
            <div class="bolha-mensagem bolha-mensagem--tool">
              <div class="bolha-mensagem__texto">🔧 chamou ${escapar(nomeLegivelTool(m.tool_chamada))}</div>
              <div class="bolha-mensagem__hora">${escapar(m.enviado_em_formatado || '')}</div>
            </div>`;
        }
        return `
          <div class="bolha-mensagem ${m.tipo === 'human' ? 'bolha-mensagem--paciente' : 'bolha-mensagem--lumi'}">
            <div class="bolha-mensagem__texto">${escapar(m.conteudo || '')}</div>
            <div class="bolha-mensagem__hora">${escapar(m.enviado_em_formatado || '')}</div>
          </div>`;
      })
      .join('');
    container.innerHTML = envolverDetalhe(
      nome || 'Conversa',
      `<div class="preview-conversa">${bolhas || vazioDetalhe('Sem mensagens registradas pra esse paciente.')}</div>`,
      null,
      true
    );
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

  const voltar = evento.target.closest('[data-voltar-mensagens]');
  if (voltar) {
    previewMensagensAberto = null;
    const container = document.getElementById('detalheCard');
    if (container && cardAberto) {
      container.innerHTML = '<div class="carregando">Carregando…</div>';
      renderizarDetalheCard(cardAberto, container).catch((erro) => {
        container.innerHTML = elementoErro(erro.message);
      });
    }
    return;
  }

  const linhaMensagens = evento.target.closest('[data-preview-mensagens]');
  if (linhaMensagens) {
    return abrirPreviewMensagens(linhaMensagens.dataset.previewMensagens, linhaMensagens.dataset.previewNome);
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
      <table class="tabela">
        <thead><tr><th>Paciente</th><th>Status</th><th>Assumido em</th><th>Tempo parado</th><th></th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>`;
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
      <table class="tabela">
        <thead><tr><th></th><th>Paciente</th><th>Domínio</th><th>Detalhe</th><th>Aberta em</th><th></th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>`;
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
  if (o.atendimento_humano_ativo) return 'Com atendimento humano — resgate automático não entra';
  if (o.paciente_ja_respondeu_depois) return 'Paciente já respondeu — resgate automático não será enviado';
  const horas = Number(o.horas_desde_ultima_interacao);
  if (horas < 4) return 'Aguardando (dentro do prazo normal de resposta)';
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
        ? `<details class="popover-mensagem">
             <summary class="botao-ver">Ver</summary>
             <div class="balao-mensagem">${escapar(o.ultima_mensagem_paciente)}</div>
           </details>`
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

// Badges e status carregam de leve assim que a página abre, mesmo antes de
// o usuário clicar na seção -- pra secretária ver de cara se tem algo
// pendente ou se a Lumi está pausada, sem precisar navegar.
carregarPendencias();
carregarSuspensos();
carregarAnalytics();
carregarStatusGlobal();

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
