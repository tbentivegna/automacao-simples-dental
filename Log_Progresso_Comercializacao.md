# Log de Progresso — Comercialização da Lumi

Diário de bordo do Gerente de Projeto/orquestrador — cada entrada é uma
entrega, decisão ou marco. Ordem cronológica, mais recente no topo. Plano
geral em [Plano_Comercializacao_Lumi.md](Plano_Comercializacao_Lumi.md).

---

## 2026-09-04 — Fase 4: protótipo do site publicado

Tiago autorizou seguir ("Pode seguir") depois de Fase 2 fechada. Construí
o site de comercialização (página única): hero com "IA Auxilia, IN
Dirige", os dois caminhos de qualificação (Simples Dental / Standalone),
o painel como diferencial central (vitrine dos 6 recursos: Agenda,
Mensagens, Oportunidades, Analytics, Pendências, Configurações), seção
de confiança (só as alegações já confirmadas na Fase 2 -- isolamento
multi-tenant, monitoramento, backup testado -- nenhuma promessa de SLA
numérico), planos (Basic/Pro/Advanced) sem preço travado, FAQ adaptado
do `Roteiro_Demo_Vendas.md`, CTA WhatsApp direto em toda a página.

**Decisão de design**: sem formulário de captura de lead -- um artifact
público não pode declarar a capability `db` (torna a página restrita à
organização, incompatível com compartilhar publicamente com prospect).
CTA é só `wa.me` com mensagem pré-preenchida, consistente com o modelo
híbrido já decidido.

**Case da Dra. Aline propositalmente genérico** -- autorização formal
dela ainda não foi confirmada nesta conversa, então o site não a nomeia
nem fabrica depoimento nenhum em nome dela -- só "em uso real, em
produção, numa clínica odontológica".

**Identidade visual**: reaproveitada a logo real (recém-corrigida) e a
mesma paleta/tipografia (Playfair Display + Raleway, dourado sobre
fundo escuro) já usada na tela de login do painel de verdade -- não
inventei uma identidade nova pro site.

Publicado como Artifact privado pra revisão:
https://claude.ai/code/artifact/34e3b332-c8d9-4f2b-8bcd-c3f5f7ae2596 --
não consegui verificar visualmente eu mesmo (o browser desta sessão não
tem login no Claude, artifact privado exige autenticação do dono);
validei via checagem de HTML bem-formado (tags balanceadas, zero
placeholder sobrando) em vez de screenshot. Fonte versionada em
`site/index.html` + `site/assets/logo-lumi.png` (caminho relativo, sem
o base64 embutido que o artifact usa).

**Decisões em aberto novas**: confirmar se o número de WhatsApp do CTA
(pessoal do Tiago) é o certo antes de divulgar o link; domínio/hospedagem
definitiva.

---

## 2026-09-04 — Backup/disaster recovery resolvido, testado ponta a ponta

Tiago confirmou: não existia nenhuma rotina de backup mesmo. Construído
`scripts/backup-postgres.js` (exporta todas as linhas de cada tabela em
JSON+gzip -- schema já é recuperável via `db/migrations/`, não precisa
de `pg_dump`, que nem está instalado nesta máquina) e
`scripts/restore-postgres.js` (restaura numa transação única, tudo ou
nada).

**Testado de verdade, não só código**: criado um banco novo do zero,
rodadas as 13 migrations, restaurado um backup real nele, comparada a
contagem de linha de cada uma das 13 tabelas contra o original -- bateu
exato em todas. Banco de teste removido depois. Rodado um backup real de
produção na sequência: 2.959 linhas, 13 tabelas, ~163KB comprimido.

`scripts/run-backup.ps1` (mesmo padrão do `run-health-check.ps1`, mas
sem passar por Claude -- é mecânico, não precisa de julgamento) roda o
backup e alerta por WhatsApp (mesmo canal do health-check) se falhar.
Documentado em `Backup_Restauracao.md`, com o comando exato de
`Register-ScheduledTask` pro Tiago rodar (registrar tarefa agendada é
ação de sistema que fico bloqueado de fazer sozinho, mesma razão do
health-check).

**Limitação registrada, não resolvida agora**: backup fica só no PC
local por enquanto -- protege contra o Postgres/VPS cair, não contra o
PC do Tiago falhar no mesmo dia. Redundância geográfica de verdade
(upload pra storage externo) fica pra quando ele quiser priorizar.

Com isso, **Fase 2 está 100% concluída** e a Fase 4 (site) está
liberada.

---

## 2026-09-04 — Logo corrigida (autorizado pelo Tiago)

Nome da Dra. Aline removido dos pixels da logo (`logo-lumi.png`) via
edição cirúrgica (Python/PIL, região x=[90,545] y=[378,401] apagada,
anel dourado e palavra "Lumi" preservados intactos, verificado pixel a
pixel antes/depois e visualmente). Nome da clínica volta como texto HTML
de verdade (`.marca-lumi-subtitulo`), dinâmico via `NOME_CLINICA` — login
e barra lateral (não no topo mobile compacto).

**Pendência pro próximo redeploy**: `NOME_CLINICA` do painel_demo hoje é
`"Lumi — Demonstração"` (frase completa, herdada de quando só alimentava
título da aba/alt invisível) — com o prefixo fixo "Concierge Digital —"
agora visível, fica redundante. Trocar essa env var no Easypanel pra algo
tipo "Demonstração".

---

## 2026-09-04 — Fase 3: manuais escritos + achado de branding no login

**Entregue**: `Manual_Uso_Diario_Equipe.md` (guia de uso do painel pra
equipe da clínica — Agenda, Mensagens, Atendimento Humano, Pendências,
Oportunidades, Analytics, Configurações, FAQ) e
`Roteiro_Video_Demo_Site.md` (roteiro de vídeo de 2-3min pro site,
condensado do roteiro de demo, com a cena do painel como ponto alto).

**Achado ao revisar o painel_demo com olhar de primeira vez** (login):
a logo (`admin-panel/public/assets/logo-lumi.png`) tem "CONCIERGE DIGITAL
— DRA. ALINE BENTIVEGNA" desenhado dentro da própria imagem — a variável
`NOME_CLINICA` só troca o título da aba e o `alt` (invisível), então o
texto visível continua sendo o nome real da Aline em qualquer instalação,
inclusive o demo. Contradiz a persona fictícia já construída
(`Dra. Camila Duarte`) e não escala pra novos clientes. Não corrigido —
é asset visual também usado na produção real da Aline, fica registrado
como decisão em aberto (`Plano_Comercializacao_Lumi.md` §5) em vez de
mexido sem confirmar.

**Status das fases**: 1, 2 e 3 com conteúdo entregue. Fase 4 (site)
represada até resolver o backup (Fase 2). Fase 5 (ir a mercado) já
documentada desde 27/08, sem novidade.

---

## 2026-09-04 — Fase 2: prontidão técnica escrita, 1 pendência real levantada

**Entregue**: `Prontidao_Tecnica_Comercializacao.md` — isolamento
multi-tenant formalizado (verificado no código: banco+role+WhatsApp+chave
dedicados por clínica, seguro pra virar texto público), rascunho mínimo
de LGPD (gap real: sem política de retenção/exclusão a pedido do
titular), texto de SLA honesto (sem prometer número de uptime).

**🔴 Achado que não posso decidir sozinho**: busquei em todo o repositório
(scripts, migrations, workflows n8n) e não encontrei nenhuma rotina de
backup do Postgres compartilhado — que hoje guarda dado real de paciente
em produção (Dra. Aline). `DATABASE_URL` aponta pra um IP direto, não um
provedor gerenciado com backup automático por padrão. Isso é risco
operacional de agora, independente de comercialização — registrado como
prioridade real em `Plano_Comercializacao_Lumi.md` §5, aguardando o
Tiago confirmar se existe snapshot automático no Easypanel/VPS por fora
da aplicação.

**Próximo passo**: seguir pra Fase 3 (manuais/formatos) em paralelo, já
que não depende da resposta sobre backup — mas Fase 4 (site) fica
represada até a Fase 2 estar 100% resolvida (alegação pública de
segurança precisa aguentar escrutínio).

---

## 2026-09-04 — Fase 1 concluída: funil bifurcado + proposta de valor

Tiago autorizou modo automático ("vou validando de vez em quando... pode
assumir as decisões que, se necessário, valido no fim de tudo") e trouxe
um input de posicionamento em paralelo: o **painel** (não só a conversa)
é o maior diferencial, e a máxima **"IA Auxilia, IN (Inteligência
Natural) Dirige"** deve ser mensagem de primeira linha, não detalhe
interno.

**Entregue**:
- `Proposta_de_Valor_Lumi.md` (novo) — documento-fonte da mensagem,
  parágrafo + 4 pilares, "IA Auxilia, IN Dirige" e o painel em primeiro
  lugar.
- `Funil_Vendas_Lumi.md` — §2 (qualificação) bifurcada Simples
  Dental/Standalone, deixou de ser filtro bloqueante único; §4 (preço)
  ganhou setup diferenciado por variante (hipótese, não validada:
  R$800-1.500 integrada / R$400-800 Standalone).
- `Lista_Leads_e_Outreach.md` — ICP atualizado pra refletir a bifurcação.
- `Roteiro_Demo_Vendas.md` — "mostrar o painel" deixou de ser condicional
  ("se o lead perguntar") e virou parte proativa do roteiro; objeção
  "preciso trocar de sistema?" bifurcada; objetivo da demo passou de 3
  pra 4 pontos (incluindo o painel).
- `Checklist_Onboarding_Nova_Clinica.md` §0 — qualificação com 3 caminhos
  (Simples Dental / Standalone / Clinicorp) em vez de 2; §2 com aviso
  pra não seguir o passo a passo do robô Simples Dental numa clínica
  Standalone.
- **Achado lateral, corrigido**: `standalone-bridge/README.md` ainda
  dizia "não testado ao vivo ainda / não rodado em produção nem uma vez"
  — desatualizado desde que virou MVP nesta mesma sessão. Corrigido antes
  de deixar o checklist apontar pra um documento enganoso.

**Próximo passo**: Fase 2 (prontidão técnica pra vender — isolamento
multi-tenant, LGPD, backup, SLA), já que Fase 4 (site) depende de
alegações que aguentem escrutínio público.

---

## 2026-09-04 — Kickoff da comercialização

**Marco**: MVP do Lumi Standalone considerado pronto pelo Tiago ("acredito
que temos um MVP!!"), depois de uma sessão de testes ao vivo reais (agenda,
troca/reconexão de WhatsApp, correção de nomes no drill-down, cores de
rótulo na Agenda).

**Decisão**: iniciar formalmente a comercialização, com trabalho
organizado em 4 lentes (Gerente de Projeto/orquestrador, UI/UX, Back-end e
Segurança, Marketing), log de progresso mantido aqui.

**Alinhado com o Tiago** (via perguntas diretas):
- Cliente-alvo: clínicas odontológicas.
- Modelo de venda: híbrido (site gera lead/prova, fechamento e onboarding
  seguem manuais).
- Primeira entrega: plano geral estruturado (este + o documento-mãe).
- Case da Dra. Aline pode virar prova social pública (autorização formal
  com ela ainda pendente).

**Achado antes de escrever qualquer coisa nova**: o repositório já tinha
um funil de vendas inteiro pronto desde 27/08/2026 (`Funil_Vendas_Lumi.md`,
`Lista_Leads_e_Outreach.md`, `Roteiro_Demo_Vendas.md`,
`Roteiro_Entrevista_Personalizacao.md`), incluindo pesquisa de preço real
de 7 concorrentes. Toda essa qualificação é bloqueante em "usa Simples
Dental" — desatualizado pelo MVP do Standalone desta sessão, que atende
justamente quem não usa nenhum sistema. Plano geral criado como
gap-analysis em cima do que já existe, não do zero — ver
`Plano_Comercializacao_Lumi.md` §1-2 pro detalhe.

**Entregue**: `Plano_Comercializacao_Lumi.md` (visão geral + roadmap de 5
fases) e este log. Próximo passo proposto: Fase 1 (atualizar o funil
existente pro Standalone + escrever a value proposition formal) —
aguardando confirmação do Tiago.
