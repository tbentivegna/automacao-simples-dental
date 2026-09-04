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
  document.title = `Lumi — Painel Administrativo | ${nome}`;
  document.querySelectorAll('img[data-marca-lumi]').forEach((img) => {
    img.alt = `Lumi — Concierge Digital, ${nome}`;
  });

  if (config.mostrarSincronizarEspelho === false) {
    const botao = document.getElementById('botaoSincronizarEspelho');
    if (botao) botao.hidden = true;
  }
})();
