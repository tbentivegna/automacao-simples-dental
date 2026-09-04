'use strict';

// Cliente fino pra Evolution API -- espelha exatamente a chamada que o node
// "Envia Bloco" do n8n já faz (mesmo endpoint/instância/formato de corpo),
// confirmado lendo o workflow "Lumi" (prod) ao vivo via API do n8n antes de
// escrever isto. Só EVOLUTION_INSTANCE_ALINE é produção -- a instância do
// Tiago é uso interno/teste (confirmado com o Tiago).
const EVOLUTION_BASE_URL = process.env.EVOLUTION_BASE_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const EVOLUTION_INSTANCE_ALINE = process.env.EVOLUTION_INSTANCE_ALINE;

// O node "fromMe" do workflow Lumi trata qualquer mensagem que sai pelo
// número da Aline como resposta da própria Lumi SE o texto contiver
// "[Lumi]" -- é assim que o n8n distingue a Lumi de uma resposta humana de
// verdade (equipe) pra decidir se pausa a IA e grava com o prefixo
// "[Equipe da clínica]:". Nunca deixar esse texto passar por aqui.
function validarTexto(texto) {
  if (texto.includes('[Lumi]')) {
    throw new Error(
      'Texto não pode conter "[Lumi]" -- o n8n usa essa marca pra reconhecer mensagem da própria Lumi, não da equipe.'
    );
  }
}

async function enviarMensagem({ telefone, texto }) {
  if (!EVOLUTION_BASE_URL || !EVOLUTION_API_KEY || !EVOLUTION_INSTANCE_ALINE) {
    throw new Error(
      'Configuração da Evolution API ausente (EVOLUTION_BASE_URL/EVOLUTION_API_KEY/EVOLUTION_INSTANCE_ALINE).'
    );
  }
  validarTexto(texto);

  const resposta = await fetch(`${EVOLUTION_BASE_URL}/message/sendText/${EVOLUTION_INSTANCE_ALINE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
    body: JSON.stringify({ number: telefone, text: texto, delay: 0, linkPreview: true }),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new Error(dados.message || dados.error || 'Falha ao enviar mensagem pela Evolution API.');
  }
  return dados;
}

// Status da conexão do WhatsApp desta instalação (produção ou demo, quem
// estiver em EVOLUTION_INSTANCE_ALINE) -- usado pelo card "Conexão WhatsApp"
// em Configurações. Ao contrário de enviarMensagem, NÃO lança erro quando a
// configuração está ausente -- devolve configurado:false, porque isso é um
// estado válido e esperado (ex: painel_demo antes de ter uma instância
// própria), não uma falha a ser tratada como 502 pelo chamador.
async function statusConexao() {
  if (!EVOLUTION_BASE_URL || !EVOLUTION_API_KEY || !EVOLUTION_INSTANCE_ALINE) {
    return { configurado: false };
  }

  const resposta = await fetch(`${EVOLUTION_BASE_URL}/instance/fetchInstances`, {
    headers: { apikey: EVOLUTION_API_KEY },
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new Error(dados.message || dados.error || 'Falha ao consultar status da Evolution API.');
  }

  const lista = Array.isArray(dados) ? dados : dados.instances || [];
  const minha = lista.find((item) => (item.instance?.instanceName || item.name || item.instanceName) === EVOLUTION_INSTANCE_ALINE);
  if (!minha) {
    return { configurado: true, encontrada: false, instancia: EVOLUTION_INSTANCE_ALINE };
  }

  const status = minha.instance?.status || minha.connectionStatus || minha.status || null;
  return { configurado: true, encontrada: true, instancia: EVOLUTION_INSTANCE_ALINE, status, conectado: status === 'open' };
}

// QR code pra (re)conectar a instância desta instalação. Chamar só quando o
// front já sabe (via statusConexao) que está desconectada -- evita gerar QR
// à toa numa instância já conectada.
async function obterQrCode() {
  if (!EVOLUTION_BASE_URL || !EVOLUTION_API_KEY || !EVOLUTION_INSTANCE_ALINE) {
    throw new Error(
      'Configuração da Evolution API ausente (EVOLUTION_BASE_URL/EVOLUTION_API_KEY/EVOLUTION_INSTANCE_ALINE).'
    );
  }

  const resposta = await fetch(`${EVOLUTION_BASE_URL}/instance/connect/${EVOLUTION_INSTANCE_ALINE}`, {
    headers: { apikey: EVOLUTION_API_KEY },
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new Error(dados.message || dados.error || 'Falha ao gerar QR code pela Evolution API.');
  }
  if (!dados.base64) {
    throw new Error('A Evolution API não devolveu um QR code -- a instância já deve estar conectada.');
  }
  return { base64: dados.base64 };
}

// Desconecta a sessão do WhatsApp linkada nesta instância (sem apagar a
// instância em si -- nome/configuração/webhook continuam existindo na
// Evolution API, só o número atual sai). Necessário antes de conseguir um
// QR novo quando já tem um número conectado -- /instance/connect só
// devolve QR pra instância desconectada (confirmado ao vivo: chamado numa
// instância "open", devolve o status atual sem nenhum campo base64).
// Só usado por trocarNumero() -- nunca exposto sozinho pro front, pra não
// deixar a Lumi desconectada sem nenhum caminho de volta visível no painel.
async function desconectarInstancia() {
  if (!EVOLUTION_BASE_URL || !EVOLUTION_API_KEY || !EVOLUTION_INSTANCE_ALINE) {
    throw new Error(
      'Configuração da Evolution API ausente (EVOLUTION_BASE_URL/EVOLUTION_API_KEY/EVOLUTION_INSTANCE_ALINE).'
    );
  }
  const resposta = await fetch(`${EVOLUTION_BASE_URL}/instance/logout/${EVOLUTION_INSTANCE_ALINE}`, {
    method: 'DELETE',
    headers: { apikey: EVOLUTION_API_KEY },
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new Error(dados.response?.message?.[0] || dados.message || dados.error || 'Falha ao desconectar a instância.');
  }
}

// Troca o número conectado: desconecta a sessão atual e devolve um QR code
// novo pra escanear com outro celular. AÇÃO DESTRUTIVA -- desconecta na
// hora o número que estiver ativo agora (em produção, é o WhatsApp real da
// clínica atendendo paciente). O front exige confirmação explícita do
// usuário antes de chamar esta rota (ver #botaoTrocarNumero em app.js).
async function trocarNumero() {
  await desconectarInstancia();
  // A Evolution API precisa de um instante pra terminar de processar o
  // logout antes de connect voltar a gerar QR -- mesmo padrão de espera
  // depois de mudar estado já usado nos scripts de n8n deste projeto.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return obterQrCode();
}

module.exports = { enviarMensagem, statusConexao, obterQrCode, trocarNumero };
