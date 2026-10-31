const forbiddenPorts = new Set([3000, 3001, 9443, 4173, 4317, 48763]);

/** Accept only a complete, pinned native loopback listening line. */
export function readinessFromOutput(output: string): string | undefined {
  const match = /(?:^|\n)server listening on (http:\/\/127\.0\.0\.1:([1-9]\d{0,4}))\r?\n/.exec(output);
  return match && Number(match[2]) <= 65535 && !forbiddenPorts.has(Number(match[2])) ? match[1] : undefined;
}
