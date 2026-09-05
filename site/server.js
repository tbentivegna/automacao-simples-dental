// Serve o site de comercialização (estático -- só index.html + assets/)
// como um serviço Easypanel próprio, mesmo padrão do resto do repo
// (server.js/admin-panel/standalone-bridge). PORT vem do Easypanel, nunca
// hardcoded -- achado real 03/09 (standalone-bridge): fixar PORT=3000 nas
// env vars derruba o serviço, o Easypanel injeta o próprio PORT.
'use strict';
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3300;

app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
  console.log(`Site Lumi rodando na porta ${PORT}`);
});
