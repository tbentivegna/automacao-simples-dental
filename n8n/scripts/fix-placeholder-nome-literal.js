// Achado real (24/08, conversa com a Erika): quando o nome do paciente
// ainda não foi confirmado (cliente.nome IS NULL), a Lumi respondeu "Sem
// problema, [Nome]! ..." -- copiou o placeholder de colchetes de um dos 4
// exemplos do prompt (que usam "[Nome]" pra indicar "insira o nome do
// paciente aqui") em vez de omitir/substituir. Fica muito ruim pro
// paciente ver.
//
// Fix em duas camadas (mesma lógica de PROMESSA DE RETORNO já usada neste
// prompt -- regra no prompt sozinha não é garantia, ver
// feedback_prompt_vs_code_guarantees):
//   1. Prompt: adiciona uma seção explicando que "[Nome]" nos exemplos é
//      só indicação de onde o nome entra, nunca pra ser escrito
//      literalmente -- se não souber o nome, reescrever sem nome.
//   2. Código: node "Extrai JSON" ganha uma rede de segurança -- se
//      "[Nome]" (colchetes) escapar mesmo assim, troca pelo nome/apelido
//      conhecido do cliente, ou remove a referência de forma gramatical
//      caso não haja nome nenhum disponível.
require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;
const workflowId = process.argv[2];
if (!workflowId) throw new Error('uso: node fix-placeholder-nome-literal.js <workflowId>');

const MARCADOR_PROMPT =
  'Sou a concierge digital da Dra. Aline -- te ajudo com informações, organização de agendamentos e te conecto com a equipe sempre que necessário."';

const SECAO_NOVA = `

📛 USO DO NOME DO PACIENTE -- nos exemplos deste prompt, "[Nome]" indica onde o nome do paciente deve entrar. NUNCA escreva a palavra "[Nome]" com colchetes literalmente numa resposta ao paciente. Se você já sabe o nome dele (confirmado ou pelo menos o nome do perfil do WhatsApp), use-o normalmente no lugar de "[Nome]". Se ainda não sabe o nome dele nesta conversa, reescreva a frase sem nenhum nome (ex: "Sem problema, [Nome]!" vira "Sem problema!") -- nunca deixe colchetes escaparem pro paciente.`;

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  const agentNode = wf.nodes.find((n) => n.name === 'AI Agent');
  const extraiJson = wf.nodes.find((n) => n.name === 'Extrai JSON');
  if (!agentNode || !extraiJson) throw new Error('nos esperados nao encontrados');

  const prompt = agentNode.parameters.options?.systemMessage;
  if (!prompt) throw new Error('systemMessage nao encontrado em AI Agent.parameters.options');

  if (!prompt.includes(MARCADOR_PROMPT)) throw new Error('marcador de insercao nao encontrado no prompt -- prompt pode ter mudado');

  if (!prompt.includes('USO DO NOME DO PACIENTE')) {
    agentNode.parameters.options.systemMessage = prompt.replace(MARCADOR_PROMPT, MARCADOR_PROMPT + SECAO_NOVA);
  } else {
    console.log('Secao do prompt ja existe, pulando essa parte.');
  }

  if (!extraiJson.parameters.jsCode.includes('REGEX_PLACEHOLDER_NOME')) {
    extraiJson.parameters.jsCode = extraiJson.parameters.jsCode.replace(
      'const text = ($json.output ?? "").replace(/^\\s*\\[Equipe da cl\\u00ednica\\]:\\s*/i, "");',
      `let text = ($json.output ?? "").replace(/^\\s*\\[Equipe da cl\\u00ednica\\]:\\s*/i, "");

// Rede de seguranca: o modelo as vezes copia o placeholder "[Nome]" (usado
// nos exemplos do prompt) ao pe da letra em vez de usar o nome real ou
// omitir -- nunca deixa isso vazar pro paciente.
const REGEX_PLACEHOLDER_NOME = /\\[Nome\\]/i;
if (REGEX_PLACEHOLDER_NOME.test(text)) {
  const clienteConhecido = $('CREATE & SELECT cliente').first().json;
  const nomeConhecido = clienteConhecido?.nome || clienteConhecido?.apelido_whatsapp;
  text = nomeConhecido
    ? text.replace(/\\[Nome\\]/gi, nomeConhecido)
    : text.replace(/,?\\s*\\[Nome\\]/gi, "").replace(/ {2,}/g, " ").trim();
}`
    );
  } else {
    console.log('Rede de seguranca no codigo ja existe, pulando essa parte.');
  }

  const payload = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings };
  const putRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    headers: { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await putRes.json();
  if (!putRes.ok) throw new Error(`PUT falhou: ${putRes.status} ${JSON.stringify(body)}`);
  console.log('Aplicado com sucesso em', workflowId, '| active=', body.active);
}

main().catch((err) => {
  console.error('ERRO:', err.message);
  process.exit(1);
});
