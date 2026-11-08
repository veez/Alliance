-- CreateTable
CREATE TABLE "mailings" (
    "id" UUID NOT NULL,
    "audience" "EventAudience" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "recipients" INTEGER NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mailings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mailings_created_at_idx" ON "mailings"("created_at");

-- AddForeignKey
ALTER TABLE "mailings" ADD CONSTRAINT "mailings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

