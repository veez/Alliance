-- CreateEnum
CREATE TYPE "OrganizationNoteKind" AS ENUM ('COMMENT', 'BOARD_DECISION');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrganizationStatus" ADD VALUE 'APPLICANT';
ALTER TYPE "OrganizationStatus" ADD VALUE 'REJECTED';
ALTER TYPE "OrganizationStatus" ADD VALUE 'EXPELLED';

-- DropForeignKey
ALTER TABLE "organizations" DROP CONSTRAINT "organizations_region_code_fkey";

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "alliance_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "is_primary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "pd_consent_at" TIMESTAMPTZ,
ADD COLUMN     "telegram" TEXT,
ADD COLUMN     "vk" TEXT;

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "is_demo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "alt_name" TEXT,
ADD COLUMN     "is_demo" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "region_code" DROP NOT NULL;

-- AlterTable
ALTER TABLE "protocols" ADD COLUMN     "is_demo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_demo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "votes" ADD COLUMN     "is_demo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "working_groups" ADD COLUMN     "chat_max" TEXT,
ADD COLUMN     "chat_telegram" TEXT,
ADD COLUMN     "chat_vk" TEXT,
ADD COLUMN     "is_demo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "leader_names" TEXT;

-- CreateTable
CREATE TABLE "organization_notes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "author_id" UUID,
    "kind" "OrganizationNoteKind" NOT NULL DEFAULT 'COMMENT',
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "organization_notes_organization_id_idx" ON "organization_notes"("organization_id");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_region_code_fkey" FOREIGN KEY ("region_code") REFERENCES "regions"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_notes" ADD CONSTRAINT "organization_notes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_notes" ADD CONSTRAINT "organization_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- На момент этой миграции в базе только демонстрационные записи
UPDATE "users" SET "is_demo" = true;
UPDATE "organizations" SET "is_demo" = true;
UPDATE "votes" SET "is_demo" = true;
UPDATE "events" SET "is_demo" = true;
UPDATE "protocols" SET "is_demo" = true;
UPDATE "working_groups" SET "is_demo" = true;
