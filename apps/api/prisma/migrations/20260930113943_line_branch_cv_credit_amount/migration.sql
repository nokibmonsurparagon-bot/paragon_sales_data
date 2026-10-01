-- AlterTable
ALTER TABLE "sales_transactions" ADD COLUMN     "bank_charge" DECIMAL(18,2),
ADD COLUMN     "bank_details" VARCHAR(300),
ADD COLUMN     "branch_id" UUID,
ADD COLUMN     "credit_amount" DECIMAL(18,2),
ADD COLUMN     "cv_code_id" UUID,
ADD COLUMN     "line_id" UUID;

-- CreateTable
CREATE TABLE "lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cv_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cv_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lines_code_key" ON "lines"("code");

-- CreateIndex
CREATE INDEX "lines_status_name_idx" ON "lines"("status", "name");

-- CreateIndex
CREATE UNIQUE INDEX "branches_code_key" ON "branches"("code");

-- CreateIndex
CREATE INDEX "branches_status_name_idx" ON "branches"("status", "name");

-- CreateIndex
CREATE UNIQUE INDEX "cv_codes_code_key" ON "cv_codes"("code");

-- CreateIndex
CREATE INDEX "cv_codes_status_name_idx" ON "cv_codes"("status", "name");

-- CreateIndex
CREATE INDEX "cv_codes_name_trgm_idx" ON "cv_codes" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "sales_transactions_line_id_idx" ON "sales_transactions"("line_id");

-- CreateIndex
CREATE INDEX "sales_transactions_branch_id_idx" ON "sales_transactions"("branch_id");

-- CreateIndex
CREATE INDEX "sales_transactions_cv_code_id_idx" ON "sales_transactions"("cv_code_id");

-- AddForeignKey
ALTER TABLE "sales_transactions" ADD CONSTRAINT "sales_transactions_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_transactions" ADD CONSTRAINT "sales_transactions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_transactions" ADD CONSTRAINT "sales_transactions_cv_code_id_fkey" FOREIGN KEY ("cv_code_id") REFERENCES "cv_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Amount (CR) can never exceed the deposit amount, and the stored bank charge is always their difference.
ALTER TABLE "sales_transactions" ADD CONSTRAINT "sales_transactions_credit_amount_check" CHECK (
  "credit_amount" IS NULL
  OR ("credit_amount" > 0 AND "amount" IS NOT NULL AND "credit_amount" <= "amount" AND "bank_charge" = "amount" - "credit_amount")
);
