'use strict';

const crypto = require('crypto');

const COOKIE_NAME = 'admin_session';
const SESSAO_DURACAO_MS = 12 * 60 * 60 * 1000; // 12 horas

// Sessão em memória, de propósito: é um painel de uma equipe pequena (a
// secretária/Dra. Aline), não precisa de Redis nem tabela de sessão no
// banco. Custo: reiniciar o serviço desloga todo mundo -- aceitável.
const sessoes = new Map(); // token -> expiraEm (timestamp)

function limparSessoesExpiradas() {
  const agora = Date.now();
  for (const [token, expiraEm] of sessoes) {
    if (expiraEm < agora) sessoes.delete(token);
  }
}

function criarSessao() {
  limparSessoesExpiradas();
  const token = crypto.randomBytes(32).toString('hex');
  sessoes.set(token, Date.now() + SESSAO_DURACAO_MS);
  return token;
}

function sessaoValida(token) {
  if (!token) return false;
  const expiraEm = sessoes.get(token);
  if (!expiraEm) return false;
  if (expiraEm < Date.now()) {
    sessoes.delete(token);
    return false;
  }
  return true;
}

function destruirSessao(token) {
  if (token) sessoes.delete(token);
}

// Parser de cookie minimalista -- evita adicionar a dependência
// cookie-parser só pra isso, mesmo espírito de dependências enxutas do
// resto do projeto (server.js usa só dotenv/express/pg/playwright).
function lerCookies(req) {
  const cabecalho = req.headers.cookie;
  if (!cabecalho) return {};
  const cookies = {};
  for (const parte of cabecalho.split(';')) {
    const idx = parte.indexOf('=');
    if (idx === -1) continue;
    const nome = parte.slice(0, idx).trim();
    const valor = parte.slice(idx + 1).trim();
    if (nome) cookies[nome] = decodeURIComponent(valor);
  }
  return cookies;
}

function definirCookieSessao(res, token) {
  const seguro = process.env.PANEL_COOKIE_SECURE !== 'false'; // true por padrão
  const partes = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSAO_DURACAO_MS / 1000)}`,
  ];
  if (seguro) partes.push('Secure');
  res.setHeader('Set-Cookie', partes.join('; '));
}

function limparCookieSessao(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`);
}

// Comparação em tempo constante -- evita vazar, por timing, quantos
// caracteres da senha estão certos.
function senhaConfere(tentativa) {
  const esperada = process.env.ADMIN_PASSWORD || '';
  if (!esperada) return false;
  const bufTentativa = Buffer.from(String(tentativa || ''));
  const bufEsperada = Buffer.from(esperada);
  if (bufTentativa.length !== bufEsperada.length) return false;
  return crypto.timingSafeEqual(bufTentativa, bufEsperada);
}

function exigirAutenticacaoPagina(req, res, next) {
  const { [COOKIE_NAME]: token } = lerCookies(req);
  if (sessaoValida(token)) return next();
  res.redirect('/login');
}

function exigirAutenticacaoApi(req, res, next) {
  const { [COOKIE_NAME]: token } = lerCookies(req);
  if (sessaoValida(token)) return next();
  res.status(401).json({ erro: 'Sessão inválida ou expirada. Faça login novamente.' });
}

module.exports = {
  COOKIE_NAME,
  criarSessao,
  destruirSessao,
  lerCookies,
  definirCookieSessao,
  limparCookieSessao,
  senhaConfere,
  exigirAutenticacaoPagina,
  exigirAutenticacaoApi,
};
