# Roteiro — Vídeo Curto de Demonstração (site + abertura de demo)

2-3 minutos, gravação de tela (WhatsApp + painel), formato recomendado
pro hero do site de comercialização e pra abrir uma call de demo quando
não dá pra digitar ao vivo. Adaptado do `Roteiro_Demo_Vendas.md`
(mensagens 1, 3 e a parte do painel), condensado pra formato passivo —
sem a interação de "adaptar ao vivo" que a demo em call tem.

**Decisão em aberto** (ver `Plano_Comercializacao_Lumi.md` §5): você
narra em voz própria, ou fica só tela + legenda/voz gerada? Este roteiro
funciona nos dois formatos — os textos entre `[ ]` são sugestão de
legenda/narração, ajustar conforme a escolha.

**Fonte de gravação**: `node lumi-harness/demo-server.js` em
`localhost:3200` (interface estilo WhatsApp, prompt real da Dra. Aline —
já documentado como o ativo mais apresentável pra tela, ver
`Roteiro_Demo_Vendas.md`). Nunca usar conversa real de paciente (LGPD).

---

## Cena 1 — Abertura (0:00–0:15)

Tela: logo/nome "Lumi" + frase de abertura.

`[Toda clínica que atende por WhatsApp perde paciente sem perceber —
enquanto ninguém responde, alguém já marcou em outro lugar.]`

## Cena 2 — Conversa acontecendo (0:15–0:50)

Tela: `demo-server.js`, digitando ao vivo (ou já com a conversa
rodando, acelerada):

> "oi, boa tarde" → Lumi responde, pergunta o nome
> "queria marcar uma consulta, vocês tem horário essa semana?" → Lumi
> oferece 2-3 horários reais
> "pode ser o segundo horário" → Lumi confirma

`[Essa é a Lumi respondendo de verdade — sem menu, sem robô genérico. E
ela nunca chuta: se não tiver certeza de qual horário o paciente quis
dizer, ela pergunta de novo em vez de arriscar marcar errado.]`

## Cena 3 — O painel, não só a conversa (0:50–1:40)

**A cena mais importante do vídeo** — é onde "IA Auxilia, IN Dirige"
deixa de ser frase e vira imagem. Cortar da conversa direto pro painel
real (Agenda mostrando o compromisso que acabou de ser criado).

`[Só a conversa é a metade da história. Por trás, existe um painel de
gestão completo — agenda em tempo real, histórico de toda conversa com a
equipe podendo assumir a qualquer momento, e um funil que recupera
sozinho o paciente que começou a marcar e sumiu. Isso é o que nenhum
"chatbot de IA" oferece.]`

Mostrar rapidamente, em sequência (2-3s cada):
- Agenda com o compromisso novo aparecendo
- Mensagens (histórico + botão de assumir)
- Oportunidades (funil de resgate)

## Cena 4 — Fechamento (1:40–2:00)

Tela: frase-síntese + chamada pra ação.

`[IA Auxilia, IN Dirige. A Lumi atende por você — você continua no
controle. Quer ver funcionando na sua clínica?]`

CTA final: WhatsApp/contato do site (ver Fase 4, site ainda não existe).

---

## Notas de produção

- Gravação de tela em 1080p, sem webcam necessária (não depende de você
  aparecer, se optar por não narrar).
- Cortes rápidos (cada cena ≤ tempo indicado) — vídeo de produto converte
  melhor curto e direto do que longo e explicativo.
- Nunca gravar com dado real de paciente em nenhuma tela (Agenda,
  Mensagens) — usar só o ambiente de demo/harness ou dados fictícios.
