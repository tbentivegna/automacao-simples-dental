require('dotenv').config();
const express = require('express');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const AUTH_FILE = path.join(__dirname, 'auth', 'sessao.json');
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');

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

// User-Agent de um Chrome comum em Windows, para o robô se parecer mais
// com um navegador usado por uma pessoa de verdade.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

// Recebe a lista de compromissos (ocupados) e calcula os "buracos" livres
// entre eles, dentro do horário de atendimento configurado.
// Importante: sempre calcula no fuso de Brasília (UTC-3), independente do
// fuso em que o servidor estiver rodando -- Brasília não tem mais horário
// de verão, então esse deslocamento fixo é seguro.
function calcularHorariosLivres(compromissos) {
  const horaIniStr = process.env.HORA_INICIO_ATENDIMENTO || '08:00';
  const horaFimStr = process.env.HORA_FIM_ATENDIMENTO || '19:00';
  const fuso = 'America/Sao_Paulo';
  const OFFSET_BRASILIA = '-03:00';

  // Agrupa os compromissos por dia (data no formato AAAA-MM-DD, já no
  // fuso de Brasília, usando Intl em vez de setHours/toLocaleDateString
  // para não depender do fuso do processo Node).
  const formatadorDiaISO = new Intl.DateTimeFormat('en-CA', { timeZone: fuso });
  const porDia = {};
  for (const c of compromissos) {
    if (!c.inicio || !c.fim) continue;
    const diaISO = formatadorDiaISO.format(new Date(c.inicio));
    if (!porDia[diaISO]) porDia[diaISO] = [];
    porDia[diaISO].push({ inicio: c.inicio, fim: c.fim });
  }

  const resultado = {};
  for (const [diaISO, intervalos] of Object.entries(porDia)) {
    intervalos.sort((a, b) => a.inicio - b.inicio);

    const inicioExpediente = new Date(`${diaISO}T${horaIniStr}:00${OFFSET_BRASILIA}`).getTime();
    const fimExpediente = new Date(`${diaISO}T${horaFimStr}:00${OFFSET_BRASILIA}`).getTime();

    const livres = [];
    let cursor = inicioExpediente;

    for (const intervalo of intervalos) {
      if (intervalo.inicio > cursor) {
        livres.push({ inicio: cursor, fim: Math.min(intervalo.inicio, fimExpediente) });
      }
      cursor = Math.max(cursor, intervalo.fim);
    }
    if (cursor < fimExpediente) {
      livres.push({ inicio: cursor, fim: fimExpediente });
    }

    const diaBR = new Date(`${diaISO}T00:00:00${OFFSET_BRASILIA}`).toLocaleDateString('pt-BR', { timeZone: fuso });

    resultado[diaBR] = livres
      .filter((l) => l.fim > l.inicio)
      .map((l) => ({
        inicio: new Date(l.inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: fuso }),
        fim: new Date(l.fim).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: fuso }),
      }));
  }

  return resultado;
}

// Abre uma aba já logada no Simples Dental, reaproveitando a sessão salva
// sempre que possível (evita logar do zero a cada chamada).
async function abrirPaginaLogada() {
  const browser = await getBrowser();
  const opcoesContexto = fs.existsSync(AUTH_FILE) ? { storageState: AUTH_FILE } : {};
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
  const aindaNaTelaDeLogin = await page
    .locator('input[type="email"]')
    .first()
    .isVisible({ timeout: 8000 })
    .catch(() => false);

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
  const telaSelecaoClinica = await page
    .getByText('Selecionar clínica')
    .isVisible()
    .catch(() => false);

  if (telaSelecaoClinica) {
    const cartaoClinica = page.locator('div').filter({ hasText: nomeClinica }).last();
    await cartaoClinica.getByRole('button', { name: 'ACESSAR' }).click();
    await page.waitForLoadState('networkidle');
  }

  // Confirma que chegamos de fato na agenda antes de seguir
  await page.waitForURL('**/simples/agenda**', { timeout: 15000 }).catch(() => {});

  // Salva a sessão logada para reaproveitar nas próximas chamadas
  await context.storageState({ path: AUTH_FILE });

  return { context, page };
}

async function verificarDisponibilidade() {
  const { context, page } = await abrirPaginaLogada();

  try {
    // Espera a grade de compromissos carregar antes de tentar ler
    await page.waitForSelector('a.fc-event', { timeout: 15000 }).catch(() => {});

    // Lê todos os compromissos visíveis na semana atual: horário, paciente
    // e status (Agendada, Confirmada, etc. -- lido do atributo "title")
    const compromissos = await page.evaluate(() => {
      const eventos = Array.from(document.querySelectorAll('a.fc-event'));
      return eventos.map((el) => {
        const inicio = Number(el.getAttribute('data-start'));
        const fim = Number(el.getAttribute('data-end'));
        const status = el.querySelector('.fc-event-main-frame')?.getAttribute('title') || null;
        const paciente = el.querySelector('.fc-event-title')?.textContent.trim() || null;
        return { inicio, fim, status, paciente };
      });
    });

    const horarios = calcularHorariosLivres(compromissos);

    const nomePrint = `agenda-${Date.now()}.png`;
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, nomePrint), fullPage: true });

    return { compromissos, horarios, print: nomePrint };
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

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Rota temporária para visualizar os prints salvos durante os testes.
// Recomendo remover ou proteger com senha depois que a automação estiver
// validada, já que a agenda tem dados de pacientes.
app.use('/screenshots', express.static(SCREENSHOTS_DIR));

app.post('/verificar-disponibilidade', async (req, res) => {
  try {
    const resultado = await comFilaSegura(verificarDisponibilidade);
    res.json(resultado);
  } catch (erro) {
    console.error('Erro ao verificar disponibilidade:', erro);
    res.status(500).json({
      erro: 'Falha ao verificar disponibilidade',
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
