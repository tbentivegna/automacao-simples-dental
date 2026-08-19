'use strict';

// Espelha exatamente os 6 nós "httpRequestTool" do workflow n8n
// (Chatbot_divisao_mensgens.json). Descrições copiadas verbatim do campo
// "toolDescription" de cada nó. "Busca Agendamentos Paciente" não tem
// toolDescription própria no n8n (usa só o nome do nó) -- aqui usamos o
// texto que o system prompt principal já usa pra descrever essa tool, já
// que é a única fonte disponível.

const tools = [
  {
    type: 'function',
    function: {
      name: 'verificar_disponibilidade',
      description:
        'Verifica os horários disponíveis no Simples Dental. Use esta ferramenta antes de tentar realizar um agendamento. Nunca invente horários. Use o resultado desta ferramenta para informar ao paciente quais horários estão disponíveis.\nOBRIGATÓRIO para qualquer pergunta sobre disponibilidade. Execute esta ferramenta sempre que o paciente perguntar, confirmar, contestar ou pedir para verificar novamente qualquer data, dia ou horário. Nunca responda sobre disponibilidade usando memória, contexto anterior ou suposição. Sempre use o resultado mais recente desta ferramenta como fonte de verdade.\nSe o paciente mencionar um dia da semana e/ou período específico (ex: "tem quarta de manhã?", "e sexta?", "só de tarde"), passe isso nos parâmetros diaSemana/periodo -- o resultado já vem filtrado e pronto, sem precisar procurar dentro de uma lista grande. Se o pedido for genérico (sem dia da semana definido), não passe esses parâmetros -- o resultado traz várias semanas de uma vez.',
      parameters: {
        type: 'object',
        properties: {
          diaSemana: {
            type: 'string',
            enum: ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'],
            description:
              'Preencha somente se o paciente mencionou um dia da semana específico nesta pergunta (ex: "quarta", "sexta"). Deixe de fora se o pedido for genérico.',
          },
          periodo: {
            type: 'string',
            enum: ['manha', 'tarde'],
            description:
              'Preencha somente se o paciente já indicou preferência de período (manhã ou tarde) nesta pergunta. Deixe de fora se ainda não sabe a preferência.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'criar_agendamento',
      description:
        'IMPORTANTE — TIMEOUT OU ERRO\n\nEsta ferramenta realiza uma operação real de criação de agendamento.\n\nSe a ferramenta retornar timeout, erro ou resultado inconclusivo, NÃO tente criar o mesmo agendamento novamente.\n\nUm timeout não significa necessariamente que o agendamento não foi criado no sistema.\n\nEm caso de erro ou timeout:\n1. Não informe ao paciente que o agendamento foi cancelado ou não foi criado.\n2. Não execute novamente "Criar Agendamento" imediatamente.\n3. Utilize "Buscar Agendamentos do Paciente" para verificar se o agendamento solicitado foi criado.\n4. Se o agendamento for encontrado para a mesma data e horário solicitados pelo paciente, considere a operação concluída.\n5. Se não for encontrado, encaminhe a situação para a equipe humana.\n\nNunca crie um segundo agendamento apenas porque esta ferramenta não retornou uma confirmação.',
      parameters: {
        type: 'object',
        properties: {
          nomePaciente: {
            type: 'string',
            description:
              'Nome completo do paciente. Obrigatório somente quando for necessário cadastrar um paciente novo. Se o paciente já estiver cadastrado no sistema, não é necessário inventar ou fornecer outro nome.',
          },
          data: {
            type: 'string',
            description:
              'Data da consulta no formato DD/MM/AAAA. Use exatamente uma data de um horário que tenha sido retornado pela ferramenta Verifica Disponibilidade e explicitamente escolhido pelo usuário via mensagem. Nunca invente uma data ou horário disponível.',
          },
          hora: {
            type: 'string',
            description:
              'Horário da consulta no formato HH:mm. Deve ser obrigatoriamente um dos horários disponíveis retornados pela ferramenta Verifica Disponibilidade e explicitamente escolhido pelo usuário via mensagem. Nunca invente ou assuma que um horário está disponível.',
          },
          observacao: {
            type: 'string',
            description:
              'Aqui você deve colocar a queixa principal ou motivação da consulta que o paciente te informou. Sempre concatene ao final da motivação a seguinte string "(AGENDADO POR IA)".',
          },
          categoria: {
            type: 'string',
            enum: [
              'primeira_consulta',
              'ortodontia',
              'odontopediatria',
              'hof',
              'clareamento',
              'limpeza_prevencao',
              'consulta_estetica',
              'dor_urgencia',
              'outro',
            ],
            description:
              'Categoria que melhor representa o motivo identificado nesta conversa (a mesma lista usada na seção IDENTIFICAÇÃO DA QUEIXA do seu prompt). Use "odontopediatria" quando o motivo for ortodontia infantil/Invisalign First em criança. Use "outro" se não se encaixar em nenhuma categoria específica. Só usada para registro interno, nunca mencione essa categoria ao paciente.',
          },
          dataNascimentoPaciente: {
            type: 'string',
            description:
              'Data de nascimento do paciente, formato DD/MM/AAAA. Só preencher quando o paciente for novo no Simples Dental.',
          },
          cpfPaciente: {
            type: 'string',
            description:
              'CPF do paciente, só números ou formatado. Só preencher quando o paciente for novo no Simples Dental.',
          },
          email: {
            type: 'string',
            description:
              'E-mail do paciente (ou do responsável, se o paciente for menor de idade). Só preencher quando o paciente for novo no Simples Dental.',
          },
          cep: {
            type: 'string',
            description:
              'CEP do endereço do paciente (ou do responsável, se menor de idade). Só preencher quando o paciente for novo no Simples Dental.',
          },
          numero: {
            type: 'string',
            description:
              'Número do endereço (residência). Só preencher quando o paciente for novo no Simples Dental.',
          },
          complemento: {
            type: 'string',
            description: 'Complemento do endereço (apto, bloco, etc), se o paciente informar. Opcional.',
          },
          nomeResponsavel: {
            type: 'string',
            description:
              'Nome completo do responsável pelo paciente. Só preencher quando o paciente for menor de idade E for novo no Simples Dental.',
          },
          dataNascimentoResponsavel: {
            type: 'string',
            description:
              'Data de nascimento do responsável, formato DD/MM/AAAA. Só quando o paciente for menor de idade e novo no Simples Dental.',
          },
          cpfResponsavel: {
            type: 'string',
            description: 'CPF do responsável. Só quando o paciente for menor de idade e novo no Simples Dental.',
          },
          celularResponsavel: {
            type: 'string',
            description:
              'Celular do responsável, se for diferente do número desta conversa no WhatsApp. Só quando o paciente for menor de idade e novo no Simples Dental.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_agendamentos_paciente',
      description:
        'Localiza as consultas existentes do paciente ("qual minha próxima consulta?", "tenho consulta marcada?"). Use sempre antes de confirmar, cancelar ou remarcar um agendamento, para obter o ID exato do agendamento. Também use no início do fluxo de agendamento pra descobrir se o paciente já é cadastrado no Simples Dental (campo "encontrado" no retorno).',
      parameters: {
        type: 'object',
        properties: {
          nomePaciente: {
            type: 'string',
            description:
              'Nome do paciente (o do dependente, se a consulta for para um filho/dependente -- ver seção CONSULTA PARA DEPENDENTE; senão, o nome de quem está conversando). Necessário pra desambiguar quando o telefone tem mais de um paciente cadastrado (ex: vários filhos no mesmo WhatsApp da família). Sem isso, se houver mais de um paciente pro telefone, a busca não sabe qual retornar.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'confirmar_agendamento',
      description:
        'Confirma um agendamento existente do paciente.\n\nUse esta ferramenta SOMENTE quando o paciente solicitar explicitamente a confirmação de um agendamento já existente.\n\nO campo "id" deve ser obrigatoriamente o ID do agendamento retornado pela ferramenta "Busca Agendamentos do Paciente".\n\nNUNCA invente, estime ou utilize o telefone, nome, data ou horário como ID.\n\nAntes de utilizar esta ferramenta, consulte "Buscar Agendamentos do Paciente" para localizar o agendamento correto e obter seu ID.\n\nSe houver mais de um agendamento e não for possível identificar com segurança qual o paciente deseja confirmar, pergunte qual agendamento ele deseja confirmar antes de executar esta ferramenta.\n\nApós executar a ferramenta, aguarde o resultado. Somente informe ao paciente que o agendamento foi confirmado se a ferramenta retornar sucesso.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description:
              'ID único do agendamento, exatamente como retornado por "Busca Agendamentos do Paciente".',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancelar_agendamento',
      description:
        'Cancela um agendamento existente do paciente.\n\nUse esta ferramenta SOMENTE quando o paciente solicitar explicitamente o cancelamento de um agendamento já existente.\n\nO campo "id" deve ser obrigatoriamente o ID do agendamento retornado pela ferramenta "Busca Agendamentos do Paciente".\n\nNUNCA invente, estime ou utilize o telefone, nome, data ou horário como ID.\n\nAntes de utilizar esta ferramenta, consulte "Buscar Agendamentos do Paciente" para localizar o agendamento correto e obter seu ID.\n\nSe houver mais de um agendamento e não for possível identificar com segurança qual o paciente deseja cancelar, pergunte qual agendamento ele deseja cancelar antes de executar esta ferramenta.\n\nApós executar a ferramenta, aguarde o resultado. Somente informe ao paciente que o agendamento foi cancelado se a ferramenta retornar sucesso.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description:
              'ID único do agendamento, exatamente como retornado por "Busca Agendamentos do Paciente".',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remarcar_agendamento',
      description:
        'Remarca (altera data e/ou horário) um agendamento existente do paciente.\n\nUse esta ferramenta SOMENTE quando o paciente solicitar explicitamente mudar a data ou horário de uma consulta já existente.\n\nO campo "id" deve ser obrigatoriamente o ID do agendamento retornado pela ferramenta "Busca Agendamentos do Paciente". NUNCA invente, estime ou utilize o telefone, nome, data ou horário como ID.\n\nAntes de utilizar esta ferramenta:\n1. Utilize "Busca Agendamentos do Paciente" para localizar o agendamento correto e obter seu ID.\n2. Utilize "Verifica Disponibilidade" para encontrar um novo horário livre.\n3. Confirme com o paciente qual novo horário ele deseja.\n\nApós executar a ferramenta, aguarde o resultado. Somente informe ao paciente que a consulta foi remarcada se a ferramenta retornar sucesso.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description:
              'ID único do agendamento, exatamente como retornado por "Busca Agendamentos do Paciente".',
          },
          data: {
            type: 'string',
            description:
              'Nova data da consulta no formato DD/MM/AAAA. Deve ser um horário retornado por "Verifica Disponibilidade" e explicitamente escolhido pelo paciente. Nunca invente.',
          },
          hora: {
            type: 'string',
            description:
              'Novo horário no formato HH:mm. Deve ser um horário retornado por "Verifica Disponibilidade" e explicitamente escolhido pelo paciente. Nunca invente.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'registrar_consentimento_lembrete',
      // No n8n real esta é uma node postgresTool (mesmo padrão do Analytics
      // Agent) -- esse tipo de node não tem campo de "toolDescription"
      // próprio como as httpRequestTool acima, só o nome e a query. Por
      // isso a descrição aqui é propositalmente mínima (pra não deixar o
      // teste "mais fácil" do que a realidade) -- a orientação de quando
      // usar mora no system prompt (seção FERRAMENTAS, item 7).
      description:
        'Executa uma query no Postgres para registrar o consentimento do paciente pra receber lembretes de consulta por WhatsApp.',
      parameters: {
        type: 'object',
        properties: {
          consentimento: {
            type: 'string',
            description:
              '"sim" para resposta ou pedido afirmativo do paciente sobre receber lembrete, "nao" para negativo',
          },
        },
      },
    },
  },
];

module.exports = { tools };
