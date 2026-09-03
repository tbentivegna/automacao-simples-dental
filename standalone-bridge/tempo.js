'use strict';

// Helpers de data/fuso/expediente -- copiados de server.js (raiz) linhas
// 298-527 e 883-911, praticamente sem alteração (são funções puras, sem
// dependência de Playwright). Mesmo padrão de duplicação já usado em
// clinicorp-bridge/tempo.js -- cada serviço é seu próprio contexto de
// build Docker, não alcança pasta irmã. Qualquer mudança na lógica de
// horários/duração feita no gêmeo da raiz precisa ser replicada aqui à
// mão -- não tem import automático.

const FUSO = 'America/Sao_Paulo';
const OFFSET_BRASILIA = '-03:00'; // Brasília não tem mais horário de verão

const formatadorDiaISO = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO });
const NOMES_DIA_SEMANA = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

function somenteDigitos(texto) {
  return (texto || '').replace(/\D/g, '');
}

// "11999998888" (ou com o 55) -> "5511999998888@s.whatsapp.net"
function jidDeLocal(valor) {
  const dig = somenteDigitos(valor);
  if (!dig) return null;
  return (dig.startsWith('55') ? dig : `55${dig}`) + '@s.whatsapp.net';
}

// Inverso de jidDeLocal -- tira o "55" e o "@s.whatsapp.net", fica só o
// número local (o formato que o cadastro/telefone bruto usa).
function telefoneLocal(texto) {
  const digitos = somenteDigitos(texto);
  return digitos.length > 11 && digitos.startsWith('55') ? digitos.slice(2) : digitos;
}

// Converte "DD/MM/AAAA" para "AAAA-MM-DD"
function paraDataISO(dataBR) {
  const [dia, mes, ano] = dataBR.split('/');
  return `${ano}-${mes}-${dia}`;
}

function nomeDiaSemana(diaISO) {
  const diaSemana = new Date(`${diaISO}T12:00:00${OFFSET_BRASILIA}`).getDay();
  return NOMES_DIA_SEMANA[diaSemana];
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

// Para cada dia dentro do período (a partir de amanhã, cobrindo N
// semanas), pega os horários fixos do modelo e verifica, contra os
// compromissos reais (array de {inicio, fim} em epoch ms -- em
// server.js/raiz vem de raspagem do Simples Dental; aqui vem de um SELECT
// em public.consultas), quais estão livres.
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

    // Não oferece hoje nem dias já passados -- a busca efetivamente
    // começa a partir de amanhã.
    if (diaISO <= hojeISO) continue;

    const nomeDia = nomeDiaSemana(diaISO);

    if (diaSemanaFiltro && nomeDia !== diaSemanaFiltro) continue;

    let horariosDoDia = modeloHorarios[nomeDia] || [];

    if (nomeDia === 'sabado' && !ehSabadoAberto(diaISO, sabadoDataReferencia)) {
      horariosDoDia = [];
    }

    if (diasBloqueados.has(diaISO)) {
      horariosDoDia = [];
    }

    if (horariosDoDia.length === 0) continue;

    const diaBR = new Date(`${diaISO}T00:00:00${OFFSET_BRASILIA}`).toLocaleDateString('pt-BR', {
      timeZone: FUSO,
    });

    let horariosLivres = horariosDoDia.filter((horario) => {
      const inicio = new Date(`${diaISO}T${horario}:00${OFFSET_BRASILIA}`).getTime();
      const fim = inicio + duracaoConsultaMinutos * 60 * 1000;

      const conflito = compromissos.find((c) => c.inicio < fim && c.fim > inicio);

      return !conflito;
    });

    if (periodoFiltro === 'manha') horariosLivres = horariosLivres.filter((h) => h < '12:00');
    if (periodoFiltro === 'tarde') horariosLivres = horariosLivres.filter((h) => h >= '12:00');

    if (horariosLivres.length === 0) continue;

    // IMPORTANTE: esta resposta alimenta o contexto de um agente de IA
    // (Lumi, no WhatsApp) -- nunca incluir dado de identificação de
    // paciente aqui, só o necessário pra calcular disponibilidade.
    resultado[diaBR] = { diaSemana: nomeDia, horariosDisponiveis: horariosLivres };
  }

  return resultado;
}

// Agrupa o resultado de calcularSlotsSemana por dia da semana + período
// (manhã/tarde), já filtrado e ordenado da data mais próxima pra mais
// distante -- mesma lógica de server.js/raiz.
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

module.exports = {
  FUSO,
  OFFSET_BRASILIA,
  formatadorDiaISO,
  somenteDigitos,
  jidDeLocal,
  telefoneLocal,
  paraDataISO,
  nomeDiaSemana,
  ehSabadoAberto,
  calcularSlotsSemana,
  agruparPorDiaSemana,
};
