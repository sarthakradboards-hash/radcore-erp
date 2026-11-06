export const run = (job: { execute(): Promise<void> }) => job.execute();
