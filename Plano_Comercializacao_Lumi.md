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
- [x] Manual de uso diário escrito — [Manual_Uso_Diario_Equipe.md](Manual_Uso_Diario_Equipe.md)
  (Agenda, Mensagens, Atendimento Humano, Pendências, Oportunidades,
  Analytics, Configurações + FAQ curto). Fonte pro formato final (PDF ou
  página) a decidir.
- [x] Roteiro de vídeo curto escrito — [Roteiro_Video_Demo_Site.md](Roteiro_Video_Demo_Site.md),
  2-3min, adaptado do roteiro de demo pra formato passivo (site + abertura
  de call). Gravação em si depende de você (webcam/narração ou não —
  decisão em aberto).
- [x] Revisão rápida do login/branding com olhar de primeira vez — achado
  real: a logo (`logo-lumi.png`) tem "CONCIERGE DIGITAL — DRA. ALINE
  BENTIVEGNA" **desenhado dentro da imagem** (pixel, não texto). A
  variável `NOME_CLINICA` (`admin-panel/server.js:68`,
  `branding.js:18-22`) só atualiza o título da aba e o `alt` da imagem
  (invisível pra quem enxerga) — o texto visível continua sendo o nome
  real da Dra. Aline em QUALQUER instalação, inclusive o painel_demo.
  Isso contradiz a persona fictícia já construída pro demo
  (`scripts/variaveis-clinica-demo.json`, "Dra. Camila Duarte"), e não
  escala pra vender pra um 2º/3º cliente (exigiria gerar uma imagem nova
  por clínica). **Não corrigi ainda** — é asset de marca visual usado
  também no painel de produção da Dra. Aline, prefiro seu ok antes de
  mexer. Recomendação: trocar por uma logo genérica "Lumi" (sem nome
  embutido) + nome da clínica como texto HTML de verdade ao lado
  (dinâmico via `NOME_CLINICA`, mesmo padrão que título/alt já usam).
  Revisão mais ampla do painel (Conexão WhatsApp e outras telas com olhar
  de primeira vez) ainda não feita.
- [ ] FAQ dentro do próprio painel (proposto no plano original) — não
  construído ainda, é mudança de código/feature nova, não conteúdo. Fica
  como item de backlog pra quando fizer sentido priorizar (o manual em
  markdown já cobre a mesma necessidade por enquanto).

### Back-end / Segurança — ✅ Fase 2 escrita 04/09/2026, ver [Prontidao_Tecnica_Comercializacao.md](Prontidao_Tecnica_Comercializacao.md)
- [x] Isolamento multi-tenant formalizado (banco+role+WhatsApp+chaves
  dedicados por clínica) — verificado no código, seguro pra virar texto
  público.
- [x] LGPD — rascunho mínimo escrito; gap real identificado: sem política
  de retenção/exclusão a pedido do titular ainda.
- [x] SLA — texto honesto proposto (sem número de uptime prometido).
- [x] **Backup/disaster recovery — resolvido 04/09/2026.** Confirmado com
  você: não existia nenhuma rotina. Construído backup lógico (Node + pg,
  sem depender de `pg_dump`) + restore, testado ponta a ponta de verdade
  (banco novo, migrations, restaurar, comparar linha por linha — 13/13
  tabelas bateram). Ver [Backup_Restauracao.md](Backup_Restauracao.md).
  Falta só você registrar a tarefa agendada (comando pronto no
  documento — ação de sistema que fico bloqueado de fazer sozinho).
  Limitação registrada: backup só no PC local por enquanto, sem
  redundância geográfica ainda.

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

**Fase 2 — Prontidão técnica pra vender de verdade** (Back-end/Segurança) — ✅ concluída 04/09/2026
Isolamento multi-tenant, LGPD e SLA formalizados — ver
[Prontidao_Tecnica_Comercializacao.md](Prontidao_Tecnica_Comercializacao.md).
Backup/disaster recovery resolvido e testado ponta a ponta — ver
[Backup_Restauracao.md](Backup_Restauracao.md). Falta só o Tiago registrar
a tarefa agendada. Com isso, Fase 4 (site) está liberada.

**Fase 3 — Manuais e formatos** (UI/UX + PM) — ✅ conteúdo escrito 04/09/2026
Manual de uso diário e roteiro de vídeo prontos (ver checklist UI/UX
acima). Falta: revisão de UX do painel com olhar de primeira vez, decidir
formato final de publicação do manual (PDF exportado do markdown, ou
página no site), e a gravação do vídeo em si (depende de você).

**Fase 4 — Site de comercialização** (UI/UX + Marketing) — ✅ protótipo publicado 04/09/2026
Vitrine de página única — hero ("IA Auxilia, IN Dirige"), os dois
caminhos (Simples Dental integrado / Standalone), o painel como
diferencial central, confiança (só alegações já confirmadas na Fase 2),
planos sem preço travado, FAQ (adaptado do roteiro de demo), CTA
WhatsApp direto (modelo híbrido, sem formulário — um artifact público
não pode usar a capability `db`, que restringe a página à organização).
Case da Dra. Aline propositalmente sem nome ainda (autorização formal
pendente). **No ar em produção**: https://lumi.tbentivegna.com.br
(deploy 05/09/2026, Easypanel, mesmo padrão dos outros serviços do
monorepo — `site/` como build path, sem env vars). Verificado via curl:
200, título/HTML/logo corretos.

**Fase 5 — Ir a mercado** (Marketing + você)
Já documentado em `Lista_Leads_e_Outreach.md` — falta a lista real de
nomes e a decisão de pedir o post da Dra. Aline antes de outreach frio.

---

## 5. Decisões em aberto (preciso de você)

**Resolvido**:
- [x] Backup/disaster recovery — ver [Backup_Restauracao.md](Backup_Restauracao.md).
  Testado ponta a ponta (banco novo, migrations, restaurar, comparar
  linha por linha). Falta só você registrar a tarefa agendada (1 comando
  pronto no documento — ação de sistema que fico bloqueado de fazer
  sozinho).
- [x] Logo corrigida 04/09 (Tiago autorizou) — nome saiu da imagem, virou
  texto dinâmico (`.marca-lumi-subtitulo`, `branding.js`). **Segue
  pendente**: `NOME_CLINICA` do painel_demo no Easypanel está como "Lumi
  — Demonstração" (frase completa) — com o novo prefixo fixo "Concierge
  Digital —" agora visível, fica redundante. Trocar pra algo tipo
  "Demonstração" no próximo redeploy.

**Decisões de rumo comercial** (menor urgência):
- Setup fee pro Standalone: manter igual à variante integrada, ou reduzir
  como diferencial de entrada (ver §2, ponto 3)?
- Vídeo de demo: você aparece narrando, ou só a tela (WhatsApp + painel)
  com legenda/voz gerada?
- [x] Domínio do site comercial — resolvido 05/09/2026: subdomínio
  `lumi.tbentivegna.com.br`, no ar.
- CTA do site usa o número pessoal do Tiago (5511981174657, já
  estabelecido como canal de contato ao longo do projeto) — confirmar se
  é esse mesmo o número certo pra receber lead de venda antes de
  divulgar o link publicamente.

## Próximo passo imediato

Sugiro começar pela **Fase 1** (atualizar o funil pro Standalone + escrever
a value proposition) — é rápido, não depende de mais nenhuma decisão sua, e
destrava as Fases 3-4. Topa que eu já comece por aí?
