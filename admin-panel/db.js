'use strict';

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não configurada -- veja .env.example.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
});

// Colunas "timestamp without time zone" neste banco (created_at, last_handoff
// etc.) já guardam hora local de Brasília, sem conversão nenhuma -- mesma
// suposição operacional usada no resto do projeto (server.js: FUSO =
// 'America/Sao_Paulo'). Só as colunas "with time zone" (processando_desde,
// consentimento_lembrete_em, n8n_chat_histories.created_at) precisam de
// conversão de verdade -- fixamos o timezone da sessão pra isso funcionar
// certo em qualquer to_char()/formatação feita direto no SQL, sem depender
// de o driver Node fazer a conversão (evita bug de fuso silencioso).
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
