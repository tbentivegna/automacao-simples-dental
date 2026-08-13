'use strict';

// Preview local do texto de lembrete de consulta, sem n8n e sem enviar nada.
//
// Reimplementa DE PROPÓSITO a mesma lógica do Code node "Monta Mensagem do
// Lembrete" (n8n/lembretes-workflow.json) -- mesmo padrão já usado em
// mock-tools.js, que duplica constantes de server.js pra poder rodar
// isolado. Se mexer no texto lá, mexa aqui também.
//
// Uso:
//   node lumi-harness/lembretes-preview.js                 -> imprime os 4 casos de exemplo
//   node lumi-harness/lembretes-preview.js caminho.json     -> imprime a partir de um JSON
//                                                              { "lembretes": [...] } (mesmo
//                                                              formato devolvido por
//                                                              POST /lembretes-do-dia)

function montarMensagem({ nomePaciente, quando, hora, status, telefone }) {
  const nome = (nomePaciente || '').split(' ')[0] || '';
  const saudacao = nome ? `Olá ${nome}!` : 'Olá!';
  const quandoTexto = quando === 'hoje' ? 'hoje' : 'amanhã';

  let mensagem = `${saudacao} 🤎 Passando pra lembrar que ${quandoTexto} você tem consulta agendada às ${hora} com a Dra. Aline.`;

  if (status === 'Confirmada') {
    mensagem += ' Te esperamos lá 🙂';
  } else {
    mensagem += ' Pode confirmar sua presença respondendo por aqui, ou me avisar se precisar remarcar ou cancelar 😊';
  }

  return {
    mensagem,
    telefoneJid: telefone ? `55${telefone}@s.whatsapp.net` : null,
  };
}

const EXEMPLOS = [
  { nomePaciente: 'Marina Costa', quando: 'hoje', hora: '15:00', status: 'Agendada', telefone: '11988885555' },
  { nomePaciente: 'Rafael Duarte', quando: 'amanha', hora: '08:30', status: 'Agendada', telefone: '11977778888' },
  { nomePaciente: 'Marina Costa', quando: 'hoje', hora: '15:00', status: 'Confirmada', telefone: '11988885555' },
  { nomePaciente: 'Rafael Duarte', quando: 'amanha', hora: '08:30', status: 'Confirmada', telefone: '11977778888' },
];

function imprimir(lembretes) {
  for (const l of lembretes) {
    const { mensagem, telefoneJid } = montarMensagem(l);
    console.log(`--- ${l.nomePaciente || l.paciente || '(sem nome)'} | ${l.quando} | ${l.hora} | status: ${l.status} ---`);
    console.log(`  para: ${telefoneJid || '(sem telefone -- lembrete seria pulado)'}`);
    console.log(`  "${mensagem}"`);
    console.log();
  }
}

if (require.main === module) {
  const arquivo = process.argv[2];
  if (!arquivo) {
    console.log('Sem arquivo informado -- usando 4 casos de exemplo (hoje/amanhã x confirmada/não confirmada).\n');
    imprimir(EXEMPLOS);
  } else {
    const fs = require('fs');
    const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    // Aceita tanto { lembretes: [...] } (saída de /lembretes-do-dia) quanto um array direto.
    const lembretes = Array.isArray(dados) ? dados : dados.lembretes || [];
    const normalizados = lembretes.map((l) => ({
      nomePaciente: l.nomePaciente || l.paciente,
      quando: l.quando,
      hora: l.hora,
      status: l.status,
      telefone: l.telefone,
    }));
    imprimir(normalizados);
  }
}

module.exports = { montarMensagem };
