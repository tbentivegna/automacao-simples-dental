// Backup lógico de todas as bases de dados reais do projeto -- não usa
// pg_dump (binário não instalado nesta máquina), puro Node + pg, mesmo
// padrão do resto do repo (zero dependência de ferramenta externa).
//
// O schema já é 100% recuperável via `db/migrations/` (versionado no
// git) -- o único dado que precisa de backup de verdade são as LINHAS de
// cada tabela. Exporta tudo em JSON (um arquivo por banco por execução,
// comprimido em gzip), local em `backups/<nome>/`.
//
// Credenciais nunca ficam duplicadas num arquivo novo -- lê o
// DATABASE_URL direto dos .env que já existem (dotenv.parse, sem tocar
// em process.env, então rodar pra 2+ bancos na mesma execução nunca
// corre risco do 2º herdar a URL do 1º por engano).
//
// uso: node scripts/backup-postgres.js
// config: scripts/backup-databases.json (gitignored -- ver .example.json)
'use strict';

const { Pool } = require('pg');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CONFIG_PATH = path.join(__dirname, 'backup-databases.json');
const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const RETENCAO_DIAS = 14;

function carregarDatabaseUrl(envPathRelativo) {
  const caminhoAbsoluto = path.join(__dirname, envPathRelativo);
  if (!fs.existsSync(caminhoAbsoluto)) {
    throw new Error(`.env não encontrado: ${caminhoAbsoluto}`);
  }
  const parsed = dotenv.parse(fs.readFileSync(caminhoAbsoluto, 'utf8'));
  if (!parsed.DATABASE_URL) {
    throw new Error(`DATABASE_URL não encontrada em ${envPathRelativo}`);
  }
  return parsed.DATABASE_URL;
}

async function backupBanco(nome, databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false });
  try {
    const { rows: tabelas } = await pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );

    const dump = {};
    let totalLinhas = 0;
    for (const { tablename } of tabelas) {
      const { rows } = await pool.query(`SELECT * FROM "${tablename}"`);
      dump[tablename] = rows;
      totalLinhas += rows.length;
    }

    const dataHora = new Date().toISOString().replace(/[:.]/g, '-');
    const dirBanco = path.join(BACKUP_DIR, nome);
    fs.mkdirSync(dirBanco, { recursive: true });
    const arquivo = path.join(dirBanco, `${dataHora}.json.gz`);
    const conteudo = JSON.stringify({ banco: nome, geradoEm: new Date().toISOString(), tabelas: dump });
    fs.writeFileSync(arquivo, zlib.gzipSync(conteudo));

    return { nome, tabelas: tabelas.length, linhas: totalLinhas, arquivo };
  } finally {
    await pool.end();
  }
}

function podarAntigos(nome) {
  const dirBanco = path.join(BACKUP_DIR, nome);
  if (!fs.existsSync(dirBanco)) return 0;
  const limite = Date.now() - RETENCAO_DIAS * 24 * 60 * 60 * 1000;
  let removidos = 0;
  for (const arquivo of fs.readdirSync(dirBanco)) {
    const caminho = path.join(dirBanco, arquivo);
    if (fs.statSync(caminho).mtimeMs < limite) {
      fs.unlinkSync(caminho);
      removidos++;
    }
  }
  return removidos;
}

async function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `Config não encontrada: ${CONFIG_PATH}. Copie scripts/backup-databases.example.json pra scripts/backup-databases.json e preencha.`
    );
  }
  const bases = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  console.log(`[backup] iniciando -- ${bases.length} banco(s) configurado(s)`);

  const resultados = [];
  for (const { nome, envPath } of bases) {
    try {
      const databaseUrl = carregarDatabaseUrl(envPath);
      const resultado = await backupBanco(nome, databaseUrl);
      const podados = podarAntigos(nome);
      console.log(
        `[backup] ${nome}: ${resultado.tabelas} tabelas, ${resultado.linhas} linhas -> ${resultado.arquivo} (${podados} backup(s) antigo(s) removido(s), retenção ${RETENCAO_DIAS}d)`
      );
      resultados.push({ nome, ok: true });
    } catch (erro) {
      console.error(`[backup] ERRO em "${nome}":`, erro.message);
      resultados.push({ nome, ok: false, erro: erro.message });
    }
  }

  const falhas = resultados.filter((r) => !r.ok);
  if (falhas.length > 0) {
    console.error(`[backup] ${falhas.length} de ${resultados.length} banco(s) falharam.`);
    process.exit(1);
  }
  console.log('[backup] concluído -- todos os bancos ok.');
}

main().catch((erro) => {
  console.error('[backup] ERRO FATAL:', erro.message);
  process.exit(1);
});
