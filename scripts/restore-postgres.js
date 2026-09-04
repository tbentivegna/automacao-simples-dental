// Restaura um dump gerado por backup-postgres.js num banco de destino.
// Pressupõe que o banco de destino já existe e já rodou TODAS as
// migrations de `db/migrations/` (schema idêntico ao original -- este
// script só repõe as LINHAS, não recria tabela nenhuma).
//
// Import com TRUNCATE + INSERT por tabela, dentro de uma única
// transação -- ou aplica tudo, ou nada (nunca deixa o banco pela metade
// se alguma tabela falhar no meio).
//
// uso: node scripts/restore-postgres.js <arquivo.json.gz> <DATABASE_URL_destino>
'use strict';

const { Pool } = require('pg');
const fs = require('fs');
const zlib = require('zlib');

async function main() {
  const [, , arquivoDump, databaseUrlDestino] = process.argv;
  if (!arquivoDump || !databaseUrlDestino) {
    console.error('uso: node scripts/restore-postgres.js <arquivo.json.gz> <DATABASE_URL_destino>');
    process.exit(1);
  }
  if (!fs.existsSync(arquivoDump)) {
    throw new Error(`Arquivo não encontrado: ${arquivoDump}`);
  }

  const dump = JSON.parse(zlib.gunzipSync(fs.readFileSync(arquivoDump)).toString('utf8'));
  console.log(`[restore] dump de "${dump.banco}", gerado em ${dump.geradoEm}`);

  const pool = new Pool({ connectionString: databaseUrlDestino, ssl: false });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const [tabela, linhas] of Object.entries(dump.tabelas)) {
      const existe = await client.query('SELECT to_regclass($1) AS existe', [`public.${tabela}`]);
      if (!existe.rows[0].existe) {
        throw new Error(`Tabela "${tabela}" não existe no destino -- rode as migrations antes de restaurar.`);
      }

      await client.query(`TRUNCATE TABLE "${tabela}" CASCADE`);
      if (linhas.length === 0) continue;

      const colunas = Object.keys(linhas[0]);
      const colunasSql = colunas.map((c) => `"${c}"`).join(', ');
      for (const linha of linhas) {
        const valores = colunas.map((c) => linha[c]);
        const placeholders = colunas.map((_, i) => `$${i + 1}`).join(', ');
        await client.query(`INSERT INTO "${tabela}" (${colunasSql}) VALUES (${placeholders})`, valores);
      }
      console.log(`[restore] ${tabela}: ${linhas.length} linha(s) restaurada(s)`);
    }

    await client.query('COMMIT');
    console.log('[restore] concluído -- transação commitada.');
  } catch (erro) {
    await client.query('ROLLBACK');
    console.error('[restore] ERRO -- transação desfeita, banco de destino não foi alterado:', erro.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((erro) => {
  console.error('[restore] ERRO FATAL:', erro.message);
  process.exit(1);
});
