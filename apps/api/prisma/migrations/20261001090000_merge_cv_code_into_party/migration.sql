-- CR3: the CV code is the farmer / customer code (parties.code); the separate CV code list is removed.
-- Approved transactions keep the CV code they had in approved_snapshot (frozen).

-- DropForeignKey
ALTER TABLE "sales_transactions" DROP CONSTRAINT "sales_transactions_cv_code_id_fkey";

-- DropIndex
DROP INDEX "sales_transactions_cv_code_id_idx";

-- AlterTable
ALTER TABLE "sales_transactions" DROP COLUMN "cv_code_id";

-- DropTable
DROP TABLE "cv_codes";

