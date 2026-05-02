-- =================================================
-- Upload PROCURE-TEST Knowledge Documents to OpenClaw
-- Target: schema/openclaw-orchestration.db
-- =================================================
-- Usage:
--   sqlite3 schema/openclaw-orchestration.db < sql/upload-procure-test-knowledge.sql
-- =================================================

-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- =================================================
-- 1. AGENT-DELEGATION-MAP.md
-- =================================================
INSERT OR IGNORE INTO openclaw_documents (id, title, content, doc_type, category, tags, version, status, created_at, updated_at)
VALUES (
    'doc-proc-delegation-map',
    'Agent Delegation Map — 01900 Procurement Testing',
    readfile('agent-companies-core/docs-agent-companies/disciplines-shared/testing/projects/PROCURE-TEST/knowledge/AGENT-DELEGATION-MAP.md'),
    'article',
    'procurement-testing',
    '["agent-delegation", "procurement", "01900", "heartbeat"]',
    '1.1',
    'active',
    datetime('now'),
    datetime('now')
);

-- =================================================
-- 2. CROSS-COMPANY-RACI.md
-- =================================================
INSERT OR IGNORE INTO openclaw_documents (id, title, content, doc_type, category, tags, version, status, created_at, updated_at)
VALUES (
    'doc-proc-raci',
    'Cross-Company RACI Matrix — PROCURE-TEST',
    readfile('agent-companies-core/docs-agent-companies/disciplines-shared/testing/projects/PROCURE-TEST/knowledge/CROSS-COMPANY-RACI.md'),
    'article',
    'procurement-testing',
    '["raci", "procurement", "01900", "cross-company"]',
    '1.1',
    'active',
    datetime('now'),
    datetime('now')
);

-- =================================================
-- 3. HEARTBEAT-MONITORING-CONFIG.md
-- =================================================
INSERT OR IGNORE INTO openclaw_documents (id, title, content, doc_type, category, tags, version, status, created_at, updated_at)
VALUES (
    'doc-proc-heartbeat',
    'Heartbeat Monitoring Configuration — PROCURE-TEST',
    readfile('agent-companies-core/docs-agent-companies/disciplines-shared/testing/projects/PROCURE-TEST/knowledge/HEARTBEAT-MONITORING-CONFIG.md'),
    'guide',
    'procurement-testing',
    '["heartbeat", "monitoring", "procurement", "feedback-loop"]',
    '1.1',
    'active',
    datetime('now'),
    datetime('now')
);

-- =================================================
-- 4. METADATA-BUNDLE.md
-- =================================================
INSERT OR IGNORE INTO openclaw_documents (id, title, content, doc_type, category, tags, version, status, created_at, updated_at)
VALUES (
    'doc-proc-metadata',
    '01900 Procurement — Complete Metadata Bundle',
    readfile('agent-companies-core/docs-agent-companies/disciplines-shared/testing/projects/PROCURE-TEST/knowledge/METADATA-BUNDLE.md'),
    'article',
    'procurement-testing',
    '["metadata", "procurement", "01900", "bundle"]',
    '1.1',
    'active',
    datetime('now'),
    datetime('now')
);

-- =================================================
-- 5. PAGE-KNOWLEDGE.md
-- =================================================
INSERT OR IGNORE INTO openclaw_documents (id, title, content, doc_type, category, tags, version, status, created_at, updated_at)
VALUES (
    'doc-proc-page-knowledge',
    '01900 Procurement Page — Component Knowledge',
    readfile('agent-companies-core/docs-agent-companies/disciplines-shared/testing/projects/PROCURE-TEST/knowledge/PAGE-KNOWLEDGE.md'),
    'article',
    'procurement-testing',
    '["page-knowledge", "procurement", "01900", "components"]',
    '1.1',
    'active',
    datetime('now'),
    datetime('now')
);

-- =================================================
-- 6. PROCURE-TEST-implementation.md
-- =================================================
INSERT OR IGNORE INTO openclaw_documents (id, title, content, doc_type, category, tags, version, status, created_at, updated_at)
VALUES (
    'doc-proc-implementation',
    'PROCURE-TEST Project Implementation — 01900 Procurement Page Testing',
    readfile('agent-companies-core/docs-agent-companies/disciplines-shared/testing/projects/PROCURE-TEST/PROCURE-TEST-implementation.md'),
    'article',
    'procurement-testing',
    '["implementation", "procurement", "01900", "project"]',
    '1.0',
    'active',
    datetime('now'),
    datetime('now')
);

-- =================================================
-- 7. plan.md (Execution Plan)
-- =================================================
INSERT OR IGNORE INTO openclaw_documents (id, title, content, doc_type, category, tags, version, status, created_at, updated_at)
VALUES (
    'doc-proc-plan',
    'PROCURE-TEST Implementation Plan',
    readfile('agent-companies-core/docs-agent-companies/disciplines-shared/testing/projects/PROCURE-TEST/plan.md'),
    'article',
    'procurement-testing',
    '["plan", "procurement", "01900", "execution"]',
    '1.0',
    'active',
    datetime('now'),
    datetime('now')
);

-- =================================================
-- 8. README.md (Project Overview)
-- =================================================
INSERT OR IGNORE INTO openclaw_documents (id, title, content, doc_type, category, tags, version, status, created_at, updated_at)
VALUES (
    'doc-proc-readme',
    'PROCURE-TEST Project',
    readfile('agent-companies-core/docs-agent-companies/disciplines-shared/testing/projects/PROCURE-TEST/README.md'),
    'article',
    'procurement-testing',
    '["readme", "procurement", "01900", "overview"]',
    '1.0',
    'active',
    datetime('now'),
    datetime('now')
);

-- =================================================
-- Verify Upload
-- =================================================
SELECT '=== PROCURE-TEST Knowledge Documents ===' AS '';
SELECT id, title, doc_type, status, length(content) AS bytes, created_at
FROM openclaw_documents
WHERE category = 'procurement-testing'
ORDER BY id;

SELECT '=== Total Documents Uploaded ===' AS '';
SELECT COUNT(*) AS total FROM openclaw_documents WHERE category = 'procurement-testing';