-- CreateEnum
CREATE TYPE "SystemRole" AS ENUM ('ADMIN', 'SECRETARY', 'USER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "OrganizationKind" AS ENUM ('ORGANIZATION', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('CANDIDATE', 'MEMBER', 'PARTNER', 'SUSPENDED', 'EXITED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FileEntityType" AS ENUM ('VOTE', 'DUES', 'AGREEMENT', 'PAYMENT', 'EVENT', 'PROTOCOL', 'WORKING_GROUP', 'TASK', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "VoteScenario" AS ENUM ('DOCUMENT_APPROVAL', 'EVENT_PARTICIPATION', 'ADMISSION', 'ELECTION', 'OTHER');

-- CreateEnum
CREATE TYPE "VoteStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VoteEligibility" AS ENUM ('ALL_MEMBERS', 'LIST', 'PAID_DUES');

-- CreateEnum
CREATE TYPE "QuestionFormat" AS ENUM ('YES_NO_ABSTAIN', 'SINGLE', 'MULTIPLE', 'RANKING');

-- CreateEnum
CREATE TYPE "DuesStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'OVERDUE', 'WAIVED');

-- CreateEnum
CREATE TYPE "AgreementStatus" AS ENUM ('DRAFT', 'SIGNED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('GENERAL_MEETING', 'CONFERENCE', 'WORKING_GROUP_MEETING', 'OTHER');

-- CreateEnum
CREATE TYPE "EventFormat" AS ENUM ('OFFLINE', 'ONLINE', 'HYBRID');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('PLANNED', 'HELD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('INVITED', 'CONFIRMED_OFFLINE', 'CONFIRMED_ONLINE', 'DECLINED');

-- CreateEnum
CREATE TYPE "PresenceStatus" AS ENUM ('UNKNOWN', 'PRESENT_OFFLINE', 'PRESENT_ONLINE', 'ABSENT');

-- CreateEnum
CREATE TYPE "ProtocolStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "WorkingGroupStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WgRole" AS ENUM ('LEAD', 'MEMBER');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "CommentEntityType" AS ENUM ('TASK', 'PLAN_ITEM', 'PROTOCOL');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "position" TEXT,
    "organization_id" UUID,
    "system_role" "SystemRole" NOT NULL DEFAULT 'USER',
    "can_view_all" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "totp_secret_enc" TEXT,
    "totp_enabled_at" TIMESTAMPTZ,
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "contact_privacy" JSONB NOT NULL DEFAULT '{}',
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "system_role" "SystemRole" NOT NULL DEFAULT 'USER',
    "organization_id" UUID,
    "created_by" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_resets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regions" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "federal_district" TEXT NOT NULL,
    "svg_path_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "kind" "OrganizationKind" NOT NULL DEFAULT 'ORGANIZATION',
    "status" "OrganizationStatus" NOT NULL DEFAULT 'CANDIDATE',
    "name" TEXT NOT NULL,
    "short_name" TEXT,
    "inn" TEXT,
    "ogrn" TEXT,
    "kpp" TEXT,
    "legal_address" TEXT,
    "postal_address" TEXT,
    "region_code" TEXT NOT NULL,
    "city" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "activity_areas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,
    "website" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "head_name" TEXT,
    "head_position" TEXT,
    "logo_file_id" UUID,
    "joined_at" TIMESTAMPTZ,
    "show_on_map" BOOLEAN NOT NULL DEFAULT true,
    "contact_privacy" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_status_history" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "from_status" "OrganizationStatus",
    "to_status" "OrganizationStatus" NOT NULL,
    "reason" TEXT,
    "vote_id" UUID,
    "changed_by" UUID,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_applications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "questionnaire" JSONB NOT NULL DEFAULT '{}',
    "status" "ApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMPTZ,
    "decided_at" TIMESTAMPTZ,
    "admission_vote_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "candidate_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID,
    "full_name" TEXT NOT NULL,
    "position" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "contact_privacy" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "responsibility_areas" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "responsibility_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_responsibilities" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "area_id" UUID NOT NULL,
    "working_group_id" UUID,

    CONSTRAINT "employee_responsibilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_links" (
    "file_id" UUID NOT NULL,
    "entity_type" "FileEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "doc_type" TEXT,
    "visible_to_partners" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_links_pkey" PRIMARY KEY ("file_id","entity_type","entity_id")
);

-- CreateTable
CREATE TABLE "votes" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scenario" "VoteScenario" NOT NULL DEFAULT 'OTHER',
    "status" "VoteStatus" NOT NULL DEFAULT 'DRAFT',
    "starts_at" TIMESTAMPTZ,
    "ends_at" TIMESTAMPTZ NOT NULL,
    "closed_at" TIMESTAMPTZ,
    "quorum_percent" INTEGER NOT NULL DEFAULT 50,
    "eligibility" "VoteEligibility" NOT NULL DEFAULT 'ALL_MEMBERS',
    "subject_organization_id" UUID,
    "reminders" JSONB NOT NULL DEFAULT '[]',
    "result" JSONB,
    "protocol_file_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vote_questions" (
    "id" UUID NOT NULL,
    "vote_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "format" "QuestionFormat" NOT NULL,
    "min_choices" INTEGER NOT NULL DEFAULT 1,
    "max_choices" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "vote_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vote_options" (
    "id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "vote_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vote_eligible_voters" (
    "vote_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,

    CONSTRAINT "vote_eligible_voters_pkey" PRIMARY KEY ("vote_id","organization_id")
);

-- CreateTable
CREATE TABLE "vote_participations" (
    "vote_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "voted_by_user_id" UUID NOT NULL,
    "voted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vote_participations_pkey" PRIMARY KEY ("vote_id","organization_id")
);

-- CreateTable
CREATE TABLE "vote_answers" (
    "id" UUID NOT NULL,
    "vote_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "option_id" UUID NOT NULL,
    "rank" INTEGER,

    CONSTRAINT "vote_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vote_reminder_log" (
    "id" UUID NOT NULL,
    "vote_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vote_reminder_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dues_settings" (
    "year" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "due_date" DATE NOT NULL,
    "grace_days" INTEGER NOT NULL DEFAULT 0,
    "voting_requires_paid" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "dues_settings_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "dues" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "amount_due" DECIMAL(12,2) NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "DuesStatus" NOT NULL DEFAULT 'UNPAID',
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "dues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dues_payments" (
    "id" UUID NOT NULL,
    "dues_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paid_at" DATE NOT NULL,
    "document_number" TEXT,
    "recorded_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dues_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donation_agreements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "signed_at" DATE,
    "year" INTEGER NOT NULL,
    "amount" DECIMAL(12,2),
    "status" "AgreementStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "donation_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "EventType" NOT NULL DEFAULT 'GENERAL_MEETING',
    "format" "EventFormat" NOT NULL DEFAULT 'ONLINE',
    "location" TEXT,
    "online_url" TEXT,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ,
    "registration_deadline" TIMESTAMPTZ,
    "working_group_id" UUID,
    "visible_to_partners" BOOLEAN NOT NULL DEFAULT false,
    "status" "EventStatus" NOT NULL DEFAULT 'PLANNED',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_attendance" (
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID,
    "registration" "RegistrationStatus" NOT NULL DEFAULT 'INVITED',
    "presence" "PresenceStatus" NOT NULL DEFAULT 'UNKNOWN',
    "marked_by" UUID,
    "marked_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "event_attendance_pkey" PRIMARY KEY ("event_id","user_id")
);

-- CreateTable
CREATE TABLE "protocols" (
    "id" UUID NOT NULL,
    "number" TEXT,
    "title" TEXT NOT NULL,
    "held_at" TIMESTAMPTZ NOT NULL,
    "event_id" UUID,
    "working_group_id" UUID,
    "status" "ProtocolStatus" NOT NULL DEFAULT 'DRAFT',
    "author_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ,
    "visible_to_partners" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "protocols_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "protocol_items" (
    "id" UUID NOT NULL,
    "protocol_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "agenda_text" TEXT NOT NULL,
    "discussion" TEXT,
    "decision" TEXT,
    "vote_id" UUID,

    CONSTRAINT "protocol_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "working_groups" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "goals" TEXT,
    "description" TEXT,
    "status" "WorkingGroupStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "working_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "working_group_members" (
    "working_group_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "WgRole" NOT NULL DEFAULT 'MEMBER',
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "working_group_members_pkey" PRIMARY KEY ("working_group_id","user_id")
);

-- CreateTable
CREATE TABLE "wg_plan_items" (
    "id" UUID NOT NULL,
    "working_group_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "start_date" DATE,
    "due_date" DATE,
    "status" "PlanStatus" NOT NULL DEFAULT 'PLANNED',
    "responsible_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "wg_plan_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wg_tasks" (
    "id" UUID NOT NULL,
    "working_group_id" UUID NOT NULL,
    "plan_item_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignee_user_id" UUID,
    "due_date" DATE,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "created_by" UUID NOT NULL,
    "done_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "wg_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "entity_type" "CommentEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edited_at" TIMESTAMPTZ,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id","type")
);

-- CreateTable
CREATE TABLE "email_templates" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body_html" TEXT NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_token_hash_key" ON "refresh_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_sessions_user_id_idx" ON "refresh_sessions"("user_id");

-- CreateIndex
CREATE INDEX "refresh_sessions_family_id_idx" ON "refresh_sessions"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_resets_token_hash_key" ON "password_resets"("token_hash");

-- CreateIndex
CREATE INDEX "organizations_region_code_idx" ON "organizations"("region_code");

-- CreateIndex
CREATE INDEX "organizations_status_idx" ON "organizations"("status");

-- CreateIndex
CREATE INDEX "organization_status_history_organization_id_idx" ON "organization_status_history"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_applications_organization_id_key" ON "candidate_applications"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_user_id_key" ON "employees"("user_id");

-- CreateIndex
CREATE INDEX "employees_organization_id_idx" ON "employees"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "responsibility_areas_code_key" ON "responsibility_areas"("code");

-- CreateIndex
CREATE UNIQUE INDEX "employee_responsibilities_employee_id_area_id_working_group_key" ON "employee_responsibilities"("employee_id", "area_id", "working_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "files_storage_key_key" ON "files"("storage_key");

-- CreateIndex
CREATE INDEX "file_links_entity_type_entity_id_idx" ON "file_links"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "votes_number_key" ON "votes"("number");

-- CreateIndex
CREATE INDEX "votes_status_ends_at_idx" ON "votes"("status", "ends_at");

-- CreateIndex
CREATE INDEX "vote_questions_vote_id_idx" ON "vote_questions"("vote_id");

-- CreateIndex
CREATE INDEX "vote_options_question_id_idx" ON "vote_options"("question_id");

-- CreateIndex
CREATE INDEX "vote_answers_question_id_idx" ON "vote_answers"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "vote_answers_vote_id_organization_id_question_id_option_id_key" ON "vote_answers"("vote_id", "organization_id", "question_id", "option_id");

-- CreateIndex
CREATE UNIQUE INDEX "vote_reminder_log_vote_id_organization_id_kind_key" ON "vote_reminder_log"("vote_id", "organization_id", "kind");

-- CreateIndex
CREATE INDEX "dues_year_status_idx" ON "dues"("year", "status");

-- CreateIndex
CREATE UNIQUE INDEX "dues_organization_id_year_key" ON "dues"("organization_id", "year");

-- CreateIndex
CREATE INDEX "donation_agreements_organization_id_year_idx" ON "donation_agreements"("organization_id", "year");

-- CreateIndex
CREATE INDEX "events_starts_at_idx" ON "events"("starts_at");

-- CreateIndex
CREATE INDEX "event_attendance_organization_id_idx" ON "event_attendance"("organization_id");

-- CreateIndex
CREATE INDEX "protocols_held_at_idx" ON "protocols"("held_at");

-- CreateIndex
CREATE INDEX "protocol_items_protocol_id_idx" ON "protocol_items"("protocol_id");

-- CreateIndex
CREATE INDEX "wg_plan_items_working_group_id_idx" ON "wg_plan_items"("working_group_id");

-- CreateIndex
CREATE INDEX "wg_tasks_working_group_id_idx" ON "wg_tasks"("working_group_id");

-- CreateIndex
CREATE INDEX "comments_entity_type_entity_id_idx" ON "comments"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_idx" ON "audit_log"("actor_user_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_region_code_fkey" FOREIGN KEY ("region_code") REFERENCES "regions"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_logo_file_id_fkey" FOREIGN KEY ("logo_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_status_history" ADD CONSTRAINT "organization_status_history_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_status_history" ADD CONSTRAINT "organization_status_history_vote_id_fkey" FOREIGN KEY ("vote_id") REFERENCES "votes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_status_history" ADD CONSTRAINT "organization_status_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_applications" ADD CONSTRAINT "candidate_applications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_applications" ADD CONSTRAINT "candidate_applications_admission_vote_id_fkey" FOREIGN KEY ("admission_vote_id") REFERENCES "votes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_responsibilities" ADD CONSTRAINT "employee_responsibilities_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_responsibilities" ADD CONSTRAINT "employee_responsibilities_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "responsibility_areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_responsibilities" ADD CONSTRAINT "employee_responsibilities_working_group_id_fkey" FOREIGN KEY ("working_group_id") REFERENCES "working_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_links" ADD CONSTRAINT "file_links_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_subject_organization_id_fkey" FOREIGN KEY ("subject_organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_protocol_file_id_fkey" FOREIGN KEY ("protocol_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_questions" ADD CONSTRAINT "vote_questions_vote_id_fkey" FOREIGN KEY ("vote_id") REFERENCES "votes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_options" ADD CONSTRAINT "vote_options_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "vote_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_eligible_voters" ADD CONSTRAINT "vote_eligible_voters_vote_id_fkey" FOREIGN KEY ("vote_id") REFERENCES "votes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_eligible_voters" ADD CONSTRAINT "vote_eligible_voters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_participations" ADD CONSTRAINT "vote_participations_vote_id_fkey" FOREIGN KEY ("vote_id") REFERENCES "votes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_participations" ADD CONSTRAINT "vote_participations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_participations" ADD CONSTRAINT "vote_participations_voted_by_user_id_fkey" FOREIGN KEY ("voted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_answers" ADD CONSTRAINT "vote_answers_vote_id_fkey" FOREIGN KEY ("vote_id") REFERENCES "votes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_answers" ADD CONSTRAINT "vote_answers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_answers" ADD CONSTRAINT "vote_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "vote_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_answers" ADD CONSTRAINT "vote_answers_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "vote_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_reminder_log" ADD CONSTRAINT "vote_reminder_log_vote_id_fkey" FOREIGN KEY ("vote_id") REFERENCES "votes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_reminder_log" ADD CONSTRAINT "vote_reminder_log_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dues" ADD CONSTRAINT "dues_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dues" ADD CONSTRAINT "dues_year_fkey" FOREIGN KEY ("year") REFERENCES "dues_settings"("year") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dues_payments" ADD CONSTRAINT "dues_payments_dues_id_fkey" FOREIGN KEY ("dues_id") REFERENCES "dues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dues_payments" ADD CONSTRAINT "dues_payments_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donation_agreements" ADD CONSTRAINT "donation_agreements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_working_group_id_fkey" FOREIGN KEY ("working_group_id") REFERENCES "working_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_attendance" ADD CONSTRAINT "event_attendance_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_attendance" ADD CONSTRAINT "event_attendance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_attendance" ADD CONSTRAINT "event_attendance_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_attendance" ADD CONSTRAINT "event_attendance_marked_by_fkey" FOREIGN KEY ("marked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_working_group_id_fkey" FOREIGN KEY ("working_group_id") REFERENCES "working_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocol_items" ADD CONSTRAINT "protocol_items_protocol_id_fkey" FOREIGN KEY ("protocol_id") REFERENCES "protocols"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocol_items" ADD CONSTRAINT "protocol_items_vote_id_fkey" FOREIGN KEY ("vote_id") REFERENCES "votes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_group_members" ADD CONSTRAINT "working_group_members_working_group_id_fkey" FOREIGN KEY ("working_group_id") REFERENCES "working_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_group_members" ADD CONSTRAINT "working_group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wg_plan_items" ADD CONSTRAINT "wg_plan_items_working_group_id_fkey" FOREIGN KEY ("working_group_id") REFERENCES "working_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wg_plan_items" ADD CONSTRAINT "wg_plan_items_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wg_tasks" ADD CONSTRAINT "wg_tasks_working_group_id_fkey" FOREIGN KEY ("working_group_id") REFERENCES "working_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wg_tasks" ADD CONSTRAINT "wg_tasks_plan_item_id_fkey" FOREIGN KEY ("plan_item_id") REFERENCES "wg_plan_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wg_tasks" ADD CONSTRAINT "wg_tasks_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wg_tasks" ADD CONSTRAINT "wg_tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
