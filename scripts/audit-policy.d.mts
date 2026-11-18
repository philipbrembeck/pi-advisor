export interface AuditFinding {
  packageName: string;
  id?: number | string;
  url: string;
  title: string;
  severity: string;
  vulnerable_versions: string;
}

export interface AuditProcessResult {
  status: number | null;
  error: Error | undefined;
  signal: NodeJS.Signals | null;
}

export function parseAuditFindings(output: string): AuditFinding[];
export function isTemporaryDevFinding(findings: AuditFinding[]): boolean;
export function isRegistryOutage(output: string): boolean;
export function isAuditProcessHealthy(result: AuditProcessResult): boolean;
