'use strict';

// Servidor local só pra demo de vendas (etapa 3 do funil, ver
// Roteiro_Demo_Vendas.md) -- uma interface de chat com visual de WhatsApp
// por cima da MESMA lógica do harness (run.js/criarSessao), pra rodar a
// demo com um visual apresentável em vez do terminal. Nenhuma ação real é
// executada (mesmas tools mockadas do harness) e nada disto toca produção.
//
// Uso: node lumi-harness/demo-server.js
// Abre em http://localhost:3200

const path = require('path');
const express = require('express');
const { criarSessao } = require('./run');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'demo-public')));

const PORT = process.env.DEMO_PORT || 3200;

// Uma sessão por processo -- suficiente pra "uma demo de cada vez" (o caso
// de uso real). "Reiniciar" cria uma sessão nova do zero, sem precisar
// derrubar o servidor entre uma demo e outra.
let sessao = criarSessao({});

app.post('/api/mensagem', async (req, res) => {
  const texto = (req.body?.texto || '').trim();
  if (!texto) return res.status(400).json({ erro: 'Mensagem vazia.' });
  try {
    const resultado = await sessao.enviarMensagemPaciente(texto);
    res.json(resultado);
  } catch (erro) {
    console.error('[demo] erro ao processar mensagem:', erro.message);
    res.status(500).json({ erro: erro.message });
  }
});

app.post('/api/reiniciar', (req, res) => {
  sessao = criarSessao({});
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Demo da Lumi rodando em http://localhost:${PORT}`);
});
