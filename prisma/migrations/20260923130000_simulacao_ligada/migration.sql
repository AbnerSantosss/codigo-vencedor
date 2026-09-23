-- Pagamento simulado ligado por padrão, pedido do dono em 2026-09-23:
-- "deixe o modo de simulação ativado por padrão até eu add um gateway".
--
-- Enquanto a loja não tem chave Pix nem gateway, toda cobrança nasce simulada
-- e, com esta flag ligada, qualquer visitante pode marcar o próprio pedido
-- como pago (e-mail de acesso, CAPI e webhooks de saída, como venda real).
-- Quando um gateway for configurado, as cobranças deixam de ser simuladas e
-- o botão some sozinho; a flag pode ser desligada no painel, aba Checkout.
--
-- O DEFAULT_CONFIG já nasce ligado, mas o seed não sobrescreve a linha que
-- existe em produção — por isso esta migração. O `||` troca só a chave.
UPDATE "SiteConfig"
SET "checkout" = COALESCE("checkout", '{}'::jsonb) || '{"simulatedPaymentEnabled": true}'::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 1;
