'use strict';

document.getElementById('formLogin').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const senha = document.getElementById('senha').value;
  const erroEl = document.getElementById('erroLogin');
  erroEl.hidden = true;

  try {
    const resposta = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senha }),
    });
    if (!resposta.ok) {
      const dados = await resposta.json().catch(() => ({}));
      erroEl.textContent = dados.erro || 'Não foi possível entrar.';
      erroEl.hidden = false;
      return;
    }
    window.location.href = '/';
  } catch (erro) {
    erroEl.textContent = 'Falha de conexão. Tente novamente.';
    erroEl.hidden = false;
  }
});
