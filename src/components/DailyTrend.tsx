import { useState, useEffect } from "react";
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
  ReferenceLine,
} from "recharts";
import type { Summary, Period } from "../api";
import { shiftDailyDates } from "../api";
import { toWeekly } from "../weekly";
import { compact, usd, modelColor } from "../format";

const safeId = (m: string, i: number) => `grad-${i}-${m.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

const PREV_KEY = "__prev_total";

type View = "daily" | "weekly";
type DisplayMode = "tokens" | "cost";

interface DailyTrendTooltipProps {
  active?: boolean;
  payload?: Array<{ dataKey: string; payload: Record<string, unknown> }>;
}

function DailyTrendTooltip({ active, payload }: DailyTrendTooltipProps) {
  if (!active || !payload?.[0]) return null;
  const data = payload[0].payload as Record<string, number | Record<string, number>>;
  const tokens = data._allTokens as Record<string, number> | undefined;
  const costs = data._allCosts as Record<string, number> | undefined;
  const model = payload[0].dataKey;

  if (!tokens || !costs) return null;

  return (
    <div style={{ background: "var(--tooltip-bg)", border: "1px solid var(--tooltip-border)", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.35)", padding: 8, color: "var(--text)" }}>
      <p style={{ margin: "4px 0", fontWeight: 600 }}>{model}</p>
      <p style={{ margin: "2px 0", fontSize: 12 }}>Token: {compact(tokens[model] ?? 0)}</p>
      <p style={{ margin: "2px 0", fontSize: 12 }}>Cost: {usd(costs[model] ?? 0)}</p>
    </div>
  );
}

const isLongPeriod = (period: Period | undefined): boolean =>
  period === "90d" || period === "all";

export function DailyTrend({ s, prev, prevOffsetDays, period }: { s: Summary; prev?: Summary; prevOffsetDays?: number; period?: Period }) {
  const [view, setView] = useState<View>(isLongPeriod(period) ? "weekly" : "daily");
  const [mode, setMode] = useState<DisplayMode>("tokens");

  useEffect(() => {
    setView(isLongPeriod(period) ? "weekly" : "daily");
  }, [period]);

  const models = s.models.map((m) => m.model);
  const xKey = view === "weekly" ? "weekStart" : "date";
  const fmt = mode === "cost" ? usd : compact;

  const rows =
    view === "weekly"
      ? toWeekly(s.daily).map((w) => ({ key: w.weekStart, tokenModels: w.tokenModels, costModels: w.models, cacheReadRatio: w.cacheReadRatio }))
      : s.daily.map((d) => ({ key: d.date, tokenModels: d.tokenModels, costModels: d.models, cacheReadRatio: d.cacheReadRatio }));

  const showPrev = view === "daily" && prev && prevOffsetDays != null;
  const prevTotalByDate = new Map<string, number>();
  const prevTokenTotalByDate = new Map<string, number>();
  if (showPrev) {
    for (const d of shiftDailyDates(prev!.daily, prevOffsetDays!)) {
      prevTotalByDate.set(d.date, d.total ?? 0);
      prevTokenTotalByDate.set(d.date, d.tokenTotal ?? 0);
    }
  }

  const data = rows.map((r) => {
    const row: Record<string, number | string | Record<string, number>> = { [xKey]: r.key };
    const allTokens: Record<string, number> = {};
    const allCosts: Record<string, number> = {};
    for (const m of models) {
      const tokenVal = r.tokenModels?.[m] ?? 0;
      const costVal = r.costModels?.[m] ?? 0;
      allTokens[m] = tokenVal;
      allCosts[m] = costVal;
      row[m] = mode === "cost" ? costVal : tokenVal;
    }
    row._allTokens = allTokens;
    row._allCosts = allCosts;
    row.cacheReadRatio = (r.cacheReadRatio ?? 0) * 100;
    if (showPrev && prevTotalByDate.has(r.key)) row[PREV_KEY] = mode === "cost" ? prevTotalByDate.get(r.key)! : prevTokenTotalByDate.get(r.key)!;
    return row;
  });

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{mode === "cost" ? "コスト推移" : "トークン推移"}</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <div className="seg" role="group" aria-label="表示モード">
            <button type="button" aria-pressed={mode === "tokens"} className={mode === "tokens" ? "active" : ""} onClick={() => setMode("tokens")}>
              トークン
            </button>
            <button type="button" aria-pressed={mode === "cost"} className={mode === "cost" ? "active" : ""} onClick={() => setMode("cost")}>
              コスト
            </button>
          </div>
          <div className="seg" role="group" aria-label="集計粒度">
            <button type="button" aria-pressed={view === "daily"} className={view === "daily" ? "active" : ""} onClick={() => setView("daily")}>
              日次
            </button>
            <button type="button" aria-pressed={view === "weekly"} className={view === "weekly" ? "active" : ""} onClick={() => setView("weekly")}>
              週次
            </button>
          </div>
        </div>
      </div>
      {view === "weekly" && isLongPeriod(period) && (
        <p className="aggregation-note" aria-live="polite">
          データ量が多いため週次集約で表示しています
        </p>
      )}
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
          <YAxis yAxisId="left" tickFormatter={fmt} stroke="var(--axis)" tick={{ fontSize: 11 }} width={56} />
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={[0, 100]}
            tickFormatter={(v) => `${v}%`}
            stroke="var(--axis)"
            tick={{ fontSize: 11 }}
          />
          <Tooltip
            content={<DailyTrendTooltip />}
            cursor={{ stroke: "var(--axis)", strokeDasharray: "3 3" }}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" />
          {models.map((m, i) => (
            <Area
              key={m}
              yAxisId="left"
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
              yAxisId="left"
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
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="cacheReadRatio"
            name="キャッシュ活用率"
            stroke="#f59e0b"
            strokeWidth={1.5}
            dot={false}
          />
          <ReferenceLine
            yAxisId="right"
            y={60}
            stroke="var(--muted)"
            strokeDasharray="4 4"
            label={{ value: "60%", position: "insideTopRight", fontSize: 10 }}
          />
          <ReferenceLine
            yAxisId="right"
            y={80}
            stroke="var(--muted)"
            strokeDasharray="4 4"
            label={{ value: "80%", position: "insideTopRight", fontSize: 10 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </section>
  );
}
