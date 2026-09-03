'use strict';

// Mesmo contrato HTTP (mesmas 6 rotas + /health) que server.js (raiz,
// Simples Dental) e clinicorp-bridge/ (Clinicorp) já expõem -- o workflow
// n8n e o painel admin funcionam sem nenhuma mudança, só apontando
// BRIDGE_URL pra este serviço. Diferença real: aqui não existe sistema
// externo nenhum -- public.consultas É a agenda, não um espelho dela.

require('dotenv').config();
const express = require('express');

const { deveBloquearCancelamentoPorRemarcacao, abrirOuAtualizarFunil } = require('./db');
const { jidDeLocal } = require('./tempo');
const {
  verificarDisponibilidade,
  criarAgendamento,
  buscarAgendamentosPaciente,
  mudarStatusAgendamento,
  remarcarAgendamento,
} = require('./consultas');

const app = express();
app.use(express.json());

// Mesma trava de autenticação do server.js/raiz e clinicorp-bridge --
// header X-Bridge-Key obrigatório em toda rota exceto /health.
const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY;
if (!BRIDGE_API_KEY) {
  console.warn('[auth] BRIDGE_API_KEY não configurada -- rotas de automação ficam abertas! Configure antes de produção.');
}
function exigirChaveBridge(req, res, next) {
  if (!BRIDGE_API_KEY) return next(); // sem chave configurada (dev local) não trava
  if (req.headers['x-bridge-key'] === BRIDGE_API_KEY) return next();
  res.status(401).json({ erro: 'Chave de autenticação inválida ou ausente (X-Bridge-Key).' });
}
app.use((req, res, next) => (req.path === '/health' ? next() : exigirChaveBridge(req, res, next)));

const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/verificar-disponibilidade', async (req, res) => {
  try {
    const resultado = await verificarDisponibilidade(req.body || {});
    // Mesmo padrão do server.js/raiz: a rota (não a função de negócio)
    // também cuida do funil de resgate, quando telefone/instancia vêm.
    if (req.body?.telefone) {
      await abrirOuAtualizarFunil({ telefone: jidDeLocal(req.body.telefone), instancia: req.body.instancia });
    }
    res.json(resultado);
  } catch (erro) {
    console.error('Erro ao verificar disponibilidade:', erro);
    res.status(500).json({ erro: 'Falha ao verificar disponibilidade', detalhe: erro.message });
  }
});

app.post('/criar-agendamento', async (req, res) => {
  try {
    const resultado = await criarAgendamento(req.body || {});
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

app.post('/buscar-agendamentos-paciente', async (req, res) => {
  try {
    const resultado = await buscarAgendamentosPaciente(req.body || {});
    res.json(resultado);
  } catch (erro) {
    console.error('Erro ao buscar agendamentos do paciente:', erro);
    res.status(500).json({ erro: 'Falha ao buscar agendamentos do paciente', detalhe: erro.message });
  }
});

app.post('/confirmar-agendamento', async (req, res) => {
  try {
    const { idAgendamento: id, telefone } = req.body || {};
    const resultado = await mudarStatusAgendamento({ id, status: 'Confirmada', telefone });
    res.json(resultado);
  } catch (erro) {
    console.error('Erro ao confirmar agendamento:', erro);
    res.status(500).json({ erro: 'Falha ao confirmar agendamento', detalhe: erro.message });
  }
});

// Mesma trava do server.js/raiz (fix 2b, generalizado 02/09): não deixa
// cancelar "no susto" no meio de uma remarcação, a menos que o
// cancelamento tenha sido pedido explicitamente. Motivo "profissional"
// passa direto (é a clínica cancelando, não a Lumi interpretando o
// paciente errado).
app.post('/cancelar-agendamento', async (req, res) => {
  try {
    const { idAgendamento: id, motivo, telefone } = req.body || {};

    if (motivo !== 'profissional' && (await deveBloquearCancelamentoPorRemarcacao(telefone))) {
      console.warn('[cancelar-agendamento] BLOQUEADO: remarcação em curso e sem pedido explícito de cancelamento (telefone:', telefone, ')');
      return res.status(409).json({
        erro: 'CANCELAMENTO_BLOQUEADO_REMARCACAO',
        detalhe:
          'O paciente está no meio de uma remarcação e não pediu cancelamento explícito. Para remarcar, use a ferramenta "Remarcar Agendamento" -- ela já cancela e reagenda de uma vez. Se o paciente REALMENTE quer apenas cancelar sem remarcar, confirme isso com ele numa pergunta direta e só então tente de novo.',
      });
    }

    const status = motivo === 'profissional' ? 'Cancelada pelo profissional' : 'Cancelada pelo paciente';
    const resultado = await mudarStatusAgendamento({ id, status, telefone });
    res.json(resultado);
  } catch (erro) {
    console.error('Erro ao cancelar agendamento:', erro);
    res.status(500).json({ erro: 'Falha ao cancelar agendamento', detalhe: erro.message });
  }
});

app.post('/remarcar-agendamento', async (req, res) => {
  try {
    const { idAgendamento, ...resto } = req.body || {};
    const resultado = await remarcarAgendamento({ id: idAgendamento, ...resto });
    res.json(resultado);
  } catch (erro) {
    console.error('Erro ao remarcar agendamento:', erro);
    const conflito = String(erro.message || '').startsWith('CONFLITO_HORARIO');
    res.status(conflito ? 409 : 500).json({
      erro: conflito ? 'Horário não está mais disponível' : 'Falha ao remarcar agendamento',
      detalhe: erro.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`standalone-bridge rodando na porta ${PORT}`);
});
