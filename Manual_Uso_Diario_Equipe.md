# Manual de Uso Diário — Painel Lumi

Guia rápido pra equipe da clínica (recepção/dono) usar o painel no dia a
dia. Diferente do `Roteiro_Demo_Vendas.md` (que é pra convencer um lead a
comprar), este documento ensina quem **já é cliente** a se virar sozinho —
é a base do que vira PDF/página de referência (ver
`Plano_Comercializacao_Lumi.md`, Fase 3, formato ainda a decidir com o
Tiago).

Lembrete que vale a pena repetir sempre: **IA Auxilia, IN Dirige** — a
Lumi cuida do repetitivo, mas o controle é sempre da equipe, aqui no
painel.

---

## Agenda

Mostra a agenda de verdade da clínica, em tempo real — o mesmo compromisso
que aparece aqui é o que está marcado no sistema de verdade (não é uma
cópia separada).

- **Visualizações**: Dia, Semana, Mês, Lista — trocar pelo seletor no topo.
- **Ver detalhe de uma consulta**: clicar em qualquer compromisso abre o
  status, horário e rótulo — dá pra mudar o status (Confirmada,
  Cancelada, Em atendimento, Falta) e o rótulo ali mesmo.
- **Criar uma consulta manualmente**: botão "+ Nova consulta" — útil
  quando o paciente liga em vez de mandar WhatsApp.
- **A bolinha colorida** ao lado do horário é o rótulo/tipo de consulta
  (ex: Invisalign, Primeira Consulta) — a legenda embaixo da grade mostra
  qual cor é qual.
- **Feriado nacional**: aparece marcado na grade automaticamente, mas não
  trava criar consulta nesse dia (às vezes a clínica atende mesmo assim).

## Mensagens

Histórico de toda conversa que a Lumi teve (ou está tendo) com cada
paciente.

- **Responder direto pelo painel**: ao enviar uma mensagem por aqui, a
  Lumi é pausada automaticamente **só pra aquela conversa** — ela não
  volta a responder esse paciente até a equipe liberar de novo (ver
  "Atendimento Humano" abaixo). Isso é diferente de responder pelo
  celular de verdade, que também pausa automaticamente.
- Use pra qualquer coisa que a Lumi não deveria responder sozinha —
  reclamação, negociação, assunto sensível.

## Atendimento Humano

Lista de pacientes com a Lumi pausada — a conversa foi assumida pela
equipe.

- **Volta sozinha em 6h** sem nenhuma mensagem nova, ou a qualquer momento
  se o paciente mandar `##lumi` na própria conversa.
- **Retomar manualmente**: botão de retomar na lista, se quiser devolver
  o controle pra Lumi antes das 6h.

## Pendências

Tudo que a Lumi encaminhou pra um humano decidir — urgência, dúvida que
ela não sabe responder, pedido fora do escopo dela. Urgências aparecem
primeiro. Dá pra adicionar uma pendência manual também (botão "+ Nova
pendência"), pra qualquer coisa que a equipe queira lembrar de resolver.

## Oportunidades (funil de resgate)

Mostra cada paciente que começou a marcar consulta e sumiu no meio do
caminho — e o que a Lumi fez sozinha pra tentar recuperar. Filtra por
etapa (interesse, horário oferecido) e status (em andamento, resgate
enviado, convertido, expirado). É o diferencial que nenhum concorrente
pesquisado tem — vale acompanhar de vez em quando pra ver taxa de
recuperação de verdade.

## Analytics

Números do período: consultas criadas/confirmadas/canceladas, novos
pacientes, mensagens trocadas, taxa de recuperação do funil de resgate.
Clicar num card ("Consultas criadas", "Confirmadas", etc.) abre a lista
detalhada com nome do paciente.

## Configurações

- **Horários**: dias e horários de atendimento, duração padrão de
  consulta — editar aqui reflete direto na disponibilidade que a Lumi
  oferece ao paciente, sem precisar mexer em código.
- **Lições Aprendidas**: sugestões que o sistema identifica sozinho
  olhando onde a equipe precisou intervir — cada uma pode ser aprovada ou
  rejeitada, nunca aplica nada sozinho sem aprovação.
- **Conexão WhatsApp**: mostra se o número está conectado (bolinha
  verde) ou caiu (vermelha). Se cair, "Gerar QR code pra reconectar"
  resolve sozinho, sem precisar chamar suporte técnico. Pra trocar de
  número (ex: trocar de aparelho), "Conectar outro número" — atenção:
  isso desconecta o número atual na hora, só usar quando já tiver o
  celular novo em mãos pronto pra escanear.
- **Pausar/retomar a Lumi pra todo mundo**: botão no topo do painel
  (fora de Configurações) — usar só em situação excepcional (ex: a
  clínica vai fechar por um período), já que ninguém recebe resposta
  automática enquanto estiver pausado.

---

## Perguntas frequentes

**A Lumi pode errar e prejudicar a clínica?**
Ela nunca confirma nada sem checar a agenda de verdade primeiro, e
qualquer coisa fora do que ela sabe resolver vira Pendência pra um
humano decidir — não tem "ela inventou".

**Um paciente reclamou que é robô, o que eu faço?**
Assumir a conversa em Mensagens resolve na hora — a Lumi nunca tenta
esconder que é uma concierge digital, mas nada impede a equipe de assumir
quando fizer sentido.

**Preciso mexer em alguma coisa quando muda o horário de atendimento?**
Sim — Configurações → Horários. É o único lugar que precisa de ajuste
manual quando a rotina da clínica muda.

**O WhatsApp caiu, e agora?**
Configurações → Conexão WhatsApp → Gerar QR code. Sem precisar chamar
ninguém.
