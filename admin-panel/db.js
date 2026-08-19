'use strict';

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não configurada -- veja .env.example.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
});

// ATENÇÃO: cliente.created_at, cliente.last_handoff e agent_actions.created_at
// são "timestamp without time zone" mas guardam hora UTC por baixo -- são
// gravadas por nodes Postgres do n8n usando now() puro, numa sessão cuja
// timezone é UTC (não Brasília). Toda leitura dessas 3 colunas precisa
// reinterpretar o valor com "AT TIME ZONE 'UTC'" antes de formatar/comparar
// (ver queries.js) -- confirmado na prática em 19/08/2026 (painel mostrando
// horário 3h à frente do real). As colunas "with time zone" de verdade
// (processando_desde, consentimento_lembrete_em, n8n_chat_histories.created_at,
// eventos_agenda.criado_em, controle_sistema.pausado_em/retomado_em) não têm
// esse problema -- fixamos o timezone da sessão só pra elas formatarem certo
// em qualquer to_char() feito direto no SQL, sem depender do driver Node.
pool.on('connect', (client) => {
  client.query("SET TIME ZONE 'America/Sao_Paulo';").catch((erro) => {
    console.error('[db] falha ao fixar timezone da sessão:', erro.message);
  });
});

pool.on('error', (erro) => {
  // Erros em clientes ociosos do pool não devem derrubar o processo.
  console.error('[db] erro inesperado no pool:', erro.message);
});

module.exports = { pool };
