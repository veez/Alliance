-- CreateTable
CREATE TABLE "working_group_employees" (
    "working_group_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "role" "WgRole" NOT NULL DEFAULT 'MEMBER',
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "working_group_employees_pkey" PRIMARY KEY ("working_group_id","employee_id")
);

-- AddForeignKey
ALTER TABLE "working_group_employees" ADD CONSTRAINT "working_group_employees_working_group_id_fkey" FOREIGN KEY ("working_group_id") REFERENCES "working_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_group_employees" ADD CONSTRAINT "working_group_employees_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

