# Plano de Lançamento — Programa Parceiro de Lançamento (Lumi Standalone)

Escrito 15/09/2026, na lente de Gerente de Produto. Complementa
[Plano_Comercializacao_Lumi.md](Plano_Comercializacao_Lumi.md) (roadmap geral) e
[Funil_Vendas_Lumi.md](Funil_Vendas_Lumi.md) (funil já bifurcado pro Standalone).
Registrar execução em [Log_Progresso_Comercializacao.md](Log_Progresso_Comercializacao.md).

---

## Tese

**Não anunciar publicamente ainda.** Com zero cliente externo e zero prova
social, um anúncio amplo gasta a única atenção inaugural que se tem e
converte perto de nada. A sequência que funciona é a inversa:

> 5 clínicas escolhidas a dedo → piloto de 3 meses → prova real (números +
> depoimento) → aí sim o anúncio público, com o que provar.

O instinto do "cliente piloto pagando parte do valor" está certo. O erro a
evitar é chamar isso de **desconto**. Desconto atrai quem compra por preço,
ancora o valor pra baixo permanentemente, e cria uma conversa difícil no dia
em que o preço sobe. O enquadramento certo é **troca**: preço reduzido em
troca de contrapartidas escritas. Quem aceita a troca é quem valoriza o
produto, não quem valoriza o desconto.

---

## A oferta

### Programa Parceiro de Lançamento — 5 vagas, até 31/10/2026

| Item | Tabela | Parceiro de Lançamento |
|---|---|---|
| Setup | R$ 400 | **R$ 0** |
| Basic (3 primeiros meses) | R$ 400/mês | **R$ 200/mês** |
| Pro (3 primeiros meses) | R$ 700/mês | **R$ 350/mês** |
| A partir do 4º mês | — | Preço cheio de tabela, **congelado por 12 meses** |
| Cancelamento | — | Livre, a qualquer momento, sem multa |

**Em troca (no contrato, não no "combinado"):**
1. Depoimento em vídeo ou texto ao fim do 3º mês + autorização de uso do
   nome e logo da clínica.
2. 30 minutos de conversa de feedback a cada 15 dias durante os 3 meses.
3. Autorização pra usar métricas **anonimizadas** da clínica (volume
   atendido, tempo de resposta, agendamentos criados) em material comercial.

### Por que esses números

- **Setup zerado em vez de mensalidade mais baixa**: o setup é a barreira
  psicológica de entrada, e é custo único — zerar dói uma vez. Mensalidade
  baixa demais dói pra sempre e é o número que o cliente memoriza.
- **3 meses, não 1 ou 2**: uma clínica leva ~60-90 dias pra acumular
  conversa suficiente pra gerar um depoimento com substância. Piloto de 1
  mês não prova nada e ainda queima a vaga.
- **Preço congelado por 12 meses**: transforma o fim do desconto em
  benefício em vez de perda. Remove a objeção "e depois vocês aumentam?".
- **Cancelamento livre**: com produto novo e sem prova, o medo do cliente
  não é o preço, é ficar preso em algo que não funciona. Tirar a trava
  aumenta conversão mais do que qualquer desconto adicional.
- **5 vagas com prazo**: escassez real (cada piloto gera carga de suporte
  e a capacidade é finita), não manufaturada. E protege contra desconto
  aberto por tempo indeterminado.

---

## O que precisa estar pronto ANTES de cobrar o primeiro real

Bloqueadores de verdade, não burocracia:

1. **Checkout em produção.** Hoje `lumi.tbentivegna.com.br/api/checkout/config`
   responde `{habilitado:true, teste:true}` — o botão "Contratar" está **vivo
   no site público apontando pro sandbox do Asaas**. Ou gera a chave de
   produção, ou desativa o botão até gerar. Do jeito que está, um lead real
   que clicar passa por um fluxo de pagamento que não cobra nada.
2. **Termos de Uso revisados por advogado.** Hoje é rascunho
   ([Termos_de_Uso_Lumi.md](Termos_de_Uso_Lumi.md)). Cobrar de clínica que
   processa dado de paciente sem termo revisado é exposição real, não
   formalidade.
3. **Fluxo de exclusão/portabilidade de dados (LGPD).** Não existe ainda.
   Dado de saúde tem tratamento mais rígido; é o primeiro item que um
   cliente mais estruturado vai perguntar.
4. **Backup agendado de fato.** O script existe e foi testado ponta a
   ponta; falta registrar a tarefa agendada
   ([Backup_Restauracao.md](Backup_Restauracao.md)).

Os itens 1 e 4 são de horas. Os 2 e 3 têm prazo externo — começar já.

---

## O ativo que falta e vale mais que a oferta inteira

**Prova social.** O site não menciona nenhum cliente hoje. Existe uma
clínica real rodando há meses (Dra. Aline), e o depoimento dela está
pendente desde 07/09 ([Roteiro_Depoimento_e_Avaliacao.md](Roteiro_Depoimento_e_Avaliacao.md)).
Isso é o maior desbloqueio disponível e não custa nada além de uma
conversa.

**Ponto sensível, melhor tratar de frente:** o sobrenome é o mesmo. Quem
pesquisar vai perceber, e descobrir sozinho uma relação não declarada
destrói mais confiança do que a relação em si jamais causaria. A saída é
declarar com naturalidade — *"nossa clínica-piloto, onde a Lumi roda desde
[data]"* — e deixar os números falarem. Caso real de uso, medido, vale
muito. Caso real disfarçado de cliente independente é um risco que não
compensa.

### Números a capturar ANTES de cada piloto ir ao ar

Sem baseline não existe depoimento com número, e depoimento sem número é
elogio genérico. Medir na semana anterior ao go-live:

- Tempo médio até a 1ª resposta a um paciente novo
- Quantas mensagens chegam fora do horário comercial
- Quantos contatos não recebem resposta nenhuma
- Quantos agendamentos por semana

Depois do go-live, os mesmos quatro (a página de Analytics do painel já
coleta a maior parte). O depoimento vira *"caímos de 4h pra 3min na
primeira resposta"* em vez de *"gostei muito"*.

---

## Canais, na ordem

1. **Indicação direta da Dra. Aline** — outras dentistas da rede dela. Maior
   taxa de conversão que existe e custo zero. Começar por aqui.
2. **Abordagem direta 1:1** (WhatsApp/Instagram) a clínicas escolhidas a
   dedo, usando o ICP de [Lista_Leads_e_Outreach.md](Lista_Leads_e_Outreach.md).
   Meta: 30 abordagens pra fechar 5. Não é volume, é seleção.
3. **Representantes de material odontológico como parceiros de indicação** —
   já visitam dezenas de clínicas por semana e conhecem a dor. Comissão ou
   permuta.
4. **Conteúdo/SEO** — já planejado, travado no depoimento. Vem depois.
5. **Anúncio pago** — **não agora**. Sem prova social, tráfego pago converte
   mal e queima caixa. Depois dos 5 pilotos.

---

## Mensagens prontas

### Abordagem fria (WhatsApp/DM)

> Oi, [Nome]! Tudo bem? Sou o Tiago, criei a Lumi — uma assistente que
> responde o WhatsApp da clínica 24h, tira dúvidas, informa valores e marca
> consulta sozinha, sem a recepção precisar parar o que está fazendo.
>
> Estou abrindo 5 vagas de parceiro de lançamento: sem taxa de setup e
> metade da mensalidade nos 3 primeiros meses, em troca de um depoimento no
> final e de conversas de feedback pra eu ir ajustando junto com você.
>
> Posso te mandar um vídeo de 3 minutos mostrando funcionando de verdade? Se
> não fizer sentido, é só me dizer que não incomodo mais. 😊

Por quê: nomeia a dor antes do produto, a oferta é específica (número e
prazo), o pedido é mínimo (assistir um vídeo, não agendar reunião), e a
saída fácil reduz a resistência de quem recebe pitch o dia todo.

### Indicação via Dra. Aline

> [Nome], tudo bem? A Lumi é o sistema que uso aqui na clínica pra responder
> o WhatsApp — ela atende os pacientes fora do horário e já marca a consulta
> direto na minha agenda. Mudou bastante a rotina da recepção.
>
> O Tiago está abrindo algumas vagas de parceiro de lançamento e lembrei de
> você. Quer que eu apresente vocês?

### Follow-up (3 dias depois, só uma vez)

> Oi [Nome]! Só pra não deixar solto — o vídeo continua de pé se quiser ver.
> E se não for o momento, sem problema nenhum, me avisa que eu paro por
> aqui. 😊

---

## O argumento de venda, em uma frase

> A clínica não perde paciente por falta de qualidade — perde por demorar a
> responder. A Lumi responde na hora, a qualquer hora, e já deixa a consulta
> marcada.

Aberturas que soam boas e não funcionam: "assistente com inteligência
artificial" (o comprador não quer IA, quer agenda cheia) e "automatize seu
atendimento" (soa a robô frio, e a recepcionista que vai avaliar a
ferramenta ouve isso como ameaça ao próprio emprego — achado real da
simulação de personas de 06/09, que já custou uma reescrita de headline).

---

## Cronograma sugerido

| Semana | O quê |
|---|---|
| 1 | Chave de produção do Asaas; falar com a Dra. Aline (depoimento + indicações); capturar baseline dela |
| 2 | Termos com advogado; gravar o vídeo de 3 min; montar lista de 30 clínicas |
| 3 | Disparar as 30 abordagens; fluxo LGPD de exclusão |
| 4-5 | Fechar e onboardar os 5 pilotos (escalonado, não todos juntos) |
| 6-17 | Piloto rodando: feedback quinzenal, métricas, ajustes |
| 18 | Depoimentos + case no site; **aí sim** anúncio público e tráfego pago |

---

## Risco honesto a considerar

Nesta mesma semana (15/09) descobrimos que o agendamento automático de
**paciente novo** estava quebrado havia cerca de um mês sem ninguém
perceber — justamente porque o volume real era baixo demais pra expor o
bug. Cinco clínicas em paralelo vão encontrar essa classe de problema em
dias, não em meses.

Isso é argumento **a favor** de um piloto pequeno e instrumentado, e
**contra** um lançamento amplo. Entrar escalonado (não os 5 no mesmo dia) e
com feedback quinzenal formal não é cerimônia — é o mecanismo que transforma
os primeiros clientes em co-construtores em vez de testadores frustrados.
