-- Migration: Drop project-management tables
-- Reason: project/task feature was retired (see commit e2e4730 removing
-- the pages, API routes, and components). The schema is dead weight.
-- ANNOTATIONS / ANNOTATION_ITEMS / ANNOTATION_OWNERS are intentionally
-- kept — they belong to the unrelated annotations feature still in use.

-- Drop in FK-dependency order: children first, parents last.
DROP TABLE IF EXISTS COMMENTS;
DROP TABLE IF EXISTS MILESTONES;
DROP TABLE IF EXISTS PROJECT_USERS;
DROP TABLE IF EXISTS ITEMS;
DROP TABLE IF EXISTS PROJECTS;
