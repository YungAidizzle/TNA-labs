BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_narrative_runs (
    id BIGSERIAL PRIMARY KEY,
    status TEXT NOT NULL,
    trigger TEXT NOT NULL DEFAULT 'manual',
    model_name TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ NULL,
    candidate_count INTEGER NOT NULL DEFAULT 0,
    evidence_count INTEGER NOT NULL DEFAULT 0,
    narrative_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT NULL,
    discovery_response_json JSONB NULL,
    canonicalization_response_json JSONB NULL,
    notes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ai_narrative_runs_status_check
        CHECK (status IN ('succeeded', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_ai_narrative_runs_generated_at
    ON public.ai_narrative_runs (generated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS public.ai_narrative_candidates (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES public.ai_narrative_runs(id) ON DELETE CASCADE,
    candidate_key TEXT NOT NULL,
    provisional_name TEXT NOT NULL,
    summary TEXT NOT NULL,
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'detected',
    evidence_count INTEGER NOT NULL DEFAULT 0,
    source_count INTEGER NOT NULL DEFAULT 0,
    first_seen_at TIMESTAMPTZ NULL,
    last_seen_at TIMESTAMPTZ NULL,
    source_domains_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    raw_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ai_narrative_candidates_status_check
        CHECK (status IN ('detected', 'clustered', 'discarded')),
    CONSTRAINT ai_narrative_candidates_confidence_range
        CHECK (confidence >= 0 AND confidence <= 1),
    CONSTRAINT ai_narrative_candidates_run_key_unique
        UNIQUE (run_id, candidate_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_narrative_candidates_run_id
    ON public.ai_narrative_candidates (run_id, status, candidate_key);

CREATE TABLE IF NOT EXISTS public.ai_narrative_evidence (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES public.ai_narrative_runs(id) ON DELETE CASCADE,
    candidate_id BIGINT NULL REFERENCES public.ai_narrative_candidates(id) ON DELETE SET NULL,
    evidence_key TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    snippet TEXT NOT NULL,
    source_domain TEXT NOT NULL,
    published_at TIMESTAMPTZ NULL,
    note TEXT NULL,
    raw_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ai_narrative_evidence_run_key_unique
        UNIQUE (run_id, evidence_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_narrative_evidence_run_id
    ON public.ai_narrative_evidence (run_id, source_domain, published_at DESC);

CREATE TABLE IF NOT EXISTS public.ai_narratives (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES public.ai_narrative_runs(id) ON DELETE CASCADE,
    rank INTEGER NOT NULL,
    canonical_id TEXT NOT NULL,
    canonical_name TEXT NOT NULL,
    summary TEXT NOT NULL,
    research_summary TEXT NOT NULL,
    evidence_count INTEGER NOT NULL DEFAULT 0,
    source_count INTEGER NOT NULL DEFAULT 0,
    first_seen_at TIMESTAMPTZ NULL,
    last_seen_at TIMESTAMPTZ NULL,
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    candidate_keys_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    evidence_keys_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    source_domains_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    key_entities_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    raw_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ai_narratives_status_check
        CHECK (status IN ('active', 'watch', 'discarded')),
    CONSTRAINT ai_narratives_confidence_range
        CHECK (confidence >= 0 AND confidence <= 1),
    CONSTRAINT ai_narratives_run_canonical_id_unique
        UNIQUE (run_id, canonical_id),
    CONSTRAINT ai_narratives_run_rank_unique
        UNIQUE (run_id, rank)
);

CREATE INDEX IF NOT EXISTS idx_ai_narratives_run_id
    ON public.ai_narratives (run_id, rank ASC);

CREATE TABLE IF NOT EXISTS public.ai_narrative_evidence_links (
    narrative_id BIGINT NOT NULL REFERENCES public.ai_narratives(id) ON DELETE CASCADE,
    evidence_id BIGINT NOT NULL REFERENCES public.ai_narrative_evidence(id) ON DELETE CASCADE,
    relation_order INTEGER NOT NULL DEFAULT 0,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (narrative_id, evidence_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_narrative_evidence_links_evidence
    ON public.ai_narrative_evidence_links (evidence_id, narrative_id);

COMMIT;
