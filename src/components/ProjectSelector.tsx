interface ProjectOption {
  cwd: string;
  cost: number;
  tokens: number;
}

function projectName(cwd: string): string {
  return cwd.split(/[\\/]+/).filter(Boolean).pop() ?? cwd;
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
          {projectName(p.cwd)}
        </option>
      ))}
    </select>
  );
}
