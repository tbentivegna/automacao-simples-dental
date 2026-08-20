require('dotenv').config({ path: __dirname + '/../../.env' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.query(`
  SELECT session_id, COUNT(*) AS qtd, MIN(created_at) AS primeira, MAX(created_at) AS ultima
  FROM public.n8n_chat_histories
  WHERE message->>'type' = 'ai' AND message->>'content' LIKE '[Equipe da clínica]:%'
  GROUP BY session_id
  ORDER BY ultima DESC
`).then(r => {
  console.log('Total de sessoes com esse padrao em mensagens ai:', r.rows.length);
  r.rows.forEach(row => console.log(row.session_id, '|', row.qtd, '|', row.primeira, '->', row.ultima));
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
