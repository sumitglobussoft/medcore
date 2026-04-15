-- CreateEnum
CREATE TYPE "PaymentTxnStatus" AS ENUM ('CAPTURED', 'FAILED', 'REFUNDED');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "razorpayOrderId" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "status" "PaymentTxnStatus" NOT NULL DEFAULT 'CAPTURED';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pushPlatform" TEXT,
ADD COLUMN     "pushToken" TEXT,
ADD COLUMN     "pushTokenUpdatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_razorpayOrderId_key" ON "invoices"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_transactionId_key" ON "payments"("transactionId");
