'use strict';

// Cliente de LLM compartilhado entre os harnesses (Lumi e Analytics Agent).
// Suporta múltiplos provedores compatíveis com o formato de tool-calling da
// OpenAI (messages/tools/tool_calls) -- Mistral, Groq e Gemini são todos
// assim, só muda a base URL, a env var da chave e o nome do modelo.

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const PROVEDORES = {
  mistral: {
    baseUrl: 'https://api.mistral.ai/v1/chat/completions',
    apiKeyEnv: 'MISTRAL_API_KEY',
    modeloPadrao: 'devstral-latest',
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    apiKeyEnv: 'GROQ_API_KEY',
    modeloPadrao: 'llama-3.3-70b-versatile',
  },
  gemini: {
    // Camada de compatibilidade OpenAI do Google -- aceita o mesmo formato
    // de messages/tools/tool_calls, então reaproveita o mesmo código.
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    apiKeyEnv: 'GEMINI_API_KEY',
    modeloPadrao: 'gemini-flash-latest',
  },
};

function corTerminal(texto, codigo) {
  if (process.env.NO_COLOR) return texto;
  return `\x1b[${codigo}m${texto}\x1b[0m`;
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retorna uma função chamarLLM(messages) já configurada com o provedor/chave
// do ambiente atual (LUMI_PROVIDER/LUMI_MODEL) e as tools passadas.
function criarClienteLLM(tools) {
  const PROVEDOR = PROVEDORES[process.env.LUMI_PROVIDER || 'mistral'];
  if (!PROVEDOR) {
    throw new Error(`LUMI_PROVIDER inválido. Use um de: ${Object.keys(PROVEDORES).join(', ')}`);
  }

  const API_KEY = process.env[PROVEDOR.apiKeyEnv];
  const MODEL = process.env.LUMI_MODEL || PROVEDOR.modeloPadrao;
  const TEMPERATURE = 0.1;

  if (!API_KEY) {
    throw new Error(`Falta ${PROVEDOR.apiKeyEnv}. Crie lumi-harness/.env com ${PROVEDOR.apiKeyEnv}=... (veja .env.example).`);
  }

  async function chamarLLM(messages, tentativa = 1) {
    const resp = await fetch(PROVEDOR.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: TEMPERATURE,
        messages,
        tools,
        tool_choice: 'auto',
      }),
    });

    // Rate limit (comum no tier free da Groq/Mistral): espera o tempo
    // sugerido pela API (quando ela informa) e tenta de novo, em vez de
    // simplesmente falhar -- essencial pra rodar testes de várias
    // mensagens/repetições.
    if (resp.status === 429 && tentativa <= 4) {
      const corpo = await resp.text().catch(() => '');
      const match = corpo.match(/try again in ([\d.]+)s/i);
      const esperaMs = match ? Math.ceil(parseFloat(match[1]) * 1000) + 1000 : 15000 * tentativa;
      console.error(corTerminal(`   (rate limit, aguardando ${Math.round(esperaMs / 1000)}s antes de tentar de novo...)`, '90'));
      await esperar(esperaMs);
      return chamarLLM(messages, tentativa + 1);
    }

    if (!resp.ok) {
      const texto = await resp.text().catch(() => '');
      throw new Error(`API (${process.env.LUMI_PROVIDER || 'mistral'}) respondeu ${resp.status}: ${texto}`);
    }

    return resp.json();
  }

  return { chamarLLM, MODEL, PROVEDOR };
}

module.exports = { criarClienteLLM, corTerminal, esperar };
