-- Business wings (DOC, CBF, Fish, Feed, Milk). Every sales transaction belongs to exactly one wing;
-- Sales Admin / finance reviewers only see and act on transactions of the wings assigned to them.

-- CreateTable
CREATE TABLE "wings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "wings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_wings" (
    "user_id" UUID NOT NULL,
    "wing_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_wings_pkey" PRIMARY KEY ("user_id","wing_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wings_code_key" ON "wings"("code");
CREATE INDEX "wings_status_name_idx" ON "wings"("status", "name");
CREATE INDEX "user_wings_wing_id_idx" ON "user_wings"("wing_id");

-- Reference data: the default wings (the seed keeps them in sync; admins can rename or add wings).
INSERT INTO "wings" ("code", "name", "updated_at") VALUES
    ('DOC',  'DOC',  CURRENT_TIMESTAMP),
    ('CBF',  'CBF',  CURRENT_TIMESTAMP),
    ('FISH', 'Fish', CURRENT_TIMESTAMP),
    ('FEED', 'Feed', CURRENT_TIMESTAMP),
    ('MILK', 'Milk', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Existing users keep the access they had before wings existed (every transaction);
-- administrators narrow it per user afterwards. New users default to no wing.
ALTER TABLE "users" ADD COLUMN "all_wings" BOOLEAN NOT NULL DEFAULT false;
UPDATE "users" SET "all_wings" = true;

-- Existing transactions are assigned to the first wing (DOC); correct them via the owner if needed.
ALTER TABLE "sales_transactions" ADD COLUMN "wing_id" UUID;
UPDATE "sales_transactions" SET "wing_id" = (SELECT "id" FROM "wings" WHERE "code" = 'DOC') WHERE "wing_id" IS NULL;
ALTER TABLE "sales_transactions" ALTER COLUMN "wing_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "sales_transactions_wing_id_status_idx" ON "sales_transactions"("wing_id", "status");

-- AddForeignKey
ALTER TABLE "user_wings" ADD CONSTRAINT "user_wings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_wings" ADD CONSTRAINT "user_wings_wing_id_fkey" FOREIGN KEY ("wing_id") REFERENCES "wings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_transactions" ADD CONSTRAINT "sales_transactions_wing_id_fkey" FOREIGN KEY ("wing_id") REFERENCES "wings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
