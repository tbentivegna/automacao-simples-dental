'use strict';

// Cliente HTTP pro serviço de automação (server.js na raiz do repo) --
// mesma separação que queries.js já tem pro Postgres, só que pra API do
// bridge. fetch nativo (Node 20+, sem dependência nova).
const BRIDGE_URL = process.env.BRIDGE_URL;
const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY;

async function chamarBridge(caminho, opcoes = {}) {
  if (!BRIDGE_URL) throw new Error('BRIDGE_URL não configurada.');
  const resposta = await fetch(`${BRIDGE_URL}${caminho}`, {
    ...opcoes,
    headers: {
      'Content-Type': 'application/json',
      ...(BRIDGE_API_KEY ? { 'X-Bridge-Key': BRIDGE_API_KEY } : {}),
      ...(opcoes.headers || {}),
    },
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.erro || dados.detalhe || `Falha ao chamar ${caminho}`);
  return dados;
}

async function buscarAgendaSemana(semanas) {
  return chamarBridge(`/agenda-semana?semanas=${encodeURIComponent(semanas || 4)}`);
}

async function criarConsulta(payload) {
  return chamarBridge('/criar-agendamento', { method: 'POST', body: JSON.stringify(payload) });
}

async function mudarStatusConsulta({ idAgendamento, status, telefone }) {
  return chamarBridge('/alterar-status-agendamento', {
    method: 'POST',
    body: JSON.stringify({ idAgendamento, status, telefone }),
  });
}

async function remarcarConsulta(payload) {
  return chamarBridge('/remarcar-agendamento', { method: 'POST', body: JSON.stringify(payload) });
}

module.exports = { buscarAgendaSemana, criarConsulta, mudarStatusConsulta, remarcarConsulta };
