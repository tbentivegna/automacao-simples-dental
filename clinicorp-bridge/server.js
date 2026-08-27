require('dotenv').config();
const express = require('express');
const tempo = require('./tempo');
const db = require('./db');
const clinicorp = require('./clinicorp-client');
const translate = require('./translate');

const app = express();
app.use(express.json());

// Mesmo mecanismo de autenticação do server.js da raiz -- header
// X-Bridge-Key, mesma env var BRIDGE_API_KEY. O n8n e o painel admin não
// precisam saber a diferença entre este serviço e o da raiz.
const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY;
if (!BRIDGE_API_KEY) {
  console.warn('[auth] BRIDGE_API_KEY não configurada -- rotas de automação ficam abertas! Configure antes de produção.');
}
function exigirChaveBridge(req, res, next) {
  if (!BRIDGE_API_KEY) return next();
  if (req.headers['x-bridge-key'] === BRIDGE_API_KEY) return next();
  res.status(401).json({ erro: 'Chave de autenticação inválida ou ausente (X-Bridge-Key).' });
}
app.use((req, res, next) => (req.path === '/health' ? next() : exigirChaveBridge(req, res, next)));

const PORT = process.env.PORT || 3000;
const CLINICORP_BUSINESS_ID = process.env.CLINICORP_BUSINESS_ID;
const CLINICORP_DENTIST_PERSON_ID = process.env.CLINICORP_DENTIST_PERSON_ID;
const CLINICORP_SCHEDULE_TO_ID = process.env.CLINICORP_SCHEDULE_TO_ID;
const DURACAO_CONSULTA_MINUTOS = Number(process.env.DURACAO_CONSULTA_MINUTOS || 60);
const SEMANAS_A_VERIFICAR = Number(process.env.SEMANAS_A_VERIFICAR || 4);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', backend: 'clinicorp' });
});

// POST /verificar-disponibilidade -- mesmo contrato de server.js da raiz.
// NÃO VERIFICADO contra conta real: se get_avaliable_days já exclui
// horário ocupado ou é só grade de expediente (ver translate.js e
// README.md). Testar antes de confiar em produção.
app.post('/verificar-disponibilidade', async (req, res) => {
  try {
    const { diaSemana, periodo, telefone, instancia } = req.body || {};
    const { from, to } = tempo.janelaSemanas(SEMANAS_A_VERIFICAR);
    const diasClinicorp = await clinicorp.getAvaliableDays({ from, to });
    const resultado = translate.traduzirDisponibilidade(diasClinicorp, {
      diaSemanaFiltro: diaSemana || null,
      periodoFiltro: periodo || null,
      semanasVerificadas: SEMANAS_A_VERIFICAR,
    });
    await db.abrirOuAtualizarFunil({ telefone, instancia });
    res.json(resultado);
  } catch (erro) {
    console.error('Erro ao verificar disponibilidade:', erro);
    res.status(500).json({ erro: 'Falha ao verificar disponibilidade', detalhe: erro.message });
  }
});

// POST /buscar-agendamentos-paciente -- mesmo contrato de server.js da raiz.
// NÃO VERIFICADO: formato exato do telefone esperado por patient/get
// (com/sem DDI, com/sem máscara).
app.post('/buscar-agendamentos-paciente', async (req, res) => {
  try {
    const { telefone, semanas } = req.body || {};
    if (!telefone) return res.status(400).json({ erro: 'Campo obrigatório faltando: telefone.' });

    const paciente = await clinicorp.buscarPacientePorTelefone(telefone).catch(() => null);
    if (!paciente || !paciente.PatientId) {
      return res.json({ encontrado: false, agendamentos: [] });
    }

    const lista = await clinicorp.listarAgendamentosPaciente(paciente.PatientId);
    res.json({
      encontrado: true,
      nomePaciente: paciente.Name,
      agendamentos: translate.traduzirListaAgendamentos(lista),
      semanasVerificadas: Number(semanas || SEMANAS_A_VERIFICAR),
    });
  } catch (erro) {
    console.error('Erro ao buscar agendamentos do paciente:', erro);
    res.status(500).json({ erro: 'Falha ao buscar agendamentos do paciente', detalhe: erro.message });
  }
});

// POST /criar-agendamento -- mesmo contrato de server.js da raiz.
// NÃO VERIFICADO: fluxo completo de busca/criação de paciente + criação
// de agendamento nunca foi testado contra uma conta real. Ver README.md.
app.post('/criar-agendamento', async (req, res) => {
  try {
    const { telefone, nomePaciente, data, hora, observacao, categoria, duracaoMinutos } = req.body || {};
    if (!telefone || !nomePaciente || !data || !hora) {
      return res.status(400).json({ erro: 'Campos obrigatórios faltando: telefone, nomePaciente, data e hora são necessários.' });
    }
    if (!CLINICORP_BUSINESS_ID || !CLINICORP_DENTIST_PERSON_ID || !CLINICORP_SCHEDULE_TO_ID) {
      throw new Error('Configuração da clínica incompleta: CLINICORP_BUSINESS_ID/CLINICORP_DENTIST_PERSON_ID/CLINICORP_SCHEDULE_TO_ID.');
    }

    let paciente = await clinicorp.buscarPacientePorTelefone(telefone).catch(() => null);
    let pacienteNovo = false;
    if (!paciente || !paciente.PatientId) {
      paciente = await clinicorp.criarPaciente({ nome: nomePaciente, telefone });
      pacienteNovo = true;
    }

    const duracao = Number(duracaoMinutos || DURACAO_CONSULTA_MINUTOS);
    const [horaIni, minIni] = hora.split(':').map(Number);
    const fimData = new Date(0, 0, 0, horaIni, minIni + duracao);
    const horaFim = `${String(fimData.getHours()).padStart(2, '0')}:${String(fimData.getMinutes()).padStart(2, '0')}`;

    const criado = await clinicorp.criarAgendamento({
      patientId: paciente.PatientId,
      nomePaciente,
      telefone,
      data: tempo.paraDataISO(data),
      horaInicio: hora,
      horaFim,
      businessId: CLINICORP_BUSINESS_ID,
      dentistPersonId: CLINICORP_DENTIST_PERSON_ID,
      scheduleToId: CLINICORP_SCHEDULE_TO_ID,
      procedimentos: observacao,
      categoriaDescricao: categoria,
    });

    const idCriado = Array.isArray(criado) ? criado[0]?.id : criado?.id;
    await db.salvarTelefoneAgendamento({ agendamentoId: idCriado, telefone });
    await db.registrarEventoAgenda({ tipo: 'criado', telefone, categoria, data, hora });
    await db.fecharFunil({ telefone, status: 'concluido' });

    res.json({ sucesso: true, pacienteNovo, data, hora, duracaoMinutos: duracao });
  } catch (erro) {
    console.error('Erro ao criar agendamento:', erro);
    res.status(500).json({ erro: 'Falha ao criar agendamento', detalhe: erro.message });
  }
});

// POST /confirmar-agendamento -- mesmo contrato de server.js da raiz.
app.post('/confirmar-agendamento', async (req, res) => {
  try {
    const { idAgendamento, telefone } = req.body || {};
    if (!idAgendamento) return res.status(400).json({ erro: 'Campo obrigatório faltando: idAgendamento.' });
    await clinicorp.confirmarAgendamento(idAgendamento);
    await db.registrarEventoAgenda({ tipo: 'confirmado', telefone });
    res.json({ sucesso: true, id: idAgendamento, status: 'Confirmada' });
  } catch (erro) {
    console.error('Erro ao confirmar agendamento:', erro);
    res.status(500).json({ erro: 'Falha ao confirmar agendamento', detalhe: erro.message });
  }
});

// POST /cancelar-agendamento -- mesmo contrato de server.js da raiz.
// NÃO VERIFICADO: Clinicorp não expõe campo de "motivo" no schema
// documentado -- a distinção paciente/profissional do Simples Dental fica
// achatada aqui até confirmar se existe algo equivalente.
app.post('/cancelar-agendamento', async (req, res) => {
  try {
    const { idAgendamento, telefone } = req.body || {};
    if (!idAgendamento) return res.status(400).json({ erro: 'Campo obrigatório faltando: idAgendamento.' });
    await clinicorp.cancelarAgendamento(idAgendamento);
    await db.registrarEventoAgenda({ tipo: 'cancelado', telefone });
    res.json({ sucesso: true, id: idAgendamento, status: 'Cancelada' });
  } catch (erro) {
    console.error('Erro ao cancelar agendamento:', erro);
    res.status(500).json({ erro: 'Falha ao cancelar agendamento', detalhe: erro.message });
  }
});

// POST /remarcar-agendamento -- AINDA NÃO IMPLEMENTADO DE PROPÓSITO.
// O Clinicorp não tem endpoint dedicado de remarcação (confirmado
// varrendo a lista completa de endpoints do grupo "appointment") -- a
// única forma encontrada é um composto cancelar + criar de novo, que tem
// um modo de falha que o Simples Dental nunca teve: se criar falhar DEPOIS
// de cancelar ter tido sucesso, o paciente fica sem consulta nenhuma. Isso
// precisa ser desenhado com cuidado (rollback? novo tentativa? aviso pro
// paciente?) e testado contra uma conta real antes de implementar --
// ver plano/README.md. Devolve 501 até essa decisão ser tomada.
app.post('/remarcar-agendamento', async (req, res) => {
  res.status(501).json({
    erro: 'Remarcação ainda não implementada pro backend Clinicorp',
    detalhe: 'Sem endpoint dedicado de remarcação na API do Clinicorp -- precisa de um fluxo cancelar+criar desenhado com cuidado (ver README.md) antes de implementar. Ainda não testado contra conta real.',
  });
});

app.listen(PORT, () => {
  console.log(`clinicorp-bridge rodando na porta ${PORT}`);
});
