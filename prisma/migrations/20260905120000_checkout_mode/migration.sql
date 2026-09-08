-- Modo do checkout (formulário embutido ou botão para link externo).
-- Nullable de propósito: instalações existentes recebem o default do código
-- via merge em getSiteConfig, sem precisar de backfill.
ALTER TABLE "SiteConfig" ADD COLUMN "checkout" JSONB;
