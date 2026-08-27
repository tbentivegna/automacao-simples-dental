# Roteiro — Entrevista de Personalização (call de kickoff pós-fechamento)

Etapa 6 do [Funil_Vendas_Lumi.md](Funil_Vendas_Lumi.md), logo depois do fechamento (etapa 5) — agendar em até poucos dias, com o entusiasmo do cliente ainda alto. Alimenta direto o [Template_Prompt_Assistente_IA.md](Template_Prompt_Assistente_IA.md) e a tela "Configurações" do painel admin.

**Com quem**: o próprio dono/responsável clínico (não a recepcionista) — é ele quem define tom, limites e regras de negócio; delegar isso perde qualidade.
**Duração**: 45–60 min.
**Formato**: chamada de vídeo/voz, não formulário escrito — as melhores respostas (tom, o que não oferecer, hesitações) saem de conversa, não de campo de texto.

## Antes da call

- [ ] Confirmar duração e pedir pra reservar sem interrupção (é uma call de decisão, não de bastidor).
- [ ] Avisar os temas com antecedência (por mensagem curta), pra ele já vir pensando: nome/especialidades, o que a clínica não atende, preço da primeira consulta, horários de atendimento.
- [ ] **Nunca pedir login/senha do Simples Dental nesta call** (nem por escrito, nem falado) — combinar um canal separado e seguro pra isso depois (ex: gerenciador de senha compartilhado), fora do roteiro de personalização.

## Abertura (3 min)

Framing sugerido: *"Essa conversa vai definir como a [nome da assistente] vai soar e se comportar representando você — quanto mais detalhe você me der agora, mais ela vai parecer você mesmo(a) conversando, e menos vai precisar de ajuste depois. Não existe resposta errada aqui, é sobre como VOCÊ atende hoje."*

Avisar o formato: vai ser uma conversa, não um formulário — ele fala livre, quem organiza é você.

## Bloco 1 — Identidade profissional

*(alimenta `{{NOME_PROFISSIONAL}}`, `{{REGISTRO_PROFISSIONAL}}`, `{{ESPECIALIDADES_RESUMO}}`, `{{PRECISAO_CREDENCIAIS}}`)*

- "Como você quer que a assistente te apresente pro paciente? Nome completo e o registro (CRO, CRM, CRP)?"
- "Quais são suas especialidades de verdade — as que você pode falar com confiança total?"
- "Tem alguma área onde você atua mas **não** tem título de especialista? Isso importa — a assistente nunca pode exagerar seu nível de expertise, mesmo que pareça mais vendedor. Como você prefere que ela descreva isso?" (ex: "atua com" em vez de "especialista em")
- "Tem algum limite técnico dentro de uma especialidade que o paciente costuma perguntar errado? (ex: só alinhador invisível, não aparelho fixo)"

## Bloco 2 — O que a clínica atende (e o que não atende)

*(alimenta `{{DESCRICOES_TRATAMENTOS}}`, `{{MOTIVOS_CONSULTA_EXEMPLOS}}`, `{{PROCEDIMENTOS_NAO_OFERECIDOS}}`)*

- "Quais os 4-6 tratamentos que mais aparecem no seu dia a dia? Me descreve cada um em 1 frase, como você explicaria pro paciente."
- "Existe algo que as pessoas pedem com frequência que você **não faz**? (ex: canal, prótese, um procedimento específico)" — importante: a assistente nunca pode dizer que a clínica faz algo que não faz, nem mandar o paciente embora sem oferecer a consulta primeiro.
- "Atende criança? Se sim, tem algum diferencial específico pra atendimento infantil, ou seria igual ao adulto?"

## Bloco 3 — Tom de voz e personalidade

*(alimenta `{{TOM_DE_VOZ}}`, e qualquer módulo tipo "palavra proibida")*

- "Se eu te desse 5 palavras pra descrever como você atende pessoalmente, quais seriam?"
- "Tem alguma palavra ou expressão que você **odeia** que usem pra descrever seu trabalho?" (o caso real da Dra. Aline foi a palavra "avaliação")
- "Formal ou próximo? Emoji sim ou não? Você mesmo, ao vivo, fala assim com paciente novo?"

## Bloco 4 — Primeira consulta e preço

*(alimenta `{{DESCRICAO_PRIMEIRA_CONSULTA}}`, `{{PRECO_PRIMEIRA_CONSULTA}}`, módulo Particular/Convênio)*

- "O que acontece na primeira consulta, na prática? Quanto tempo dura, o que está incluso?"
- "Qual o valor da primeira consulta hoje? Tem retorno incluso, por quanto tempo?"
- "Vocês atendem convênio ou é só particular?" — se atender convênio, essa seção do prompt muda inteira (não é ajuste pontual).
- "Tem algum procedimento com preço à parte que costuma confundir o paciente (ex: limpeza não incluída na consulta)?"

## Bloco 5 — Horários e agenda

*(alimenta a tela **Configurações** do painel — `public.configuracao_horarios` — e `{{RESUMO_DIAS_ATENDIMENTO}}` no prompt)*

- "Quais dias você atende, e em qual período (manhã/tarde)?"
- "Quanto tempo dura uma consulta normal?"
- "Tem algum dia que só abre de vez em quando (ex: sábado quinzenal)? Me dá uma data recente que teve expediente nesse dia, pra eu usar de referência."

⚠️ Preencher direto na tela Configurações do painel logo depois da call (não deixar só no papel) — evita a mesma informação ficar desatualizada em dois lugares.

## Bloco 6 — Regras específicas do negócio

*(alimenta `{{REGRAS_ESPECIFICAS}}`)*

- "Tem alguma regra própria sua que não é óbvia? (idade mínima, exige responsável presente, não atende sem documento, etc.)"
- "Já teve alguma situação constrangedora com paciente que você gostaria que a assistente evitasse?" — pergunta boa pra puxar regra que ele nem pensaria em mencionar sozinho.

## Bloco 7 — Operacional

*(alimenta `{{ENDERECO_CONSULTORIO}}`, `{{LINK_MAPS}}`, `{{CANAL_DESPEDIDA}}`, número de handoff humano, instância do WhatsApp)*

- "Endereço completo do consultório, do jeito que você quer que apareça pro paciente?"
- "Qual rede social você quer que a assistente mencione na despedida?"
- "Qual número de WhatsApp deve receber quando a assistente precisar acionar um humano — o seu, da recepção, ou de outra pessoa da equipe?"
- "Vocês já têm um número de WhatsApp Business dedicado pra isso, ou vamos criar um novo?"

## Fechamento da call (5 min)

- Alinhar prazo: quando ele recebe o primeiro rascunho do prompt pra revisar (**"aprovação da voz"**, ver Checklist seção 3-4 — ele aprova antes de qualquer paciente real ver).
- Deixar claro que ajustes de tom depois do lançamento são normais e esperados, não sinal de que algo deu errado.
- Combinar o canal seguro pra troca de credenciais do Simples Dental (fora desta call).

---

## Ficha de captura rápida (preencher ao vivo, uma por clínica)

| Campo | Resposta |
|---|---|
| Nome completo + registro | |
| Especialidades (confiança total) | |
| Áreas sem título formal (cuidado ao descrever) | |
| Tratamentos + descrição curta de cada um | |
| Procedimentos NÃO oferecidos | |
| Atende criança? Diferencial? | |
| 5 palavras de tom | |
| Palavra(s) proibida(s) | |
| Descrição da primeira consulta | |
| Preço da primeira consulta | |
| Atende convênio? Qual? | |
| Dias/períodos de atendimento | |
| Duração da consulta | |
| Dia com expediente irregular (ex: sábado quinzenal) + data de referência | |
| Regras específicas do negócio | |
| Endereço completo | |
| Rede social pra despedida | |
| Número de WhatsApp do handoff humano | |
| Já tem WhatsApp Business dedicado? | |
