interface ProjectOption {
  cwd: string;
  cost: number;
  tokens: number;
}

function segments(cwd: string): string[] {
  return cwd.split(/[\\/]+/).filter(Boolean);
}

function projectLabel(cwd: string, allCwds: string[]): string {
  const segs = segments(cwd);
  const name = segs.pop() ?? cwd;
  const isDuplicate = allCwds.some(
    (c) => c !== cwd && (segments(c).pop() ?? c) === name
  );
  return isDuplicate ? `${name} (${cwd})` : name;
}

export function ProjectSelector({
  projects,
  selected,
  onChange,
}: {
  projects: ProjectOption[];
  selected: string;
  onChange: (cwd: string) => void;
}) {
  const allCwds = projects.map((p) => p.cwd);
  return (
    <select
      className="project-selector"
      value={selected}
      onChange={(e) => onChange(e.target.value)}
      title="プロジェクトで絞り込む"
    >
      <option value="">すべてのプロジェクト</option>
      {projects.map((p) => (
        <option key={p.cwd} value={p.cwd}>
          {projectLabel(p.cwd, allCwds)}
        </option>
      ))}
    </select>
  );
}
