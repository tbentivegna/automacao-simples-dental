# Funil de Vendas — Lumi (Concierge Digital para Clínicas Odontológicas)

Rascunho inicial, feito pra ser editado com a experiência real de venda (hoje só existe 1 cliente, a Dra. Aline — o funil vai amadurecer com o 2º, 3º cliente). Serve de esqueleto: cada etapa aponta pro material que já existe e pro que ainda falta construir.

## Visão geral das etapas

```
1. Geração de lead  →  2. Qualificação  →  3. Demonstração  →  4. Proposta  →  5. Fechamento
        →  6. Entrevista de personalização  →  7. Onboarding técnico  →  8. Pós-venda / expansão
```

Etapas 6-7 já estão praticamente prontas (`Checklist_Onboarding_Nova_Clinica.md` + `Template_Prompt_Assistente_IA.md`). As etapas 1-5 e a 8 são o que falta estruturar — é onde vale focar agora.

---

## 1. Geração de lead

**Canais mais prováveis pro seu caso, em ordem de força esperada:**
- **Indicação direta da Dra. Aline** — de longe o canal mais barato e mais crível: ela é uma referência viva e funcionando, não um case genérico. Vale formalizar isso (ver seção 8, pedido de indicação estruturado, não só esperar que aconteça sozinho).
- **Outreach direcionado** — dentistas com perfil parecido ao da Aline (clínica pequena/média, atendimento particular, já preocupados com resposta rápida no WhatsApp). LinkedIn e Instagram são os canais naturais pra esse público.
- **Conteúdo** — a própria Dra. Aline postando sobre a experiência com a Lumi (não é você vendendo, é ela mostrando) tende a converter melhor que qualquer post seu de "vendo automação pra dentista".
- **Parcerias/eventos de odontologia** — associações, grupos de dentistas, cursos de gestão de clínica. Canal mais lento de ativar, mas com bom potencial de volume depois.

**Falta construir**: um pitch curto de 1 frase pra cada canal (não é a mesma mensagem pra indicação vs. outreach frio), e uma lista real de 10-20 dentistas-alvo pra começar o outreach direcionado.

## 2. Qualificação

Existe um **filtro técnico obrigatório**, não negociável — já está no checklist (seção 0), mas cabe repetir aqui porque é o primeiro filtro do funil, antes até de agendar demo:

- [ ] Usa **Simples Dental**? (bloqueante — outro sistema é projeto novo, não venda padrão)
- [ ] Tem ou topa criar um WhatsApp Business dedicado?
- [ ] Volume de mensagens/pacientes que justifique o investimento (uma clínica com poucochíssimo movimento talvez não tenha ROI claro — vale ter um piso mental, mesmo que informal)

**Falta decidir**: um piso de volume/faturamento abaixo do qual não vale a pena vender (pra não gastar seu tempo de onboarding num cliente que não vai perceber valor).

## 3. Demonstração

O ativo mais forte que você tem é **mostrar a Lumi de verdade**, não um mockup. Duas formas:
- **Ao vivo, no harness** (`lumi-harness/run.js` em modo interativo) — você digita como se fosse um paciente, o dentista-lead vê a Lumi responder na hora, sem risco de tocar produção.
- **Prints/trecho real de conversa da Dra. Aline** (anonimizado) — prova social concreta, mas cuidado com LGPD: nunca mostrar nome completo/telefone real de paciente sem anonimizar antes.

**Falta construir**: um roteiro de demo (quais mensagens digitar, em que ordem, pra mostrar os pontos fortes — agendamento completo, recusa educada de algo que não é oferecido, urgência tratada com seriedade) — hoje isso ficaria improvisado.

## 4. Proposta e precificação

Não tenho números reais de custo/mercado seus pra cravar um preço — mas dá pra montar o **modelo**, você preenche os valores:

- **Estrutura sugerida**: taxa de setup (cobre a Entrevista + Onboarding técnico, que tem custo real do seu tempo) + mensalidade (cobre hospedagem — Postgres/Evolution/n8n execution/Easypanel — e suporte contínuo).
- **Por que não só mensalidade**: setup técnico (seção 7) não é instantâneo nem grátis pra você — cobrar por ele desde o primeiro cliente evita ensinar o mercado a esperar onboarding de graça.
- **Por que não só taxa única**: hospedagem e sua disponibilidade pra manutenção (como os fixes de hoje) são custo recorrente — sem mensalidade, cada bug futuro vira trabalho não remunerado.

**Falta decidir**: os números (setup + mensalidade), e se existe um período de teste/trial antes do compromisso.

## 5. Fechamento

Pouco a inventar aqui além do óbvio (aceite formal, primeira cobrança) — mas o gatilho de **transição pra etapa 6** deveria ser automático: fechamento assinado → agenda a call de Entrevista Estratégica em até X dias, enquanto o entusiasmo do lead ainda está alto.

## 6. Entrevista de personalização

Já existe em rascunho — `Checklist_Onboarding_Nova_Clinica.md`, seção 1. Alimenta direto o `Template_Prompt_Assistente_IA.md` e a tela de Configurações do painel.

**Falta** (próxima tarefa que você mencionou): transformar essas perguntas soltas num roteiro de call de verdade — ordem, como formular cada pergunta de um jeito que não pareça formulário, e o que fazer com cada resposta.

## 7. Onboarding técnico

Já 100% documentado — `Checklist_Onboarding_Nova_Clinica.md`, seções 2-4 (provisionamento, teste, ativação).

## 8. Pós-venda / expansão

- **Follow-up ~2 semanas depois** (já previsto no checklist) — coletar resultado real e depoimento.
- **Pedido de indicação estruturado**: não deixar implícito — depois do depoimento positivo, perguntar diretamente se ela conhece outro dentista que se beneficiaria, oferecendo algo em troca (desconto na mensalidade dela, por exemplo).
- **Upsell futuro**: conforme o produto cresce (ex: mais telas no painel admin), clientes antigos são candidatos naturais a pacotes maiores.

**Falta decidir**: se existe algum incentivo formal de indicação (desconto, comissão).

---

## Prioridade sugerida pro que falta construir

1. Roteiro da Entrevista de personalização (etapa 6) — você já sinalizou que é o próximo passo.
2. Modelo de precificação com números reais (etapa 4) — sem isso, não dá pra fechar venda nenhuma.
3. Roteiro de demo (etapa 3).
4. Lista de leads-alvo + pitch de outreach (etapa 1).
