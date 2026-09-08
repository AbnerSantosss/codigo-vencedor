-- FASE 4 — webhooks de saída: verbo HTTP e headers do destino.
--
-- 100% aditiva. `headers` nasce nulável e `method` tem default, então
-- nenhuma linha existente precisa ser reescrita e não há janela de
-- indisponibilidade. Nenhuma coluna removida, nenhum tipo alterado.
--
-- Gerada por `prisma migrate diff --from-schema-datasource
-- --to-schema-datamodel --script` e conferida antes de aplicar, porque
-- `migrate dev` não roda em ambiente sem teclado (ver armadilha 80).

-- AlterTable
ALTER TABLE "OutboundWebhook" ADD COLUMN     "headers" JSONB,
ADD COLUMN     "method" TEXT NOT NULL DEFAULT 'POST';
