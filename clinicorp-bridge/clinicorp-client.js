'use strict';

// Cliente fino pra API REST do Clinicorp (fetch nativo, mesmo padrão do
// admin-panel/bridge.js) -- confirmado ao vivo contra a documentação
// Swagger pública em https://sistema.clinicorp.com/api-docs/ (base
// https://api.clinicorp.com/rest/v1), 2026-08-27. NENHUMA chamada real foi
// feita ainda contra uma conta de verdade -- os formatos abaixo vêm só da
// documentação. Ver README.md, seção "Não verificado ainda", antes de usar
// isto em produção.
//
// Autenticação: HTTP Basic (usuário = "ID de acesso ao Sistema", senha =
// "Token API", geradas pela própria clínica em Gerenciar Assinatura ->
// Acesso Externo e Integrações). Cada endpoint TAMBÉM pede subscriber_id +
// code_link como parâmetro separado -- a relação exata entre esses dois e
// as credenciais de Basic Auth não foi confirmada com uma chamada real
// ainda (podem ser redundantes, podem ser coisas genuinamente diferentes).

const BASE_URL = process.env.CLINICORP_API_BASE_URL || 'https://api.clinicorp.com/rest/v1';
const ACCESS_ID = process.env.CLINICORP_ACCESS_ID;
const API_TOKEN = process.env.CLINICORP_API_TOKEN;
const SUBSCRIBER_ID = process.env.CLINICORP_SUBSCRIBER_ID;
const CODE_LINK = process.env.CLINICORP_CODE_LINK;

function faltandoConfig() {
  const faltando = [];
  if (!ACCESS_ID) faltando.push('CLINICORP_ACCESS_ID');
  if (!API_TOKEN) faltando.push('CLINICORP_API_TOKEN');
  if (!SUBSCRIBER_ID) faltando.push('CLINICORP_SUBSCRIBER_ID');
  if (!CODE_LINK) faltando.push('CLINICORP_CODE_LINK');
  return faltando;
}

function cabecalhoAuth() {
  const credencial = Buffer.from(`${ACCESS_ID}:${API_TOKEN}`).toString('base64');
  return { Authorization: `Basic ${credencial}` };
}

// GET com subscriber_id/code_link já injetados nos query params.
async function clinicorpGet(caminho, params = {}) {
  const faltando = faltandoConfig();
  if (faltando.length) {
    throw new Error(`Configuração do Clinicorp incompleta: faltam ${faltando.join(', ')}.`);
  }

  const url = new URL(BASE_URL + caminho);
  url.searchParams.set('subscriber_id', SUBSCRIBER_ID);
  url.searchParams.set('code_link', CODE_LINK);
  for (const [chave, valor] of Object.entries(params)) {
    if (valor !== undefined && valor !== null && valor !== '') {
      url.searchParams.set(chave, valor);
    }
  }

  const resposta = await fetch(url, { headers: { ...cabecalhoAuth(), Accept: 'application/json' } });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new Error(dados.Message || dados.erro || `Clinicorp GET ${caminho} falhou (${resposta.status}).`);
  }
  return dados;
}

// POST com subscriber_id já injetado no corpo (padrão observado nos
// exemplos do Swagger pra confirm_appointment/cancel_appointment).
async function clinicorpPost(caminho, corpo = {}) {
  const faltando = faltandoConfig();
  if (faltando.length) {
    throw new Error(`Configuração do Clinicorp incompleta: faltam ${faltando.join(', ')}.`);
  }

  const resposta = await fetch(BASE_URL + caminho, {
    method: 'POST',
    headers: { ...cabecalhoAuth(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ subscriber_id: SUBSCRIBER_ID, ...corpo }),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new Error(dados.Message || dados.erro || `Clinicorp POST ${caminho} falhou (${resposta.status}).`);
  }
  return dados;
}

// --- Agenda / disponibilidade ---

// NÃO VERIFICADO: se AvailableTimes já exclui horário ocupado, ou é só
// grade fixa de expediente (precisaria cruzar com GET /appointment/list).
function getAvaliableDays({ from, to, includeHolidays = false, showAvailableTimes = true }) {
  return clinicorpGet('/appointment/get_avaliable_days', {
    from,
    to,
    includeHolidays: includeHolidays ? 'X' : undefined,
    showAvailableTimes: showAvailableTimes ? 'X' : undefined,
  });
}

// --- Paciente ---

// GET /patient/get aceita busca por Phone diretamente -- confirmado no
// schema Swagger, mas NUNCA chamado de verdade. Formato exato do telefone
// esperado (com DDD? com máscara?) não confirmado.
function buscarPacientePorTelefone(telefone) {
  return clinicorpGet('/patient/get', { Phone: telefone });
}

function buscarPacientePorId(patientId) {
  return clinicorpGet('/patient/get', { PatientId: patientId });
}

// NÃO VERIFICADO: formato exato aceito (MobilePhone é number no exemplo,
// não string -- confirmar antes de confiar nisso em produção).
function criarPaciente({ nome, dataNascimento, sexo, email, telefone, documento, cpf, notas }) {
  return clinicorpPost('/patient/create', {
    Name: nome,
    BirthDate: dataNascimento || undefined,
    Sex: sexo || undefined,
    Email: email || undefined,
    MobilePhone: telefone,
    DocumentId: documento || undefined,
    OtherDocumentId: cpf || undefined,
    Notes: notas || undefined,
  });
}

function listarAgendamentosPaciente(patientId) {
  return clinicorpGet('/patient/list_appointments', { PatientId: patientId });
}

// --- Agendamento ---

// NÃO VERIFICADO: se aceita criar paciente novo inline (campos tipo
// dataNascimentoPaciente/cpfPaciente do Simples Dental) ou exige
// Patient_PersonId sempre resolvido antes via patient/get+create.
function criarAgendamento({
  patientId,
  nomePaciente,
  telefone,
  email,
  data,
  horaInicio,
  horaFim,
  businessId,
  dentistPersonId,
  scheduleToId,
  procedimentos,
  categoriaId,
  categoriaDescricao,
  categoriaCor,
}) {
  return clinicorpPost('/appointment/create_appointment_by_api', {
    Patient_PersonId: patientId,
    PatientName: nomePaciente,
    MobilePhone: telefone,
    Email: email || undefined,
    fromTime: horaInicio,
    toTime: horaFim,
    date: data,
    Clinic_BusinessId: businessId,
    Dentist_PersonId: dentistPersonId,
    ScheduleToId: scheduleToId,
    ScheduleToType: 'CHAIR',
    Procedures: procedimentos || undefined,
    CategoryId: categoriaId || undefined,
    CategoryDescription: categoriaDescricao || undefined,
    CategoryColor: categoriaCor || undefined,
  });
}

function confirmarAgendamento(id) {
  return clinicorpPost('/appointment/confirm_appointment', { id });
}

function cancelarAgendamento(id) {
  return clinicorpPost('/appointment/cancel_appointment', { id });
}

function buscarAgendamento(id) {
  return clinicorpGet('/appointment/get_appointment', { id });
}

module.exports = {
  getAvaliableDays,
  buscarPacientePorTelefone,
  buscarPacientePorId,
  criarPaciente,
  listarAgendamentosPaciente,
  criarAgendamento,
  confirmarAgendamento,
  cancelarAgendamento,
  buscarAgendamento,
};
