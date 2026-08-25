# Painel administrativo — pipeline de próximos passos

Baseado numa avaliação por perfil feita em 20/08/2026: simulamos uma dentista,
uma recepcionista, um gerente de marketing e um técnico de TI usando o painel
com dados reais de produção (384 pacientes), testando casos de uso reais de
cada um. Relatório completo (com o detalhe de cada caso testado) em:
https://claude.ai/code/artifact/cf6d52a3-0bae-4e1f-bb69-8f15933395aa

Cobertura na data da avaliação: Recepção 6/8, Clínica 4/7, Marketing 1/6, TI 1/7.

Este arquivo é o backlog vivo — quando um item for feito, mover pra
"Concluído" com a data, não apagar (mantém o histórico de por que foi
priorizado).

## P0 — prioridade real

- [ ] **Contas de usuário reais (um login por pessoa) + log de quem fez o quê.**
  Hoje é uma senha única compartilhada por toda a equipe (`ADMIN_PASSWORD`),
  sem forma de revogar acesso de uma pessoa específica nem saber quem pausou
  o bot ou resolveu uma pendência — tudo fica registrado como "painel
  administrativo". Serve: TI, Recepção, Clínica.
- [ ] **Alerta ativo pra urgência e fila de atendimento humano.**
  Hoje só aparece se alguém tiver a aba aberta olhando — uma urgência pode
  ficar esperando sem ninguém saber. Serve: Recepção, Clínica.
- [ ] **Exportar/apagar dados de um paciente específico (LGPD).**
  Não existe em nenhuma tela hoje — só seria possível mexendo direto no
  banco. Serve: TI, Marketing.

## P1 — alto valor, sem urgência

- [ ] **Ficha de paciente mais completa dentro do painel** (CPF, nascimento,
  endereço) — hoje só existe no Simples Dental, cada atendimento vira dois
  sistemas abertos. Serve: Recepção, Clínica.
- [ ] **Abrir a conversa de um paciente direto da busca** — hoje o histórico
  só aparece via drill-down agregado do card "Mensagens trocadas", sem link
  direto por paciente. Serve: Recepção, Clínica.
- [ ] **Formatar telefone pra leitura humana** — aparece como
  `5511999999999@s.whatsapp.net` em toda tela que lista paciente. Pequeno,
  mas é fricção constante. Serve: Recepção.
- [ ] **Pausa programada/recorrente** (almoço, fim de semana) — hoje é
  sempre manual. Serve: Recepção.

## P2 — melhoria de longo prazo

- [ ] **Painel de saúde do sistema** (última mensagem processada, erros
  recentes) — hoje só é visível entrando direto no n8n. Serve: TI.
- [ ] **Captura de origem/canal do paciente** (Instagram, indicação, Google)
  — não existe em nenhum ponto do fluxo hoje; precisaria ser capturado já
  na primeira conversa com a Lumi. Serve: Marketing.
- [ ] **Funil de conversão** (mensagem → pendência → consulta confirmada) —
  os números já existem separados, falta cruzá-los numa visão só. Serve:
  Marketing.
- [ ] **Responder o paciente direto do painel** — maior esforço da lista
  (precisa integrar envio pelo Evolution API); hoje sempre volta pro
  WhatsApp pra escrever. Serve: Recepção, Clínica.

## Concluído

- [x] **Gráfico de tendência ao longo do tempo** (25/08/2026) — nova página
  Analytics: gráfico de tendência (Dia/Semana/Mês/Trimestre/Ano) dos
  indicadores da Visão Geral, cards de funil de resgate (recuperados/
  tentativas/taxa) e nuvem de palavras das mensagens (paciente/Lumi/ambos).
