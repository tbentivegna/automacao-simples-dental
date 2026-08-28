// Peca 6 do "Espelho da Agenda": popula public.paciente_dependente a partir
// da listagem de pacientes do Simples Dental (menores de 18).
//
// A planilha ja traz, pra cada menor, a coluna "Celular" = o WhatsApp da
// familia/responsavel (conferido: os 64 celulares batem 100% com um
// cliente cadastrado). O nome do paciente na planilha e a mesma string que
// aparece na agenda do SD -> casa com consultas.paciente_nome. Entao nao
// precisa navegar as fichas: da pra vincular direto.
//
// responsavel_telefone = 55<celular>@s.whatsapp.net  (formato de cliente.telefone)
// dependente_nome       = nome do paciente
// dependente_cpf        = CPF quando a planilha tem (38/64)
// dependente_nascimento = null (planilha so tem idade; nao e usado pelo guard)
//
// Idempotente (ON CONFLICT). Nao mexe em linhas ja existentes alem de
// completar o CPF se estava null.
//
// uso: node db/backfill/backfill-paciente-dependente.js [--dry]
'use strict';
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { Pool } = require('pg');

const DRY = process.argv.includes('--dry');
const { minors } = JSON.parse(fs.readFileSync(path.join(__dirname, 'minors-2026-08-11.json'), 'utf8'));

function jid(celular) {
  const d = String(celular || '').replace(/\D/g, '');
  if (!d) return null;
  return (d.startsWith('55') ? d : `55${d}`) + '@s.whatsapp.net';
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
});

(async () => {
  let inseridos = 0;
  let atualizados = 0;
  let semCelular = 0;
  const linhas = [];
  for (const m of minors) {
    const tel = jid(m.celular);
    if (!tel) { semCelular++; console.warn('  SEM CELULAR:', m.nome); continue; }
    linhas.push([tel, m.nome, m.cpf || null]);
  }

  if (DRY) {
    console.log(`[dry-run] ${linhas.length} upserts. Amostra:`);
    linhas.slice(0, 8).forEach((l) => console.log('  ', l[1], '->', l[0], l[2] ? `(cpf ${l[2]})` : '(sem cpf)'));
    await pool.end();
    return;
  }

  for (const [tel, nome, cpf] of linhas) {
    const r = await pool.query(
      `INSERT INTO public.paciente_dependente (responsavel_telefone, dependente_nome, dependente_cpf)
       VALUES ($1, $2, $3)
       ON CONFLICT (responsavel_telefone, dependente_nome) DO UPDATE SET
         dependente_cpf = COALESCE(public.paciente_dependente.dependente_cpf, EXCLUDED.dependente_cpf)
       RETURNING (xmax = 0) AS inserido`,
      [tel, nome, cpf]
    );
    if (r.rows[0].inserido) inseridos++;
    else atualizados++;
  }

  const tot = await pool.query('SELECT count(*)::int n FROM public.paciente_dependente');
  console.log(`\ninseridos: ${inseridos} | ja existiam (cpf completado se faltava): ${atualizados} | sem celular: ${semCelular}`);
  console.log(`total em paciente_dependente agora: ${tot.rows[0].n}`);
  await pool.end();
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
