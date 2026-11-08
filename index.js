/**
 * dsh-task-progress — Host half.
 *
 * The plugin is intentionally client-only: the shipped `jobs` client service
 * already streams job rows and job output to the browser (job.list / job.follow),
 * so the progress card needs no Host code, no HTTP route and no polling loop.
 */
export function apply() {}
