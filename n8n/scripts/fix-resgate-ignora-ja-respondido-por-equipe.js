'use strict';

// Fix do segundo problema real do incidente de 31/08/2026 (caso Aurora
// Ambiel Lazzaretti): o resgate citou "Magina! O nosso caso tem todo um
// contexto hahahaha Combinado" como se fosse uma pergunta em aberto pra
// Lumi -- mas essa mensagem era, na verdade, uma resposta de ENCERRAMENTO
// pra uma explicação que a EQUIPE HUMANA já tinha dado sobre o mesmo
// assunto (valor da consulta), minutos antes. A equipe já tinha resolvido
// aquele "contexto" -- não fazia sentido nenhum a Lumi voltar 3 dias
// depois perguntando "ainda tem interesse?" sobre uma coisa que já foi
// respondida e encerrada por um humano.
//
// Causa raiz: "Busca Funil Parado" só olha bot_disabled ATUAL (que já
// reseta sozinho depois de 6h de handoff, ver workflow "Lumi - Retorno
// Automático do Atendimento Humano") -- não tem memória de que a equipe
// participou daquela tentativa de agendamento em algum momento. Uma vez
// que bot_disabled volta a false, o funil trata a conversa como se
// nenhum humano nunca tivesse entrado nela.
//
// Fix: além do bot_disabled atual, também excluir qualquer tentativa
// onde a equipe já mandou pelo menos 1 mensagem (prefixo "[Equipe da
// clínica]:") DEPOIS que a tentativa começou (f.iniciado_em). Se um
// humano já participou daquela tentativa especificamente, o resgate
// automático não dispara mais pra ela -- fica a critério de quem já
// está cuidando do caso decidir se retoma ou não.
//
// Idempotente: só reescreve se ainda encontrar a query antiga.

require('dotenv').config();

const BASE = process.env.N8N_BASE_URL;
const KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = 'vUGMz073giDPfGzx'; // Lumi - Resgate de Funil (prod)
const NODE_NAME = 'Busca Funil Parado';

const TRECHO_ANTIGO = `  AND NOT EXISTS (
    SELECT 1 FROM public.consultas ct
    WHERE ct.telefone = f.telefone
      AND ct.inicio >= now()
      AND ct.status NOT IN ('Cancelada pelo paciente','Cancelada pelo profissional','Falta','removido_do_calendario')
  )
LIMIT 20;`;

const TRECHO_NOVO = `  AND NOT EXISTS (
    SELECT 1 FROM public.consultas ct
    WHERE ct.telefone = f.telefone
      AND ct.inicio >= now()
      AND ct.status NOT IN ('Cancelada pelo paciente','Cancelada pelo profissional','Falta','removido_do_calendario')
  )
  AND NOT EXISTS (
    -- Se a equipe humana já participou desta tentativa específica
    -- (qualquer mensagem "[Equipe da clínica]:" depois que a tentativa
    -- começou), não é uma conversa abandonada de verdade -- é uma
    -- conversa que já teve intervenção humana, e o resgate automático
    -- não deveria voltar sozinho citando um contexto que já foi tratado.
    SELECT 1 FROM public.n8n_chat_histories h
    WHERE h.session_id = f.telefone
      AND h.message->>'type' = 'ai'
      AND h.message->>'content' LIKE '[Equipe da clínica]:%'
      AND h.created_at > f.iniciado_em
  )
LIMIT 20;`;

async function main() {
  const resposta = await fetch(`${BASE}/api/v1/workflows/${WORKFLOW_ID}`, {
    headers: { 'X-N8N-API-KEY': KEY },
  });
  const workflow = await resposta.json();

  const node = workflow.nodes.find((n) => n.name === NODE_NAME);
  if (!node) throw new Error(`Node "${NODE_NAME}" não encontrado.`);

  if (node.parameters.query.includes('h.message->>\'content\' LIKE \'[Equipe da clínica]:%\'')) {
    console.log('Já aplicado (query já tem a checagem de equipe). Nada a fazer.');
    return;
  }
  if (!node.parameters.query.includes(TRECHO_ANTIGO)) {
    throw new Error('Query atual do node não bate com o esperado -- abortando pra não sobrescrever algo inesperado. Confira manualmente.');
  }

  node.parameters.query = node.parameters.query.replace(TRECHO_ANTIGO, TRECHO_NOVO);

  const stickyId = `sticky-fix-resgate-contexto-${Date.now()}`;
  workflow.nodes.push({
    parameters: {
      content:
        '## ⚠️ Fix 31/08/2026\nAdicionada checagem: se a equipe já mandou alguma mensagem nesta tentativa específica (depois de iniciado_em), o resgate automático não dispara mais pra ela -- evita citar como "pergunta em aberto" algo que a equipe já respondeu e encerrou.',
      height: 220,
      width: 340,
      color: 3,
    },
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [node.position[0] - 60, node.position[1] + 260],
    id: stickyId,
    name: 'Nota - Fix Resgate Contexto 31-08',
  });

  const payload = {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings || {},
  };

  const put = await fetch(`${BASE}/api/v1/workflows/${WORKFLOW_ID}`, {
    method: 'PUT',
    headers: { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!put.ok) {
    throw new Error(`Falha ao salvar workflow: ${put.status} ${await put.text()}`);
  }
  console.log('Aplicado com sucesso.');
}

main().catch((erro) => {
  console.error('ERRO:', erro.message);
  process.exit(1);
});
