// Corrige o nome pelo qual a Lumi trata a pessoa DENTRO do histórico de
// conversa (n8n_chat_histories).
//
// POR QUE ISTO EXISTE: quando a Lumi trata a responsável pelo nome da
// criança (bug de dependente -- casos reais Valentina/Yasmin e
// Guilherme/Carla), corrigir `public.cliente.nome` NÃO resolve. A cada
// mensagem nova o modelo relê o histórico, vê dezenas de "Olá Guilherme!"
// e repete o erro. O histórico é o que ancora o comportamento, então é ele
// que precisa ser corrigido.
//
// CUIDADO CENTRAL: um replace cego CORROMPE o histórico. No caso real da
// Valentina, o nome aparece 10 vezes e só 5 estão erradas -- nas outras é
// referência legítima à criança ("o agendamento da Valentina", "paciente
// Valentina Freitas de Lima"). Por isso este script classifica ocorrência
// por ocorrência, mostra tudo, e nunca escreve sem --aplicar.
//
// ESCOPO -- o que NUNCA é tocado:
//   - mensagens `human`: são as palavras da própria paciente
//   - mensagens `tool`: dados de sistema (resultado de ferramenta)
//   - mensagens que começam com "[Equipe da clínica]": escritas por uma
//     pessoa da clínica, que já usa os nomes corretamente (confirmado nos
//     dois casos reais -- a equipe trata "Carla" e se refere ao
//     "Guilherme" certinho; quem erra é só a Lumi)
//   - ocorrências REFERENCIAIS ("da Valentina", "paciente Guilherme",
//     "consulta do Guilherme"): falam da criança, e estão certas
//
// Sobra só o que interessa: a Lumi CHAMANDO a pessoa pelo nome errado.
//
// uso:
//   node scripts/corrigir-nome-no-historico.js --telefone 19988653740 --errado Valentina --certo Yasmin
//     (acima = SIMULAÇÃO, nada é escrito)
//   ... --aplicar
//     grava de verdade, dentro de uma transação, com backup automático das
//     linhas originais em public.n8n_chat_histories_backup_nome
require('dotenv').config({ path: __dirname + '/../.env' });
const { Pool } = require('pg');

const args = process.argv.slice(2);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : null;
};
const telefone = opt('--telefone');
const errado = opt('--errado');
const certo = opt('--certo');
const aplicar = args.includes('--aplicar');

if (!telefone || !errado || !certo) {
  console.error('uso: --telefone <numero> --errado <NomeErrado> --certo <NomeCerto> [--aplicar]');
  process.exit(1);
}

// Só nomes (letras/acentos) são aceitos -- assim o nome pode entrar direto
// numa RegExp sem escape, e some toda uma classe de erro de escaping.
const SO_LETRAS = /^[A-Za-zÀ-ÿ]+$/;
if (!SO_LETRAS.test(errado) || !SO_LETRAS.test(certo)) {
  console.error('ERRO: --errado e --certo devem ser um primeiro nome só, apenas letras (sem espaço, número ou pontuação).');
  process.exit(1);
}

const MARCADOR_EQUIPE = '[Equipe da clínica]';

// Palavras que, imediatamente antes do nome, indicam que ele está sendo
// REFERENCIADO (falando SOBRE a criança) e não usado como tratamento.
const ANTES_REFERENCIAL =
  /\b(?:d[aeo]s?|com|para|pel[ao]|paciente|crian[çc]a|filh[ao]|consulta|agendamento|atendimento|caso|tratamento|limpeza|retorno|avalia[çc][ãa]o)\s+(?:[ao]s?\s+)?$/i;

// Em posição de tratamento, consome também os sobrenomes que venham logo
// depois, senão "Oi, Guilherme Pérsico Caetano Chiaparini!" viraria
// "Oi, Carla Pérsico Caetano Chiaparini!".
const RE_NOME = new RegExp(`\\b${errado}\\b(?:\\s+[A-ZÀ-Ý][a-zà-ÿ]+)*`, 'g');

function corrigir(texto) {
  const decisoes = [];
  const novo = texto.replace(RE_NOME, (achado, offset) => {
    const antes = texto.slice(Math.max(0, offset - 40), offset);
    const referencial = ANTES_REFERENCIAL.test(antes);
    decisoes.push({
      achado,
      referencial,
      contexto: texto.slice(Math.max(0, offset - 40), offset + achado.length + 30).replace(/\s+/g, ' '),
    });
    return referencial ? achado : certo;
  });
  return { novo, decisoes };
}

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  const { rows } = await pool.query(
    `select id, message from n8n_chat_histories
      where session_id like $1
        and message->>'type' = 'ai'
        and message->>'content' ilike $2
      order by id`,
    [`%${telefone}%`, `%${errado}%`]
  );

  let trocas = 0;
  let mantidas = 0;
  const aEscrever = [];

  for (const linha of rows) {
    const conteudo = (linha.message && linha.message.content) || '';
    if (conteudo.startsWith(MARCADOR_EQUIPE)) {
      const qtd = (conteudo.match(RE_NOME) || []).length;
      mantidas += qtd;
      console.log(`  [${linha.id}] PULADA  (${MARCADOR_EQUIPE}, escrita por humano) -- ${qtd} ocorrência(s) intocada(s)`);
      continue;
    }
    const { novo, decisoes } = corrigir(conteudo);
    for (const d of decisoes) {
      if (d.referencial) {
        mantidas++;
        console.log(`  [${linha.id}] MANTER  "${d.achado}" (fala da criança) :: ...${d.contexto}...`);
      } else {
        trocas++;
        console.log(`  [${linha.id}] TROCAR  "${d.achado}" -> "${certo}" :: ...${d.contexto}...`);
      }
    }
    if (novo !== conteudo) aEscrever.push({ id: linha.id, conteudo: novo });
  }

  console.log('\n=== RESUMO ===');
  console.log(`linhas analisadas    : ${rows.length}`);
  console.log(`ocorrências a trocar : ${trocas}`);
  console.log(`ocorrências mantidas : ${mantidas}`);
  console.log(`linhas a atualizar   : ${aEscrever.length}`);

  if (!aplicar) {
    console.log('\nSIMULAÇÃO -- nada foi escrito. Revise a lista acima e rode de novo com --aplicar.');
    await pool.end();
    return;
  }

  const cliente = await pool.connect();
  try {
    await cliente.query('begin');
    // Backup antes de qualquer escrita: o histórico é o registro do que foi
    // REALMENTE enviado ao paciente. Corrigir o texto faz ele divergir
    // disso, então o original precisa continuar existindo em algum lugar.
    await cliente.query(`
      create table if not exists public.n8n_chat_histories_backup_nome (
        id int,
        session_id text,
        message jsonb,
        nome_errado text,
        nome_certo text,
        corrigido_em timestamptz default now()
      )`);
    for (const l of aEscrever) {
      await cliente.query(
        `insert into public.n8n_chat_histories_backup_nome (id, session_id, message, nome_errado, nome_certo)
         select id, session_id, message, $2, $3 from n8n_chat_histories where id = $1`,
        [l.id, errado, certo]
      );
      await cliente.query(
        `update n8n_chat_histories set message = jsonb_set(message, '{content}', to_jsonb($2::text)) where id = $1`,
        [l.id, l.conteudo]
      );
    }
    await cliente.query('commit');
    console.log(`\nAPLICADO: ${aEscrever.length} linha(s) atualizada(s).`);
    console.log('Originais preservados em public.n8n_chat_histories_backup_nome.');
  } catch (e) {
    await cliente.query('rollback');
    console.error('ERRO -- nada foi alterado (rollback):', e.message);
    process.exitCode = 1;
  } finally {
    cliente.release();
    await pool.end();
  }
})().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
