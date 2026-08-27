'use strict';

// Helpers de data/fuso -- portados de server.js (raiz), linhas ~233-296,
// pura lógica de calendário sem nenhuma dependência de Simples Dental ou
// Clinicorp. Mantenha este arquivo em sincronia manual com o original se
// a lógica de lá mudar (mesmo aviso que db.js/tempo.js do admin-panel já
// seguem -- cada serviço é seu próprio contexto de build Docker).
//
// NÃO portado aqui: ehSabadoAberto/SABADO_DATA_REFERENCIA (hack específico
// do Simples Dental pro sábado quinzenal -- o Clinicorp devolve dias
// disponíveis de verdade via get_avaliable_days, não deveria precisar
// desse workaround; confirmar quando houver credencial real).

const FUSO = 'America/Sao_Paulo';
const OFFSET_BRASILIA = '-03:00'; // Brasília não tem mais horário de verão

const formatadorDiaISO = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO });
const NOMES_DIA_SEMANA = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

function nomeDiaSemana(diaISO) {
  const diaSemana = new Date(`${diaISO}T12:00:00${OFFSET_BRASILIA}`).getDay();
  return NOMES_DIA_SEMANA[diaSemana];
}

// Segunda-feira da semana que contém a data informada.
function segundaDaSemana(diaISO) {
  const diaSemana = new Date(`${diaISO}T12:00:00${OFFSET_BRASILIA}`).getDay();
  const deslocamentoAteSegunda = diaSemana === 0 ? -6 : 1 - diaSemana;
  const segunda = new Date(`${diaISO}T12:00:00${OFFSET_BRASILIA}`);
  segunda.setDate(segunda.getDate() + deslocamentoAteSegunda);
  return segunda;
}

function semanasEntre(diaISOAlvo, diaISOBase) {
  const msPorSemana = 7 * 24 * 60 * 60 * 1000;
  const diff = segundaDaSemana(diaISOAlvo).getTime() - segundaDaSemana(diaISOBase).getTime();
  return Math.round(diff / msPorSemana);
}

function somenteDigitos(texto) {
  return (texto || '').replace(/\D/g, '');
}

// Converte "DD/MM/AAAA" para "AAAA-MM-DD"
function paraDataISO(dataBR) {
  if (!dataBR || !dataBR.includes('/')) return dataBR; // já deve estar em ISO
  const [dia, mes, ano] = dataBR.split('/');
  return `${ano}-${mes}-${dia}`;
}

// Data de hoje (AAAA-MM-DD) no fuso da clínica -- ponto de partida pra
// calcular o intervalo `from`/`to` de get_avaliable_days.
function hojeISO() {
  return formatadorDiaISO.format(new Date());
}

// `from`/`to` (AAAA-MM-DD) cobrindo N semanas a partir de hoje, mesmo
// critério de janela usado por SEMANAS_A_VERIFICAR no server.js da raiz.
function janelaSemanas(semanas) {
  const hoje = hojeISO();
  const fim = new Date(`${hoje}T12:00:00${OFFSET_BRASILIA}`);
  fim.setDate(fim.getDate() + Number(semanas) * 7);
  return { from: hoje, to: formatadorDiaISO.format(fim) };
}

module.exports = {
  FUSO,
  OFFSET_BRASILIA,
  formatadorDiaISO,
  NOMES_DIA_SEMANA,
  nomeDiaSemana,
  segundaDaSemana,
  semanasEntre,
  somenteDigitos,
  paraDataISO,
  hojeISO,
  janelaSemanas,
};
