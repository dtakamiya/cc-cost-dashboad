// 絵文字ハードコードを廃し、集約型の SVG アイコンで統一する。
// KISS/YAGNI のため lucide-react 等は追加せず、必要なアイコンのみ自前実装する。

export type IconName =
  | "token"
  | "sessions"
  | "calendar"
  | "cost"
  | "check"
  | "warning"
  | "sun"
  | "moon"
  | "refresh"
  | "thumbsUp";

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  "aria-label"?: string;
}

const PATHS: Record<IconName, React.ReactNode> = {
  token: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9h6v6H9z" />
    </>
  ),
  sessions: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M7 7V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  cost: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M9.5 9.5c0-1.5 1.2-2.5 2.5-2.5s2.5 1 2.5 2c0 2-5 1.5-5 4 0 1 1.2 2.5 2.5 2.5s2.5-1 2.5-2.5" />
    </>
  ),
  check: <path d="M4 12l5 5L20 6" />,
  warning: (
    <>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  refresh: (
    <>
      <path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3" />
      <path d="M18 3v4h-4M6 21v-4h4" />
    </>
  ),
  thumbsUp: (
    <>
      <path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" />
      <path d="M7 11l3.5-7a2 2 0 0 1 2 2v3h5.2a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.5 20H9a2 2 0 0 1-2-2" />
    </>
  ),
};

/** 絵文字を置き換える集約型 SVG アイコン。name で表示するアイコンを切り替える。 */
export function Icon({ name, size = 16, className, "aria-label": ariaLabel }: IconProps) {
  const isDecorative = !ariaLabel;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={isDecorative ? undefined : "img"}
      aria-label={ariaLabel}
      aria-hidden={isDecorative ? "true" : undefined}
      data-testid={`icon-${name}`}
    >
      {PATHS[name]}
    </svg>
  );
}
