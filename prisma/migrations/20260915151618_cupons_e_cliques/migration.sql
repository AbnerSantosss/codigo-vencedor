-- CreateEnum
CREATE TYPE "CouponKind" AS ENUM ('percent', 'fixed');

-- AlterTable
ALTER TABLE "FunnelEvent" ADD COLUMN     "clickLabel" TEXT,
ADD COLUMN     "clickSection" TEXT,
ADD COLUMN     "cta" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "couponCode" TEXT,
ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "listAmountCents" INTEGER;

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "CouponKind" NOT NULL,
    "value" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- CreateIndex
CREATE INDEX "Coupon_active_createdAt_idx" ON "Coupon"("active", "createdAt");

-- CreateIndex
CREATE INDEX "FunnelEvent_cta_createdAt_idx" ON "FunnelEvent"("cta", "createdAt");

-- CreateIndex
CREATE INDEX "FunnelEvent_clickSection_createdAt_idx" ON "FunnelEvent"("clickSection", "createdAt");

-- CreateIndex
CREATE INDEX "Order_couponCode_idx" ON "Order"("couponCode");
