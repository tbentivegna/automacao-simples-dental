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
function calcularSlotsSemana(compromissos, semanas, diasBloqueados = new Set()) {
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
    const nomeDia = nomeDiaSemana(diaISO);

    let horariosDoDia = MODELO_HORARIOS[nomeDia] || [];
    if (nomeDia === 'sabado' && !ehSabadoAberto(diaISO)) {
      horariosDoDia = [];
    }
    if (diasBloqueados.has(diaISO)) {
      horariosDoDia = []; // dia todo bloqueado (ex: folga, feriado)
    }

    if (horariosDoDia.length === 0) continue; // dia sem atendimento, não retorna nada

    const diaBR = new Date(`${diaISO}T00:00:00${OFFSET_BRASILIA}`).toLocaleDateString('pt-BR', { timeZone: FUSO });

    resultado[diaBR] = horariosDoDia.map((horario) => {
      const inicio = new Date(`${diaISO}T${horario}:00${OFFSET_BRASILIA}`).getTime();
      const fim = inicio + DURACAO_CONSULTA_MINUTOS * 60 * 1000;

      const conflito = compromissos.find((c) => c.inicio < fim && c.fim > inicio);

      return {
        horario,
        disponivel: !conflito,
        paciente: conflito ? conflito.paciente : undefined,
      };
    });
  }

  return resultado;
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

async function verificarDisponibilidade() {
  const { context, page } = await abrirPaginaLogada();
  const semanas = Number(process.env.SEMANAS_A_VERIFICAR || 4);

  try {
    const compromissos = await coletarCompromissosVariasSemanas(page, semanas);
    const diasBloqueados = obterDiasBloqueados(compromissos);
    const horarios = calcularSlotsSemana(compromissos, semanas, diasBloqueados);
    const compromissosFormatados = formatarCompromissos(compromissos);

    const nomePrint = `agenda-${Date.now()}.png`;
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, nomePrint), fullPage: true });

    return {
      compromissos: compromissosFormatados,
      horarios,
      diasBloqueados: Array.from(diasBloqueados),
      semanasVerificadas: semanas,
      print: nomePrint,
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

// O campo de celular do cadastro de paciente novo espera só o número
// local (sem o "55" do Brasil, que já vem fixo como prefixo separado
// na tela). Essa suposição ainda não foi validada com um teste real --
// se o cadastro falhar por causa do formato, ajustar aqui.
function telefoneLocal(texto) {
  const digitos = somenteDigitos(texto);
  return digitos.length > 11 && digitos.startsWith('55') ? digitos.slice(2) : digitos;
}

async function criarAgendamento({ telefone, nomePaciente, data, hora, duracaoMinutos, observacao }) {
  if (!telefone || !data || !hora) {
    throw new Error('Campos obrigatórios faltando: telefone, data e hora são necessários.');
  }

  const { context, page } = await abrirPaginaLogada();
  const duracao = Number(duracaoMinutos || DURACAO_CONSULTA_MINUTOS);
  const nomeProfissional = process.env.SIMPLES_DENTAL_PROFISSIONAL || 'Aline Ramos Bentivegna';

  try {
    // 1. Abre o formulário de novo evento
    await page.click('[data-testid="btnNovoEvento"]');

    // 2. Busca o paciente pelo telefone
    const campoPaciente = page.locator('sd-pacientes-autocomplete input[placeholder="Buscar paciente"]');
    await campoPaciente.fill(somenteDigitos(telefone));

    const opcaoPaciente = page.locator('.sd-pacientes-autocomplete__option').first();
    const encontrouPaciente = await opcaoPaciente.isVisible({ timeout: 4000 }).catch(() => false);

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
      await page.locator('[data-testid="inputNome"]').fill(nomePaciente);
      await page.locator('[data-testid="inputCelular"]').fill(telefoneLocal(telefone));

      // Contorno extra, caso o banner de cookies ainda esteja de pé
      await dispensarBannerCookies(page);

      await page.locator('[data-testid="btnSalvar"]').click();
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
    const dialogoAbriu = await page
      .getByText('Sugestão de horários')
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    // 5. Seleciona qualquer sugestão de horário, só para destravar os
    // campos de data/hora (vamos sobrescrever com os valores reais logo
    // em seguida). O dia sugerido por padrão pode não ter nenhum horário
    // livre (ex: dia sem expediente ou já totalmente ocupado) -- nesse
    // caso avançamos de dia em dia até aparecer alguma sugestão clicável.
    const sugestao = page.locator('mat-button-toggle-group button.mat-button-toggle-button').first();
    let apareceuSugestao = await sugestao.isVisible({ timeout: 3000 }).catch(() => false);

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
      apareceuSugestao = await sugestao.isVisible({ timeout: 2000 }).catch(() => false);
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

    // 6. Sobrescreve com os valores reais desejados
    await dialogo.locator('[data-testid="inputData"]').fill(data);
    await dialogo.locator('input[formcontrolname="hour"]').fill(hora);
    await dialogo.locator('sd-minutes-autocomplete input[type="number"]').fill(String(duracao));

    // 7. Observação (opcional)
    if (observacao) {
      await dialogo.locator('textarea[formcontrolname="descricao"]').fill(observacao);
    }

    // 8. Rede de segurança: o próprio Simples Dental avisa com um banner
    // amarelo se detectar conflito de horário assim que os campos são
    // preenchidos. Checamos isso ANTES de clicar em Marcar -- se existir,
    // abortamos, para não arriscar duplicar o compromisso.
    const bannerConflito = await page
      .getByText('Há um compromisso no mesmo horário desta consulta.')
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    if (bannerConflito) {
      throw new Error('CONFLITO_HORARIO: o Simples Dental detectou um compromisso já existente nesse horário.');
    }

    // 9. Marca de verdade
    await page.getByRole('button', { name: 'Marcar', exact: true }).click();

    // 10. Confirma sucesso pelo texto do toast
    const confirmou = await page
      .getByText('Consulta agendada com sucesso.')
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    const nomePrint = `agendamento-${Date.now()}.png`;
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, nomePrint), fullPage: true });

    if (!confirmou) {
      throw new Error('Não foi possível confirmar visualmente o sucesso do agendamento (toast não apareceu).');
    }

    return {
      sucesso: true,
      pacienteNovo,
      data,
      hora,
      duracaoMinutos: duracao,
      print: nomePrint,
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

// Espera receber, no corpo da requisição (JSON):
// {
//   "telefone": "11991234567",       (obrigatório)
//   "nomePaciente": "Nome Completo", (obrigatório só se for paciente novo)
//   "data": "03/08/2026",            (obrigatório, formato DD/MM/AAAA --
//                                     igual ao usado nas chaves do
//                                     resultado de /verificar-disponibilidade)
//   "hora": "08:30",                 (obrigatório, formato HH:mm)
//   "duracaoMinutos": 90,            (opcional)
//   "observacao": "texto livre"      (opcional)
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

process.on('SIGTERM', async () => {
  if (browserCompartilhado) await browserCompartilhado.close();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Serviço de automação rodando na porta ${PORT}`);
});
