-- CreateTable
CREATE TABLE "dues_reminder_log" (
    "id" UUID NOT NULL,
    "dues_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dues_reminder_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dues_reminder_log_dues_id_kind_key" ON "dues_reminder_log"("dues_id", "kind");

-- AddForeignKey
ALTER TABLE "dues_reminder_log" ADD CONSTRAINT "dues_reminder_log_dues_id_fkey" FOREIGN KEY ("dues_id") REFERENCES "dues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
