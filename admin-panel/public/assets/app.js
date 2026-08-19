'use strict';

// ============================================================
// Util
// ============================================================

function escapar(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
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
  pacientes: () => carregarPacientes(document.getElementById('buscaPacientes').value),
};

document.querySelectorAll('.nav__item[data-secao]').forEach((botao) => {
  botao.addEventListener('click', () => irParaSecao(botao.dataset.secao));
});

function irParaSecao(nome) {
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
        <div class="cartao-stat"><div class="cartao-stat__rotulo">Consultas criadas</div><div class="cartao-stat__valor">${formatarNumero(ag.criados)}</div></div>
        <div class="cartao-stat"><div class="cartao-stat__rotulo">Confirmadas</div><div class="cartao-stat__valor">${formatarNumero(ag.confirmados)}</div></div>
        <div class="cartao-stat"><div class="cartao-stat__rotulo">Canceladas</div><div class="cartao-stat__valor">${formatarNumero(ag.cancelados)}</div></div>
        <div class="cartao-stat"><div class="cartao-stat__rotulo">Remarcadas</div><div class="cartao-stat__valor">${formatarNumero(ag.remarcados)}</div></div>
        <div class="cartao-stat"><div class="cartao-stat__rotulo">Lembretes enviados</div><div class="cartao-stat__valor">${formatarNumero(ag.lembretes_enviados)}</div></div>
        <div class="cartao-stat"><div class="cartao-stat__rotulo">Novos pacientes</div><div class="cartao-stat__valor">${formatarNumero(d.novos_pacientes)}</div></div>
        <div class="cartao-stat"><div class="cartao-stat__rotulo">Mensagens trocadas</div><div class="cartao-stat__valor">${formatarNumero(d.mensagens_trocadas)}</div></div>
        <div class="cartao-stat"><div class="cartao-stat__rotulo">Pendências em aberto</div><div class="cartao-stat__valor${Number(pend.urgentes_em_aberto) > 0 ? ' destaque-urgente' : ''}">${formatarNumero(pend.total_em_aberto)}</div></div>
        <div class="cartao-stat"><div class="cartao-stat__rotulo">Urgências em aberto</div><div class="cartao-stat__valor${Number(pend.urgentes_em_aberto) > 0 ? ' destaque-urgente' : ''}">${formatarNumero(pend.urgentes_em_aberto)}</div></div>
        <div class="cartao-stat"><div class="cartao-stat__rotulo">Com atendimento humano</div><div class="cartao-stat__valor${Number(d.pacientes_com_lumi_suspensa) > 0 ? ' destaque-alerta' : ''}">${formatarNumero(d.pacientes_com_lumi_suspensa)}</div></div>
      </div>
      ${categorias ? `<div class="painel"><div class="painel__cabecalho">Consultas criadas por categoria</div><div style="padding:16px 20px; display:flex; flex-wrap:wrap; gap:8px;">${categorias}</div></div>` : ''}
    `;

    atualizarBadges();
  } catch (erro) {
    alvo.innerHTML = elementoErro(erro.message);
  }
}

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
              <div class="nome-paciente">${escapar(p.nome || '(sem nome)')}</div>
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
              <div class="nome-paciente">${escapar(p.paciente_nome || '(paciente não identificado)')}</div>
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
// Pacientes
// ============================================================

function renderizarPacientes(lista) {
  const alvo = document.getElementById('conteudoPacientes');
  if (lista.length === 0) {
    alvo.innerHTML = '<div class="estado-vazio"><span class="estado-vazio__emoji">🔎</span>Nenhum paciente encontrado.</div>';
    return;
  }
  const linhas = lista
    .map(
      (p) => `
        <tr>
          <td>
            <div class="nome-paciente">${escapar(p.nome || '(sem nome)')}</div>
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
          <td>${
            p.consentimento_lembrete === true
              ? '<span class="selo selo-sucesso">Aceitou</span>'
              : p.consentimento_lembrete === false
                ? '<span class="selo selo-neutro">Recusou</span>'
                : '<span class="selo selo-neutro">Não perguntado</span>'
          }</td>
        </tr>`
    )
    .join('');
  alvo.innerHTML = `
    <table class="tabela">
      <thead><tr><th>Paciente</th><th>Telefone</th><th>Cadastrado em</th><th>Atendimento</th><th>Lembrete</th></tr></thead>
      <tbody>${linhas}</tbody>
    </table>`;
}

async function carregarPacientes(busca) {
  const alvo = document.getElementById('conteudoPacientes');
  try {
    const lista = await chamarApi(`/api/pacientes?busca=${encodeURIComponent(busca || '')}`);
    renderizarPacientes(lista);
  } catch (erro) {
    alvo.innerHTML = elementoErro(erro.message);
  }
}

// Switch por linha: liga = Lumi ativa, desliga = pausa só pra esse
// paciente (equivalente a um handoff manual). Atualiza o selo na hora e
// desfaz o toggle se a chamada falhar.
document.getElementById('conteudoPacientes').addEventListener('change', async (evento) => {
  const input = evento.target.closest('input[data-toggle-paciente]');
  if (!input) return;
  const id = input.dataset.togglePaciente;
  const querAtivar = input.checked;
  const selo = input.closest('td').querySelector('[data-selo-atendimento]');
  input.disabled = true;
  try {
    await chamarApi(`/api/pacientes/${id}/${querAtivar ? 'retomar' : 'pausar'}`, { method: 'POST' });
    selo.textContent = querAtivar ? 'Lumi ativa' : 'Com a equipe';
    selo.className = `selo ${querAtivar ? 'selo-sucesso' : 'selo-alerta'}`;
    input.closest('label').title = querAtivar ? 'Pausar a Lumi pra esse paciente' : 'Devolver pra Lumi';
    carregarSuspensos();
  } catch (erro) {
    input.checked = !querAtivar;
    alert(erro.message);
  } finally {
    input.disabled = false;
  }
});

let temporizadorBusca = null;
document.getElementById('buscaPacientes').addEventListener('input', (evento) => {
  clearTimeout(temporizadorBusca);
  const valor = evento.target.value;
  temporizadorBusca = setTimeout(() => carregarPacientes(valor), 300);
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
// Sair
// ============================================================

document.getElementById('botaoSair').addEventListener('click', async () => {
  await fetch('/logout', { method: 'POST' }).catch(() => {});
  window.location.href = '/login';
});
