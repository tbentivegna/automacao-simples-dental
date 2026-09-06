'use strict';

// Aplica o nome da clínica (NOME_CLINICA no servidor, ver server.js) no
// título da aba e no alt da logo, e esconde "Sincronizar espelho" quando
// o backend não tem esse conceito (standalone-bridge). Roda em
// login.html E dashboard.html -- por isso é um arquivo à parte, carregado
// ANTES de login.js/app.js. GET /api/config é público de propósito (a
// tela de login roda isto antes de existir qualquer sessão).
(async function () {
  let config = {};
  try {
    config = await fetch('/api/config').then((r) => r.json());
  } catch (erro) {
    console.error('Falha ao carregar /api/config (mantendo textos padrão):', erro);
    return;
  }

  const nome = config.nomeClinica || 'Dra. Aline Bentivegna';
  // Marca própria (plano Advanced, 2026-09-06): quando o cliente tem sua
  // própria logo configurada (LOGO_CLIENTE_URL no servidor), troca a
  // identidade visual do painel -- logo, alt, subtítulo e título da aba --
  // pra não mostrar "Lumi". Sem isso configurado, comportamento de sempre.
  const marcaPropria = !!config.logoUrl;
  document.title = marcaPropria
    ? `${nome} — Painel de Gestão`
    : `Lumi — Painel Administrativo | ${nome}`;
  document.querySelectorAll('img[data-marca-lumi]').forEach((img) => {
    if (marcaPropria) img.src = config.logoUrl;
    img.alt = marcaPropria ? `Painel de Gestão, ${nome}` : `Lumi — Concierge Digital, ${nome}`;
  });
  // Nome da clínica como texto visível de verdade -- até 04/09 isso vinha
  // desenhado dentro do PNG da logo (só o alt, invisível, mudava por
  // instalação), então o nome real da Dra. Aline aparecia até no
  // painel_demo. Ver .marca-lumi-subtitulo em style.css.
  document.querySelectorAll('[data-marca-lumi-subtitulo]').forEach((el) => {
    el.textContent = marcaPropria ? 'Painel de Gestão' : `Concierge Digital — ${nome}`;
  });

  if (config.mostrarSincronizarEspelho === false) {
    const botao = document.getElementById('botaoSincronizarEspelho');
    if (botao) botao.hidden = true;
  }
})();
