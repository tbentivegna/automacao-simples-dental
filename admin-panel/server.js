'use strict';

require('dotenv').config();
const express = require('express');
const path = require('path');
const {
  criarSessao,
  destruirSessao,
  lerCookies,
  definirCookieSessao,
  limparCookieSessao,
  senhaConfere,
  exigirAutenticacaoPagina,
  exigirAutenticacaoApi,
  COOKIE_NAME,
} = require('./auth');
const {
  buscarAnalytics,
  buscarDetalheAgendamentos,
  buscarDetalheNovosPacientes,
  buscarDetalheMensagens,
  buscarMensagensPaciente,
  buscarSuspensos,
  buscarPendencias,
  resolverPendencia,
  buscarOportunidades,
  buscarPacientes,
  buscarStatusGlobal,
  pausarGlobal,
  retomarGlobal,
  retomarPaciente,
  pausarPaciente,
  definirConsentimentoPaciente,
} = require('./queries');

if (!process.env.ADMIN_PASSWORD) {
  throw new Error('ADMIN_PASSWORD não configurada -- veja .env.example.');
}

const app = express();
const PORT = process.env.PORT || 3100;

app.use(express.json());
// CSS/JS/imagens ficam liberados sem login -- não têm dado nenhum de
// paciente, só estrutura. Quem protege os dados de verdade é a API abaixo.
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));

// ============================================================
// Login
// ============================================================
app.get('/login', (req, res) => {
  const { [COOKIE_NAME]: token } = lerCookies(req);
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { senha } = req.body || {};
  if (!senhaConfere(senha)) {
    return res.status(401).json({ erro: 'Senha incorreta.' });
  }
  const token = criarSessao();
  definirCookieSessao(res, token);
  res.json({ ok: true });
});

app.post('/logout', (req, res) => {
  const { [COOKIE_NAME]: token } = lerCookies(req);
  destruirSessao(token);
  limparCookieSessao(res);
  res.json({ ok: true });
});

// ============================================================
// Página principal (protegida)
// ============================================================
app.get('/', exigirAutenticacaoPagina, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ============================================================
// API (protegida) -- tudo leitura, exceto resolver pendência
// ============================================================
app.get('/api/analytics', exigirAutenticacaoApi, async (req, res) => {
  try {
    const dados = await buscarAnalytics(req.query.janela);
    res.json(dados);
  } catch (erro) {
    console.error('Erro em /api/analytics:', erro);
    res.status(500).json({ erro: 'Falha ao buscar analytics.', detalhe: erro.message });
  }
});

// Drill-down dos cards da Visão Geral -- mesmo dado que já alimenta os
// números, só que em lista em vez de contagem.
app.get('/api/analytics/agendamentos', exigirAutenticacaoApi, async (req, res) => {
  try {
    res.json(await buscarDetalheAgendamentos(req.query.tipo, req.query.janela));
  } catch (erro) {
    console.error('Erro em /api/analytics/agendamentos:', erro);
    res.status(500).json({ erro: 'Falha ao buscar detalhe de agendamentos.', detalhe: erro.message });
  }
});

app.get('/api/analytics/novos-pacientes', exigirAutenticacaoApi, async (req, res) => {
  try {
    res.json(await buscarDetalheNovosPacientes(req.query.janela));
  } catch (erro) {
    console.error('Erro em /api/analytics/novos-pacientes:', erro);
    res.status(500).json({ erro: 'Falha ao buscar novos pacientes.', detalhe: erro.message });
  }
});

app.get('/api/analytics/mensagens', exigirAutenticacaoApi, async (req, res) => {
  try {
    res.json(await buscarDetalheMensagens(req.query.janela));
  } catch (erro) {
    console.error('Erro em /api/analytics/mensagens:', erro);
    res.status(500).json({ erro: 'Falha ao buscar mensagens por paciente.', detalhe: erro.message });
  }
});

app.get('/api/mensagens', exigirAutenticacaoApi, async (req, res) => {
  try {
    const telefone = (req.query.telefone || '').trim();
    if (!telefone) {
      return res.status(400).json({ erro: 'telefone é obrigatório.' });
    }
    res.json(await buscarMensagensPaciente(telefone, parseInt(req.query.limite, 10) || 20));
  } catch (erro) {
    console.error('Erro em /api/mensagens:', erro);
    res.status(500).json({ erro: 'Falha ao buscar mensagens do paciente.', detalhe: erro.message });
  }
});

app.get('/api/suspensos', exigirAutenticacaoApi, async (req, res) => {
  try {
    res.json(await buscarSuspensos());
  } catch (erro) {
    console.error('Erro em /api/suspensos:', erro);
    res.status(500).json({ erro: 'Falha ao buscar atendimentos suspensos.', detalhe: erro.message });
  }
});

app.post('/api/suspensos/:id/retomar', exigirAutenticacaoApi, async (req, res) => {
  try {
    const encontrou = await retomarPaciente(req.params.id);
    if (!encontrou) {
      return res.status(404).json({ erro: 'Paciente não encontrado ou a Lumi já estava ativa pra ele.' });
    }
    res.json({ ok: true });
  } catch (erro) {
    console.error('Erro em POST /api/suspensos/:id/retomar:', erro);
    res.status(500).json({ erro: 'Falha ao devolver o paciente para a Lumi.', detalhe: erro.message });
  }
});

// ============================================================
// Controle global (equivalente a ##pausar / ##retomar no WhatsApp)
// ============================================================
app.get('/api/status-global', exigirAutenticacaoApi, async (req, res) => {
  try {
    res.json(await buscarStatusGlobal());
  } catch (erro) {
    console.error('Erro em /api/status-global:', erro);
    res.status(500).json({ erro: 'Falha ao buscar status global.', detalhe: erro.message });
  }
});

app.post('/api/status-global/pausar', exigirAutenticacaoApi, async (req, res) => {
  try {
    await pausarGlobal('painel administrativo');
    res.json({ ok: true });
  } catch (erro) {
    console.error('Erro em POST /api/status-global/pausar:', erro);
    res.status(500).json({ erro: 'Falha ao pausar a Lumi.', detalhe: erro.message });
  }
});

app.post('/api/status-global/retomar', exigirAutenticacaoApi, async (req, res) => {
  try {
    await retomarGlobal('painel administrativo');
    res.json({ ok: true });
  } catch (erro) {
    console.error('Erro em POST /api/status-global/retomar:', erro);
    res.status(500).json({ erro: 'Falha ao retomar a Lumi.', detalhe: erro.message });
  }
});

app.get('/api/pendencias', exigirAutenticacaoApi, async (req, res) => {
  try {
    res.json(await buscarPendencias());
  } catch (erro) {
    console.error('Erro em /api/pendencias:', erro);
    res.status(500).json({ erro: 'Falha ao buscar pendências.', detalhe: erro.message });
  }
});

app.get('/api/oportunidades', exigirAutenticacaoApi, async (req, res) => {
  try {
    res.json(await buscarOportunidades());
  } catch (erro) {
    console.error('Erro em /api/oportunidades:', erro);
    res.status(500).json({ erro: 'Falha ao buscar oportunidades.', detalhe: erro.message });
  }
});

app.post('/api/pendencias/:id/resolver', exigirAutenticacaoApi, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ erro: 'id inválido.' });
    }
    const { resolvidoPor } = req.body || {};
    const encontrou = await resolverPendencia(id, resolvidoPor);
    if (!encontrou) {
      return res.status(404).json({ erro: 'Pendência não encontrada ou já estava resolvida.' });
    }
    res.json({ ok: true });
  } catch (erro) {
    console.error('Erro em POST /api/pendencias/:id/resolver:', erro);
    res.status(500).json({ erro: 'Falha ao marcar pendência como resolvida.', detalhe: erro.message });
  }
});

app.get('/api/pacientes', exigirAutenticacaoApi, async (req, res) => {
  try {
    const pagina = parseInt(req.query.pagina, 10) || 1;
    res.json(await buscarPacientes(req.query.busca, pagina));
  } catch (erro) {
    console.error('Erro em /api/pacientes:', erro);
    res.status(500).json({ erro: 'Falha ao buscar pacientes.', detalhe: erro.message });
  }
});

app.post('/api/pacientes/:id/pausar', exigirAutenticacaoApi, async (req, res) => {
  try {
    const encontrou = await pausarPaciente(req.params.id);
    if (!encontrou) {
      return res.status(404).json({ erro: 'Paciente não encontrado ou a Lumi já estava pausada pra ele.' });
    }
    res.json({ ok: true });
  } catch (erro) {
    console.error('Erro em POST /api/pacientes/:id/pausar:', erro);
    res.status(500).json({ erro: 'Falha ao pausar a Lumi pro paciente.', detalhe: erro.message });
  }
});

app.post('/api/pacientes/:id/retomar', exigirAutenticacaoApi, async (req, res) => {
  try {
    const encontrou = await retomarPaciente(req.params.id);
    if (!encontrou) {
      return res.status(404).json({ erro: 'Paciente não encontrado ou a Lumi já estava ativa pra ele.' });
    }
    res.json({ ok: true });
  } catch (erro) {
    console.error('Erro em POST /api/pacientes/:id/retomar:', erro);
    res.status(500).json({ erro: 'Falha ao devolver o paciente para a Lumi.', detalhe: erro.message });
  }
});

app.post('/api/pacientes/:id/consentimento', exigirAutenticacaoApi, async (req, res) => {
  try {
    const { consentimento } = req.body || {};
    if (typeof consentimento !== 'boolean') {
      return res.status(400).json({ erro: 'consentimento precisa ser true ou false.' });
    }
    const encontrou = await definirConsentimentoPaciente(req.params.id, consentimento);
    if (!encontrou) {
      return res.status(404).json({ erro: 'Paciente não encontrado.' });
    }
    res.json({ ok: true });
  } catch (erro) {
    console.error('Erro em POST /api/pacientes/:id/consentimento:', erro);
    res.status(500).json({ erro: 'Falha ao atualizar consentimento do paciente.', detalhe: erro.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Painel administrativo rodando na porta ${PORT}`);
});
