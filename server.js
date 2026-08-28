require('dotenv').config();
const express = require('express');
const { chromium } = require('playwright');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// Chave compartilhada exigida em toda chamada (exceto /health), enviada no
// header X-Bridge-Key. Sem isso, qualquer um que descobrisse a URL pública
// deste serviço conseguiria criar/cancelar/remarcar consulta de verdade na
// agenda da clínica -- hoje esse serviço não tem NENHUMA autenticação.
// Quem chama (n8n, e agora também o admin-panel) precisa mandar o mesmo
// valor configurado aqui via BRIDGE_API_KEY.
const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY;
if (!BRIDGE_API_KEY) {
  console.warn('[auth] BRIDGE_API_KEY não configurada -- rotas de automação ficam abertas! Configure antes de produção.');
}
function exigirChaveBridge(req, res, next) {
  if (!BRIDGE_API_KEY) return next(); // sem chave configurada (dev local) não trava
  if (req.headers['x-bridge-key'] === BRIDGE_API_KEY) return next();
  res.status(401).json({ erro: 'Chave de autenticação inválida ou ausente (X-Bridge-Key).' });
}
app.use((req, res, next) => (req.path === '/health' ? next() : exigirChaveBridge(req, res, next)));

const PORT = process.env.PORT || 3000;
const AUTH_FILE = path.join(__dirname, 'auth', 'sessao.json');
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');

// Conexão com o mesmo Postgres que o n8n usa -- só pra registrar eventos de
// agenda (public.eventos_agenda), usados pelo Analytics Agent. Se
// DATABASE_URL não estiver configurada, o registro só fica desativado (log
// de aviso), sem quebrar o resto do serviço -- essa tabela é só analytics,
// nunca deve impedir um agendamento real de funcionar.
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    })
  : null;

if (!pool) {
  console.warn('[eventosAgenda] DATABASE_URL não configurada -- eventos de agenda não serão registrados (analytics ficará sem dados).');
}

// Nunca deve derrubar o fluxo principal: uma falha aqui só é logada.
async function registrarEventoAgenda({ tipo, telefone, categoria, data, hora }) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO public.eventos_agenda (tipo, telefone, categoria, data_consulta, hora_consulta)
       VALUES ($1, $2, $3, $4, $5)`,
      [tipo, telefone || null, categoria || null, data ? paraDataISO(data) : null, hora || null]
    );
  } catch (erro) {
    console.error('[eventosAgenda] falha ao registrar evento (não afeta a resposta ao paciente):', erro.message);
  }
}

// Nunca deve derrubar o fluxo principal: uma falha aqui só é logada.
// Abre (ou reaproveita) a tentativa de agendamento em andamento pro
// telefone, sempre que a Lumi mostra horários reais ao paciente. Se já
// existir uma tentativa em_andamento pro mesmo telefone, só atualiza
// ultima_interacao_em (evita duplicar tentativa quando o paciente pergunta
// disponibilidade várias vezes na mesma conversa). `telefone` já deve vir no
// formato completo (5511999998888@s.whatsapp.net), igual ao resto do banco.
// Só é chamada a partir de /verificar-disponibilidade, então sempre marca
// (ou promove) a tentativa pra etapa "horario_oferecido" -- uma tentativa
// aberta antes como "interesse" (paciente só perguntou sobre procedimento/
// valor) é promovida aqui, nunca rebaixada de volta.
async function abrirOuAtualizarFunil({ telefone, instancia, etapa = 'horario_oferecido' }) {
  if (!pool || !telefone) return;
  try {
    const atualizado = await pool.query(
      `UPDATE public.funil_agendamento
       SET ultima_interacao_em = now(), etapa = $2
       WHERE telefone = $1 AND status = 'em_andamento'`,
      [telefone, etapa]
    );
    if (atualizado.rowCount === 0) {
      await pool.query(
        `INSERT INTO public.funil_agendamento (telefone, instancia, etapa)
         VALUES ($1, $2, $3)`,
        [telefone, instancia || null, etapa]
      );
    }
  } catch (erro) {
    console.error('[funilAgendamento] falha ao abrir/atualizar tentativa (não afeta a resposta ao paciente):', erro.message);
  }
}

// Nunca deve derrubar o fluxo principal: uma falha aqui só é logada.
// Fecha a tentativa em_andamento pro telefone (agendamento confirmado --
// não faz mais sentido mandar resgate pra essa tentativa).
async function fecharFunil({ telefone, status }) {
  if (!pool || !telefone) return;
  try {
    await pool.query(
      `UPDATE public.funil_agendamento
       SET status = $2, concluido_em = now()
       WHERE telefone = $1 AND status = 'em_andamento'`,
      [telefone, status]
    );
  } catch (erro) {
    console.error('[funilAgendamento] falha ao fechar tentativa (não afeta a resposta ao paciente):', erro.message);
  }
}

// Guard do fix 2b (28/08): protege contra a Lumi cancelar um agendamento
// "no susto" no meio de uma REMARCAÇÃO. Caso real (Guilherme, 27/08): o
// paciente respondeu "Sim" a um resgate ("ainda tem interesse?") e o
// modelo interpretou como "sim, cancela" -- cancelou a consulta confirmada
// sem reagendar nada.
//
// Retorna true (=> deve BLOQUEAR o cancelamento) só quando as DUAS coisas
// valem: (a) existe tentativa de agendamento em_andamento pro telefone com
// interação nas últimas 2h (o paciente pediu horários e ainda não fechou
// -- clássico "remarcação em curso"); e (b) nenhuma das últimas mensagens
// do paciente tem pedido explícito de cancelamento.
//
// Fail-open: qualquer erro/infra ausente => retorna false (nunca bloqueia
// um cancelamento de verdade por causa do guard).
async function deveBloquearCancelamentoPorRemarcacao(telefoneLocal) {
  if (!pool || !telefoneLocal) return false;
  const jid = '55' + somenteDigitos(telefoneLocal) + '@s.whatsapp.net';
  try {
    const remarcando = await pool.query(
      `SELECT 1 FROM public.funil_agendamento
       WHERE telefone = $1 AND status = 'em_andamento'
         AND ultima_interacao_em > now() - interval '2 hours'
       LIMIT 1`,
      [jid]
    );
    if (remarcando.rowCount === 0) return false;

    const msgs = await pool.query(
      `SELECT message->>'content' AS c
       FROM public.n8n_chat_histories
       WHERE session_id = $1 AND message->>'type' = 'human'
       ORDER BY created_at DESC
       LIMIT 6`,
      [jid]
    );
    const texto = msgs.rows.map((r) => (r.c || '').toLowerCase()).join('\n');
    const pediuCancelarExplicito =
      /\bcancel|desmarc|desist|n[aã]o quero mais|n[aã]o vou (mais )?(poder )?(ir|comparecer)|(remover|tirar|excluir) (a |minha )?consulta/.test(
        texto
      );
    return !pediuCancelarExplicito;
  } catch (erro) {
    console.error('[cancelar-agendamento] guard de remarcação falhou -- deixando passar:', erro.message);
    return false;
  }
}

// Nunca deve derrubar o fluxo principal: uma falha aqui só é logada.
// Mapeia agendamento (Simples Dental) -> telefone, pra o workflow de
// lembretes conseguir descobrir quem avisar sem depender de casar por nome
// -- o calendário do Simples Dental nunca expõe telefone, só nome.
async function salvarTelefoneAgendamento({ agendamentoId, telefone }) {
  if (!pool || !agendamentoId || !telefone) return;
  try {
    await pool.query(
      `INSERT INTO public.agendamento_telefone (agendamento_id, telefone, atualizado_em)
       VALUES ($1, $2, now())
       ON CONFLICT (agendamento_id) DO UPDATE SET telefone = EXCLUDED.telefone, atualizado_em = now()`,
      [String(agendamentoId), somenteDigitos(telefone)]
    );
  } catch (erro) {
    console.error('[agendamentoTelefone] falha ao salvar mapeamento (não afeta a resposta ao paciente):', erro.message);
  }
}

// O Simples Dental exibe o título do evento como "Nome Completo - Dr(a).
// Fulano" -- tira esse sufixo antes de comparar com public.cliente.nome.
function nomeSemSufixoProfissional(nomeExibido) {
  return (nomeExibido || '').replace(/\s*-\s*Dr\(a\)\..*$/i, '').trim();
}

// Fallback pra quando o agendamento não tem mapeamento em
// agendamento_telefone (ex: criado manualmente no Simples Dental, sem
// passar pelo bot) -- tenta achar o telefone pelo nome exibido no
// calendário, casando contra public.cliente.nome. Só retorna telefone se
// achar EXATAMENTE UM paciente com esse nome -- em caso de nome ambíguo
// (mais de um paciente com nome igual/parecido) ou nenhum resultado, prefere
// não mandar lembrete a mandar pra pessoa errada.
async function resolverTelefonePorNome(nomeExibido) {
  const nome = nomeSemSufixoProfissional(nomeExibido);
  if (!pool || !nome) return null;

  try {
    const { rows } = await pool.query(
      `SELECT telefone FROM public.cliente WHERE nome ILIKE $1 LIMIT 2;`,
      [nome]
    );
    // public.cliente.telefone guarda o JID completo do WhatsApp
    // ("5511999998888@s.whatsapp.net"), mas agendamento_telefone.telefone
    // (e o resto desta função) guarda só o número local -- telefoneLocal()
    // converte pro mesmo formato, senão o telefone sai inconsistente
    // dependendo de qual dos dois caminhos resolveu ele.
    return rows.length === 1 ? telefoneLocal(rows[0].telefone) : null;
  } catch (erro) {
    console.error('[resolverTelefonePorNome] falha ao buscar telefone por nome:', erro.message);
    return null;
  }
}

// Garante que as pastas existem antes de usar
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
if (!fs.existsSync(path.dirname(AUTH_FILE))) fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });

let browserCompartilhado = null;

// Cache curto (1 min) da leitura da agenda da semana -- evita martelar o
// Simples Dental de verdade a cada troca de aba/reload da página Agenda do
// painel. Chave = número de semanas pedido. Toda escrita (criar/mudar
// status/remarcar) precisa limpar isso, senão a Agenda mostra dado velho
// logo depois de uma ação que já funcionou.
const cacheAgenda = new Map();

// Fila simples: garante que só uma operação de automação roda por vez,
// evitando duas tarefas brigando pelo mesmo navegador.
let filaAtual = Promise.resolve();
async function comFilaSegura(tarefa) {
  const resultado = filaAtual.then(() => tarefa());
  filaAtual = resultado.catch(() => {}); // a fila segue mesmo se uma tarefa falhar
  return resultado;
}

async function getBrowser() {
  if (!browserCompartilhado) {
    browserCompartilhado = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled', // reduz sinais de que é um robô
      ],
    });
  }
  return browserCompartilhado;
}

// O Simples Dental mostra um banner de cookies que, em alguns pontos,
// volta a aparecer (parece renderizar de novo a cada diálogo/modal) e
// pode fisicamente cobrir botões, travando cliques. Chamamos essa função
// em vários pontos-chave para garantir que ele não está no caminho.
async function dispensarBannerCookies(page) {
  await page
    .getByRole('button', { name: 'Aceitar todos os cookies' })
    .click({ timeout: 1500 })
    .catch(() => {});
  await page
    .evaluate(() => {
      const banner = document.querySelector('#onetrust-consent-sdk');
      if (banner) banner.remove();
    })
    .catch(() => {});
}

// IMPORTANTE: locator.isVisible() faz uma checagem praticamente imediata,
// sem re-tentar de verdade enquanto o conteúdo ainda está carregando --
// isso causava falsos negativos (ex: achar que um paciente não existia
// só porque a busca ainda não tinha terminado). Esta função usa waitFor,
// que realmente aguarda até o elemento aparecer.
async function aparece(locator, timeout = 5000) {
  return locator
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);
}

// User-Agent de um Chrome comum em Windows, para o robô se parecer mais
// com um navegador usado por uma pessoa de verdade.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

const FUSO = 'America/Sao_Paulo';
const OFFSET_BRASILIA = '-03:00'; // Brasília não tem mais horário de verão

// Fallback de última instância: só entra em jogo se o banco estiver
// inacessível ou sem a linha de configuração (ver buscarConfiguracaoHorarios
// abaixo). O expediente de verdade mora em public.configuracao_horarios,
// editável pelo painel admin -- estes valores aqui existem só pra nunca
// deixar a Lumi sem conseguir consultar disponibilidade por causa de um
// problema no Postgres.
const MODELO_HORARIOS_PADRAO = {
  segunda: ['08:30', '09:30', '10:30', '13:30', '14:30', '15:30', '16:30'],
  terca: [],
  quarta: ['08:30', '09:30', '10:30', '13:30', '14:30', '15:30', '16:30'],
  quinta: [],
  sexta: ['08:00', '09:00', '10:00'],
  sabado: ['08:00', '09:00', '10:00'], // só nos sábados "abertos" (quinzenal)
  domingo: [],
};

const DURACAO_CONSULTA_MINUTOS_PADRAO = Number(process.env.DURACAO_CONSULTA_MINUTOS || 60);
const SABADO_DATA_REFERENCIA_PADRAO = process.env.SABADO_DATA_REFERENCIA || null;

const formatadorDiaISO = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO });
const NOMES_DIA_SEMANA = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

function nomeDiaSemana(diaISO) {
  const diaSemana = new Date(`${diaISO}T12:00:00${OFFSET_BRASILIA}`).getDay();
  return NOMES_DIA_SEMANA[diaSemana];
}

// Segunda-feira da semana que contém a data informada -- mesmo critério
// usado em calcularSlotsSemana e na paginação da agenda (a grade do
// Simples Dental é sempre navegada semana a semana a partir daí).
function segundaDaSemana(diaISO) {
  const diaSemana = new Date(`${diaISO}T12:00:00${OFFSET_BRASILIA}`).getDay();
  const deslocamentoAteSegunda = diaSemana === 0 ? -6 : 1 - diaSemana;
  const segunda = new Date(`${diaISO}T12:00:00${OFFSET_BRASILIA}`);
  segunda.setDate(segunda.getDate() + deslocamentoAteSegunda);
  return segunda;
}

// Quantos cliques em "próximo período" separam a semana de hoje da
// semana da data alvo (pode ser 0 se estiverem na mesma semana).
function semanasEntre(diaISOAlvo, diaISOBase) {
  const msPorSemana = 7 * 24 * 60 * 60 * 1000;
  const diff = segundaDaSemana(diaISOAlvo).getTime() - segundaDaSemana(diaISOBase).getTime();
  return Math.round(diff / msPorSemana);
}

// Verifica se um determinado sábado está "aberto", com base numa data de
// referência conhecida (um sábado que sabemos que é de atendimento) e no
// padrão quinzenal (a cada 14 dias). Sem referência, os sábados ficam
// fechados por padrão -- mais seguro do que assumir aberto.
function ehSabadoAberto(diaISO, sabadoDataReferencia) {
  if (!sabadoDataReferencia) return false;

  const msPorDia = 24 * 60 * 60 * 1000;
  const dataRef = new Date(`${sabadoDataReferencia}T00:00:00${OFFSET_BRASILIA}`).getTime();
  const dataAtual = new Date(`${diaISO}T00:00:00${OFFSET_BRASILIA}`).getTime();
  const diffDias = Math.round((dataAtual - dataRef) / msPorDia);

  return diffDias % 14 === 0;
}

// Cache de 60s (mesmo padrão de cacheAgenda/listarAgendaSemana) -- evita
// bater no Postgres em toda chamada de disponibilidade/agendamento, e
// segura o efeito de uma instabilidade curta do banco.
let cacheConfiguracaoHorarios = { expiraEm: 0, dados: null };

// Config real do expediente mora em public.configuracao_horarios (editável
// no painel admin). Qualquer falha aqui (sem pool, erro de query, linha
// ausente) cai pros valores _PADRAO acima -- nunca deve impedir a Lumi de
// consultar disponibilidade ou o painel de criar/remarcar um agendamento.
async function buscarConfiguracaoHorarios() {
  if (cacheConfiguracaoHorarios.dados && cacheConfiguracaoHorarios.expiraEm > Date.now()) {
    return cacheConfiguracaoHorarios.dados;
  }

  const padrao = {
    modeloHorarios: MODELO_HORARIOS_PADRAO,
    duracaoConsultaMinutos: DURACAO_CONSULTA_MINUTOS_PADRAO,
    sabadoDataReferencia: SABADO_DATA_REFERENCIA_PADRAO,
  };

  if (!pool) return padrao;

  try {
    // sabado_data_referencia::text evita que o driver `pg` converta a coluna
    // `date` num objeto Date (o parser dele ancora no fuso do PROCESSO node,
    // não no do banco -- num container em UTC isso reformataria a data
    // errado quando reconvertida pra America/Sao_Paulo). Como texto, o valor
    // "AAAA-MM-DD" chega intacto, sem nenhuma reinterpretação de fuso.
    const { rows } = await pool.query(
      "SELECT horarios, duracao_consulta_minutos, sabado_data_referencia::text FROM public.configuracao_horarios WHERE id = 1"
    );
    if (rows.length === 0) return padrao;

    const dados = {
      modeloHorarios: rows[0].horarios,
      duracaoConsultaMinutos: rows[0].duracao_consulta_minutos,
      sabadoDataReferencia: rows[0].sabado_data_referencia || null,
    };
    cacheConfiguracaoHorarios = { expiraEm: Date.now() + 60_000, dados };
    return dados;
  } catch (erro) {
    console.error('[configuracaoHorarios] falha ao ler configuração do banco, usando valores padrão:', erro.message);
    return padrao;
  }
}

// Para cada dia dentro do período (a partir de hoje, cobrindo N semanas),
// pega os horários fixos do modelo e verifica, contra os compromissos
// reais, quais estão livres.
function calcularSlotsSemana(
  compromissos,
  semanas,
  diasBloqueados = new Set(),
  diaSemanaFiltro = null,
  periodoFiltro = null,
  { modeloHorarios, duracaoConsultaMinutos, sabadoDataReferencia }
) {
  const hojeISO = formatadorDiaISO.format(new Date());
  const diaSemanaHoje = new Date(`${hojeISO}T12:00:00${OFFSET_BRASILIA}`).getDay();
  const deslocamentoAteSegunda = diaSemanaHoje === 0 ? -6 : 1 - diaSemanaHoje;

  const segunda = new Date(`${hojeISO}T12:00:00${OFFSET_BRASILIA}`);
  segunda.setDate(segunda.getDate() + deslocamentoAteSegunda);

  const resultado = {};
  const totalDias = semanas * 7;

  for (let i = 0; i < totalDias; i++) {
    const diaAtual = new Date(segunda);
    diaAtual.setDate(segunda.getDate() + i);

    const diaISO = formatadorDiaISO.format(diaAtual);

    // Não oferece hoje nem dias já passados -- não dá pra agendar em cima
    // da hora (o paciente não teria como chegar a tempo), e um horário de
    // um dia anterior já nem existe mais. A busca efetivamente começa a
    // partir de amanhã.
    if (diaISO <= hojeISO) continue;

    const nomeDia = nomeDiaSemana(diaISO);

    // Filtro por dia da semana: se o paciente pediu um dia específico, o
    // agente já manda esse filtro na chamada -- nem entra no resultado o
    // que não é esse dia, então não sobra nada pra "escanear" depois.
    if (diaSemanaFiltro && nomeDia !== diaSemanaFiltro) continue;

    let horariosDoDia = modeloHorarios[nomeDia] || [];

    if (nomeDia === 'sabado' && !ehSabadoAberto(diaISO, sabadoDataReferencia)) {
      horariosDoDia = [];
    }

    if (diasBloqueados.has(diaISO)) {
      horariosDoDia = [];
    }

    if (horariosDoDia.length === 0) continue;

    const diaBR = new Date(
      `${diaISO}T00:00:00${OFFSET_BRASILIA}`
    ).toLocaleDateString('pt-BR', {
      timeZone: FUSO,
    });

    // Só entra no resultado o que está livre -- horário ocupado não serve
    // pra nada no fluxo de agendamento em si, e é só mais uma coisa que o
    // agente de IA (Lumi) precisaria filtrar/ignorar corretamente ao ler a
    // resposta (na prática, ela às vezes deixava de considerar um horário
    // livre que vinha no meio de uma lista longa com ocupados misturados).
    let horariosLivres = horariosDoDia.filter((horario) => {
      const inicio = new Date(
        `${diaISO}T${horario}:00${OFFSET_BRASILIA}`
      ).getTime();

      const fim = inicio + duracaoConsultaMinutos * 60 * 1000;

      const conflito = compromissos.find(
        (c) => c.inicio < fim && c.fim > inicio
      );

      return !conflito;
    });

    if (periodoFiltro === 'manha') horariosLivres = horariosLivres.filter((h) => h < '12:00');
    if (periodoFiltro === 'tarde') horariosLivres = horariosLivres.filter((h) => h >= '12:00');

    if (horariosLivres.length === 0) continue;

    // IMPORTANTE: não incluir aqui nenhum dado de identificação do
    // paciente que ocupa o horário (nome, telefone, etc.) -- esta
    // resposta alimenta o contexto de um agente de IA no WhatsApp
    // (Lumi), e dados de terceiros não podem vazar para essa conversa.
    // Só o necessário para calcular disponibilidade.
    resultado[diaBR] = {
      diaSemana: nomeDia,
      horariosDisponiveis: horariosLivres,
    };
  }

  return resultado;
}

// Agrupa o resultado de calcularSlotsSemana por dia da semana + período
// (manhã/tarde), já filtrado e ordenado da data mais próxima pra mais
// distante. Existe pra dar ao agente de IA uma resposta pronta pra
// perguntas do tipo "tem quarta de manhã?", sem precisar escanear
// manualmente um objeto grande com várias semanas de datas (o que, na
// prática, o modelo às vezes fazia de forma incompleta e pulava datas).
function agruparPorDiaSemana(horariosPorData) {
  const resumo = {};

  for (const [diaBR, info] of Object.entries(horariosPorData)) {
    if (!resumo[info.diaSemana]) {
      resumo[info.diaSemana] = { manha: [], tarde: [] };
    }

    const manha = info.horariosDisponiveis.filter((h) => h < '12:00');
    const tarde = info.horariosDisponiveis.filter((h) => h >= '12:00');

    if (manha.length) resumo[info.diaSemana].manha.push({ data: diaBR, horarios: manha });
    if (tarde.length) resumo[info.diaSemana].tarde.push({ data: diaBR, horarios: tarde });
  }

  return resumo;
}

// Abre uma aba já logada no Simples Dental, reaproveitando a sessão salva
// sempre que possível (evita logar do zero a cada chamada).
async function abrirPaginaLogada() {
  const browser = await getBrowser();
  const opcoesContexto = {
    ...(fs.existsSync(AUTH_FILE) ? { storageState: AUTH_FILE } : {}),
    timezoneId: 'America/Sao_Paulo',
    locale: 'pt-BR',
  };
  const context = await browser.newContext(opcoesContexto);
  const page = await context.newPage();

  await page.goto(process.env.SIMPLES_DENTAL_URL);
  // A tela do Simples Dental carrega em JavaScript e pode demorar um
  // instante a mais para aparecer -- esperamos a rede "assentar" antes de
  // checar o que está na tela, evitando checar cedo demais.
  await page.waitForLoadState('networkidle').catch(() => {});

  // Se a sessão salva ainda for válida, o Simples Dental pula direto pra
  // agenda (ou pra tela de seleção de clínica). Confirmamos checando se
  // ainda estamos na tela de login.
  const aindaNaTelaDeLogin = await aparece(page.locator('input[type="email"]').first(), 8000);

  if (aindaNaTelaDeLogin) {
    await page.fill('input[type="email"]', process.env.SIMPLES_DENTAL_USER);
    await page.fill('input[type="password"]', process.env.SIMPLES_DENTAL_PASS);
    await page.getByRole('button', { name: 'ENTRAR NO SISTEMA' }).click();
    await page.waitForLoadState('networkidle');
  }

  // Depois do login, o Simples Dental pode pedir pra escolher a clínica
  // (quando o usuário tem acesso a mais de uma). Se essa tela aparecer,
  // clicamos em "ACESSAR" no card da clínica configurada.
  const nomeClinica = process.env.SIMPLES_DENTAL_CLINICA || 'ALINE BENTIVEGNA';
  const telaSelecaoClinica = await aparece(page.getByText('Selecionar clínica'), 3000);

  if (telaSelecaoClinica) {
    const cartaoClinica = page.locator('div').filter({ hasText: nomeClinica }).last();
    await cartaoClinica.getByRole('button', { name: 'ACESSAR' }).click();
    await page.waitForLoadState('networkidle');
  }

  // Confirma que chegamos de fato na agenda antes de seguir
  await page.waitForURL('**/simples/agenda**', { timeout: 15000 }).catch(() => {});

  // O Simples Dental mostra um banner de cookies que pode atrapalhar
  // cliques em outros elementos depois. Tentamos dispensar aqui, logo
  // após o login (mas repetimos em outros pontos críticos também, já
  // que ele pode voltar a aparecer em novos diálogos).
  await dispensarBannerCookies(page);

  // Salva a sessão logada para reaproveitar nas próximas chamadas
  await context.storageState({ path: AUTH_FILE });

  return { context, page };
}

// Navega pela agenda clicando em "próxima semana" e vai juntando os
// compromissos encontrados em cada semana, até cobrir o total pedido.
async function coletarCompromissosVariasSemanas(page, semanas) {
  const todosCompromissos = [];

  for (let semana = 0; semana < semanas; semana++) {
    await page.waitForSelector('a.fc-event', { timeout: 15000 }).catch(() => {});
    // Pequena pausa extra: os eventos às vezes continuam chegando por um
    // instante depois que a grade aparece.
    await page.waitForTimeout(800);

    // rotulo/rotuloCor: o Simples Dental mostra opcionalmente uma bolinha
    // colorida com o tipo de consulta (ex: "INVISALIGN", "Primeira
    // Consulta") dentro de .float-section, irmão de .fc-event-time -- não
    // é uma categoria da Lumi, é nativo do próprio calendário, e cobre
    // QUALQUER consulta (marcada pela Lumi ou não). Nem toda consulta tem
    // (é opcional, setado na hora de criar no Simples Dental). Extraído do
    // mesmo HTML que já lemos aqui, sem clique/chamada extra por evento.
    const eventosDaSemana = await page.evaluate(() => {
      const eventos = Array.from(document.querySelectorAll('a.fc-event'));
      return eventos.map((el) => {
        const rotuloEl = el.querySelector('.float-section .label.rotulo');
        const corMatch = rotuloEl?.getAttribute('style')?.match(/background-color:\s*(#[0-9a-fA-F]{3,6})/);
        return {
          id: el.getAttribute('data-consulta-id'),
          inicio: Number(el.getAttribute('data-start')) || 0,
          fim: Number(el.getAttribute('data-end')) || 0,
          status: el.querySelector('.fc-event-main-frame')?.getAttribute('title') || null,
          paciente: el.querySelector('.fc-event-title')?.textContent.trim() || null,
          rotulo: rotuloEl?.getAttribute('title') || null,
          rotuloCor: corMatch ? corMatch[1] : null,
        };
      });
    });

    todosCompromissos.push(...eventosDaSemana);

    if (semana < semanas - 1) {
      await page.click('[data-testid="btnProximoPeriodo"]').catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {});
    }
  }

  // Remove duplicados, caso a mesma consulta apareça em mais de uma leitura
  // (mantém os eventos de dia inteiro -- eles representam bloqueios reais).
  const vistos = new Set();
  return todosCompromissos.filter((c) => {
    const chave = c.id || `${c.inicio}-${c.fim}-${c.paciente}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

// Eventos de "dia inteiro" não têm horário de término definido (fim <= 0
// ou fim <= inicio). Eles representam bloqueios reais (ex: folga, feriado),
// então o dia inteiro correspondente deve ficar sem horários disponíveis.
function obterDiasBloqueados(compromissos) {
  const dias = new Set();
  for (const c of compromissos) {
    if (c.inicio > 0 && !(c.fim > c.inicio)) {
      dias.add(formatadorDiaISO.format(new Date(c.inicio)));
    }
  }
  return dias;
}

// Deixa os compromissos legíveis para humanos (e para o n8n exibir),
// mantendo os campos originais em milissegundos para os cálculos internos.
function formatarCompromissos(compromissos) {
  return compromissos.map((c) => {
    if (c.fim > c.inicio) {
      return {
        ...c,
        inicioFormatado: new Date(c.inicio).toLocaleString('pt-BR', {
          timeZone: FUSO,
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        fimFormatado: new Date(c.fim).toLocaleString('pt-BR', {
          timeZone: FUSO,
          hour: '2-digit',
          minute: '2-digit',
        }),
      };
    }

    // Evento de dia inteiro
    const diaBR = new Date(c.inicio).toLocaleDateString('pt-BR', { timeZone: FUSO });

    return {
      ...c,
      inicioFormatado: `Dia inteiro - ${diaBR}`,
      fimFormatado: null,
    };
  });
}

// Lista os compromissos das próximas N semanas pra visão de agenda do
// painel administrativo -- ao contrário de listarLembretesDoDia, NÃO filtra
// cancelados (a Agenda é uma visão completa; cancelados ficam visualmente
// distintos no front, não somem). Cache de 1 min (cacheAgenda) evita reler
// o Simples Dental de verdade a cada troca de aba/reload no painel.
async function listarAgendaSemana({ semanas } = {}) {
  const totalSemanas = Math.min(4, Math.max(1, Number(semanas) || Number(process.env.SEMANAS_A_VERIFICAR) || 4));

  const cacheado = cacheAgenda.get(totalSemanas);
  if (cacheado && cacheado.expiraEm > Date.now()) return cacheado.dados;

  const { context, page } = await abrirPaginaLogada();
  try {
    const compromissos = await coletarCompromissosVariasSemanas(page, totalSemanas);
    const dados = { semanasVerificadas: totalSemanas, compromissos: formatarCompromissos(compromissos) };
    cacheAgenda.set(totalSemanas, { expiraEm: Date.now() + 60_000, dados });
    return dados;
  } finally {
    await context.close();
  }
}

// "11999998888" (ou com o 55) -> "5511999998888@s.whatsapp.net", pra bater
// com public.cliente.telefone / public.funil_agendamento.telefone.
function jidDeLocal(valor) {
  const dig = somenteDigitos(valor);
  if (!dig) return null;
  return (dig.startsWith('55') ? dig : `55${dig}`) + '@s.whatsapp.net';
}

// Resolve o telefone (JID completo) de uma consulta da agenda do Simples
// Dental, que só expõe o nome do paciente. Ordem: mapeamento direto do bot
// -> match exato em cliente.nome -> match em paciente_dependente. Qualquer
// ambiguidade (2+ resultados) devolve null -- consulta fica "órfã".
async function resolverTelefoneConsulta(nomeLimpo, agendamentoId) {
  if (!pool) return null;
  try {
    if (agendamentoId) {
      const m = await pool.query(
        'SELECT telefone FROM public.agendamento_telefone WHERE agendamento_id = $1',
        [String(agendamentoId)]
      );
      if (m.rows[0]?.telefone) return jidDeLocal(m.rows[0].telefone);
    }
    if (!nomeLimpo) return null;
    const c = await pool.query(
      'SELECT telefone FROM public.cliente WHERE lower(trim(nome)) = lower(trim($1)) LIMIT 2',
      [nomeLimpo]
    );
    if (c.rows.length === 1) return c.rows[0].telefone; // já é JID
    const d = await pool.query(
      'SELECT responsavel_telefone FROM public.paciente_dependente WHERE lower(trim(dependente_nome)) = lower(trim($1)) LIMIT 2',
      [nomeLimpo]
    );
    if (d.rows.length === 1) return d.rows[0].responsavel_telefone;
    return null;
  } catch (erro) {
    console.error('[sincronizarAgenda] falha ao resolver telefone de consulta:', erro.message);
    return null;
  }
}

// Varre a agenda real do Simples Dental (4 semanas) e faz upsert em
// public.consultas -- o espelho local que o guard do resgate e o painel
// consultam. Consulta que sumiu da varredura (cancelada/movida na mão no
// SD) vira status 'removido_do_calendario', não é apagada. Chamada sob
// comFilaSegura (compartilha o lock do navegador com o resto).
async function sincronizarAgenda({ semanas } = {}) {
  if (!pool) return { erro: 'DATABASE_URL não configurada -- sync desativado' };
  const totalSemanas = Math.min(4, Math.max(1, Number(semanas) || Number(process.env.SEMANAS_A_VERIFICAR) || 4));
  const { context, page } = await abrirPaginaLogada();
  const sincronizadoEm = new Date().toISOString();
  try {
    const compromissos = await coletarCompromissosVariasSemanas(page, totalSemanas);
    // só consultas reais: têm id e têm horário de fim (descarta bloqueios de dia inteiro)
    const reais = compromissos.filter((c) => c.id && c.fim > c.inicio);

    let novos = 0;
    let atualizados = 0;
    let semTelefone = 0;
    const idsVistos = [];

    for (const c of reais) {
      const nomeLimpo = nomeSemSufixoProfissional(c.paciente) || (c.paciente || '').trim();
      const telefone = await resolverTelefoneConsulta(nomeLimpo, c.id);
      if (!telefone) semTelefone++;
      idsVistos.push(String(c.id));

      const r = await pool.query(
        `INSERT INTO public.consultas
           (agendamento_id, paciente_nome, inicio, fim, status, telefone, rotulo, origem, visto_em, atualizado_em)
         VALUES ($1, $2, to_timestamp($3 / 1000.0), to_timestamp($4 / 1000.0), $5, $6, $7, 'sync', now(), now())
         ON CONFLICT (agendamento_id) DO UPDATE SET
           paciente_nome = EXCLUDED.paciente_nome,
           inicio        = EXCLUDED.inicio,
           fim           = EXCLUDED.fim,
           status        = EXCLUDED.status,
           rotulo        = EXCLUDED.rotulo,
           telefone      = COALESCE(EXCLUDED.telefone, public.consultas.telefone),
           visto_em      = now(),
           atualizado_em = now()
         RETURNING (xmax = 0) AS inserido`,
        [String(c.id), nomeLimpo, c.inicio, c.fim, c.status, telefone, c.rotulo || null]
      );
      if (r.rows[0]?.inserido) novos++;
      else atualizados++;
    }

    // Consultas futuras que estavam no espelho e não apareceram nesta
    // varredura => sumiram do calendário do SD.
    let removidos = 0;
    if (idsVistos.length) {
      const del = await pool.query(
        `UPDATE public.consultas
         SET status = 'removido_do_calendario', atualizado_em = now()
         WHERE inicio >= now()
           AND status IS DISTINCT FROM 'removido_do_calendario'
           AND NOT (agendamento_id = ANY ($1))`,
        [idsVistos]
      );
      removidos = del.rowCount;
    }

    return {
      total: reais.length,
      novos,
      atualizados,
      removidos,
      sem_telefone: semTelefone,
      semanas: totalSemanas,
      sincronizado_em: sincronizadoEm,
    };
  } finally {
    await context.close();
  }
}

async function verificarDisponibilidade({ diaSemana, periodo } = {}) {
  const { context, page } = await abrirPaginaLogada();
  const semanas = Number(process.env.SEMANAS_A_VERIFICAR || 4);
  const configuracaoHorarios = await buscarConfiguracaoHorarios();

  try {
    const compromissos = await coletarCompromissosVariasSemanas(page, semanas);
    const diasBloqueados = obterDiasBloqueados(compromissos);
    const horarios = calcularSlotsSemana(
      compromissos,
      semanas,
      diasBloqueados,
      diaSemana || null,
      periodo || null,
      configuracaoHorarios
    );

    // O print continua sendo salvo em disco (útil para depuração local),
    // mas não é mais devolvido na resposta da API -- a rota /screenshots
    // foi removida, e o próprio nome do arquivo não deve ir para o
    // contexto do agente de IA.
    const nomePrint = `agenda-${Date.now()}.png`;
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, nomePrint), fullPage: true });

    // IMPORTANTE: esta resposta alimenta o contexto de um agente de IA
    // (Lumi, no WhatsApp). Não incluir aqui o array bruto de compromissos
    // (que traz nome de paciente, telefone, observação, etc. de terceiros)
    // nem o caminho do print. Só o necessário para calcular disponibilidade.
    return {
      horarios,
      resumoPorDiaSemana: agruparPorDiaSemana(horarios),
      diasBloqueados: Array.from(diasBloqueados),
      semanasVerificadas: semanas,
    };
  } catch (erro) {
    // Tira um print exatamente do momento do erro, pra facilitar o diagnóstico
    await page
      .screenshot({ path: path.join(SCREENSHOTS_DIR, `erro-${Date.now()}.png`) })
      .catch(() => {});
    throw erro;
  } finally {
    await context.close();
  }
}

function somenteDigitos(texto) {
  return (texto || '').replace(/\D/g, '');
}

// Converte "DD/MM/AAAA" para "AAAA-MM-DD"
function paraDataISO(dataBR) {
  const [dia, mes, ano] = dataBR.split('/');
  return `${ano}-${mes}-${dia}`;
}

// Alguns campos (data, hora, duração) têm máscara de formatação e não
// aceitam bem receber o valor de uma vez só (via fill) -- o Angular
// rejeita e volta para o último valor válido. Simulamos digitação real,
// caractere por caractere, que é como um humano preencheria.
async function preencherCampoComMascara(locator, valor) {
  await locator.click();
  await locator.press('Control+A');
  await locator.press('Backspace');
  await locator.pressSequentially(String(valor), { delay: 60 });
}

// O campo de celular do cadastro de paciente novo espera só o número
// local (sem o "55" do Brasil, que já vem fixo como prefixo separado
// na tela). Essa suposição ainda não foi validada com um teste real --
// se o cadastro falhar por causa do formato, ajustar aqui.
function telefoneLocal(texto) {
  const digitos = somenteDigitos(texto);
  return digitos.length > 11 && digitos.startsWith('55') ? digitos.slice(2) : digitos;
}

// Preenche o cadastro completo de um paciente novo no Simples Dental (data
// de nascimento, CPF, e-mail, endereço, e -- se for menor de idade -- os
// dados do responsável). Roda DEPOIS de Nome/Celular (que o fluxo de
// criarAgendamento já preenche) e ANTES de clicar em "Salvar".
//
// Campos soltos (em vez de um objeto aninhado tipo `{ responsavel: {...} }`)
// de propósito -- é assim que a tool "Cria Agendamento" no n8n manda os
// parâmetros pro httpRequestTool (mesmo padrão flat que nomePaciente/data/
// hora já usam), então bate direto com o que chega no body da requisição
// sem precisar reconstruir objeto nenhum.
//
// `dialogo` é o mesmo mat-dialog-container.last() já usado pra Nome/Celular
// -- os campos abaixo vivem todos nesse mesmo diálogo, só que atrás de duas
// abas ("Informações adicionais" -- já vem selecionada por padrão -- e
// "Endereço" -- precisa clicar pra aparecer).
//
// Os data-testid foram conferidos manualmente no formulário real do
// Simples Dental (não documentados em nenhum lugar oficial), então
// qualquer mudança de layout no site pode quebrar isso silenciosamente.
async function preencherCadastroCompleto(dialogo, dados) {
  // Data de nascimento primeiro -- é ela que faz o Simples Dental decidir
  // (client-side) se mostra/exige a seção "Dados do responsável".
  if (dados.dataNascimentoPaciente) {
    await preencherCampoComMascara(
      dialogo.locator('[data-testid="inputDtNascimento"]'),
      dados.dataNascimentoPaciente
    );
  }
  if (dados.cpfPaciente) {
    await preencherCampoComMascara(dialogo.locator('[data-testid="inputCpf"]'), somenteDigitos(dados.cpfPaciente));
  }

  if (dados.nomeResponsavel) {
    await dialogo.locator('[data-testid="inputResponsavel"]').fill(dados.nomeResponsavel);
  }
  if (dados.dataNascimentoResponsavel) {
    await preencherCampoComMascara(
      dialogo.locator('[data-testid="inputDtNascimentoResponsavel"]'),
      dados.dataNascimentoResponsavel
    );
  }
  if (dados.cpfResponsavel) {
    await preencherCampoComMascara(
      dialogo.locator('[data-testid="inputCpfResponsavelPaciente"]'),
      somenteDigitos(dados.cpfResponsavel)
    );
  }
  if (dados.celularResponsavel) {
    await preencherCampoComMascara(
      dialogo.locator('[data-testid="inputCelularResponsavelPaciente"]'),
      telefoneLocal(dados.celularResponsavel)
    );
  }

  // E-mail fica na aba "Informações adicionais", que já vem selecionada
  // por padrão quando o diálogo abre -- não precisa clicar em nada. Vale
  // tanto pro e-mail do próprio paciente (adulto) quanto do responsável
  // (menor de idade) -- o Simples Dental só tem UM campo de e-mail no
  // cadastro, não um por pessoa.
  if (dados.email) {
    await dialogo.locator('[data-testid="inputEmail"]').fill(dados.email);
  }

  // Endereço fica atrás da aba "Endereço". Preencher o CEP dispara um
  // autofill (client-side, provavelmente via ViaCEP) que já resolve Rua/
  // Bairro/Cidade/Estado sozinho -- só Número (e opcionalmente
  // Complemento) precisam ser digitados manualmente.
  if (dados.cep) {
    await dialogo.getByText(/endereço/i).first().click();
    await preencherCampoComMascara(dialogo.locator('[data-testid="inputCep"]'), somenteDigitos(dados.cep));
    // Sem um seletor confirmado pro campo "Rua" pra esperar de forma
    // ativa (waitForFunction), uma espera fixa é o que temos por ora --
    // se o autofill do CEP demorar mais que isso em produção, aumentar.
    await dialogo.page().waitForTimeout(1500);
    if (dados.numero) {
      await dialogo.locator('[data-testid="inputNumero"]').fill(dados.numero);
    }
    if (dados.complemento) {
      await dialogo.locator('[data-testid="inputComplemento"]').fill(dados.complemento);
    }
  }
}

// Busca o paciente pelo telefone no autocomplete de "novo agendamento" e
// escolhe QUAL das opções corresponde. Importante desde que passamos a
// cadastrar cada dependente como paciente próprio (não mais o responsável
// "por eles"): um telefone de família (WhatsApp da mãe/pai) pode ter vários
// pacientes cadastrados, um por filho. Sem desambiguar por nome, sempre
// pegava a primeira opção da lista -- o que podia ser o irmão errado.
//
// Se `nomeBuscado` bater com mais de uma opção, ou não bater com nenhuma
// (ex: telefone já tem outros filhos cadastrados, mas não esse), trata como
// "não encontrado" -- é alguém novo usando o mesmo telefone da família.
// telefoneLocal() (não somenteDigitos()) porque o campo de busca do
// Simples Dental guarda o número sem o "55" -- um telefone recebido como
// JID completo (ex: vindo direto de public.cliente.telefone, como faz o
// formulário de Nova Consulta do painel) nunca batia com nenhum resultado
// e caía sempre no caminho de "paciente não encontrado", mesmo quando o
// paciente já existia. Achado testando a Agenda do painel em 25/08 --
// o node do n8n que a Lumi usa já mandava o telefone sem o "55" hoje em
// dia, então esse bug nunca afetou o fluxo da Lumi, só o painel.
async function encontrarOpcaoPaciente(page, campoBusca, telefone, nomeBuscado) {
  await campoBusca.fill(telefoneLocal(telefone));
  const opcoes = page.locator('.sd-pacientes-autocomplete__option');
  const apareceu = await aparece(opcoes.first(), 6000);
  if (!apareceu) return { opcao: null, nome: null };

  const total = await opcoes.count();

  if (nomeBuscado && total > 1) {
    const alvo = nomeBuscado.trim().toLowerCase();
    for (let i = 0; i < total; i++) {
      const opcao = opcoes.nth(i);
      const nome = (await opcao.locator('.sd-pacientes-autocomplete__nome').innerText().catch(() => '')) || '';
      if (nome && (nome.toLowerCase().includes(alvo) || alvo.includes(nome.toLowerCase()))) {
        return { opcao, nome };
      }
    }
    return { opcao: null, nome: null };
  }

  const opcao = opcoes.first();
  const nome = await opcao.locator('.sd-pacientes-autocomplete__nome').innerText().catch(() => null);
  return { opcao, nome };
}

// Rótulo nativo do Simples Dental (a bolinha colorida com nome tipo
// "INVISALIGN"/"Primeira Consulta" -- ver coletarCompromissosVariasSemanas)
// -- mesmo componente de autocomplete usado tanto no diálogo de criar
// consulta quanto no popover de detalhe de uma consulta existente, por
// isso um helper só serve os dois lugares (recebe o container certo em
// cada caso: o diálogo ou o popover). Digita o nome pra filtrar a lista e
// clica na opção com esse texto exato. As opções renderizam num overlay
// do Angular Material fora do container do campo (mesmo motivo pelo qual
// a seleção de Status busca a opção na página inteira, não escopada ao
// popover) -- por isso a busca da opção usa page.getByRole, não o
// container recebido.
async function selecionarRotulo(page, container, rotulo) {
  const campo = container.locator('input[data-testid="inputRotulo"]');
  await campo.click();
  await campo.fill('');
  await campo.fill(rotulo);

  const opcao = page.getByRole('option', { name: rotulo, exact: true });
  const apareceu = await aparece(opcao, 5000);
  if (!apareceu) {
    throw new Error(`Rótulo "${rotulo}" não encontrado na lista de opções do Simples Dental.`);
  }
  await opcao.click();
}

async function criarAgendamento({
  telefone,
  nomePaciente,
  data,
  hora,
  duracaoMinutos,
  observacao,
  categoria,
  rotulo,
  dataNascimentoPaciente,
  cpfPaciente,
  email,
  cep,
  numero,
  complemento,
  nomeResponsavel,
  dataNascimentoResponsavel,
  cpfResponsavel,
  celularResponsavel,
}) {
  if (!telefone || !data || !hora) {
    throw new Error('Campos obrigatórios faltando: telefone, data e hora são necessários.');
  }

  const { context, page } = await abrirPaginaLogada();
  const duracao = Number(duracaoMinutos || (await buscarConfiguracaoHorarios()).duracaoConsultaMinutos);
  const nomeProfissional = process.env.SIMPLES_DENTAL_PROFISSIONAL || 'Aline Ramos Bentivegna';
  const hojeISO = formatadorDiaISO.format(new Date());
  const semanasAteData = Math.max(0, semanasEntre(paraDataISO(data), hojeISO));

  try {
    // 0. Coleta os compromissos reais ANTES de abrir qualquer diálogo.
    // IMPORTANTE: a checagem de conflito NÃO PODE navegar a agenda
    // clicando em "próximo período" depois que o diálogo de novo evento
    // estiver aberto -- o backdrop do diálogo modal bloqueia cliques nos
    // elementos por trás dele (fora do diálogo), então esses cliques
    // falham silenciosamente (a chamada tem .catch(() => {})) e a
    // checagem nunca alcança a semana certa, podendo concluir
    // erradamente que não há conflito -- isso já causou um agendamento
    // duplicado num teste real. Coletando aqui, com a página ainda
    // "limpa" (sem diálogo por cima), evitamos esse problema por completo.
    const semanasParaConflito = Math.max(4, semanasAteData + 2);
    const compromissosExistentes = await coletarCompromissosVariasSemanas(page, semanasParaConflito);

    // 1. Abre o formulário de novo evento
    await page.click('[data-testid="btnNovoEvento"]');

    // 2. Busca o paciente pelo telefone -- desambiguando por nome quando o
    // telefone tem mais de um paciente cadastrado (ex: vários filhos no
    // mesmo WhatsApp da família). Ver encontrarOpcaoPaciente.
    const campoPaciente = page.locator('sd-pacientes-autocomplete input[placeholder="Buscar paciente"]');
    const { opcao: opcaoPaciente } = await encontrarOpcaoPaciente(page, campoPaciente, telefone, nomePaciente);
    const encontrouPaciente = !!opcaoPaciente;

    let pacienteNovo = false;
    if (encontrouPaciente) {
      await opcaoPaciente.click();
    } else {
      // Paciente não encontrado -- cadastra um novo
      pacienteNovo = true;
      if (!nomePaciente) {
        throw new Error('Paciente não encontrado pelo telefone e nomePaciente não foi informado para cadastro.');
      }
      await page.getByText('Cadastrar novo paciente').click();

      // O cadastro abre num diálogo NOVO, por cima do formulário principal
      // (que continua "por baixo", ainda presente no DOM). Restringimos a
      // busca ao último diálogo aberto (o de cima) para não confundir com
      // elementos parecidos do formulário de baixo -- o Simples Dental,
      // por exemplo, reaproveita o mesmo data-testid="btnSalvar" no botão
      // "Marcar" do formulário principal.
      const dialogoCadastro = page.locator('mat-dialog-container').last();

      await dialogoCadastro.locator('[data-testid="inputNome"]').fill(nomePaciente);
      await dialogoCadastro.locator('[data-testid="inputCelular"]').fill(telefoneLocal(telefone));

      // Cadastro completo (data de nascimento, CPF, e-mail, endereço, e
      // dados do responsável se for menor de idade) -- exigido pela Dra.
      // Aline pra todo paciente novo, não só nome+telefone.
      await preencherCadastroCompleto(dialogoCadastro, {
        dataNascimentoPaciente,
        cpfPaciente,
        email,
        cep,
        numero,
        complemento,
        nomeResponsavel,
        dataNascimentoResponsavel,
        cpfResponsavel,
        celularResponsavel,
      });

      // Contorno extra, caso o banner de cookies ainda esteja de pé
      await dispensarBannerCookies(page);

      await dialogoCadastro.locator('[data-testid="btnSalvar"]').click();
      // Depois de salvar, a tela volta sozinha para o formulário de
      // agendamento com o paciente já selecionado -- esperamos isso
      // acontecer conferindo se o campo de paciente ficou preenchido.
      await page.waitForFunction(
        () => {
          const campo = document.querySelector('sd-pacientes-autocomplete input');
          return campo && campo.value && campo.value.trim().length > 0;
        },
        { timeout: 10000 }
      );
    }

    // 3. Seleciona o profissional
    await page.locator('[data-testid="inputProfissional"]').fill(nomeProfissional);
    await page
      .locator('.sd-profissionais-autocomplete__name-container', { hasText: nomeProfissional })
      .first()
      .click();

    // Diagnóstico: confirma o que ficou preenchido no campo Paciente
    // até este ponto, antes de seguir -- ajuda a investigar casos em
    // que o campo aparece vazio mais adiante.
    const valorPacienteAntes = await page
      .locator('sd-pacientes-autocomplete input')
      .inputValue()
      .catch(() => null);

    // 4. Procura horário livre -- abre o diálogo de sugestão
    await dispensarBannerCookies(page);
    await page.getByText('Encontrar horário livre').click();

    // Print de diagnóstico logo após o clique, para confirmarmos se o
    // diálogo "Sugestão de horários" realmente abriu ou não.
    await page.waitForTimeout(1000);
    await page
      .screenshot({ path: path.join(SCREENSHOTS_DIR, `debug-sugestao-${Date.now()}.png`), fullPage: true })
      .catch(() => {});
    const dialogoAbriu = await aparece(page.getByText('Sugestão de horários'), 3000);

    // 5. Seleciona qualquer sugestão de horário, só para destravar os
    // campos de data/hora (vamos sobrescrever com os valores reais logo
    // em seguida). O dia sugerido por padrão pode não ter nenhum horário
    // livre (ex: dia sem expediente ou já totalmente ocupado) -- nesse
    // caso avançamos de dia em dia até aparecer alguma sugestão clicável.
    const sugestao = page.locator('mat-button-toggle-group button.mat-button-toggle-button').first();
    let apareceuSugestao = await aparece(sugestao, 3000);

    let tentativas = 0;
    while (!apareceuSugestao && tentativas < 14) {
      if (!dialogoAbriu) {
        throw new Error(
          `O diálogo "Sugestão de horários" não abriu depois do clique em "Encontrar horário livre" (valorPacienteAntes: ${JSON.stringify(valorPacienteAntes)}).`
        );
      }
      await dispensarBannerCookies(page);
      const cliqueAvancar = await page
        .getByRole('button', { name: 'Avançar um dia' })
        .click({ timeout: 4000 })
        .then(() => true)
        .catch(() => false);

      if (!cliqueAvancar) {
        throw new Error('Não foi possível clicar em "Avançar um dia" -- algo pode estar bloqueando o botão (ex: banner de cookies).');
      }

      await page.waitForTimeout(500);
      apareceuSugestao = await aparece(sugestao, 2000);
      tentativas++;
    }

    if (!apareceuSugestao) {
      throw new Error('Nenhuma sugestão de horário apareceu em 14 dias -- não foi possível destravar os campos de data/hora.');
    }
    await sugestao.click();
    await page.getByRole('button', { name: 'Escolher horário' }).click();

    // Restringe as buscas seguintes ao diálogo aberto (em vez da página
    // inteira) -- evita ambiguidade com elementos parecidos que existem
    // "por baixo", como o filtro de data lá no topo da agenda.
    const dialogo = page.locator('mat-dialog-container');

    // 6. Sobrescreve com os valores reais desejados (digitando caractere
    // por caractere, já que esses campos têm máscara de formatação)
    await preencherCampoComMascara(dialogo.locator('[data-testid="inputData"]'), data);
    await preencherCampoComMascara(dialogo.locator('input[formcontrolname="hour"]'), hora);
    await preencherCampoComMascara(dialogo.locator('sd-minutes-autocomplete input[type="number"]'), duracao);

    // Confere se os valores realmente "grudaram" antes de seguir -- se
    // não bateram, é melhor abortar agora do que marcar no horário errado.
    const dataConfirmada = await dialogo.locator('[data-testid="inputData"]').inputValue();
    const horaConfirmada = await dialogo.locator('input[formcontrolname="hour"]').inputValue();
    if (dataConfirmada !== data || horaConfirmada !== hora) {
      throw new Error(
        `Os campos de data/hora não ficaram com os valores esperados (esperado: ${data} ${hora}, ficou: ${dataConfirmada} ${horaConfirmada}).`
      );
    }

    // 7. Observação (opcional)
    if (observacao) {
      await dialogo.locator('textarea[formcontrolname="descricao"]').fill(observacao);
    }

    // 7.5. Rótulo nativo do Simples Dental (opcional, best-effort -- ao
    // contrário de "categoria" acima, que só grava em eventos_agenda pra
    // analytics interno, isto aqui mexe visualmente no próprio Simples
    // Dental). Se falhar, não derruba a criação da consulta -- ela já
    // teria data/hora/paciente corretos, só ficaria sem o rótulo visual.
    if (rotulo) {
      try {
        await selecionarRotulo(page, dialogo, rotulo);
      } catch (erro) {
        console.error('[criarAgendamento] falha ao setar rótulo (consulta seguiu sem rótulo):', erro.message);
      }
    }

    // 8. Rede de segurança DUPLA contra conflito de horário:
    //   a) o banner amarelo nativo do Simples Dental (mas ele nem sempre
    //      aparece de forma confiável -- já vimos isso falhar num teste real)
    //   b) checagem própria contra os compromissos reais coletados no
    //      passo 0, ANTES de este diálogo abrir -- essa é a proteção
    //      principal agora (ver comentário no passo 0 sobre por que não
    //      dá pra checar direto no DOM aqui, com o diálogo já aberto).
    // Se qualquer uma das duas detectar conflito, abortamos antes de
    // clicar em Marcar, para não arriscar duplicar o compromisso.
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);

    const bannerConflito = await aparece(
      page.getByText('Há um compromisso no mesmo horário desta consulta.'),
      5000
    );

    const inicioEsperado = new Date(`${paraDataISO(data)}T${hora}:00${OFFSET_BRASILIA}`).getTime();
    const fimEsperado = inicioEsperado + duracao * 60 * 1000;
    const conflitoReal = compromissosExistentes.some(
      (c) => c.fim > c.inicio && c.inicio < fimEsperado && c.fim > inicioEsperado
    );

    if (bannerConflito || conflitoReal) {
      throw new Error('CONFLITO_HORARIO: já existe um compromisso nesse horário.');
    }


    // 9. Marca de verdade
    await page.getByRole('button', { name: 'Marcar', exact: true }).click();

    // 10. Confirma sucesso pelo fechamento do diálogo. Testado manualmente:
    // o Simples Dental fecha o diálogo e mostra o toast de sucesso de forma
    // instantânea quando o agendamento é criado -- se o diálogo continuar
    // aberto depois do clique em "Marcar", é sinal real de que algo
    // impediu a submissão (ex: erro de validação).
    const dialogoFechou = await dialogo
      .waitFor({ state: 'detached', timeout: 20000 })
      .then(() => true)
      .catch(() => false);

    if (!dialogoFechou) {
      await page
        .screenshot({ path: path.join(SCREENSHOTS_DIR, `erro-dialogo-nao-fechou-${Date.now()}.png`) })
        .catch(() => {});
      throw new Error('O diálogo de agendamento não fechou depois de clicar em "Marcar" -- provável falha ao salvar.');
    }

    // A partir daqui o agendamento já está confirmado (diálogo fechou). O
    // trecho abaixo só re-varre a agenda como registro auxiliar em log/print
    // -- NÃO decide mais sucesso ou falha. Antes disso decidia, e mostrou
    // na prática falsos negativos (reportava falha em agendamentos que,
    // conferidos manualmente, tinham sido criados com sucesso -- provável
    // timing: navegação/render da agenda não terminando a tempo do polling).

    // Volta para a URL base da agenda -- não basta um reload(). O fluxo
    // de "Encontrar horário livre" pode ter avançado a visão do calendário
    // várias vezes (via "Avançar um dia") procurando uma sugestão, e não
    // há garantia de que um reload sozinho descarta esse estado. Ir
    // explicitamente para a URL base garante que partimos sempre de um
    // ponto de referência conhecido: a semana de HOJE.
    await page.goto(process.env.SIMPLES_DENTAL_URL);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForURL('**/simples/agenda**', { timeout: 15000 }).catch(() => {});
    await page.waitForSelector('a.fc-event', { timeout: 15000 }).catch(() => {});
    await dispensarBannerCookies(page);

    // Calcula EXATAMENTE quantas semanas à frente de hoje está a data
    // marcada, e avança essa quantidade exata de cliques -- em vez de
    // tentar "adivinhar" avançando aos poucos. Essa grade não tem como
    // voltar, então adivinhar errado significa nunca mais achar o evento.
    // (hojeISO/semanasAteData já foram calculados no início da função.)
    const semanasParaAvancar = semanasAteData;

    for (let semana = 0; semana < semanasParaAvancar; semana++) {
      await page.click('[data-testid="btnProximoPeriodo"]').catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(600);
    }

    const nomeParaBuscar = (nomePaciente || '').toLowerCase();

    // Predicado serializado para dentro do browser -- roda em polling via
    // page.waitForFunction, então é uma espera ATIVA (verifica o DOM
    // repetidamente) em vez de um sleep fixo que pode ser curto demais.
    // Devolve o id do compromisso (string truthy) em vez de um boolean --
    // waitForFunction já trata qualquer retorno truthy como "condição
    // satisfeita", e assim aproveitamos a mesma varredura pra capturar o
    // data-consulta-id do agendamento recém-criado (usado só pra gravar o
    // mapeamento agendamento -> telefone, ver salvarTelefoneAgendamento).
    const encontrarIdEvento = ({ inicioEsperado, nomeParaBuscar }) => {
      const eventos = Array.from(document.querySelectorAll('a.fc-event'));
      const encontrado = eventos.find((el) => {
        const inicio = Number(el.getAttribute('data-start')) || 0;
        const paciente = (el.querySelector('.fc-event-title')?.textContent || '').toLowerCase();
        const bateHorario = Math.abs(inicio - inicioEsperado) < 60000; // tolerância de 1 min
        const batePaciente = !nomeParaBuscar || paciente.includes(nomeParaBuscar);
        return bateHorario && batePaciente;
      });
      return encontrado ? encontrado.getAttribute('data-consulta-id') : null;
    };

    let confirmou = false;
    let idCriado = null;

    console.log(
      `[criarAgendamento] tentativa 1: aguardando compromisso aparecer na semana calculada ` +
      `(${semanasParaAvancar} período(s) à frente de hoje, até 12s)...`
    );
    idCriado = await page
      .waitForFunction(encontrarIdEvento, { inicioEsperado, nomeParaBuscar }, { timeout: 12000, polling: 500 })
      .then((handle) => handle.jsonValue())
      .catch(() => null);
    confirmou = !!idCriado;

    if (confirmou) {
      console.log('[criarAgendamento] tentativa 1: compromisso encontrado.');
    }

    // Margem de segurança: avança mais algumas semanas caso o cálculo
    // tenha ficado com folga por alguma diferença de limite de semana
    // entre o nosso cálculo e o do Simples Dental (não há como voltar,
    // então a margem só pode ser para frente).
    for (let margem = 0; margem < 2 && !confirmou; margem++) {
      console.log(
        `[criarAgendamento] tentativa ${margem + 2}: não encontrado ainda -- ` +
        `avançando mais um período e tentando de novo...`
      );
      await page.click('[data-testid="btnProximoPeriodo"]').catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {});
      idCriado = await page
        .waitForFunction(encontrarIdEvento, { inicioEsperado, nomeParaBuscar }, { timeout: 8000, polling: 500 })
        .then((handle) => handle.jsonValue())
        .catch(() => null);
      confirmou = !!idCriado;
      if (confirmou) {
        console.log(`[criarAgendamento] tentativa ${margem + 2}: compromisso encontrado.`);
      }
    }

    if (!confirmou) {
      // Só log -- o diálogo já fechou (passo 10), então já sabemos que o
      // agendamento foi criado. Isso ajuda a investigar timing da agenda
      // se algum dia for necessário, sem bloquear a resposta ao paciente.
      // Sem id capturado, salvarTelefoneAgendamento abaixo é só um no-op.
      console.warn(
        '[criarAgendamento] AVISO: agendamento já confirmado (diálogo fechou), mas a varredura ' +
        'auxiliar da agenda não achou o compromisso -- possível timing de render, não é falha real.'
      );
    }

    const nomePrint = `agendamento-${Date.now()}.png`;
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, nomePrint), fullPage: true }).catch(() => {});

    await registrarEventoAgenda({ tipo: 'criado', telefone, categoria, data, hora });
    await salvarTelefoneAgendamento({ agendamentoId: idCriado, telefone });
    await fecharFunil({ telefone: `55${telefoneLocal(telefone)}@s.whatsapp.net`, status: 'concluido' });

    // Vínculo responsável -> dependente: se veio nomeResponsavel, é consulta
    // pra menor sob o WhatsApp da família. Registra o vínculo pra o sync da
    // agenda conseguir resolver o telefone dessa consulta depois. Nunca
    // derruba a resposta -- falha aqui é só log.
    if (nomeResponsavel && nomePaciente && pool) {
      try {
        await pool.query(
          `INSERT INTO public.paciente_dependente
             (responsavel_telefone, dependente_nome, dependente_nascimento, dependente_cpf)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (responsavel_telefone, dependente_nome) DO UPDATE SET
             dependente_nascimento = COALESCE(EXCLUDED.dependente_nascimento, public.paciente_dependente.dependente_nascimento),
             dependente_cpf        = COALESCE(EXCLUDED.dependente_cpf, public.paciente_dependente.dependente_cpf)`,
          [
            `55${telefoneLocal(telefone)}@s.whatsapp.net`,
            nomePaciente.trim(),
            dataNascimentoPaciente ? paraDataISO(dataNascimentoPaciente) : null,
            cpfPaciente ? somenteDigitos(cpfPaciente) : null,
          ]
        );
      } catch (erro) {
        console.error('[criarAgendamento] falha ao gravar paciente_dependente (não afeta o agendamento):', erro.message);
      }
    }

    cacheAgenda.clear();

    return {
      sucesso: true,
      pacienteNovo,
      data,
      hora,
      duracaoMinutos: duracao,
    };
  } catch (erro) {
    await page
      .screenshot({ path: path.join(SCREENSHOTS_DIR, `erro-agendamento-${Date.now()}.png`) })
      .catch(() => {});
    throw erro;
  } finally {
    await context.close();
  }
}

// Encontra os próximos compromissos de um paciente, a partir do telefone.
// Estratégia: usa o mesmo campo de busca de paciente do formulário de novo
// evento (sem criar nada) para descobrir o NOME exato cadastrado, fecha o
// diálogo, e então varre os compromissos das próximas semanas (mesma
// função usada em /verificar-disponibilidade) filtrando pelo nome.
async function buscarAgendamentosPaciente({ telefone, semanas, nomePaciente: nomeBuscado }) {
  if (!telefone) {
    throw new Error('Campo obrigatório faltando: telefone.');
  }

  const { context, page } = await abrirPaginaLogada();
  const totalSemanas = Number(semanas || process.env.SEMANAS_A_VERIFICAR || 4);

  try {
    // 1. Abre o "+" só para usar o campo de busca de paciente
    await page.click('[data-testid="btnNovoEvento"]');
    const campoPaciente = page.locator('sd-pacientes-autocomplete input[placeholder="Buscar paciente"]');
    // Desambigua por nome quando o telefone tem mais de um paciente
    // cadastrado (ex: vários filhos no mesmo WhatsApp da família) -- ver
    // encontrarOpcaoPaciente.
    const { nome: nomePaciente } = await encontrarOpcaoPaciente(page, campoPaciente, telefone, nomeBuscado);

    // Fecha o diálogo sem salvar nada
    await page
      .getByRole('button', { name: 'Fechar', exact: true })
      .click({ timeout: 5000 })
      .catch(() => {});

    if (!nomePaciente) {
      return { encontrado: false, agendamentos: [] };
    }

    // 2. Varre os compromissos das próximas semanas e filtra pelo nome
    const compromissos = await coletarCompromissosVariasSemanas(page, totalSemanas);
    const nomeBusca = nomePaciente.toLowerCase();
    const doPaciente = compromissos.filter((c) => (c.paciente || '').toLowerCase().includes(nomeBusca));

    return {
      encontrado: true,
      nomePaciente,
      agendamentos: formatarCompromissos(doPaciente),
      semanasVerificadas: totalSemanas,
    };
  } catch (erro) {
    await page
      .screenshot({ path: path.join(SCREENSHOTS_DIR, `erro-busca-paciente-${Date.now()}.png`) })
      .catch(() => {});
    throw erro;
  } finally {
    await context.close();
  }
}

// Lista as consultas de hoje e amanhã, resolvendo o telefone de cada uma via
// public.agendamento_telefone (gravado por salvarTelefoneAgendamento sempre
// que o bot cria/confirma/cancela/remarca um agendamento -- agendamentos
// feitos manualmente, sem nenhuma interação via WhatsApp, ficam com
// telefone null aqui). Usada só pelo workflow separado de lembretes
// (n8n/lembretes-workflow.json), nunca pela Lumi -- por isso, ao contrário
// de verificarDisponibilidade, PODE incluir nome do paciente na resposta.
async function listarLembretesDoDia() {
  const { context, page } = await abrirPaginaLogada();

  try {
    // 2 semanas dá margem suficiente pra cobrir hoje+amanhã mesmo quando a
    // virada cai numa fronteira de semana do calendário (ex: hoje é
    // domingo, amanhã já é segunda da semana seguinte).
    const compromissos = await coletarCompromissosVariasSemanas(page, 2);

    const hojeISO = formatadorDiaISO.format(new Date());
    const amanhaISO = formatadorDiaISO.format(new Date(Date.now() + 24 * 60 * 60 * 1000));

    const doDia = compromissos.filter((c) => {
      if (!(c.fim > c.inicio)) return false; // descarta bloqueios de dia inteiro
      if (STATUS_CANCELADOS.includes(c.status)) return false;
      const diaISO = formatadorDiaISO.format(new Date(c.inicio));
      return diaISO === hojeISO || diaISO === amanhaISO;
    });

    const lembretes = [];
    for (const c of doDia) {
      let telefone = null;
      if (pool && c.id) {
        try {
          const resultado = await pool.query(
            'SELECT telefone FROM public.agendamento_telefone WHERE agendamento_id = $1',
            [String(c.id)]
          );
          telefone = resultado.rows[0]?.telefone || null;
        } catch (erro) {
          console.error('[lembretesDoDia] falha ao buscar telefone (agendamento fica sem lembrete):', erro.message);
        }
      }

      // Sem mapeamento em agendamento_telefone (comum pra agendamento
      // criado manualmente, direto no Simples Dental, sem passar pelo
      // bot) -- tenta achar o paciente pelo nome, já que ele pode muito
      // bem já existir em public.cliente (ex: veio da importação em lote).
      if (!telefone) {
        telefone = await resolverTelefonePorNome(c.paciente);
      }

      const diaISO = formatadorDiaISO.format(new Date(c.inicio));
      const dataHora = new Date(c.inicio);

      lembretes.push({
        agendamentoId: c.id || null,
        paciente: c.paciente || null,
        status: c.status || null,
        data: dataHora.toLocaleDateString('pt-BR', { timeZone: FUSO }),
        hora: dataHora.toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' }),
        quando: diaISO === hojeISO ? 'hoje' : 'amanha',
        telefone,
      });
    }

    return { lembretes };
  } catch (erro) {
    await page
      .screenshot({ path: path.join(SCREENSHOTS_DIR, `erro-lembretes-${Date.now()}.png`) })
      .catch(() => {});
    throw erro;
  } finally {
    await context.close();
  }
}

// Localiza um compromisso específico na tela pelo id (data-consulta-id).
// Como o evento pode estar numa semana diferente da que está visível por
// padrão, avança algumas vezes procurando antes de desistir.
async function localizarEventoPorId(page, id, maxTentativas = 6) {
  const evento = page.locator(`a.fc-event[data-consulta-id="${id}"]`);
  for (let tentativa = 0; tentativa < maxTentativas; tentativa++) {
    if (await aparece(evento, 1500)) return evento;
    await page.click('[data-testid="btnProximoPeriodo"]').catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(500);
  }
  return null;
}

const STATUS_VALIDOS = [
  'Agendada',
  'Confirmada',
  'Em atendimento',
  'Falta',
  'Cancelada pelo paciente',
  'Cancelada pelo profissional',
];

const STATUS_CANCELADOS = STATUS_VALIDOS.filter((s) => s.startsWith('Cancelada'));

// Base de /confirmar-agendamento e /cancelar-agendamento: clica no
// compromisso (abre o popover pequeno) e troca o status pelo dropdown.
async function mudarStatusAgendamento({ id, status, telefone }) {
  if (!id || !status) {
    throw new Error('Campos obrigatórios faltando: id e status são necessários.');
  }
  // IDs reais do Simples Dental são só dígitos. Se vier outra coisa (ex: a IA
  // confundindo o id da propria chamada de ferramenta com o id do
  // agendamento), falha aqui com uma mensagem clara em vez de tentar a
  // automação com um id que nunca vai ser encontrado.
  if (!/^\d+$/.test(String(id))) {
    throw new Error(`ID de agendamento inválido: "${id}". Use exatamente o id numérico retornado por Busca Agendamentos do Paciente.`);
  }
  if (!STATUS_VALIDOS.includes(status)) {
    throw new Error(`Status inválido: "${status}". Valores aceitos: ${STATUS_VALIDOS.join(', ')}`);
  }

  const { context, page } = await abrirPaginaLogada();

  try {
    const evento = await localizarEventoPorId(page, id);
    if (!evento) {
      throw new Error(`Não foi possível encontrar o compromisso com id ${id} nas próximas semanas.`);
    }

    await evento.click();

    const popover = page.locator('mat-card.popover-content');
    const abriu = await aparece(popover, 5000);
    if (!abriu) {
      throw new Error('O popover do compromisso não abriu depois do clique.');
    }

    await popover.locator('mat-select[mattooltip="Status"]').click();
    await page.getByRole('option', { name: status, exact: true }).click();
    await page.waitForLoadState('networkidle').catch(() => {});

    // Confirma que o status realmente mudou antes de considerar sucesso --
    // espera ATIVA com retry (em vez de um sleep fixo + checagem única),
    // já que o texto do popover pode demorar um pouco mais que isso pra
    // atualizar depois do clique na opção.
    let statusAtual = null;
    for (let tentativa = 0; tentativa < 6; tentativa++) {
      statusAtual = await popover
        .locator('.mat-mdc-select-min-line')
        .innerText()
        .catch(() => null);

      console.log(
        `[mudarStatusAgendamento] tentativa ${tentativa + 1}: status na tela = "${statusAtual}" (esperado "${status}")`
      );

      if (statusAtual && statusAtual.trim() === status) break;
      await page.waitForTimeout(500);
    }

    const nomePrint = `status-${Date.now()}.png`;
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, nomePrint), fullPage: true });

    if (!statusAtual || statusAtual.trim() !== status) {
      throw new Error(`O status não foi confirmado como alterado (ficou: "${statusAtual}").`);
    }

    // Fecha o popover
    await popover
      .locator('[data-testid="btnFechar"]')
      .click({ timeout: 3000 })
      .catch(() => {});

    // Só Confirmada/Cancelada* têm um "tipo" correspondente em
    // eventos_agenda (usado pelo Analytics) -- os outros 4 status
    // (Agendada, Em atendimento, Falta) não têm equivalente e não devem
    // logar nada, senão contaminava a contagem de cancelamento/confirmação.
    // Isso só passou a importar agora que existe uma rota genérica
    // (/alterar-status-agendamento) que permite os 6 valores -- antes só
    // /confirmar-agendamento e /cancelar-agendamento chamavam esta função,
    // então o ternário antigo nunca via os outros 4 valores.
    const tipoEvento = status === 'Confirmada' ? 'confirmado' : status.startsWith('Cancelada') ? 'cancelado' : null;
    if (tipoEvento) {
      await registrarEventoAgenda({ tipo: tipoEvento, telefone });
    }
    await salvarTelefoneAgendamento({ agendamentoId: id, telefone });
    cacheAgenda.clear();

    return { sucesso: true, id, status };
  } catch (erro) {
    await page
      .screenshot({ path: path.join(SCREENSHOTS_DIR, `erro-status-${Date.now()}.png`) })
      .catch(() => {});
    throw erro;
  } finally {
    await context.close();
  }
}

// Muda o rótulo de uma consulta JÁ EXISTENTE -- mesmo popover de detalhe
// usado por mudarStatusAgendamento (clica no evento, mesmo popover), mas
// o campo de rótulo é um autocomplete (selecionarRotulo), não um
// mat-select como o de Status.
async function mudarRotuloAgendamento({ id, rotulo, telefone }) {
  if (!id || !rotulo) {
    throw new Error('Campos obrigatórios faltando: id e rotulo são necessários.');
  }
  if (!/^\d+$/.test(String(id))) {
    throw new Error(`ID de agendamento inválido: "${id}". Use exatamente o id numérico retornado por Busca Agendamentos do Paciente.`);
  }

  const { context, page } = await abrirPaginaLogada();

  try {
    const evento = await localizarEventoPorId(page, id);
    if (!evento) {
      throw new Error(`Não foi possível encontrar o compromisso com id ${id} nas próximas semanas.`);
    }

    await evento.click();

    const popover = page.locator('mat-card.popover-content');
    const abriu = await aparece(popover, 5000);
    if (!abriu) {
      throw new Error('O popover do compromisso não abriu depois do clique.');
    }

    await selecionarRotulo(page, popover, rotulo);
    await page.waitForLoadState('networkidle').catch(() => {});

    await page
      .screenshot({ path: path.join(SCREENSHOTS_DIR, `rotulo-${Date.now()}.png`), fullPage: true })
      .catch(() => {});

    // Fecha o popover
    await popover
      .locator('[data-testid="btnFechar"]')
      .click({ timeout: 3000 })
      .catch(() => {});

    await salvarTelefoneAgendamento({ agendamentoId: id, telefone });
    cacheAgenda.clear();

    return { sucesso: true, id, rotulo };
  } catch (erro) {
    await page
      .screenshot({ path: path.join(SCREENSHOTS_DIR, `erro-rotulo-${Date.now()}.png`) })
      .catch(() => {});
    throw erro;
  } finally {
    await context.close();
  }
}

async function remarcarAgendamento({
  id,
  data,
  hora,
  duracaoMinutos,
  observacao,
  telefone,
}) {
  if (!id || !data || !hora) {
    throw new Error(
      'Campos obrigatórios faltando: id, data e hora são necessários.'
    );
  }
  // Mesma rede de seguranca do mudarStatusAgendamento -- ver comentario la.
  if (!/^\d+$/.test(String(id))) {
    throw new Error(`ID de agendamento inválido: "${id}". Use exatamente o id numérico retornado por Busca Agendamentos do Paciente.`);
  }

  const { context, page } = await abrirPaginaLogada();

  const duracao = Number(
    duracaoMinutos || (await buscarConfiguracaoHorarios()).duracaoConsultaMinutos
  );

  const hojeISO = formatadorDiaISO.format(new Date());
  const semanasAteData = Math.max(0, semanasEntre(paraDataISO(data), hojeISO));

  try {
    // ============================================================
    // 0. COLETA OS COMPROMISSOS REAIS (para checagem de conflito)
    // ============================================================
    //
    // IMPORTANTE: assim como em criarAgendamento, a checagem de conflito
    // NÃO PODE navegar a agenda clicando em "próximo período" depois que
    // o diálogo de edição estiver aberto -- o backdrop do diálogo modal
    // bloqueia cliques nos elementos por trás dele, e esses cliques
    // falhariam silenciosamente (.catch(() => {})), fazendo a checagem
    // nunca alcançar a semana certa e concluir erradamente que não há
    // conflito. Coletamos aqui, com a página ainda "limpa".
    const semanasParaConflito = Math.max(4, semanasAteData + 2);
    const compromissosExistentes = await coletarCompromissosVariasSemanas(page, semanasParaConflito);

    // Volta para a URL base -- a coleta acima avança a visão da agenda
    // várias semanas, e localizarEventoPorId (a seguir) espera partir de
    // um ponto de referência conhecido (a semana de hoje).
    await page.goto(process.env.SIMPLES_DENTAL_URL);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForURL('**/simples/agenda**', { timeout: 15000 }).catch(() => {});
    await page.waitForSelector('a.fc-event', { timeout: 15000 }).catch(() => {});
    await dispensarBannerCookies(page);

    // ============================================================
    // 1. LOCALIZA O COMPROMISSO PELO ID
    // ============================================================

    const evento = await localizarEventoPorId(page, id);

    if (!evento) {
      throw new Error(
        `Não foi possível encontrar o compromisso com id ${id} nas próximas semanas.`
      );
    }

    // Guarda informações do compromisso original para diagnóstico
    const dadosOriginais = await evento.evaluate((el) => ({
      id: el.getAttribute('data-consulta-id'),
      inicio: Number(el.getAttribute('data-start')) || 0,
      fim: Number(el.getAttribute('data-end')) || 0,
      paciente:
        el.querySelector('.fc-event-title')?.textContent.trim() || null,
    }));

    console.log(
      'Compromisso localizado para remarcação:',
      dadosOriginais
    );

    // ============================================================
    // 2. CLICA NO COMPROMISSO
    // ============================================================

    await dispensarBannerCookies(page);

    await evento.click();

    const popover = page.locator('mat-card.popover-content');

    const abriuPopover = await aparece(popover, 5000);

    if (!abriuPopover) {
      throw new Error(
        'O popover do compromisso não abriu depois do clique.'
      );
    }

    await page.screenshot({
      path: path.join(
        SCREENSHOTS_DIR,
        `debug-remarcar-popover-${Date.now()}.png`
      ),
      fullPage: true,
    });

    // ============================================================
    // 3. CLICA NO LÁPIS / EDITAR
    // ============================================================

    /*
     * O Simples Dental pode variar os atributos do botão dependendo
     * da versão da tela. Tentamos primeiro seletores mais específicos
     * e depois algumas alternativas.
     */

    const botoesEditar = [
      popover.locator('[data-testid="btnEditar"]'),
      popover.locator('[data-testid="btnEditarConsulta"]'),
      popover.locator('[data-testid="btnEditarAgendamento"]'),
      popover.getByRole('button', { name: /editar/i }),
      popover.locator('button').filter({ has: page.locator('mat-icon') }),
    ];

    let botaoEditar = null;

    for (const candidato of botoesEditar) {
      if (await aparece(candidato, 1000)) {
        botaoEditar = candidato.first();
        break;
      }
    }

    /*
     * Último recurso: procura botões que contenham um ícone
     * relacionado a edição.
     */
    if (!botaoEditar) {
      const botoes = popover.locator('button');

      const quantidadeBotoes = await botoes.count();

      for (let i = 0; i < quantidadeBotoes; i++) {
        const botao = botoes.nth(i);

        const texto = await botao.innerText().catch(() => '');
        const aria = await botao.getAttribute('aria-label').catch(() => '');
        const tooltip = await botao
          .getAttribute('mattooltip')
          .catch(() => '');

        const informacao = `${texto} ${aria} ${tooltip}`.toLowerCase();

        if (
          informacao.includes('editar') ||
          informacao.includes('edit') ||
          informacao.includes('alterar')
        ) {
          botaoEditar = botao;
          break;
        }
      }
    }

    if (!botaoEditar) {
      throw new Error(
        'Não foi possível localizar o botão de editar (lápis) no compromisso.'
      );
    }

    await botaoEditar.click();

    // ============================================================
    // 4. ESPERA O DIÁLOGO COMPLETO DE EDIÇÃO
    // ============================================================

    const dialogo = page.locator('mat-dialog-container').last();

    const abriuDialogo = await aparece(dialogo, 8000);

    if (!abriuDialogo) {
      throw new Error(
        'O diálogo completo de edição do compromisso não abriu.'
      );
    }

    await page.waitForTimeout(500);
    await dispensarBannerCookies(page);

    await page.screenshot({
      path: path.join(
        SCREENSHOTS_DIR,
        `debug-remarcar-dialogo-${Date.now()}.png`
      ),
      fullPage: true,
    });

    // ============================================================
    // 5. ALTERA DATA
    // ============================================================

    const campoData = dialogo
      .locator('[data-testid="inputData"]')
      .last();

    const campoHora = dialogo
      .locator('input[formcontrolname="hour"]')
      .last();

    const campoDuracao = dialogo
      .locator('sd-minutes-autocomplete input[type="number"]')
      .last();

    if (!(await aparece(campoData, 5000))) {
      throw new Error(
        'Campo de data da consulta não apareceu no diálogo de edição.'
      );
    }

    if (!(await aparece(campoHora, 5000))) {
      throw new Error(
        'Campo de horário da consulta não apareceu no diálogo de edição.'
      );
    }

    // Digitação simulando usuário real para respeitar as máscaras
    await preencherCampoComMascara(campoData, data);

    await preencherCampoComMascara(campoHora, hora);

    if (await aparece(campoDuracao, 3000)) {
      await preencherCampoComMascara(
        campoDuracao,
        String(duracao)
      );
    }

    // ============================================================
    // 6. CONFERE SE OS CAMPOS FORAM PREENCHIDOS
    // ============================================================

    const dataConfirmada = await campoData
      .inputValue()
      .catch(() => '');

    const horaConfirmada = await campoHora
      .inputValue()
      .catch(() => '');

    if (dataConfirmada !== data || horaConfirmada !== hora) {
      throw new Error(
        `Os campos de data/hora não ficaram com os valores esperados ` +
        `(esperado: ${data} ${hora}, ficou: ` +
        `${dataConfirmada} ${horaConfirmada}).`
      );
    }

    // ============================================================
    // 7. OBSERVAÇÃO
    // ============================================================

    if (observacao !== undefined && observacao !== null) {
      const campoObservacao = dialogo.locator(
        'textarea[formcontrolname="descricao"]'
      );

      if (await aparece(campoObservacao, 2000)) {
        await campoObservacao.fill(observacao);
      }
    }

    // ============================================================
    // 8. CHECAGEM DE CONFLITO
    // ============================================================

    const inicioEsperado = new Date(
      `${paraDataISO(data)}T${hora}:00${OFFSET_BRASILIA}`
    ).getTime();

    const fimEsperado =
      inicioEsperado + duracao * 60 * 1000;

    await page.waitForTimeout(1000);

    /*
     * IMPORTANTE:
     *
     * A checagem usa os compromissos coletados no passo 0, ANTES do
     * diálogo de edição abrir (ver comentário lá sobre por que não dá
     * pra navegar a agenda com o diálogo já aberto). Excluímos o próprio
     * ID do compromisso sendo remarcado, senão ele conflitaria consigo
     * mesmo.
     */

    const conflitoReal = compromissosExistentes.some(
      (c) =>
        String(c.id) !== String(id) &&
        c.fim > c.inicio &&
        c.inicio < fimEsperado &&
        c.fim > inicioEsperado
    );

    const bannerConflito = await aparece(
      page.getByText(
        'Há um compromisso no mesmo horário desta consulta.'
      ),
      3000
    );

    if (bannerConflito || conflitoReal) {
      throw new Error(
        'CONFLITO_HORARIO: já existe outro compromisso nesse horário.'
      );
    }

    // ============================================================
    // 9. SALVA A REMARCAÇÃO
    // ============================================================

    let botaoSalvar = dialogo.getByRole('button', {
      name: 'Salvar',
      exact: true,
    });

    if (!(await aparece(botaoSalvar, 2000))) {
      botaoSalvar = dialogo.getByRole('button', {
        name: 'Marcar',
        exact: true,
      });
    }

    if (!(await aparece(botaoSalvar, 3000))) {
      throw new Error(
        'Não foi possível encontrar o botão "Salvar" no diálogo de edição.'
      );
    }

    await botaoSalvar.click();

    // ============================================================
    // 10. ESPERA O DIÁLOGO FECHAR -- esse é o sinal real de sucesso
    // (mesmo raciocínio de criarAgendamento: testado manualmente, o
    // Simples Dental fecha o diálogo instantaneamente quando salva).
    // ============================================================

    const dialogoFechou = await dialogo
      .waitFor({
        state: 'detached',
        timeout: 20000,
      })
      .then(() => true)
      .catch(() => false);

    if (!dialogoFechou) {
      await page
        .screenshot({ path: path.join(SCREENSHOTS_DIR, `erro-remarcacao-dialogo-nao-fechou-${Date.now()}.png`) })
        .catch(() => {});
      throw new Error('O diálogo de edição não fechou depois de clicar em "Salvar"/"Marcar" -- provável falha ao salvar a remarcação.');
    }

    await page.waitForLoadState('networkidle').catch(() => {});

    // ============================================================
    // 11. CONFIRMAÇÃO DO NOVO HORÁRIO -- a partir daqui a remarcação já
    // está confirmada (diálogo fechou). O que segue é só registro
    // auxiliar em log/print, não decide mais sucesso ou falha (mesmo
    // motivo de criarAgendamento: essa varredura já mostrou falsos
    // negativos na prática).
    // ============================================================

    /*
     * Depois de salvar, o compromisso pode estar em outra semana.
     * Procuramos pelo ID, que é muito mais confiável do que procurar
     * pelo nome do paciente.
     *
     * Volta para a URL base da agenda (referência conhecida: semana de
     * hoje) em vez de continuar de onde a busca do compromisso original
     * (localizarEventoPorId) deixou a tela -- essa grade não tem como
     * voltar sozinha, então se a nova data for anterior à semana em que
     * estávamos, nunca mais acharíamos o compromisso.
     */
    await page.goto(process.env.SIMPLES_DENTAL_URL);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForURL('**/simples/agenda**', { timeout: 15000 }).catch(() => {});
    await page.waitForSelector('a.fc-event', { timeout: 15000 }).catch(() => {});
    await dispensarBannerCookies(page);

    // (hojeISO/semanasAteData já foram calculados no início da função.)
    const semanasParaAvancar = semanasAteData;

    console.log(
      `[remarcarAgendamento] navegando ${semanasParaAvancar} período(s) à frente de hoje até a semana da nova data (${data})...`
    );
    for (let semana = 0; semana < semanasParaAvancar; semana++) {
      await page.click('[data-testid="btnProximoPeriodo"]').catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(600);
    }

    // Predicado serializado para dentro do browser -- roda em polling via
    // page.waitForFunction, uma espera ATIVA em vez de sleep fixo.
    const eventoBateCondicao = ({ id, inicioEsperado }) => {
      const el = document.querySelector(`a.fc-event[data-consulta-id="${id}"]`);
      if (!el) return false;
      const inicio = Number(el.getAttribute('data-start')) || 0;
      return Math.abs(inicio - inicioEsperado) < 60000;
    };

    let confirmou = false;

    console.log(
      `[remarcarAgendamento] tentativa 1: aguardando compromisso aparecer no novo horário (até 12s)...`
    );
    confirmou = await page
      .waitForFunction(eventoBateCondicao, { id, inicioEsperado }, { timeout: 12000, polling: 500 })
      .then(() => true)
      .catch(() => false);

    if (confirmou) {
      console.log('[remarcarAgendamento] tentativa 1: compromisso confirmado no novo horário.');
    }

    // Margem de segurança: avança mais algumas semanas caso o cálculo
    // tenha ficado com folga (não há como voltar, então só pra frente).
    for (let margem = 0; margem < 2 && !confirmou; margem++) {
      console.log(
        `[remarcarAgendamento] tentativa ${margem + 2}: não encontrado ainda -- avançando mais um período e tentando de novo...`
      );
      await page.click('[data-testid="btnProximoPeriodo"]').catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {});
      confirmou = await page
        .waitForFunction(eventoBateCondicao, { id, inicioEsperado }, { timeout: 8000, polling: 500 })
        .then(() => true)
        .catch(() => false);
      if (confirmou) {
        console.log(`[remarcarAgendamento] tentativa ${margem + 2}: compromisso confirmado no novo horário.`);
      }
    }

    if (!confirmou) {
      // Só log -- o diálogo já fechou (passo 10), então já sabemos que a
      // remarcação foi salva. Ajuda a investigar timing da agenda se
      // necessário, sem bloquear a resposta ao paciente.
      console.warn(
        '[remarcarAgendamento] AVISO: remarcação já confirmada (diálogo fechou), mas a varredura ' +
        'auxiliar não achou o compromisso no novo horário -- possível timing de render, não é falha real.'
      );
    } else {
      const dadosDepois = await page
        .locator(`a.fc-event[data-consulta-id="${id}"]`)
        .first()
        .evaluate((el) => ({
          id: el.getAttribute('data-consulta-id'),
          inicio: Number(el.getAttribute('data-start')) || 0,
          fim: Number(el.getAttribute('data-end')) || 0,
          paciente: el.querySelector('.fc-event-title')?.textContent.trim() || null,
        }))
        .catch(() => null);
      console.log('[remarcarAgendamento] compromisso depois da remarcação:', dadosDepois);
    }

    // ============================================================
    // 12. PRINT FINAL
    // ============================================================

    const nomePrint = `remarcacao-${Date.now()}.png`;

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, nomePrint),
      fullPage: true,
    }).catch(() => {});

    await registrarEventoAgenda({ tipo: 'remarcado', telefone, data, hora });
    await salvarTelefoneAgendamento({ agendamentoId: id, telefone });
    // Achado 26/08 (via fix em Busca Funil Parado): remarcar tambem
    // encerra a tentativa em_andamento do funil de resgate -- sem isso,
    // um paciente que remarca fica com a linha do funil orfa pra sempre
    // (nunca fecha), arriscando um resgate incorreto oferecendo um
    // horario que ele ja tem. Mesma chamada que criarAgendamento ja faz.
    await fecharFunil({ telefone: `55${telefoneLocal(telefone)}@s.whatsapp.net`, status: 'concluido' });
    cacheAgenda.clear();

    return {
      sucesso: true,
      id,
      data,
      hora,
      duracaoMinutos: duracao,
    };
  } catch (erro) {
    await page
      .screenshot({
        path: path.join(
          SCREENSHOTS_DIR,
          `erro-remarcacao-${Date.now()}.png`
        ),
        fullPage: true,
      })
      .catch(() => {});

    throw erro;
  } finally {
    await context.close();
  }
}


app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Espera receber, no corpo da requisição (JSON, tudo opcional):
// {
//   "diaSemana": "segunda" | "terca" | "quarta" | "quinta" | "sexta" | "sabado" | "domingo",
//   "periodo": "manha" | "tarde"
// }
// Se omitidos, devolve todas as semanas/períodos (comportamento antigo).
app.post('/verificar-disponibilidade', async (req, res) => {
  try {
    const resultado = await comFilaSegura(() => verificarDisponibilidade(req.body || {}));
    const { telefone, instancia } = req.body || {};
    await abrirOuAtualizarFunil({ telefone, instancia });
    res.json(resultado);
  } catch (erro) {
    console.error('Erro ao verificar disponibilidade:', erro);
    res.status(500).json({
      erro: 'Falha ao verificar disponibilidade',
      detalhe: erro.message,
    });
  }
});

// Espera receber, no corpo da requisição (JSON):
// {
//   "telefone": "11991234567",       (obrigatório)
//   "nomePaciente": "Nome Completo", (obrigatório só se for paciente novo)
//   "data": "03/08/2026",            (obrigatório, formato DD/MM/AAAA --
//                                     igual ao usado nas chaves do
//                                     resultado de /verificar-disponibilidade)
//   "hora": "08:30",                 (obrigatório, formato HH:mm)
//   "duracaoMinutos": 90,            (opcional)
//   "observacao": "texto livre",     (opcional)
//   "categoria": "primeira_consulta" | "ortodontia" | "odontopediatria" |
//                "hof" | "clareamento" | "limpeza_prevencao" |
//                "consulta_estetica" | "dor_urgencia" | "outro"  (opcional,
//                usado só para registrar o evento em eventos_agenda)
//   "rotulo": "HOF" | "Clareamento" | "INVISALIGN" | ... (opcional, nome
//             EXATO de um rótulo já existente no Simples Dental -- é o
//             rótulo visual nativo de lá, diferente de "categoria" acima.
//             Se não existir com esse nome, é ignorado silenciosamente
//             e a consulta é criada sem rótulo mesmo assim)
//
//   Campos abaixo só são usados se o paciente for NOVO no Simples Dental
//   (ignorados se o telefone já corresponder a um paciente existente):
//
//   "dataNascimentoPaciente": "07/05/1989", (do paciente, formato DD/MM/AAAA)
//   "cpfPaciente": "38185854823",           (do paciente, só dígitos ou formatado)
//   "email": "nome@exemplo.com",            (do paciente adulto, ou do
//                                             responsável se for menor)
//   "cep": "13334360",
//   "numero": "43",
//   "complemento": "apto 22",               (opcional)
//
//   Só quando o paciente é menor de idade (ver seção CONSULTA PARA
//   DEPENDENTE do prompt da Lumi):
//   "nomeResponsavel": "Nome do Responsável",
//   "dataNascimentoResponsavel": "10/08/1990",
//   "cpfResponsavel": "34404146809",
//   "celularResponsavel": "11998092622"
// }
app.post('/criar-agendamento', async (req, res) => {
  try {
    const resultado = await comFilaSegura(() => criarAgendamento(req.body || {}));
    res.json(resultado);
  } catch (erro) {
    console.error('Erro ao criar agendamento:', erro);
    const conflito = String(erro.message || '').startsWith('CONFLITO_HORARIO');
    res.status(conflito ? 409 : 500).json({
      erro: conflito ? 'Horário não está mais disponível' : 'Falha ao criar agendamento',
      detalhe: erro.message,
    });
  }
});

// Espera receber, no corpo da requisição (JSON):
// {
//   "telefone": "11991234567",  (obrigatório)
//   "semanas": 4                (opcional, padrão = SEMANAS_A_VERIFICAR)
//   "nomePaciente": "Pedro Lima" (opcional -- necessário quando o telefone
//                                 pode ter mais de um paciente cadastrado,
//                                 ex: vários filhos no mesmo WhatsApp da
//                                 família. Sem isso, se houver mais de um
//                                 paciente pro telefone, a busca não
//                                 consegue saber qual deles retornar e trata
//                                 como não encontrado.)
// }
app.post('/buscar-agendamentos-paciente', async (req, res) => {
  try {
    const resultado = await comFilaSegura(() => buscarAgendamentosPaciente(req.body || {}));
    res.json(resultado);
  } catch (erro) {
    console.error('Erro ao buscar agendamentos do paciente:', erro);
    res.status(500).json({
      erro: 'Falha ao buscar agendamentos do paciente',
      detalhe: erro.message,
    });
  }
});

// Sem parâmetros no corpo. Usado só pelo workflow separado de lembretes
// (n8n/lembretes-workflow.json) -- NÃO é uma tool da Lumi, por isso não
// precisa (nem deve) ser adicionada como httpRequestTool no fluxo de
// conversa. Devolve:
// {
//   "lembretes": [
//     {
//       "agendamentoId": "310729432" | null,
//       "paciente": "Nome do Paciente" | null,
//       "status": "Agendada" | "Confirmada" | ...,
//       "data": "13/08/2026",
//       "hora": "08:30",
//       "quando": "hoje" | "amanha",
//       "telefone": "11991234567" | null   (null = sem mapeamento conhecido,
//                                           agendamento feito fora do bot)
//     }, ...
//   ]
// }
app.post('/lembretes-do-dia', async (req, res) => {
  try {
    const resultado = await comFilaSegura(() => listarLembretesDoDia());
    res.json(resultado);
  } catch (erro) {
    console.error('Erro ao listar lembretes do dia:', erro);
    res.status(500).json({
      erro: 'Falha ao listar lembretes do dia',
      detalhe: erro.message,
    });
  }
});

// Usada pela página Agenda do painel administrativo (não é ferramenta da
// Lumi). Query param opcional "semanas" (1-4, padrão SEMANAS_A_VERIFICAR ou
// 4). Devolve TODOS os compromissos das próximas N semanas, incluindo
// cancelados (ao contrário de /lembretes-do-dia) -- quem decide esconder ou
// não é o front, aqui é só leitura completa.
app.get('/agenda-semana', async (req, res) => {
  try {
    const resultado = await comFilaSegura(() => listarAgendaSemana({ semanas: req.query.semanas }));
    res.json(resultado);
  } catch (erro) {
    console.error('Erro ao listar agenda da semana:', erro);
    res.status(500).json({ erro: 'Falha ao listar agenda da semana', detalhe: erro.message });
  }
});

// Sincroniza a agenda real do Simples Dental -> public.consultas (o espelho
// local). Chamada pelo workflow de resgate (antes do Busca Funil Parado) e
// pelo botão "Sincronizar agora" da página Agenda do painel.
// Corpo opcional: { "semanas": 4 }
app.post('/sincronizar-agenda', async (req, res) => {
  try {
    const resultado = await comFilaSegura(() => sincronizarAgenda(req.body || {}));
    cacheAgenda.clear();
    res.json(resultado);
  } catch (erro) {
    console.error('Erro ao sincronizar agenda:', erro);
    res.status(500).json({ erro: 'Falha ao sincronizar agenda', detalhe: erro.message });
  }
});

// Usada pela página Agenda do painel administrativo (não é ferramenta da
// Lumi) -- ao contrário de /confirmar-agendamento e /cancelar-agendamento
// (que só cobrem 2 dos 6 status possíveis), esta rota aceita qualquer valor
// de STATUS_VALIDOS. Espera receber:
// { "idAgendamento": "310729432", "status": "Em atendimento", "telefone": "11991234567" }
app.post('/alterar-status-agendamento', async (req, res) => {
  try {
    const { idAgendamento: id, status, telefone } = req.body || {};
    const resultado = await comFilaSegura(() => mudarStatusAgendamento({ id, status, telefone }));
    res.json(resultado);
  } catch (erro) {
    console.error('Erro ao alterar status do agendamento:', erro);
    res.status(500).json({ erro: 'Falha ao alterar status do agendamento', detalhe: erro.message });
  }
});

// Usada pela página Agenda do painel administrativo (não é ferramenta da
// Lumi). Muda o rótulo nativo do Simples Dental (nome EXATO de um rótulo
// já existente, ex: "HOF", "Clareamento", "INVISALIGN") de uma consulta
// já existente. Espera receber:
// { "idAgendamento": "310729432", "rotulo": "HOF", "telefone": "11991234567" }
app.post('/alterar-rotulo-agendamento', async (req, res) => {
  try {
    const { idAgendamento: id, rotulo, telefone } = req.body || {};
    const resultado = await comFilaSegura(() => mudarRotuloAgendamento({ id, rotulo, telefone }));
    res.json(resultado);
  } catch (erro) {
    console.error('Erro ao alterar rótulo do agendamento:', erro);
    res.status(500).json({ erro: 'Falha ao alterar rótulo do agendamento', detalhe: erro.message });
  }
});

// Espera receber: { "idAgendamento": "310729432", "telefone": "11991234567" }
// (idAgendamento vem de /buscar-agendamentos-paciente; telefone é opcional,
// só usado para registrar o evento em eventos_agenda. Chamado de
// "idAgendamento" e não "id" de propósito -- evita a IA confundir com o id
// interno da própria chamada de ferramenta no protocolo de tool-calling.)
app.post('/confirmar-agendamento', async (req, res) => {
  try {
    const { idAgendamento: id, telefone } = req.body || {};
    const resultado = await comFilaSegura(() => mudarStatusAgendamento({ id, status: 'Confirmada', telefone }));
    res.json(resultado);
  } catch (erro) {
    console.error('Erro ao confirmar agendamento:', erro);
    res.status(500).json({ erro: 'Falha ao confirmar agendamento', detalhe: erro.message });
  }
});

// Espera receber: { "idAgendamento": "310729432", "motivo": "paciente" | "profissional", "telefone": "11991234567" }
// (motivo e telefone são opcionais -- telefone só é usado para registrar o
// evento em eventos_agenda; padrão de motivo = "paciente". Chamado de
// "idAgendamento" e não "id" de propósito -- ver comentário em
// /confirmar-agendamento.)
app.post('/cancelar-agendamento', async (req, res) => {
  try {
    console.log('[cancelar-agendamento] body recebido:', JSON.stringify(req.body));
    const { idAgendamento: id, motivo, telefone } = req.body || {};

    // Fix 2b: não deixa cancelar "no susto" durante uma remarcação (ver
    // deveBloquearCancelamentoPorRemarcacao). Só se aplica ao cancelamento
    // pedido pelo paciente via Lumi -- cancelamento "profissional" passa direto.
    if (motivo !== 'profissional' && (await deveBloquearCancelamentoPorRemarcacao(telefone))) {
      console.warn('[cancelar-agendamento] BLOQUEADO: remarcação em curso e sem pedido explícito de cancelamento (telefone:', telefone, ')');
      return res.status(409).json({
        erro: 'CANCELAMENTO_BLOQUEADO_REMARCACAO',
        detalhe:
          'O paciente está no meio de uma remarcação e não pediu cancelamento explícito. Para remarcar, use a ferramenta "Remarcar Agendamento" -- ela já cancela e reagenda de uma vez. Se o paciente REALMENTE quer apenas cancelar sem remarcar, confirme isso com ele numa pergunta direta e só então tente de novo.',
      });
    }

    const status = motivo === 'profissional' ? 'Cancelada pelo profissional' : 'Cancelada pelo paciente';
    const resultado = await comFilaSegura(() => mudarStatusAgendamento({ id, status, telefone }));
    res.json(resultado);
  } catch (erro) {
    console.error('Erro ao cancelar agendamento:', erro);
    res.status(500).json({ erro: 'Falha ao cancelar agendamento', detalhe: erro.message });
  }
});

// Espera receber:
// {
//   "idAgendamento": "310729432",
//   "data": "05/08/2026",
//   "hora": "15:00",
//   "duracaoMinutos": 90,
//   "observacao": "Paciente solicitou alteração de horário",
//   "telefone": "11991234567"  (opcional, só usado para registrar o evento em eventos_agenda)
// }
//
// idAgendamento deve vir de /buscar-agendamentos-paciente. Chamado de
// "idAgendamento" e não "id" de propósito -- ver comentário em
// /confirmar-agendamento.
app.post('/remarcar-agendamento', async (req, res) => {
  try {
    const { idAgendamento, ...resto } = req.body || {};
    const resultado = await comFilaSegura(() =>
      remarcarAgendamento({ id: idAgendamento, ...resto })
    );

    res.json(resultado);
  } catch (erro) {
    console.error('Erro ao remarcar agendamento:', erro);

    const conflito = String(
      erro.message || ''
    ).startsWith('CONFLITO_HORARIO');

    res.status(conflito ? 409 : 500).json({
      erro: conflito
        ? 'Horário não está mais disponível'
        : 'Falha ao remarcar agendamento',
      detalhe: erro.message,
    });
  }
});


process.on('SIGTERM', async () => {
  if (browserCompartilhado) await browserCompartilhado.close();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Serviço de automação rodando na porta ${PORT}`);
});
