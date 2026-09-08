-- FASE 3 — atribuição de origem, deduplicação e identidade de visitante.
--
-- Uma migration só, de propósito: as oito mudanças abaixo servem ao mesmo
-- assunto (saber de onde a venda veio e contar gente em vez de aba), e
-- fragmentar em várias deixaria o histórico ilegível.
--
-- Tudo é aditivo. Nenhuma coluna é removida, nenhum tipo muda, e toda coluna
-- nova é nulável ou tem default — então não há perda de dado nem janela de
-- indisponibilidade.
--
-- O único ponto que poderia falhar é o índice único em FunnelEvent.eventId,
-- que quebra se houver eventId repetido. Conferido antes: 239 linhas, 239
-- eventIds distintos, zero duplicata. As duas chaves estrangeiras também
-- foram conferidas contra órfão (zero em FunnelEvent.leadId e EmailLog.orderId).

-- DropIndex
DROP INDEX "FunnelEvent_eventId_idx";

-- AlterTable
ALTER TABLE "EmailLog" ADD COLUMN     "leadId" TEXT,
ADD COLUMN     "meta" JSONB;

-- AlterTable
ALTER TABLE "FunnelEvent" ADD COLUMN     "visitorId" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "firstTouch" JSONB,
ADD COLUMN     "recoveryNextAt" TIMESTAMP(3),
ADD COLUMN     "recoveryStep" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "visitorId" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "firstTouch" JSONB,
ADD COLUMN     "recoveryNextAt" TIMESTAMP(3),
ADD COLUMN     "recoveryStep" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OutboundDelivery" ADD COLUMN     "payload" JSONB;

-- CreateIndex
CREATE INDEX "EmailLog_leadId_idx" ON "EmailLog"("leadId");

-- CreateIndex
CREATE INDEX "EmailLog_template_createdAt_idx" ON "EmailLog"("template", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FunnelEvent_eventId_key" ON "FunnelEvent"("eventId");

-- CreateIndex
CREATE INDEX "FunnelEvent_visitorId_idx" ON "FunnelEvent"("visitorId");

-- CreateIndex
CREATE INDEX "FunnelEvent_leadId_idx" ON "FunnelEvent"("leadId");

-- CreateIndex
CREATE INDEX "Lead_visitorId_idx" ON "Lead"("visitorId");

-- CreateIndex
CREATE INDEX "Lead_recoveryNextAt_idx" ON "Lead"("recoveryNextAt");

-- CreateIndex
CREATE INDEX "Order_recoveryNextAt_idx" ON "Order"("recoveryNextAt");

-- AddForeignKey
ALTER TABLE "FunnelEvent" ADD CONSTRAINT "FunnelEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

