// Popula o banco de DEMONSTRAÇÃO com dados fictícios: agenda cheia por
// vários meses, pacientes, eventos de analytics, funil e conversas.
//
// Pedido do Tiago (17/09/2026): "no banco do demo, consegue colocar mais
// umas consultas? não tem nenhuma... 2 a 6 por dia pra ficar bem cheio (...)
// se quiser inflar também os números de analytics, pode fazer... é apenas
// demonstração, não precisa ser verdadeiro."
//
// ⚠️ TRAVA DE SEGURANÇA: o script ABORTA se o banco conectado não se chamar
// exatamente `lumi_standalone_teste`. O banco de PRODUÇÃO da Lumi se chama
// `whatsapp-teste` (o nome engana, ver memória do projeto) e é pra onde o
// `.env` da RAIZ aponta -- escrever dado falso lá seria um desastre. Por
// isso este script lê `standalone-bridge/.env`, e ainda assim confere o
// nome antes de qualquer escrita.
//
// Tudo que é criado fica marcado (`consultas.origem = 'demo'`, telefones no
// prefixo 5519 9xxxx reservado abaixo, agendamento_id com prefixo
// `demo-seed-`), então dá pra limpar e repopular sem tocar no que veio de
// teste real.
//
// uso:
//   node scripts/popular-demo.js            (simulação: só diz o que faria)
//   node scripts/popular-demo.js --aplicar
//   node scripts/popular-demo.js --limpar   (remove só o que este script criou)
require('dotenv').config({ path: __dirname + '/../standalone-bridge/.env' });
const { Pool } = require('pg');

const BANCO_ESPERADO = 'lumi_standalone_teste';
const PREFIXO_ID = 'demo-seed-';
const MARCA_TELEFONE = '55199'; // faixa usada só pelos pacientes fictícios
const aplicar = process.argv.includes('--aplicar');
const limpar = process.argv.includes('--limpar');

// Quantas semanas pra trás (histórico, alimenta analytics) e pra frente
// (agenda cheia -- o Tiago pediu "próximos meses", porque a cada semana que
// passa entra uma semana nova na visualização).
const SEMANAS_PASSADO = 8;
const SEMANAS_FUTURO = 16;

const NOMES = [
  'Ana Beatriz Moraes', 'Carlos Eduardo Pinto', 'Mariana Lopes Vieira', 'Rodrigo Tavares Melo',
  'Juliana Prado Barros', 'Felipe Antunes Rocha', 'Camila Nogueira Serra', 'Bruno Carvalho Dias',
  'Patrícia Arantes Luz', 'Thiago Moreira Pinto', 'Letícia Furtado Neves', 'Gustavo Peixoto Faria',
  'Renata Sampaio Cruz', 'Marcelo Bastos Leal', 'Vanessa Queiroz Pinho', 'André Siqueira Mota',
  'Bianca Teixeira Lara', 'Rafael Guimarães Sá', 'Tatiane Borges Amaral', 'Leonardo Vasques Pires',
  'Fernanda Caldeira Reis', 'Diego Salgado Franco', 'Priscila Monteiro Vaz', 'Henrique Lacerda Pinto',
  'Aline Fontoura Bispo', 'Vinícius Rangel Couto', 'Débora Machado Pinto', 'Otávio Bandeira Nunes',
  'Simone Vilela Andrade', 'Caio Pacheco Ribeiro', 'Natália Bezerra Gomes', 'Murilo Aguiar Prado',
  'Elisa Camargo Pontes', 'Sérgio Brandão Mesquita', 'Larissa Pimentel Rosa', 'Igor Meireles Duarte',
  'Cristiane Valente Sena', 'Fábio Correia Rezende', 'Raquel Bittencourt Sá', 'Danilo Escobar Freitas',
];

const ROTULOS = [
  { nome: 'Primeira Consulta', cor: '#6D3F14', peso: 3 },
  { nome: 'Profilaxia', cor: '#4a8f6b', peso: 3 },
  { nome: 'Ortodontia', cor: '#b89a68', peso: 2 },
  { nome: 'INVISALIGN', cor: '#3f6d8a', peso: 2 },
  { nome: 'Clareamento', cor: '#c9a227', peso: 1 },
  { nome: 'Clínica Geral', cor: '#7a7a7a', peso: 2 },
  { nome: 'Urgência', cor: '#b3413a', peso: 1 },
  { nome: 'HOF', cor: '#c98da8', peso: 1 },
];

// Os valores possíveis NÃO são livres: eventos_agenda tem um CHECK
// constraint. Inventei categorias na 1ª tentativa ('retorno', 'urgencia',
// 'limpeza') e o INSERT foi recusado -- esta lista é exatamente a do
// constraint eventos_agenda_categoria_check.
const CATEGORIAS = [
  'primeira_consulta', 'ortodontia', 'odontopediatria', 'hof',
  'clareamento', 'limpeza_prevencao', 'consulta_estetica', 'dor_urgencia', 'outro',
];

// Gerador determinístico: rodar duas vezes produz o mesmo resultado, então
// dá pra limpar e repopular sem a agenda "mudar de cara" a cada execução.
let semente = 20260917;
function aleatorio() {
  semente = (semente * 1103515245 + 12345) % 2147483648;
  return semente / 2147483648;
}
const escolher = (lista) => lista[Math.floor(aleatorio() * lista.length)];
const inteiro = (min, max) => min + Math.floor(aleatorio() * (max - min + 1));

function rotuloSorteado() {
  const bolsa = ROTULOS.flatMap((r) => Array(r.peso).fill(r));
  return escolher(bolsa);
}

function telefoneDemo(i) {
  return `${MARCA_TELEFONE}${String(80000 + i).padStart(5, '0')}@s.whatsapp.net`;
}

const inicioDoDia = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const banco = (await pool.query('select current_database() d')).rows[0].d;
  if (banco !== BANCO_ESPERADO) {
    console.error(`ABORTADO: conectado em "${banco}", esperado "${BANCO_ESPERADO}". Nenhuma escrita foi feita.`);
    await pool.end();
    process.exit(1);
  }
  console.log(`banco: ${banco} ✔`);

  if (limpar) {
    if (!aplicar) {
      console.log('SIMULAÇÃO de limpeza -- rode com --aplicar junto pra executar.');
      await pool.end();
      return;
    }
    const c = await pool.connect();
    try {
      await c.query('begin');
      const r1 = await c.query(`delete from public.consultas where agendamento_id like $1`, [`${PREFIXO_ID}%`]);
      const r2 = await c.query(`delete from public.eventos_agenda where telefone like $1`, [`${MARCA_TELEFONE}%`]);
      const r3 = await c.query(`delete from public.funil_agendamento where telefone like $1`, [`${MARCA_TELEFONE}%`]);
      const r4 = await c.query(`delete from public.n8n_chat_histories where session_id like $1`, [`${MARCA_TELEFONE}%`]);
      const r5 = await c.query(`delete from public.cliente where telefone like $1`, [`${MARCA_TELEFONE}%`]);
      await c.query('commit');
      console.log(`limpo: ${r1.rowCount} consultas, ${r2.rowCount} eventos, ${r3.rowCount} funis, ${r4.rowCount} mensagens, ${r5.rowCount} clientes`);
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
      await pool.end();
    }
    return;
  }

  const profissionais = (await pool.query('select id, nome from public.profissionais where ativo order by ordem')).rows;
  if (profissionais.length === 0) throw new Error('nenhum profissional ativo -- a agenda precisa de pelo menos um.');

  const config = (await pool.query('select horarios from public.configuracao_horarios limit 1')).rows[0];
  // Demo fica mais convincente com a semana inteira útil. Terça e quinta
  // estavam vazias na configuração, o que deixaria dois buracos na grade.
  const horariosDemo = {
    domingo: [],
    segunda: ['08:30', '09:30', '10:30', '13:30', '14:30', '15:30', '16:30'],
    terca: ['08:30', '09:30', '10:30', '13:30', '14:30', '15:30', '16:30'],
    quarta: ['08:30', '09:30', '10:30', '13:30', '14:30', '15:30', '16:30'],
    quinta: ['08:30', '09:30', '10:30', '13:30', '14:30', '15:30', '16:30'],
    sexta: ['08:00', '09:00', '10:00', '13:00', '14:00', '15:00'],
    sabado: ['08:00', '09:00', '10:00'],
  };
  const DIAS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

  const agora = new Date();
  const consultas = [];
  const eventos = [];
  let seq = 0;

  for (let offset = -SEMANAS_PASSADO * 7; offset <= SEMANAS_FUTURO * 7; offset++) {
    const dia = inicioDoDia(new Date(agora.getTime() + offset * 86400000));
    const nomeDia = DIAS[dia.getDay()];
    const slots = horariosDemo[nomeDia];
    if (!slots || slots.length === 0) continue;

    const quantos = Math.min(inteiro(2, 6), slots.length);
    const escolhidos = [...slots].sort(() => aleatorio() - 0.5).slice(0, quantos).sort();

    for (const hhmm of escolhidos) {
      const [h, m] = hhmm.split(':').map(Number);
      const inicio = new Date(dia);
      inicio.setHours(h, m, 0, 0);
      const fim = new Date(inicio.getTime() + 60 * 60000);
      const passado = fim < agora;
      const rot = rotuloSorteado();
      const prof = escolher(profissionais);
      const iNome = seq % NOMES.length;

      // Passado tem desfecho; futuro fica entre agendada e confirmada.
      let status;
      if (passado) {
        const d = aleatorio();
        status = d < 0.72 ? 'Finalizada' : d < 0.85 ? 'Confirmada' : d < 0.94 ? 'Cancelada pelo paciente' : 'Falta';
      } else {
        status = aleatorio() < 0.45 ? 'Confirmada' : 'Agendada';
      }

      consultas.push({
        id: `${PREFIXO_ID}${seq}`,
        nome: NOMES[iNome],
        inicio,
        fim,
        status,
        telefone: telefoneDemo(iNome),
        rotulo: rot.nome,
        profissional_id: prof.id,
      });

      // Evento de criação: registrado alguns dias antes da consulta.
      const criadoEm = new Date(inicio.getTime() - inteiro(1, 20) * 86400000);
      eventos.push({ tipo: 'criado', telefone: telefoneDemo(iNome), categoria: escolher(CATEGORIAS), data: inicio, hora: hhmm, criado_em: criadoEm });
      if (status === 'Confirmada' || status === 'Finalizada') {
        eventos.push({ tipo: 'confirmado', telefone: telefoneDemo(iNome), categoria: null, data: inicio, hora: hhmm, criado_em: new Date(inicio.getTime() - 86400000) });
        eventos.push({ tipo: 'lembrete_enviado', telefone: telefoneDemo(iNome), categoria: null, data: inicio, hora: hhmm, criado_em: new Date(inicio.getTime() - 86400000) });
      }
      if (status.startsWith('Cancelada')) {
        eventos.push({ tipo: 'cancelado', telefone: telefoneDemo(iNome), categoria: null, data: inicio, hora: hhmm, criado_em: new Date(inicio.getTime() - 2 * 86400000) });
      }
      if (aleatorio() < 0.08) {
        eventos.push({ tipo: 'remarcado', telefone: telefoneDemo(iNome), categoria: null, data: inicio, hora: hhmm, criado_em: new Date(inicio.getTime() - 3 * 86400000) });
      }
      seq++;
    }
  }

  console.log(`a criar: ${NOMES.length} pacientes, ${consultas.length} consultas, ${eventos.length} eventos de agenda`);
  const futuras = consultas.filter((c) => c.inicio > agora).length;
  console.log(`  (${futuras} no futuro, ${consultas.length - futuras} no passado)`);

  if (!aplicar) {
    console.log('\nSIMULAÇÃO -- nada foi escrito. Rode de novo com --aplicar.');
    await pool.end();
    return;
  }

  const c = await pool.connect();
  try {
    await c.query('begin');

    await c.query(`update public.configuracao_horarios set horarios = $1, atualizado_em = now()`, [JSON.stringify(horariosDemo)]);

    // Pacientes
    for (let i = 0; i < NOMES.length; i++) {
      const criado = new Date(agora.getTime() - inteiro(1, SEMANAS_PASSADO * 7) * 86400000);
      await c.query(
        `insert into public.cliente (nome, telefone, email, created_at, bot_disabled, consentimento_lembrete, se_apresentou)
         values ($1,$2,$3,$4,$5,$6,true)
         on conflict (telefone) do update set nome = excluded.nome, created_at = excluded.created_at`,
        [
          NOMES[i],
          telefoneDemo(i),
          `${NOMES[i].split(' ')[0].toLowerCase()}@exemplo.com.br`,
          criado,
          aleatorio() < 0.1,
          aleatorio() < 0.8,
        ]
      );
    }

    // Consultas
    for (const k of consultas) {
      await c.query(
        `insert into public.consultas (agendamento_id, paciente_nome, inicio, fim, status, telefone, rotulo, origem, profissional_id)
         values ($1,$2,$3,$4,$5,$6,$7,'demo',$8)
         on conflict (agendamento_id) do update set
           paciente_nome=excluded.paciente_nome, inicio=excluded.inicio, fim=excluded.fim,
           status=excluded.status, rotulo=excluded.rotulo, profissional_id=excluded.profissional_id,
           atualizado_em=now()`,
        [k.id, k.nome, k.inicio, k.fim, k.status, k.telefone, k.rotulo, k.profissional_id]
      );
    }

    // Eventos (analytics)
    for (const e of eventos) {
      await c.query(
        `insert into public.eventos_agenda (tipo, telefone, categoria, data_consulta, hora_consulta, criado_em)
         values ($1,$2,$3,$4,$5,$6)`,
        [e.tipo, e.telefone, e.categoria, e.data, e.hora, e.criado_em]
      );
    }

    // Funil de resgate (alimenta Oportunidades e os cards do funil)
    const ETAPAS = ['interesse', 'horario_oferecido'];
    const STATUS_FUNIL = ['em_andamento', 'resgate_enviado', 'concluido', 'perdido'];
    for (let i = 0; i < 14; i++) {
      const iniciado = new Date(agora.getTime() - inteiro(1, 40) * 86400000);
      const st = escolher(STATUS_FUNIL);
      await c.query(
        `insert into public.funil_agendamento (telefone, status, etapa, iniciado_em, ultima_interacao_em, resgate_enviado_em, concluido_em)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [
          telefoneDemo(i),
          st,
          escolher(ETAPAS),
          iniciado,
          new Date(iniciado.getTime() + inteiro(1, 48) * 3600000),
          st === 'resgate_enviado' || st === 'concluido' ? new Date(iniciado.getTime() + 36 * 3600000) : null,
          st === 'concluido' ? new Date(iniciado.getTime() + 60 * 3600000) : null,
        ]
      );
    }

    // Conversas (alimenta "mensagens trocadas" e a nuvem de palavras)
    const PERGUNTAS = [
      'Oi, gostaria de marcar uma avaliação',
      'Bom dia! Vocês atendem convênio?',
      'Qual o valor da limpeza?',
      'Consigo remarcar minha consulta?',
      'Estou com dor de dente, tem horário hoje?',
      'Vocês fazem clareamento?',
      'Qual o endereço da clínica?',
      'Quanto tempo dura o tratamento de ortodontia?',
    ];
    const RESPOSTAS = [
      'Olá! 🤎 Claro, posso te ajudar com o agendamento.',
      'O atendimento é particular, não trabalhamos com convênios.',
      'Tenho estes horários disponíveis, qual prefere?',
      'Perfeito! Sua consulta foi confirmada. 😊',
      'Sinto muito pela dor — vou priorizar seu atendimento.',
    ];
    for (let i = 0; i < NOMES.length; i++) {
      const trocas = inteiro(2, 6);
      for (let t = 0; t < trocas; t++) {
        const quando = new Date(agora.getTime() - inteiro(1, SEMANAS_PASSADO * 7) * 86400000);
        await c.query(
          `insert into public.n8n_chat_histories (session_id, message, created_at) values ($1,$2,$3)`,
          [telefoneDemo(i), JSON.stringify({ type: 'human', content: escolher(PERGUNTAS) }), quando]
        );
        await c.query(
          `insert into public.n8n_chat_histories (session_id, message, created_at) values ($1,$2,$3)`,
          [telefoneDemo(i), JSON.stringify({ type: 'ai', content: escolher(RESPOSTAS) }), new Date(quando.getTime() + 40000)]
        );
      }
    }

    await c.query('commit');
    console.log('\nAPLICADO com sucesso.');
  } catch (e) {
    await c.query('rollback');
    console.error('ERRO -- nada foi escrito (rollback):', e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
