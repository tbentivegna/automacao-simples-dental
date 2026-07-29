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
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserCompartilhado;
}

// Abre uma aba já logada no Simples Dental, reaproveitando a sessão salva
// sempre que possível (evita logar do zero a cada chamada).
async function abrirPaginaLogada() {
  const browser = await getBrowser();
  const opcoesContexto = fs.existsSync(AUTH_FILE) ? { storageState: AUTH_FILE } : {};
  const context = await browser.newContext(opcoesContexto);
  const page = await context.newPage();

  await page.goto(process.env.SIMPLES_DENTAL_URL);

  // Se a sessão salva ainda for válida, o Simples Dental pula direto pra
  // agenda (ou pra tela de seleção de clínica). Confirmamos checando se
  // ainda estamos na tela de login.
  const aindaNaTelaDeLogin = await page
    .locator('input[type="email"]')
    .first()
    .isVisible()
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
    // Neste primeiro momento, ainda não sabemos o padrão exato de HTML que
    // diferencia um horário livre de um horário ocupado na grade da agenda.
    // Por enquanto, confirmamos que chegamos na agenda e tiramos um print --
    // isso já valida toda a parte difícil (login + seleção de clínica).
    const chegouNaAgenda = page.url().includes('/simples/agenda');

    const nomePrint = `agenda-${Date.now()}.png`;
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, nomePrint), fullPage: true });

    // TODO: depois de confirmar o print, trocar isso pela extração real dos
    // horários livres, algo como:
    // const horarios = await page.locator('TODO_SELETOR_HORARIOS_LIVRES').allTextContents();
    const horarios = [];

    return { chegouNaAgenda, print: nomePrint, horarios };
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
