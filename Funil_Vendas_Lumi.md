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

**Pronto** — `Lista_Leads_e_Outreach.md`: critério de prospecção (ICP), onde procurar, e pitch pronto pra cada canal (indicação, outreach direto, conteúdo). **Falta preencher**: a lista real de 10-20 nomes/contatos — isso só sai da rede real da Dra. Aline + prospecção ativa, não dá pra fabricar sozinho.

## 2. Qualificação

Existe um **filtro técnico obrigatório**, não negociável — já está no checklist (seção 0), mas cabe repetir aqui porque é o primeiro filtro do funil, antes até de agendar demo:

- [ ] Usa **Simples Dental**? (bloqueante — outro sistema é projeto novo, não venda padrão)
- [ ] Tem ou topa criar um WhatsApp Business dedicado?
- [ ] Volume de mensagens/pacientes que justifique o investimento (uma clínica com poucochíssimo movimento talvez não tenha ROI claro — vale ter um piso mental, mesmo que informal)

**Falta decidir**: um piso de volume/faturamento abaixo do qual não vale a pena vender (pra não gastar seu tempo de onboarding num cliente que não vai perceber valor).

## 3. Demonstração

**Pronto** — `Roteiro_Demo_Vendas.md`: sequência de 6 mensagens pra digitar ao vivo no harness (saudação, dúvida sobre tratamento, agendamento completo, recusa de procedimento não oferecido, urgência/dor, teste de estresse pra lead técnico), com o que comentar depois de cada resposta, como mostrar o painel (funil de resgate é o diferencial mais forte), e uma tabela de objeções comuns com resposta pronta.

O ativo mais forte é **mostrar a Lumi de verdade** (harness, ao vivo, prompt real da Dra. Aline), não um mockup — nunca usar print/trecho de conversa real de paciente (LGPD).

## 4. Proposta e precificação

**Pesquisa de mercado (2026-08-27)** — concorrentes diretos de IA no WhatsApp pra clínica odontológica/saúde no Brasil, com preço público:

| Empresa | Entrada | Meio | Topo | Taxa de setup |
|---|---|---|---|---|
| [WSeller](https://wseller.co/vendedor-ia-clinica-whatsapp/) | R$ 97/mês | — | — | não divulga |
| [NEXA IA](https://nexaautomacao.com.br/) | R$ 397/mês | — | "Sob consulta" | sem taxa (declarado) |
| [Secretária Odonto](https://secretariaodonto.com.br/) | R$ 297/mês¹ | R$ 497/mês¹ | R$ 997/mês¹ | **tem taxa**, valor conforme complexidade do plano |
| [Agiliza Clínica](https://agilizaclinica.com.br/precos/) | R$ 497/mês | R$ 997/mês | R$ 1.997/mês | sem taxa (declarado) |
| [Densya](https://densya.com.br/)² | R$ 149,90/mês | R$ 199,90/mês | — | sem taxa (declarado) |
| [Clinia](https://clinia.io/planos) | "sob consulta" | "sob consulta" | "sob consulta" | não divulga nenhum valor |
| [Secretária IA](https://usesecretariaia.com/) | plano único, "sob consulta" | — | — | não divulga |

¹ preço promocional (50% off do "de tabela" R$597/997/1997 — o "de tabela" é provavelmente o número real a comparar).
² Densya é sistema de gestão completo (agenda/prontuário/financeiro), com IA de WhatsApp só no plano mais caro — não é concorrente direto puro, mais barato porque a IA não é o produto principal.

**Padrão que se repete**: 3 faixas (entrada ~R$300–500, meio ~R$500–1.000, topo "fale conosco"/multi-unidade). Quem tem integração mais profunda (Secretária Odonto) cobra setup separado; quem não cobra parece ter onboarding mais leve/self-service.

**Leitura pro nosso caso**:
- **Cobrar taxa de setup, sim** — nosso onboarding não é self-service (é o checklist inteiro: provisionar banco, clonar 3 workflows, robô com Playwright logado de verdade no Simples Dental). O comparável certo é a Secretária Odonto, não o WSeller/NEXA (que parecem ter integração mais leve).
- **Não competir pelo preço de entrada mais baixo** — R$97 (WSeller) é claramente plano-isca, não referência de valor real. Diferenciais que nenhum concorrente pesquisado divulgou ter: integração de verdade com o sistema de gestão (não um widget de agenda à parte), funil de resgate proativo (win-back automático de quem começou a agendar e sumiu), e uma **rotina própria de monitoramento com IA** — health-check automatizado rodando 3x/dia, avisando só quando há problema real, com humano no comando das decisões. Isso é operação madura, não só um chatbot — vale mais que o topo da faixa encontrada, não o meio.
- **Capacidade é o limite real, não o preço** — hoje é 1 pessoa fazendo onboarding técnico. Preço baixo demais + demanda alta vira gargalo de suporte antes de virar problema de vendas.

**Estrutura sugerida** (proposta, não valor fechado — ajustar com custo real de hospedagem + quanto vale a hora de suporte):
- **Basic**: R$ 400–600/mês — 1 profissional, funcionalidades centrais (agendar/cancelar/remarcar/lembrete)
- **Pro**: R$ 900–1.200/mês — múltiplos profissionais, funil de resgate, painel completo (Analytics, Oportunidades, Mensagens)
- **Advanced**: "Fale conosco" — multi-unidade, integrações extras
- **Setup**: R$ 800–1.500 único, escalando com o plano (mesmo racional da Secretária Odonto)

**Falta decidir**: confirmar/travar os números acima, e se existe um período de teste/trial antes do compromisso.

## 5. Fechamento

Pouco a inventar aqui além do óbvio (aceite formal, primeira cobrança) — mas o gatilho de **transição pra etapa 6** deveria ser automático: fechamento assinado → agenda a call de Entrevista Estratégica em até X dias, enquanto o entusiasmo do lead ainda está alto.

## 6. Entrevista de personalização

**Pronto** — `Roteiro_Entrevista_Personalizacao.md`: call de 45-60min com o dono, 7 blocos de pergunta (identidade, o que atende/não atende, tom, primeira consulta/preço, horários, regras específicas, operacional), com a ficha de captura rápida no final. Alimenta direto o `Template_Prompt_Assistente_IA.md` e a tela de Configurações do painel.

## 7. Onboarding técnico

Já 100% documentado — `Checklist_Onboarding_Nova_Clinica.md`, seções 2-4 (provisionamento, teste, ativação).

## 8. Pós-venda / expansão

- **Follow-up ~2 semanas depois** (já previsto no checklist) — coletar resultado real e depoimento.
- **Pedido de indicação estruturado**: não deixar implícito — depois do depoimento positivo, perguntar diretamente se ela conhece outro dentista que se beneficiaria, oferecendo algo em troca (desconto na mensalidade dela, por exemplo).
- **Upsell futuro**: conforme o produto cresce (ex: mais telas no painel admin), clientes antigos são candidatos naturais a pacotes maiores.

**Falta decidir**: se existe algum incentivo formal de indicação (desconto, comissão).

---

## Prioridade sugerida pro que falta construir

1. ~~Roteiro da Entrevista de personalização~~ pronto (etapa 6) — `Roteiro_Entrevista_Personalizacao.md`.
2. ~~Modelo de precificação~~ pesquisa de mercado feita e faixa sugerida (etapa 4) — falta só travar os números finais.
3. ~~Roteiro de demo~~ pronto (etapa 3) — `Roteiro_Demo_Vendas.md`.
4. ~~Pitch de outreach~~ pronto (etapa 1) — `Lista_Leads_e_Outreach.md`. Falta só a lista real de nomes, que só sai de você.

Todos os itens da fila original estão prontos. O que resta é decisão sua (travar preço, puxar a lista de nomes) ou execução (rodar a primeira demo/venda de verdade) — a partir daqui o funil amadurece com a experiência real, não com mais documento.
