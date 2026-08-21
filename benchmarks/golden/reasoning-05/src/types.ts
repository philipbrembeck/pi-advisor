export interface Job {
  id: string;
  payload: string;
}

export interface JobResult {
  attempts: number;
  id: string;
  status: "completed" | "duplicate";
  value?: string;
}
