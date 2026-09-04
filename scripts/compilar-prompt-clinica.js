'use strict';

// Compila o núcleo fixo de Template_Prompt_Assistente_IA.md substituindo as
// {{VARIAVEIS}} pelos valores de um arquivo JSON (uma cópia de
// scripts/variaveis-clinica.exemplo.json preenchida por clínica), pronto pra
// colar no campo systemMessage do node "AI Agent" no n8n dessa clínica.
//
// uso: node scripts/compilar-prompt-clinica.js <caminho-do-json> [arquivo-saida.txt]
//
// O que este script faz sozinho (sem precisar de variável pra isso):
// - Remove os comentários <!-- MÓDULO: ... --> (são notas editoriais pra
//   quem preenche o template, não devem ir pro prompt real).
// - Remove a seção 🚫 PALAVRA PROIBIDA inteira se
//   _modulo_palavra_proibida.incluir for false (ou substitui a palavra se
//   for true).
// - Genericiza as menções a "Simples Dental" espalhadas pelo núcleo fixo
//   (nome do sistema de agenda dessa clínica -- ver _nome_sistema_agenda),
//   já que o template hoje assume Simples Dental como padrão mas o núcleo
//   fixo também precisa funcionar pra clínicas no standalone-bridge.
// - Ajusta o nome do node de cliente na expressão n8n literal do final
//   (seção NOTAS DESTA CONVERSA), se _nome_node_cliente_n8n vier diferente
//   de "CREATE & SELECT cliente".

const fs = require('fs');
const path = require('path');

const caminhoJson = process.argv[2];
if (!caminhoJson) {
  console.error('uso: node compilar-prompt-clinica.js <caminho-do-json> [arquivo-saida.txt]');
  process.exit(1);
}
const arquivoSaida = process.argv[3] || caminhoJson.replace(/\.json$/, '') + '.compilado.txt';

const vars = JSON.parse(fs.readFileSync(caminhoJson, 'utf8'));
const templatePath = path.join(__dirname, '..', 'Template_Prompt_Assistente_IA.md');
const template = fs.readFileSync(templatePath, 'utf8');

// Extrai o núcleo fixo -- primeiro bloco ``` depois de "NÚCLEO FIXO"
const inicioMarcador = 'NÚCLEO FIXO';
const idxNucleo = template.indexOf(inicioMarcador);
if (idxNucleo === -1) throw new Error('Não achei a seção NÚCLEO FIXO no template.');
const idxAbre = template.indexOf('```', idxNucleo);
const idxFecha = template.indexOf('```', idxAbre + 3);
if (idxAbre === -1 || idxFecha === -1) throw new Error('Não achei os delimitadores ``` do núcleo fixo.');
let corpo = template.slice(idxAbre + 3, idxFecha).trim();

// Remove os comentários editoriais <!-- MÓDULO: ... --> / <!-- MÓDULO OPCIONAL: ... -->
corpo = corpo.replace(/<!--[\s\S]*?-->\n?/g, '');

// Seção PALAVRA PROIBIDA: remove inteira se não aplicável a esta clínica
const modProibida = vars._modulo_palavra_proibida || { incluir: false };
if (!modProibida.incluir) {
  const inicio = corpo.indexOf('🚫 PALAVRA PROIBIDA');
  const fim = corpo.indexOf('🎯 MISSÃO');
  if (inicio !== -1 && fim !== -1) {
    corpo = corpo.slice(0, inicio) + corpo.slice(fim);
  }
} else {
  const palavra = modProibida.palavra || '';
  const substituta = modProibida.substituta || '';
  corpo = corpo
    .replace(/"avaliação" ou qualquer variação dela \(avaliar, avalie, avaliando, avaliado\)/g, `"${palavra}" (e variações)`)
    .replace(/Use sempre "consulta" no lugar/g, `Use sempre "${substituta}" no lugar`);
}

// {{MODULO_ODONTOPEDIATRIA}}
const modOdonto = vars._modulo_odontopediatria || {};
corpo = corpo.split('{{MODULO_ODONTOPEDIATRIA}}').join(modOdonto.texto || '');

// Variáveis normais -- todo {{CHAVE}} que exista como chave no JSON
for (const [chave, valor] of Object.entries(vars)) {
  if (chave.startsWith('_')) continue;
  const token = `{{${chave}}}`;
  corpo = corpo.split(token).join(String(valor ?? ''));
}

// Alerta se sobrou alguma {{VARIAVEL}} não preenchida
const sobrou = corpo.match(/\{\{[A-Z_]+\}\}/g);
if (sobrou) {
  console.warn('⚠️  Variáveis não preenchidas, ficaram literais no texto:', [...new Set(sobrou)].join(', '));
}

// Genericiza "Simples Dental" pro nome de sistema desta clínica -- o valor
// configurado deve ser o substantivo NU, sem artigo (ex: "sistema", não "o
// sistema"), pra "no"/"do" contrair certo em português.
const nomeSistema = vars._nome_sistema_agenda || 'sistema';
corpo = corpo
  .replace(/no Simples Dental/g, `no ${nomeSistema}`)
  .replace(/do Simples Dental/g, `do ${nomeSistema}`)
  .replace(/NO SIMPLES DENTAL/g, `NO ${nomeSistema.toUpperCase()}`);

// Nome do node de cliente na expressão n8n literal do final (se diferente)
const nodeCliente = vars._nome_node_cliente_n8n || 'CREATE & SELECT cliente';
if (nodeCliente !== 'CREATE & SELECT cliente') {
  corpo = corpo.split("$('CREATE & SELECT cliente')").join(`$('${nodeCliente}')`);
}

fs.writeFileSync(arquivoSaida, corpo, 'utf8');
console.log(`Compilado: ${arquivoSaida} (${corpo.length} caracteres)`);
