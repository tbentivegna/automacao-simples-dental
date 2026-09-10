// Semeia public.profissionais (+ public.profissional_horarios) a partir de
// um JSON, e faz o backfill de consultas.profissional_id pro profissional
// padrão. Idempotente: upsert por `nome`.
//
// uso:  node db/seed-profissionais.js db/profissionais.aline.json
//       DATABASE_URL="postgres://.../lumi_standalone_teste" node db/seed-profissionais.js db/profissionais.demo.json
//
// Sem DATABASE_URL no ambiente, cai no .env da raiz (mesmo critério de
// db/run-migration.js).
'use strict';
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const arquivo = process.argv[2];
if (!arquivo) {
  console.error('uso: node db/seed-profissionais.js <arquivo.json>');
  process.exit(1);
}

const dados = JSON.parse(fs.readFileSync(path.isAbsolute(arquivo) ? arquivo : path.join(process.cwd(), arquivo), 'utf8'));
const lista = Array.isArray(dados) ? dados : dados.profissionais;
if (!Array.isArray(lista) || lista.length === 0) {
  console.error('JSON precisa ter um array `profissionais` (ou ser um array direto) com pelo menos 1 item.');
  process.exit(1);
}

const comPadrao = lista.filter((p) => p.padrao);
if (comPadrao.length > 1) {
  console.error(`Mais de um profissional marcado como "padrao" (${comPadrao.map((p) => p.nome).join(', ')}). Deixe só um.`);
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
});

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const p of lista) {
      if (!p.nome || !String(p.nome).trim()) throw new Error('cada profissional precisa de `nome`.');
      const especialidades = Array.isArray(p.especialidades) ? p.especialidades : [];

      const { rows } = await client.query(
        `INSERT INTO public.profissionais
           (nome, especialidades, especialidade_principal, aceita_primeira_consulta, ativo, padrao, cor, ordem, observacoes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (nome) DO UPDATE SET
           especialidades           = EXCLUDED.especialidades,
           especialidade_principal  = EXCLUDED.especialidade_principal,
           aceita_primeira_consulta = EXCLUDED.aceita_primeira_consulta,
           ativo                    = EXCLUDED.ativo,
           padrao                   = EXCLUDED.padrao,
           cor                      = EXCLUDED.cor,
           ordem                    = EXCLUDED.ordem,
           observacoes              = EXCLUDED.observacoes,
           atualizado_em            = now()
         RETURNING id, nome, padrao`,
        [
          String(p.nome).trim(),
          especialidades,
          p.especialidadePrincipal || p.especialidade_principal || null,
          p.aceitaPrimeiraConsulta !== undefined ? !!p.aceitaPrimeiraConsulta
            : p.aceita_primeira_consulta !== undefined ? !!p.aceita_primeira_consulta : true,
          p.ativo !== undefined ? !!p.ativo : true,
          !!p.padrao,
          p.cor || null,
          Number.isFinite(p.ordem) ? p.ordem : 0,
          p.observacoes || null,
        ]
      );
      const prof = rows[0];
      console.log(`  ${prof.padrao ? '★' : ' '} ${prof.nome}`);

      const horarios = p.horarios || (p.profissionalHorarios && p.profissionalHorarios.horarios);
      if (horarios && typeof horarios === 'object') {
        await client.query(
          `INSERT INTO public.profissional_horarios
             (profissional_id, horarios, duracao_consulta_minutos, sabado_data_referencia)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (profissional_id) DO UPDATE SET
             horarios                 = EXCLUDED.horarios,
             duracao_consulta_minutos = EXCLUDED.duracao_consulta_minutos,
             sabado_data_referencia   = EXCLUDED.sabado_data_referencia,
             atualizado_em            = now()`,
          [
            prof.id,
            JSON.stringify(horarios),
            Number.isFinite(p.duracaoConsultaMinutos) ? p.duracaoConsultaMinutos : null,
            p.sabadoDataReferencia || null,
          ]
        );
        console.log(`      + expediente próprio`);
      }
    }

    // Garante que só o marcado no JSON fica como padrão (se algum foi marcado).
    if (comPadrao.length === 1) {
      await client.query(
        `UPDATE public.profissionais SET padrao = false, atualizado_em = now()
         WHERE padrao AND nome <> $1`,
        [String(comPadrao[0].nome).trim()]
      );
    }

    // Backfill: consulta sem profissional passa a ser do padrão.
    const padraoRow = await client.query('SELECT id, nome FROM public.profissionais WHERE padrao');
    if (padraoRow.rowCount === 1) {
      const r = await client.query(
        'UPDATE public.consultas SET profissional_id = $1, atualizado_em = now() WHERE profissional_id IS NULL',
        [padraoRow.rows[0].id]
      );
      console.log(`\nbackfill: ${r.rowCount} consulta(s) sem profissional -> ${padraoRow.rows[0].nome}`);
    } else {
      console.log('\nsem profissional padrão -> backfill de consultas pulado (profissional_id fica NULL, comportamento = hoje).');
    }

    await client.query('COMMIT');
    console.log('\nOK (commit)');
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ERRO (rollback):', erro.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
