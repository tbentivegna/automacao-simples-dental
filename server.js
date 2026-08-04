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

// Checagem PRÓPRIA de conflito, direto na grade da agenda -- não depende
// do banner nativo do Simples Dental (que nem sempre aparece de forma
// confiável, como confirmamos num teste real). Procura, entre os
// compromissos já carregados na tela, algum que se sobreponha ao horário
// pedido. Se a semana visível não parecer ser a certa (nenhum evento
// "por perto" da data pedida), tenta avançar algumas vezes antes de
// desistir -- mas nunca trava insistindo demais.
async function existeConflitoReal(page, inicioEsperado, fimEsperado) {
  const UMA_SEMANA_MS = 7 * 24 * 60 * 60 * 1000;

  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const { conflito, algumEventoPorPerto } = await page.evaluate(
      ({ inicioEsperado, fimEsperado, UMA_SEMANA_MS }) => {
        const eventos = Array.from(document.querySelectorAll('a.fc-event'));
        let conflito = false;
        let algumEventoPorPerto = false;
        for (const el of eventos) {
          const inicio = Number(el.getAttribute('data-start')) || 0;
          const fim = Number(el.getAttribute('data-end')) || 0;
          if (Math.abs(inicio - inicioEsperado) < UMA_SEMANA_MS) algumEventoPorPerto = true;
          if (fim > inicio && inicio < fimEsperado && fim > inicioEsperado) conflito = true;
        }
        return { conflito, algumEventoPorPerto };
      },
      { inicioEsperado, fimEsperado, UMA_SEMANA_MS }
    );

    if (conflito) return true;
    if (algumEventoPorPerto) return false; // semana certa, sem conflito

    // Pode ser que a semana visível não seja a certa -- avança e tenta de novo
    await page.click('[data-testid="btnProximoPeriodo"]').catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(500);
  }

  return false;
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
    //   b) uma checagem própria, direto nos compromissos já carregados na
    //      grade da agenda -- essa é a proteção principal agora.
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
    const conflitoReal = await existeConflitoReal(page, inicioEsperado, fimEsperado);

    if (bannerConflito || conflitoReal) {
      throw new Error('CONFLITO_HORARIO: já existe um compromisso nesse horário.');
    }


    // 9. Marca de verdade
    await page.getByRole('button', { name: 'Marcar', exact: true }).click();

    // 10. Confirma sucesso de um jeito confiável: em vez de tentar capturar
    // o toast (que aparece e desaparece rápido demais), esperamos o
    // diálogo fechar e então procuramos, na própria agenda, um compromisso
    // batendo com o horário pedido (e o nome do paciente, se disponível).
    await dialogo.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1000);

    const nomeParaBuscar = (nomePaciente || '').toLowerCase();

    let confirmou = false;
    for (let tentativa = 0; tentativa < 4 && !confirmou; tentativa++) {
      confirmou = await page.evaluate(
        ({ inicioEsperado, nomeParaBuscar }) => {
          const eventos = Array.from(document.querySelectorAll('a.fc-event'));
          return eventos.some((el) => {
            const inicio = Number(el.getAttribute('data-start')) || 0;
            const paciente = (el.querySelector('.fc-event-title')?.textContent || '').toLowerCase();
            const bateHorario = Math.abs(inicio - inicioEsperado) < 60000; // tolerância de 1 min
            const batePaciente = !nomeParaBuscar || paciente.includes(nomeParaBuscar);
            return bateHorario && batePaciente;
          });
        },
        { inicioEsperado, nomeParaBuscar }
      );

      if (!confirmou && tentativa < 3) {
        // O horário pedido pode estar numa semana que não é a que está
        // visível agora -- avança e tenta de novo antes de desistir.
        await page.click('[data-testid="btnProximoPeriodo"]').catch(() => {});
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(500);
      }
    }

    const nomePrint = `agendamento-${Date.now()}.png`;
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, nomePrint), fullPage: true });

    if (!confirmou) {
      throw new Error('Não foi possível confirmar o agendamento na agenda (nenhum compromisso encontrado no horário esperado).');
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
async function mudarStatusAgendamento({ id, status }) {
  if (!id || !status) {
    throw new Error('Campos obrigatórios faltando: id e status são necessários.');
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
    await page.waitForTimeout(800);

    // Confirma que o status realmente mudou antes de considerar sucesso
    const statusAtual = await popover
      .locator('.mat-mdc-select-min-line')
      .innerText()
      .catch(() => null);

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

    return { sucesso: true, id, status, print: nomePrint };
  } catch (erro) {
    await page
      .screenshot({ path: path.join(SCREENSHOTS_DIR, `erro-status-${Date.now()}.png`) })
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

// Espera receber: { "id": "310729432" }  (o id vem de /buscar-agendamentos-paciente)
app.post('/confirmar-agendamento', async (req, res) => {
  try {
    const { id } = req.body || {};
    const resultado = await comFilaSegura(() => mudarStatusAgendamento({ id, status: 'Confirmada' }));
    res.json(resultado);
  } catch (erro) {
    console.error('Erro ao confirmar agendamento:', erro);
    res.status(500).json({ erro: 'Falha ao confirmar agendamento', detalhe: erro.message });
  }
});

// Espera receber: { "id": "310729432", "motivo": "paciente" | "profissional" }
// (motivo é opcional, padrão = "paciente")
app.post('/cancelar-agendamento', async (req, res) => {
  try {
    const { id, motivo } = req.body || {};
    const status = motivo === 'profissional' ? 'Cancelada pelo profissional' : 'Cancelada pelo paciente';
    const resultado = await comFilaSegura(() => mudarStatusAgendamento({ id, status }));
    res.json(resultado);
  } catch (erro) {
    console.error('Erro ao cancelar agendamento:', erro);
    res.status(500).json({ erro: 'Falha ao cancelar agendamento', detalhe: erro.message });
  }
});

process.on('SIGTERM', async () => {
  if (browserCompartilhado) await browserCompartilhado.close();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Serviço de automação rodando na porta ${PORT}`);
});
