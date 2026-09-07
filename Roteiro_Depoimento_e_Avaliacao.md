# Roteiro — Depoimento e Autorização da Dra. Aline

Objetivo: transformar a Dra. Aline (única cliente real, em produção) num
depoimento com substância, autorização pra citar a clínica publicamente,
e uma avaliação real — sem inventar nada, sem fabricar métrica.
Resolve de uma vez três pendências que já estavam em aberto: o "Em uso
real, em produção, **numa clínica odontológica**" genérico do site, o
case do blog (ver `Plano_Comercializacao_Lumi.md`), e a prova social
vaga que os 3 perfis de compra (`Log_Progresso_Comercializacao.md`,
06/09) apontaram como fraca.

**Isso é ação do Tiago, não automatizável** — é uma conversa pessoal
com uma cliente real. O que segue é o material pronto pra usar.

## 1. Mensagem pra puxar a conversa (WhatsApp, ajustar o tom antes de mandar)

> Aline, posso te pedir uma coisa rapidinha? Tô trabalhando em divulgar
> a Lumi pra outras clínicas, e nada vende melhor do que a experiência
> de quem já usa de verdade. Topa gravar um áudio (ou responder por
> texto mesmo) com 4 perguntas rápidas sobre como tem sido usar? E
> também: posso citar sua clínica com nome no site e num post sobre o
> case, em vez de deixar genérico como está hoje? Só uso se você topar.

## 2. Roteiro de perguntas (gera texto com substância, não "adorei!")

1. **Antes da Lumi, quanto tempo por dia você (ou a equipe) gastava
   respondendo WhatsApp de paciente?** — puxa um número, mesmo que
   aproximado; é o que dá peso real ao depoimento.
2. **O que mudou no dia a dia da clínica desde que começou a usar?**
3. **Teve algum momento em que ela resolveu algo que você não
   esperava, ou evitou um problema?** — historinha concreta > elogio
   genérico.
4. **Recomendaria pra outro dentista? Por quê?**

Se ela topar gravar áudio, ainda melhor — dá pra cortar um trecho como
depoimento em vídeo curto pro site/Instagram, além do texto.

## 3. Onde isso entra depois da resposta

- **Site** (`site/index.html`, seção `#confianca`): depoimento real
  substituindo/complementando a lista de confiança genérica atual.
- **Selo do hero**: "numa clínica odontológica" pode virar o nome real
  da clínica, se ela autorizar.
- **Schema JSON-LD**: um `Review` singular e real (não
  `AggregateRating` fabricado — isso segue recusado, ver commit
  `3a27413`) associado à `Organization` já publicada.
- **Blog** (`Plano_Comercializacao_Lumi.md`, artigo 3): vira a base do
  case study — o 3º artigo pilar da estratégia de conteúdo, que fica
  pra depois da resposta dela por decisão do Tiago (06/09/2026).

## 4. Canal de avaliação — correção em relação ao que eu disse antes

Cheguei a sugerir Google Meu Negócio; reconsiderando, **não é um bom
encaixe**: esse perfil é pensado pra negócio com endereço físico ou que
atende o cliente presencialmente, e a Lumi é 100% remota — criar um
perfil que não se qualifica de verdade arrisca suspensão e não ajuda
em nada. Substituindo pela rota certa pro caso:

- **Depoimento direto no site** (item 3 acima) — o canal mais rápido e
  sob controle total, não depende de plataforma de terceiro.
- **Recomendação no LinkedIn**, se a Dra. Aline tiver perfil ativo —
  encaixe melhor pra contexto B2B, pública e referenciável.
- **Diretórios de software (Capterra, G2, GetApp)** — legítimos e
  aceitam avaliação de B2B remoto, mas fazem mais sentido com 2-3
  clientes reais (uma avaliação solitária lá rende pouco); vale
  revisitar quando o funil trouxer o 2º/3º cliente.
