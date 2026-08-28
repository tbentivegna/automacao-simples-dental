// Roda um arquivo de migration contra o Postgres do DATABASE_URL.
// uso: node db/run-migration.js 011_consultas.sql [012_outra.sql ...]
'use strict';
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const arquivos = process.argv.slice(2);
if (!arquivos.length) {
  console.error('uso: node db/run-migration.js <arquivo.sql> [mais.sql ...]');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
});

(async () => {
  for (const nome of arquivos) {
    const caminho = path.isAbsolute(nome) ? nome : path.join(__dirname, 'migrations', nome);
    const sql = fs.readFileSync(caminho, 'utf8');
    process.stdout.write(`\n>>> ${nome}\n`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      console.log('    OK (commit)');
    } catch (erro) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('    ERRO (rollback):', erro.message);
      client.release();
      await pool.end();
      process.exit(1);
    }
    client.release();
  }
  // resumo do que ficou
  const t = await pool.query(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN ('consultas', 'paciente_dependente')
      ORDER BY table_name, ordinal_position`
  );
  console.log('\n=== estrutura resultante ===');
  console.table(t.rows);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
