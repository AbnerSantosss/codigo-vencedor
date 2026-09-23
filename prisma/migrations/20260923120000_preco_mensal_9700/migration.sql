-- Preço único e mensal, pedido do dono em 2026-09-23: sempre na promoção,
-- de R$ 197,00 por R$ 97,00/mês (antes: R$ 27,90 uma vez, de R$ 273,90).
--
-- O preço vive em SiteConfig.content, não no código: o seed é idempotente e
-- não sobrescreve a linha que já existe, então sem esta migração o banco de
-- produção continuaria cobrando R$ 27,90 depois do deploy. O `||` troca só
-- as duas chaves e preserva o resto do JSON (nome do produto, vídeo etc.).
-- Banco novo, sem linha ainda: o UPDATE não pega nada e o seed, que roda
-- depois do `migrate deploy`, cria a linha já com o DEFAULT_CONFIG novo.
UPDATE "SiteConfig"
SET "content" = "content" || '{"priceCents": 9700, "priceFromCents": 19700}'::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 1;
