-- CreateEnum
CREATE TYPE "EventAudience" AS ENUM ('ALL_MEMBERS', 'BOARD', 'CANDIDATES');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "audience" "EventAudience" NOT NULL DEFAULT 'ALL_MEMBERS';

