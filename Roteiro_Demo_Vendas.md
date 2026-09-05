# Roteiro de Demo — Etapa 3 do Funil de Vendas

Objetivo: o dentista-lead ver a Lumi respondendo de verdade (não slide, não mockup) e sair convencido de 4 coisas — ela é confiável (nunca inventa, nunca promete o que não confirmou), ela soa humana (não parece bot genérico), ela recupera paciente que outros sistemas perdem (funil de resgate), e — o argumento mais forte pra quem já viu "mais uma IA de WhatsApp" antes — **por trás da conversa existe um painel de gestão completo, não só um bot solto** (ver `Proposta_de_Valor_Lumi.md`: "IA Auxilia, IN Dirige"). Duração: 15-20 min de demo + conversa.

**Como rodar**: `node lumi-harness/demo-server.js` e abrir `http://localhost:3200` — interface com visual de WhatsApp (bolhas, "digitando…", check azul), bem mais apresentável que terminal pra tela compartilhada. Por trás, é a mesma lógica do harness com o prompt real da Dra. Aline (é o único caso afinado hoje — e serve como prova social: "isso está em produção agora, não é protótipo"). Botão "↻ Reiniciar" no cabeçalho limpa a conversa entre uma demo e outra. Nenhuma ação real é executada (tools mockadas, mesmas do harness). Nunca mostrar o arquivo do prompt em si nem o código — só a conversa acontecendo (ver `Roteiro_Entrevista_Personalizacao.md`, proteção de IP).

*(Alternativa mais crua, sem interface: `node lumi-harness/run.js` em modo interativo no terminal — serve se estiver sem tempo de configurar a tela antes de uma call.)*

⚠️ Nunca usar conversas reais de pacientes da Dra. Aline como print/exemplo nesta etapa (LGPD) — só a demo ao vivo com mensagens novas, escritas na hora.

## Sequência sugerida

Digite estas mensagens em ordem (adaptando o tom pra soar natural, não robótico), com uma pausa curta depois de cada resposta pra comentar o que acabou de acontecer:

**1. Saudação (mostra calor/tom natural)**
> "oi, boa tarde"

*Comentário: "Repara que ela não despeja um menu de opções — conversa. E ela pergunta o nome até a 2ª mensagem, sempre, sem exceção — é uma regra rígida porque sem nome não dá pra personalizar nada depois."*

**2. Dúvida real sobre tratamento (mostra competência sem ser vendedora demais)**
> "queria saber como funciona o invisalign"

*Comentário: explica sem forçar agendamento na mesma mensagem — "ela não empurra venda a cada resposta, isso built trust."*

**3. Fluxo de agendamento completo (o coração do produto)**
> "queria marcar uma consulta, vocês tem horário essa semana?"

Depois que ela apresentar 2-3 horários:
> "pode ser o segundo horário"

*Comentário-chave: "Ela nunca chuta. Se a resposta do paciente fosse ambígua tipo 'pode ser' sem apontar qual horário, ela ia perguntar de novo em vez de adivinhar — isso evita marcar errado e depois ter que desmarcar, que é pior pra reputação da clínica do que simplesmente confirmar direito."*

**4. Pedido de algo que a clínica não oferece (mostra segurança/honestidade)**
> "vocês fazem canal?" *(ou outro procedimento não oferecido pela clínica em questão)*

*Comentário: "Ela nunca finge que atende algo que não atende — mas também não simplesmente recusa e manda embora, ela sempre tenta trazer pra consulta primeiro. Isso é calibrado, não é óbvio de fazer bem."*

**5. Urgência/dor (o maior argumento de redução de risco pra clínica de saúde)**
> "estou com uma dor de dente insuportável, o que eu tomo?"

*Comentário-chave, pausar aqui: "Ela NUNCA recomenda medicamento — nem analgésico, nem anti-inflamatório, nada. Isso é proposital: numa clínica de saúde, uma IA prescrevendo remédio errado é risco real, de responsabilidade profissional. Toda urgência vira prioridade máxima pra um humano, sem prometer prazo que não pode cumprir."*

**6. (Se o lead parecer técnico/cético) Teste de estresse**
> "não tem quarta-feira?" *(depois de já ter oferecido outro dia)*

*Comentário: "Ela sempre reconsulta o sistema de verdade antes de responder — nunca 'de memória'. Isso existe porque times competidores de chatbot mais simples respondem baseado no que já disseram antes na conversa, e erram quando a agenda muda no meio do papo."*

## Mostrar o painel — sempre, não só se o lead perguntar

Mudança importante: o painel não é resposta a uma pergunta, é **parte
central do roteiro**, mesmo que ninguém pergunte "e depois, como eu
acompanho?". É onde "IA Auxilia, IN Dirige" deixa de ser frase e vira
coisa que o lead vê com os próprios olhos — abrir com algo como: *"O que
você acabou de ver foi só a conversa. Deixa eu te mostrar o que tem por
trás, porque é aqui que a Lumi é diferente de qualquer IA de WhatsApp que
você já tenha visto."*

- **Mensagens**: histórico de conversa, com opção de a equipe assumir a qualquer momento (mostra que não é IA sem supervisão).
- **Agenda**: visão em tempo real do que está marcado — "isso já é o sistema de vocês, a Lumi só opera nele, vocês não trocam de agenda." *(Se o lead não tiver sistema de agenda hoje: "a gente monta essa agenda do zero pra você, sem precisar de sistema nenhum de terceiro" — ver `Funil_Vendas_Lumi.md` §2, variante Standalone.)*
- **Oportunidades**: o funil de resgate. *Diferencial mais forte pra fechar* — "quando um paciente pergunta preço, começa a marcar e some, a maioria das clínicas simplesmente perde esse paciente. Aqui, depois de um tempo de silêncio, ela manda uma mensagem de resgate sozinha, retomando de onde parou. Nenhum concorrente que pesquisei tem isso."
- **Configurações**: pausar/retomar a Lumi pra todos os pacientes com um clique, e reconectar o WhatsApp sozinho (QR code) sem depender de suporte técnico se o número cair. "Vocês têm o controle inteiro, a qualquer momento — não depende de mim."

## Objeções comuns e como responder

| Objeção | Resposta |
|---|---|
| "E se ela errar e prejudicar a clínica?" | "Ela nunca confirma nada sem checar o sistema de verdade primeiro — não existe 'ela inventou um horário'. E qualquer coisa fora do que ela sabe resolver vira aviso pra um humano, na hora." |
| "Meus pacientes vão perceber que é robô e não gostar?" | Mostrar o tom da demo — "o objetivo nunca foi esconder que é uma concierge digital, é ser útil e rápida. Se quiser, ela pode se apresentar assim logo de cara." |
| "Preciso trocar de sistema de agenda?" | Se já usa Simples Dental: "Não — ela opera dentro do que você já usa, é um robô que mexe no mesmo sistema que sua recepção mexe." Se não usa nenhum sistema: "Não precisa ter nada — a gente monta a agenda pra você desde o início, sem sistema de terceiro no meio." *(As duas são venda padrão hoje, não projeto especial — ver `Funil_Vendas_Lumi.md` §2.)* |
| "E se cair o WhatsApp ou o sistema?" | "Existe monitoramento automatizado rodando várias vezes por dia, avisando quando algo sai do esperado — não é 'sobe e esquece'." |
| "Meus dados ficam seguros?" | "Cada clínica tem banco de dados próprio, isolado — não é uma base compartilhada entre clientes." |

## Fechar a demo

Nunca deixar a demo "morrer" sem próximo passo claro: *"Isso que você viu é exatamente o que está rodando pra Dra. Aline hoje, ao vivo. Faz sentido eu te mandar uma proposta com os planos?"* → transição direta pra etapa 4 (Proposta).
