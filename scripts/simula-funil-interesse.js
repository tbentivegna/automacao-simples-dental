// Script de SIMULAÇÃO (só leitura, não grava nada) -- testa a heurística
// proposta pra etapa "interesse" do funil de resgate contra o histórico
// real de conversas, pra avaliar antes de implementar de verdade.
'use strict';
require('dotenv').config({ path: __dirname + '/../admin-panel/.env' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
});

// Heurística proposta: palavras/expressões que indicam interesse real
// (dúvida sobre procedimento, valor, ou vontade de agendar) sem ainda ter
// chegado na oferta de horários.
const REGEX_INTERESSE =
  /\b(valor|quanto custa|pre[çc]o|como funciona|avalia[çc][ãa]o|avaliar|gostaria de (marcar|agendar)|marcar (uma )?consulta|agendar (uma )?consulta|d[úu]vida|indica[çc][ãa]o|procedimento)\b/i;

const HORAS_SILENCIO_CORTE = 4; // mesmo limiar já usado no funil de horário oferecido

async function main() {
  const { rows } = await pool.query(`
    SELECT session_id, message->>'content' as conteudo, created_at
    FROM n8n_chat_histories
    WHERE message->>'type' = 'human'
    ORDER BY session_id, created_at ASC;
  `);

  const porSessao = new Map();
  for (const r of rows) {
    if (!porSessao.has(r.session_id)) porSessao.set(r.session_id, []);
    porSessao.get(r.session_id).push(r);
  }

  const candidatos = [];

  for (const [telefone, msgs] of porSessao) {
    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i];
      if (!REGEX_INTERESSE.test(msg.conteudo || '')) continue;

      const proxima = msgs[i + 1];
      const horasAteProxima = proxima
        ? (new Date(proxima.created_at) - new Date(msg.created_at)) / 3600000
        : (Date.now() - new Date(msg.created_at)) / 3600000;

      const ficouSilencioso = horasAteProxima >= HORAS_SILENCIO_CORTE;

      candidatos.push({
        telefone,
        trechoMatch: msg.conteudo.slice(0, 140),
        quando: msg.created_at,
        horasAteProximaMsg: Number(horasAteProxima.toFixed(1)),
        ficouSilencioso,
        eraUltimaMensagemDoPaciente: !proxima,
      });
      break; // só a PRIMEIRA ocorrência por sessão importa pra abrir o funil
    }
  }

  console.log(`\n=== Simulação: heurística de "interesse" ===`);
  console.log(`Sessões analisadas: ${porSessao.size}`);
  console.log(`Mensagens que bateram na regex: ${candidatos.length}\n`);

  for (const c of candidatos) {
    const marcador = c.ficouSilencioso ? '🔴 TERIA disparado resgate' : '🟢 não dispararia (respondeu antes do limiar)';
    console.log(`--- ${c.telefone}`);
    console.log(`   trecho: "${c.trechoMatch}"`);
    console.log(`   silêncio depois: ${c.horasAteProximaMsg}h | ${marcador}`);
    if (c.ficouSilencioso) {
      const primeiroNome = 'Paciente'; // nome real seria buscado em cliente.nome no fluxo real
      console.log(
        `   texto de resgate proposto: "Oi! 🤎 Vi que você tinha perguntado: \\"${c.trechoMatch.slice(0, 80)}${c.trechoMatch.length > 80 ? '...' : ''}\\" -- ainda tem interesse? Fico à disposição pra te ajudar! 😊"`
      );
    }
    console.log();
  }

  const dispararia = candidatos.filter((c) => c.ficouSilencioso).length;
  console.log(`=== Resultado: ${dispararia} de ${candidatos.length} teriam disparado um resgate de "interesse" ===`);

  await pool.end();
}

main().catch((err) => {
  console.error('ERRO:', err.message);
  process.exit(1);
});
