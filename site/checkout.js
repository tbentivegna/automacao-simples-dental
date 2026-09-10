'use strict';
// Integração de checkout com o Asaas.
//
// Regras de segurança que este módulo respeita:
//  - A chave da API (ASAAS_API_KEY) é SÓ do servidor, nunca vai pro browser.
//  - Nenhum dado de cartão passa por aqui. A gente cria o cliente + a
//    cobrança e devolve a URL da fatura HOSPEDADA do Asaas -- é lá, no
//    ambiente PCI deles, que o cartão é digitado.
//  - O valor cobrado vem SEMPRE desta tabela, nunca do que o browser mandou.

const ASAAS_BASE = process.env.ASAAS_BASE_URL || 'https://sandbox.asaas.com/api/v3';
const ASAAS_KEY = process.env.ASAAS_API_KEY || '';

// Fonte da verdade dos preços. Mensal = assinatura recorrente no cartão
// (cancela quando quiser). Anual = cobrança única parcelada em 12x no
// cartão, sem juros pro cliente (o Asaas não adiciona juros ao pagador
// nesse formato -- a taxa de parcelamento fica com o recebedor).
const PLANOS = {
  'Basic:mensal': { tipo: 'assinatura', valor: 400, rotulo: 'Lumi — plano Basic (mensal)' },
  'Pro:mensal': { tipo: 'assinatura', valor: 700, rotulo: 'Lumi — plano Pro (mensal)' },
  'Basic:anual': { tipo: 'parcelado', total: 3840, parcelas: 12, rotulo: 'Lumi — plano Basic (anual, 12x sem juros)' },
  'Pro:anual': { tipo: 'parcelado', total: 6720, parcelas: 12, rotulo: 'Lumi — plano Pro (anual, 12x sem juros)' },
};

function habilitado() {
  return Boolean(ASAAS_KEY);
}

async function asaas(method, endpoint, body) {
  const res = await fetch(ASAAS_BASE + endpoint, {
    method,
    headers: {
      'access_token': ASAAS_KEY,
      'Content-Type': 'application/json',
      'User-Agent': 'lumi-site-checkout',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const texto = await res.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* resposta não-JSON */ }
  if (!res.ok) {
    const msg = json && json.errors && json.errors[0] && json.errors[0].description;
    const err = new Error(msg || `Asaas respondeu ${res.status}`);
    err.asaasStatus = res.status;
    err.asaasErrors = (json && json.errors) || null;
    throw err;
  }
  return json;
}

function amanha() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function erro(codigo, mensagem) {
  const e = new Error(mensagem);
  e.code = codigo;
  return e;
}

async function acharOuCriarCliente({ nome, email, cpfCnpj, telefone, nomeClinica }) {
  const digitos = String(cpfCnpj || '').replace(/\D/g, '');
  const busca = await asaas('GET', `/customers?cpfCnpj=${digitos}&limit=1`);
  if (busca && Array.isArray(busca.data) && busca.data.length) return busca.data[0];
  return asaas('POST', '/customers', {
    name: nomeClinica ? `${nomeClinica} — ${nome}` : nome,
    email,
    cpfCnpj: digitos,
    mobilePhone: String(telefone || '').replace(/\D/g, '') || undefined,
    notificationDisabled: false,
  });
}

// Cria a cobrança certa pro plano/período e devolve { url } da fatura Asaas.
async function criarCheckout({ plano, periodo, nome, email, cpfCnpj, telefone, nomeClinica }) {
  if (!habilitado()) throw erro('DESABILITADO', 'Checkout indisponível no momento.');

  const cfg = PLANOS[`${plano}:${periodo}`];
  if (!cfg) throw erro('PLANO_INVALIDO', 'Plano ou período inválido.');

  const faltando = ['nome', 'email', 'cpfCnpj'].filter((k) => !String({ nome, email, cpfCnpj }[k] || '').trim());
  if (faltando.length) throw erro('DADOS', `Preencha: ${faltando.join(', ')}.`);
  if (!/^\S+@\S+\.\S+$/.test(email)) throw erro('DADOS', 'E-mail inválido.');
  const docDigitos = String(cpfCnpj).replace(/\D/g, '');
  if (docDigitos.length !== 11 && docDigitos.length !== 14) throw erro('DADOS', 'CPF ou CNPJ inválido.');

  const cliente = await acharOuCriarCliente({ nome, email, cpfCnpj, telefone, nomeClinica });

  if (cfg.tipo === 'assinatura') {
    const sub = await asaas('POST', '/subscriptions', {
      customer: cliente.id,
      billingType: 'CREDIT_CARD',
      value: cfg.valor,
      nextDueDate: amanha(),
      cycle: 'MONTHLY',
      description: cfg.rotulo,
      externalReference: `site:${plano}:${periodo}`,
    });
    const pagamentos = await asaas('GET', `/subscriptions/${sub.id}/payments`);
    const primeira = pagamentos && Array.isArray(pagamentos.data) && pagamentos.data[0];
    if (!primeira || !primeira.invoiceUrl) throw erro('ASAAS', 'Assinatura criada mas sem link de fatura.');
    return { url: primeira.invoiceUrl, tipo: 'assinatura' };
  }

  const pgto = await asaas('POST', '/payments', {
    customer: cliente.id,
    billingType: 'CREDIT_CARD',
    totalValue: cfg.total,
    installmentCount: cfg.parcelas,
    dueDate: amanha(),
    description: cfg.rotulo,
    externalReference: `site:${plano}:${periodo}`,
  });
  if (!pgto || !pgto.invoiceUrl) throw erro('ASAAS', 'Cobrança criada mas sem link de fatura.');
  return { url: pgto.invoiceUrl, tipo: 'parcelado' };
}

module.exports = { criarCheckout, habilitado, PLANOS };
