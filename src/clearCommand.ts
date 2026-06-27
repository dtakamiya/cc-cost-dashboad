export function buildClearCommand(cwd: string): string {
  if (!cwd) return "claude clear";
  // Single-quote to handle spaces and metacharacters; escape embedded single quotes.
  const escaped = cwd.replace(/'/g, "'\\''");
  return `cd '${escaped}' && claude clear`;
}
