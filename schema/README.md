# Schema

**Status**: 📋 Placeholder — OpenClaw-specific schema definitions go here.

## Purpose

This directory will contain SQLite database schema definitions for OpenClaw orchestration. OpenClaw may use a different schema from Paperclip — once the OpenClaw data model is understood, table definitions, indexes, and migration scripts should be placed here.

## Expected Contents

- `create-tables.sql` — Core OpenClaw tables (companies, agents, tasks, api_keys, etc.)
- `indexes.sql` — Performance indexes
- `migrations/` — Schema version migrations
- `seed.sql` — Seed data for local development

## Reference

Paperclip schema (for reference during migration): `agent-companies-paperclip/packages/db/paperclip-schema/`

---

*Fill this in when OpenClaw data model is understood.*