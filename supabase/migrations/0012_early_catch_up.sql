-- Bentley Home Hub — allow early visibility ("Visible before due date") on "Do it once" (catch_up) tasks.
-- Upcoming rows are preview-only and completing a catch_up task only settles occurrences up to today, so the two combine safely.

alter table tasks drop constraint if exists tasks_visible_early_not_catch_up;
