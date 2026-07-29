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

  // TODO: trocar pelo seletor de algo que só aparece DEPOIS do login
  // (ex: o menu lateral da agenda, o nome do usuário no topo, etc.)
  const jaLogado = await page
    .locator('TODO_SELETOR_TELA_INTERNA')
    .first()
    .isVisible()
    .catch(() => false);

  if (!jaLogado) {
    // TODO: ajustar os três seletores abaixo conforme a tela real de login
    await page.fill('TODO_SELETOR_CAMPO_USUARIO', process.env.SIMPLES_DENTAL_USER);
    await page.fill('TODO_SELETOR_CAMPO_SENHA', process.env.SIMPLES_DENTAL_PASS);
    await page.click('TODO_SELETOR_BOTAO_ENTRAR');
    await page.waitForLoadState('networkidle');

    // Salva a sessão logada para reaproveitar nas próximas chamadas
    await context.storageState({ path: AUTH_FILE });
  }

  return { context, page };
}

async function verificarDisponibilidade() {
  const { context, page } = await abrirPaginaLogada();

  try {
    // TODO: navegar até a tela de agenda e extrair os horários livres.
    // Exemplo de como deve ficar (ajustar os seletores reais depois):
    //
    // await page.click('TODO_SELETOR_MENU_AGENDA');
    // const horarios = await page.locator('TODO_SELETOR_HORARIOS_LIVRES').allTextContents();

    const horarios = []; // placeholder até definirmos os seletores reais

    return { horarios };
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
