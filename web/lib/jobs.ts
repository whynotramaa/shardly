import type { Job } from "./api";

export function newTerminalJobs(jobs: Job[], seen: Set<string>): Job[] {
  return jobs.filter((job) => {
    if (job.status === "queued" || job.status === "running") return false;
    const key = `${job.id}:${job.status}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
