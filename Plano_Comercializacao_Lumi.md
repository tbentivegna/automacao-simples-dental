# Plano de Comercialização — Lumi (visão geral, orquestrada)

Este documento é a "ata" do Gerente de Projeto/orquestrador: reúne o que já
existe, o que muda com o MVP do Standalone, e o roadmap do que falta —
visto por 4 lentes (Gerente de Projeto, UI/UX, Back-end/Segurança,
Marketing). Log contínuo de progresso em
[Log_Progresso_Comercializacao.md](Log_Progresso_Comercializacao.md).

**Decisões já tomadas** (não reabrir sem motivo novo):
- Cliente-alvo: clínicas odontológicas.
- Modelo de venda: híbrido — site gera lead/prova, fechamento e onboarding
  continuam manuais por enquanto.
- Case de prova social: Dra. Aline pode ser citada publicamente (formalizar
  autorização com ela antes de publicar qualquer coisa que a nomeie).
- Marca do produto: **Lumi** — já usado consistentemente em todo material
  existente, não "assistente de IA" genérico.
- Pilar central de mensagem (adicionado pelo Tiago, 04/09): **"IA Auxilia,
  IN (Inteligência Natural) Dirige"** — e o painel de gestão (não só a
  conversa) é o maior diferencial competitivo, deve aparecer em primeiro
  lugar em qualquer material, não como resposta a pergunta. Ver
  [Proposta_de_Valor_Lumi.md](Proposta_de_Valor_Lumi.md), o documento-fonte
  dessa mensagem.

---

## 1. O que já existe (não duplicar)

Achado ao revisar o repositório antes de escrever qualquer coisa nova —
grande parte do que normalmente seria a "primeira entrega" já está pronta,
datada de 27/08/2026 (antes do Standalone existir):

| Etapa do funil | Documento | Status |
|---|---|---|
| 1. Geração de lead | [Lista_Leads_e_Outreach.md](Lista_Leads_e_Outreach.md) | Pronto — critério de ICP, canais, pitch por canal. Falta só a lista real de nomes (só sai da sua rede). |
| 2. Qualificação | [Funil_Vendas_Lumi.md](Funil_Vendas_Lumi.md) §2 | Pronto, mas com filtro "usa Simples Dental" que o Standalone torna obsoleto (ver §2 abaixo). |
| 3. Demonstração | [Roteiro_Demo_Vendas.md](Roteiro_Demo_Vendas.md) | Pronto — roteiro de 6 mensagens + `lumi-harness/demo-server.js` (UI estilo WhatsApp em `localhost:3200`) + tabela de objeções. |
| 4. Proposta/preço | [Funil_Vendas_Lumi.md](Funil_Vendas_Lumi.md) §4 | Pesquisa de mercado real (7 concorrentes, preços públicos) + faixa sugerida (Basic R$400-600, Pro R$900-1.200, Setup R$800-1.500). Falta travar os números finais. |
| 6. Entrevista de personalização | [Roteiro_Entrevista_Personalizacao.md](Roteiro_Entrevista_Personalizacao.md) | Pronto — 7 blocos, alimenta o template de prompt e a tela Configurações. |
| 7. Onboarding técnico | [Checklist_Onboarding_Nova_Clinica.md](Checklist_Onboarding_Nova_Clinica.md) | Pronto, mas escrito só pra variante Simples Dental (ver §2). |

**Conclusão prática**: não vamos reescrever nada disso. O trabalho real
agora é (a) integrar o Standalone nesse funil já existente, e (b) preencher
os gaps genuinamente novos — site público, manual de uso pro dia a dia da
clínica (diferente do roteiro de venda), e formalizar o que hoje só é
afirmado no pitch (isolamento de dados, segurança, SLA).

---

## 2. Achado principal desta rodada (Marketing + PM)

Toda a qualificação de lead hoje é **bloqueante em "usa Simples Dental"**:

> *"Usa Simples Dental? (bloqueante — outro sistema é projeto novo, não
> venda padrão)"* — Funil_Vendas_Lumi.md §2

Isso fazia sentido quando só existia a variante integrada (Playwright
contra o Simples Dental de verdade). O que fechamos nesta sessão
([[project_standalone_bridge]] no histórico) é justamente o produto pra
quem **não** usa Simples Dental — `public.consultas` como fonte única de
verdade, zero dependência de sistema externo, e — ponto comercial
importante — onboarding tecnicamente **mais simples e mais rápido** que a
variante integrada (nada de calibrar login/Playwright contra um sistema de
terceiros).

**Isso muda três coisas concretas no funil**:

1. **ICP se expande** — de "clínica que já usa Simples Dental" pra
   "qualquer clínica odontológica pequena/média que atende por WhatsApp",
   com ou sem sistema de agenda. O filtro de qualificação vira uma
   bifurcação, não um bloqueio: "usa Simples Dental → variante integrada"
   / "não usa nada → variante Standalone".
2. **Objeção-chave muda de sentido** — a resposta pronta pra "preciso
   trocar de sistema de agenda?" (Roteiro_Demo_Vendas.md) hoje é
   defensiva ("não, ela opera dentro do que você já usa... se não usar
   Simples Dental, fora do escopo padrão"). Com o Standalone, essa
   pergunta vira **vantagem**: "não precisa ter nenhum sistema, a gente
   monta tudo pra você."
3. **Setup fee pode (deve?) ser diferente por variante** — a lógica de
   cobrar setup alto (Funil_Vendas_Lumi.md §4) foi construída em cima do
   onboarding mais pesado (Playwright calibrado por clínica). Standalone
   tem onboarding mais leve — vale reconsiderar um setup menor (ou até
   isento) como diferencial competitivo justamente no segmento hoje
   inacessível (quem não tem sistema nenhum tende a ser clínica menor,
   mais sensível a preço de entrada).

---

## 3. Gaps reais — o que falta, por lente

### Marketing
- [x] Atualizar `Funil_Vendas_Lumi.md` §2-4 pra bifurcar
  Simples-Dental-integrado vs. Standalone (qualificação, objeção, preço) —
  feito 04/09. Setup fee diferenciado por variante é hipótese desta
  rodada, ainda não validada.
- [x] Value proposition formal e curta — feito 04/09, ver
  [Proposta_de_Valor_Lumi.md](Proposta_de_Valor_Lumi.md). Reforçada com o
  pilar "painel > chatbot" + "IA Auxilia, IN Dirige" a pedido do Tiago,
  propagada também pro `Roteiro_Demo_Vendas.md` (mostrar o painel virou
  parte proativa do roteiro, não resposta condicional) e pro
  `Funil_Vendas_Lumi.md` §4.
- [ ] Site de comercialização — **não existe hoje nenhuma página pública**.
  Formato proposto na Fase 3 abaixo.
- [ ] Formalizar autorização da Dra. Aline pra uso público do case
  (mensagem/termo simples, não precisa ser jurídico pesado nesta fase).

### UI/UX
- [ ] Revisão do painel com olhar de "alguém vendo pela primeira vez, não
  é dev" — a aba Conexão WhatsApp (autosserviço de reconexão/troca de
  número) é literal desta sessão, nunca foi vista por ninguém de fora.
- [ ] Definir formato de manual pro **uso diário da equipe da clínica**
  (recepcionista/dentista usando o painel) — diferente do
  Roteiro_Demo_Vendas.md, que é pra convencer um lead a comprar, não pra
  ensinar quem já comprou a usar Agenda/Mensagens/Configurações no
  dia a dia.
- [ ] Recomendação de formato por público (ver §4, Fase 3).

### Back-end / Segurança — ✅ Fase 2 escrita 04/09/2026, ver [Prontidao_Tecnica_Comercializacao.md](Prontidao_Tecnica_Comercializacao.md)
- [x] Isolamento multi-tenant formalizado (banco+role+WhatsApp+chaves
  dedicados por clínica) — verificado no código, seguro pra virar texto
  público.
- [x] LGPD — rascunho mínimo escrito; gap real identificado: sem política
  de retenção/exclusão a pedido do titular ainda.
- [x] SLA — texto honesto proposto (sem número de uptime prometido).
- [ ] **Backup/disaster recovery — gap real, confirmado (não achei
  nenhuma rotina no código), aguardando você confirmar se existe
  snapshot automático no Easypanel/VPS por fora da aplicação.** Isso é
  risco de produção hoje (dado real de paciente), não só item de
  checklist de venda — não vou decidir isso sozinho.

### Gerente de Projeto (orquestração)
- [ ] Manter [Log_Progresso_Comercializacao.md](Log_Progresso_Comercializacao.md)
  atualizado a cada entrega/decisão.
- [ ] Sequenciar as fases abaixo, evitando trabalho paralelo que gere
  retrabalho (ex: não desenhar o site antes da value proposition estar
  fechada).

---

## 4. Roadmap de fases

**Fase 1 — Fechar a lacuna do Standalone no funil existente** (Marketing) — ✅ feito 04/09/2026
Qualificação/objeção/preço atualizados pra cobrir as duas variantes,
value proposition formal escrita com "painel > chatbot" + "IA Auxilia, IN
Dirige" como pilar central.

**Fase 2 — Prontidão técnica pra vender de verdade** (Back-end/Segurança) — ✅ escrita 04/09/2026, 🔴 1 pendência real
Isolamento multi-tenant, LGPD e SLA formalizados — ver
[Prontidao_Tecnica_Comercializacao.md](Prontidao_Tecnica_Comercializacao.md).
Backup/disaster recovery fica **bloqueado até você confirmar** se existe
snapshot automático no Easypanel/VPS (não achei nenhuma rotina no
código) — não decidi isso sozinho porque é risco de dado real de
paciente, não só rumo comercial.

**Fase 3 — Manuais e formatos** (UI/UX + PM)
Recomendação (a validar com você):
- **Vídeo curto (2-3 min)** — pro site e pra abertura de demo, mostrando o
  fluxo real (mesmo estilo do `demo-server.js`, mas gravado). Vídeo
  converte melhor que texto pra "ver funcionando" — é literalmente o
  argumento central do Roteiro_Demo_Vendas.md.
- **PDF/página curta (1-2 páginas)** — guia rápido de uso diário pra
  equipe da clínica (Agenda, Mensagens, pausar a Lumi, reconectar
  WhatsApp) — referência que a recepcionista consulta sozinha, sem
  precisar te chamar.
- **FAQ vivo dentro do próprio painel** (ex: seção nova em Configurações)
  — menor esforço de manutenção que PDF solto (não fica desatualizado
  silenciosamente).

**Fase 4 — Site de comercialização** (UI/UX + Marketing, depois da Fase 1)
Vitrine pública: proposta de valor, como funciona, case Aline (após
autorização), captura de lead (WhatsApp direto ou formulário — modelo
híbrido não precisa de checkout). Posso prototipar como página pra você
revisar antes de decidir domínio/hospedagem definitiva.

**Fase 5 — Ir a mercado** (Marketing + você)
Já documentado em `Lista_Leads_e_Outreach.md` — falta a lista real de
nomes e a decisão de pedir o post da Dra. Aline antes de outreach frio.

---

## 5. Decisões em aberto (preciso de você)

**Prioridade real, não só de marketing**:
- 🔴 **Backup/disaster recovery do Postgres compartilhado — existe
  snapshot automático no Easypanel/VPS, por fora da aplicação?** Não
  encontrei nenhuma rotina no código (ver
  `Prontidao_Tecnica_Comercializacao.md` §3). Se a resposta for "não",
  isso precisa ser resolvido antes de vender pra mais alguém — é risco
  de perda de dado real de paciente hoje, inclusive em produção.

**Decisões de rumo comercial** (menor urgência):
- Setup fee pro Standalone: manter igual à variante integrada, ou reduzir
  como diferencial de entrada (ver §2, ponto 3)?
- Vídeo de demo: você aparece narrando, ou só a tela (WhatsApp + painel)
  com legenda/voz gerada?
- Domínio do site comercial: novo domínio próprio, ou subdomínio de
  `tbentivegna.com.br`?

## Próximo passo imediato

Sugiro começar pela **Fase 1** (atualizar o funil pro Standalone + escrever
a value proposition) — é rápido, não depende de mais nenhuma decisão sua, e
destrava as Fases 3-4. Topa que eu já comece por aí?
