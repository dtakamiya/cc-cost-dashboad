export function buildClearCommand(cwd: string): string {
  return `cd ${cwd} && claude clear`;
}
