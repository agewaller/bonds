-- CreateTable
CREATE TABLE "app_config" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "prompts" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "model" TEXT,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dd_subjects" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_en" TEXT,
    "name_kana" TEXT,
    "subject_type" TEXT NOT NULL DEFAULT 'other',
    "affiliations" JSONB,
    "country" TEXT,
    "state" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dd_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_due_diligences" (
    "id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "dd_type" TEXT NOT NULL,
    "prompt_key" TEXT,
    "prompt_version" INTEGER,
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'anthropic',
    "reference_date" TIMESTAMP(3),
    "input_json" JSONB,
    "output_text" TEXT,
    "output_json" JSONB,
    "scores" JSONB,
    "module_score" DOUBLE PRECISION,
    "confidence_score" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error_detail" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_due_diligences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_dd_steps" (
    "id" TEXT NOT NULL,
    "person_dd_id" TEXT NOT NULL,
    "step_key" TEXT NOT NULL,
    "step_type" TEXT NOT NULL,
    "prompt_key" TEXT,
    "model" TEXT,
    "input_json" JSONB,
    "output_json" JSONB,
    "output_text" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error_detail" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_dd_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_logs" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cost_jpy" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prompts_key_version_key" ON "prompts"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "dd_subjects_slug_key" ON "dd_subjects"("slug");

-- CreateIndex
CREATE INDEX "person_due_diligences_subject_id_dd_type_created_at_idx" ON "person_due_diligences"("subject_id", "dd_type", "created_at");

-- CreateIndex
CREATE INDEX "person_dd_steps_person_dd_id_idx" ON "person_dd_steps"("person_dd_id");

-- CreateIndex
CREATE INDEX "ai_usage_logs_purpose_created_at_idx" ON "ai_usage_logs"("purpose", "created_at");

-- AddForeignKey
ALTER TABLE "person_due_diligences" ADD CONSTRAINT "person_due_diligences_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "dd_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_dd_steps" ADD CONSTRAINT "person_dd_steps_person_dd_id_fkey" FOREIGN KEY ("person_dd_id") REFERENCES "person_due_diligences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

