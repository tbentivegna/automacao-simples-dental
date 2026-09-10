// Serve o site de comercialização (index.html + assets/) e expõe o
// endpoint de checkout do Asaas. Mantém o padrão do repo
// (server.js/admin-panel/standalone-bridge). PORT vem do Easypanel, nunca
// hardcoded -- achado real 03/09 (standalone-bridge): fixar PORT nas env
// vars derruba o serviço, o Easypanel injeta o próprio PORT.
'use strict';
const path = require('path');
// path explícito de propósito -- achado 08/09: dotenv.config() sem path,
// rodado da raiz do repo, carregava o .env errado.
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const { criarCheckout, habilitado, emTeste } = require('./checkout');

const app = express();
const PORT = process.env.PORT || 3300;

app.use(express.json());

// O front pergunta aqui se o checkout embutido está ligado. Se não
// estiver (sem ASAAS_API_KEY), os botões "Contratar" seguem levando pro
// WhatsApp, como era antes.
app.get('/api/checkout/config', (req, res) => {
  res.json({ habilitado: habilitado(), teste: emTeste() });
});

app.post('/api/checkout', async (req, res) => {
  const { plano, periodo, nome, email, cpfCnpj, telefone, nomeClinica } = req.body || {};
  try {
    const resultado = await criarCheckout({ plano, periodo, nome, email, cpfCnpj, telefone, nomeClinica });
    res.json(resultado);
  } catch (e) {
    const codigo = e.code || (e.asaasStatus ? 'ASAAS' : 'ERRO');
    const status = codigo === 'DESABILITADO' ? 503
      : (codigo === 'PLANO_INVALIDO' || codigo === 'DADOS') ? 400
        : 502;
    console.error('[checkout] falhou:', codigo, '-', e.message, e.asaasErrors || '');
    res.status(status).json({ erro: e.message, codigo });
  }
});

app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
  console.log(`Site Lumi na porta ${PORT} — checkout Asaas: ${habilitado() ? 'ligado' : 'desligado (cai no WhatsApp)'}`);
});
