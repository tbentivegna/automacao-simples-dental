# Site de comercialização — Lumi

Fase 4 do `Plano_Comercializacao_Lumi.md`. Protótipo, não deployado ainda
— domínio/hospedagem final é decisão em aberto (ver `Plano_Comercializacao_Lumi.md`
§5). Publicado como Artifact pra revisão em 04/09/2026.

Página única, estático, sem backend — CTA principal é WhatsApp direto
(`wa.me`, número 5511981174657, mensagem pré-preenchida), consistente com
o modelo de venda híbrido já decidido (site gera lead/prova, fechamento
continua manual). Sem formulário/banco de dados: um artifact público não
pode declarar a capability `db` (capabilities dessa natureza tornam a
página restrita à organização, incompatível com um site público).

Conteúdo todo derivado dos documentos já existentes -- nada inventado:
- `Proposta_de_Valor_Lumi.md` -- mensagem central ("IA Auxilia, IN
  Dirige", painel como diferencial).
- `Roteiro_Demo_Vendas.md` -- FAQ/objeções (adaptado pra 2ª pessoa).
- `Funil_Vendas_Lumi.md` §4 -- nomes dos planos (Basic/Pro/Advanced) sem
  valores em R$ (preço ainda não travado -- ver decisão em aberto no
  plano geral).
- `Prontidao_Tecnica_Comercializacao.md` -- só as alegações de
  segurança já confirmadas (isolamento multi-tenant, monitoramento,
  backup testado); nenhuma promessa de SLA numérico.

**Case da Dra. Aline propositalmente NÃO nomeado** -- autorização formal
dela ainda não confirmada (ver `Plano_Comercializacao_Lumi.md`). Site usa
só "em uso real, em produção, numa clínica odontológica", sem nome nem
depoimento fabricado. Trocar quando ela autorizar.

## Pra publicar de verdade

`index.html` + `assets/logo-lumi.png` são um site estático simples --
qualquer hospedagem serve (Easypanel como app estática, Vercel/Netlify,
etc.), assim que o domínio for decidido.
