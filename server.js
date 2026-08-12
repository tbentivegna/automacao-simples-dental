require('dotenv').config();
const express = require('express');
const { chromium } = require('playwright');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

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

// Garante que as pastas existem antes de usar
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
if (!fs.existsSync(path.dirname(AUTH_FILE))) fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });

let browserCompartilhado = null;

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

// Horários fixos que a Dra. Aline costuma usar em cada dia da semana.
// Para mudar o expediente no futuro, é só editar esta lista.
const MODELO_HORARIOS = {
  segunda: ['08:30', '10:00', '13:30', '15:00'],
  terca: [],
  quarta: ['08:30', '10:00', '13:30', '15:00'],
  quinta: [],
  sexta: ['08:00', '09:30', '11:00'],
  sabado: ['08:00', '09:30', '11:00'], // só nos sábados "abertos" (quinzenal)
  domingo: [],
};

const DURACAO_CONSULTA_MINUTOS = Number(process.env.DURACAO_CONSULTA_MINUTOS || 90);

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
// padrão quinzenal (a cada 14 dias). Se a variável não estiver configurada,
// os sábados ficam fechados por padrão -- mais seguro do que assumir aberto.
function ehSabadoAberto(diaISO) {
  const referencia = process.env.SABADO_DATA_REFERENCIA;
  if (!referencia) return false;

  const msPorDia = 24 * 60 * 60 * 1000;
  const dataRef = new Date(`${referencia}T00:00:00${OFFSET_BRASILIA}`).getTime();
  const dataAtual = new Date(`${diaISO}T00:00:00${OFFSET_BRASILIA}`).getTime();
  const diffDias = Math.round((dataAtual - dataRef) / msPorDia);

  return diffDias % 14 === 0;
}

// Para cada dia dentro do período (a partir de hoje, cobrindo N semanas),
// pega os horários fixos do modelo e verifica, contra os compromissos
// reais, quais estão livres.
function calcularSlotsSemana(compromissos, semanas, diasBloqueados = new Set(), diaSemanaFiltro = null, periodoFiltro = null) {
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

    let horariosDoDia = MODELO_HORARIOS[nomeDia] || [];

    if (nomeDia === 'sabado' && !ehSabadoAberto(diaISO)) {
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

      const fim = inicio + DURACAO_CONSULTA_MINUTOS * 60 * 1000;

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

    const eventosDaSemana = await page.evaluate(() => {
      const eventos = Array.from(document.querySelectorAll('a.fc-event'));
      return eventos.map((el) => ({
        id: el.getAttribute('data-consulta-id'),
        inicio: Number(el.getAttribute('data-start')) || 0,
        fim: Number(el.getAttribute('data-end')) || 0,
        status: el.querySelector('.fc-event-main-frame')?.getAttribute('title') || null,
        paciente: el.querySelector('.fc-event-title')?.textContent.trim() || null,
      }));
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

async function verificarDisponibilidade({ diaSemana, periodo } = {}) {
  const { context, page } = await abrirPaginaLogada();
  const semanas = Number(process.env.SEMANAS_A_VERIFICAR || 4);

  try {
    const compromissos = await coletarCompromissosVariasSemanas(page, semanas);
    const diasBloqueados = obterDiasBloqueados(compromissos);
    const horarios = calcularSlotsSemana(compromissos, semanas, diasBloqueados, diaSemana || null, periodo || null);

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

async function criarAgendamento({ telefone, nomePaciente, data, hora, duracaoMinutos, observacao, categoria }) {
  if (!telefone || !data || !hora) {
    throw new Error('Campos obrigatórios faltando: telefone, data e hora são necessários.');
  }

  const { context, page } = await abrirPaginaLogada();
  const duracao = Number(duracaoMinutos || DURACAO_CONSULTA_MINUTOS);
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

    // 2. Busca o paciente pelo telefone
    const campoPaciente = page.locator('sd-pacientes-autocomplete input[placeholder="Buscar paciente"]');
    await campoPaciente.fill(somenteDigitos(telefone));

    const opcaoPaciente = page.locator('.sd-pacientes-autocomplete__option').first();
    const encontrouPaciente = await aparece(opcaoPaciente, 6000);

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

    // Predicado serializado para dentro do browser -- roda em polling
    // via page.waitForFunction, então é uma espera ATIVA (verifica o DOM
    // repetidamente) em vez de um sleep fixo que pode ser curto demais.
    const eventoBateCondicao = ({ inicioEsperado, nomeParaBuscar }) => {
      const eventos = Array.from(document.querySelectorAll('a.fc-event'));
      return eventos.some((el) => {
        const inicio = Number(el.getAttribute('data-start')) || 0;
        const paciente = (el.querySelector('.fc-event-title')?.textContent || '').toLowerCase();
        const bateHorario = Math.abs(inicio - inicioEsperado) < 60000; // tolerância de 1 min
        const batePaciente = !nomeParaBuscar || paciente.includes(nomeParaBuscar);
        return bateHorario && batePaciente;
      });
    };

    let confirmou = false;

    console.log(
      `[criarAgendamento] tentativa 1: aguardando compromisso aparecer na semana calculada ` +
      `(${semanasParaAvancar} período(s) à frente de hoje, até 12s)...`
    );
    confirmou = await page
      .waitForFunction(eventoBateCondicao, { inicioEsperado, nomeParaBuscar }, { timeout: 12000, polling: 500 })
      .then(() => true)
      .catch(() => false);

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
      confirmou = await page
        .waitForFunction(eventoBateCondicao, { inicioEsperado, nomeParaBuscar }, { timeout: 8000, polling: 500 })
        .then(() => true)
        .catch(() => false);
      if (confirmou) {
        console.log(`[criarAgendamento] tentativa ${margem + 2}: compromisso encontrado.`);
      }
    }

    if (!confirmou) {
      // Só log -- o diálogo já fechou (passo 10), então já sabemos que o
      // agendamento foi criado. Isso ajuda a investigar timing da agenda
      // se algum dia for necessário, sem bloquear a resposta ao paciente.
      console.warn(
        '[criarAgendamento] AVISO: agendamento já confirmado (diálogo fechou), mas a varredura ' +
        'auxiliar da agenda não achou o compromisso -- possível timing de render, não é falha real.'
      );
    }

    const nomePrint = `agendamento-${Date.now()}.png`;
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, nomePrint), fullPage: true }).catch(() => {});

    await registrarEventoAgenda({ tipo: 'criado', telefone, categoria, data, hora });

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
async function buscarAgendamentosPaciente({ telefone, semanas }) {
  if (!telefone) {
    throw new Error('Campo obrigatório faltando: telefone.');
  }

  const { context, page } = await abrirPaginaLogada();
  const totalSemanas = Number(semanas || process.env.SEMANAS_A_VERIFICAR || 4);

  try {
    // 1. Abre o "+" só para usar o campo de busca de paciente
    await page.click('[data-testid="btnNovoEvento"]');
    const campoPaciente = page.locator('sd-pacientes-autocomplete input[placeholder="Buscar paciente"]');
    await campoPaciente.fill(somenteDigitos(telefone));

    const opcaoPaciente = page.locator('.sd-pacientes-autocomplete__option').first();
    const encontrouPaciente = await aparece(opcaoPaciente, 6000);

    let nomePaciente = null;
    if (encontrouPaciente) {
      nomePaciente = await opcaoPaciente
        .locator('.sd-pacientes-autocomplete__nome')
        .innerText()
        .catch(() => null);
    }

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

    await registrarEventoAgenda({
      tipo: status === 'Confirmada' ? 'confirmado' : 'cancelado',
      telefone,
    });

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
    duracaoMinutos || DURACAO_CONSULTA_MINUTOS
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
