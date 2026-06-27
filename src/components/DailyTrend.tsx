import { useState } from "react";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import type { Summary } from "../api";
import { shiftDailyDates } from "../api";
import { toWeekly } from "../weekly";
import { compact, modelColor } from "../format";

const safeId = (m: string, i: number) => `grad-${i}-${m.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

const PREV_KEY = "__prev_total";

type View = "daily" | "weekly";

export function DailyTrend({ s, prev, prevOffsetDays }: { s: Summary; prev?: Summary; prevOffsetDays?: number }) {
  const [view, setView] = useState<View>("daily");
  const models = s.models.map((m) => m.model);

  const xKey = view === "weekly" ? "weekStart" : "date";
  const rows =
    view === "weekly"
      ? toWeekly(s.daily).map((w) => ({ key: w.weekStart, tokenModels: w.tokenModels }))
      : s.daily.map((d) => ({ key: d.date, tokenModels: d.tokenModels }));

  // 前期オーバーレイ（日次のみ）: 前期の日付を現在期間に合わせてずらし、日付→合計トークンの対応表を作る。
  const showPrev = view === "daily" && prev && prevOffsetDays != null;
  const prevTotalByDate = new Map<string, number>();
  if (showPrev) {
    for (const d of shiftDailyDates(prev!.daily, prevOffsetDays!)) {
      prevTotalByDate.set(d.date, d.tokenTotal ?? 0);
    }
  }

  const data = rows.map((r) => {
    const row: Record<string, number | string> = { [xKey]: r.key };
    for (const m of models) row[m] = r.tokenModels?.[m] ?? 0;
    if (showPrev && prevTotalByDate.has(r.key)) row[PREV_KEY] = prevTotalByDate.get(r.key)!;
    return row;
  });

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>トークン推移</h2>
        <div className="seg" role="group" aria-label="集計粒度">
          <button type="button" aria-pressed={view === "daily"} className={view === "daily" ? "active" : ""} onClick={() => setView("daily")}>
            日次
          </button>
          <button type="button" aria-pressed={view === "weekly"} className={view === "weekly" ? "active" : ""} onClick={() => setView("weekly")}>
            週次
          </button>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={data} margin={{ left: 8, right: 24, top: 8 }}>
          <defs>
            {models.map((m, i) => (
              <linearGradient key={m} id={safeId(m, i)} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={modelColor(m)} stopOpacity={0.7} />
                <stop offset="100%" stopColor={modelColor(m)} stopOpacity={0.05} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey={xKey} stroke="var(--axis)" tick={{ fontSize: 11 }} tickMargin={8} />
          <YAxis tickFormatter={(v) => compact(v)} stroke="var(--axis)" tick={{ fontSize: 11 }} width={56} />
          <Tooltip
            formatter={(v: number) => compact(v)}
            cursor={{ stroke: "var(--axis)", strokeDasharray: "3 3" }}
            contentStyle={{
              background: "var(--tooltip-bg)",
              border: "1px solid var(--tooltip-border)",
              borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" />
          {models.map((m, i) => (
            <Area
              key={m}
              type="monotone"
              dataKey={m}
              stackId="1"
              stroke={modelColor(m)}
              strokeWidth={1.5}
              fill={`url(#${safeId(m, i)})`}
            />
          ))}
          {showPrev && (
            <Line
              type="monotone"
              dataKey={PREV_KEY}
              name="前の期間（合計）"
              stroke="var(--muted)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              connectNulls
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </section>
  );
}
