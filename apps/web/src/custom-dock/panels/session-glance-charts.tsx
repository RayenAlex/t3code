import { useId } from "react";

import { useDockCopy } from "../host/panelContext";
import type { RunTelemetry } from "../host/types";

const WIDTH = 320;
const LEFT = 35;
const RIGHT = 306;
const BASE = 55;
const HEIGHT = 43;
const COLORS = [
  "var(--chart-1,var(--primary))",
  "var(--chart-2,var(--success-foreground))",
  "var(--chart-3,var(--warning-foreground))",
  "var(--chart-4,var(--info-foreground))",
  "var(--chart-5,var(--guest-foreground))",
];

type Data = {
  readonly values: readonly (number | null)[];
  readonly label: string;
  readonly color: string;
};

function Plot({
  rows,
  runIds,
  maximum,
  line,
  label,
  format,
}: {
  readonly rows: readonly Data[];
  readonly runIds: readonly string[];
  readonly maximum: number;
  readonly line?: boolean;
  readonly label: string;
  readonly format: (value: number) => string;
}) {
  const id = useId();
  const count = runIds.length;
  const column = (RIGHT - LEFT) / Math.max(1, count);
  const x = (index: number) => LEFT + column * (index + 0.5);
  const size = (v: number) => (HEIGHT * v) / maximum;
  return (
    <figure className="space-y-0.5">
      <figcaption id={id} className="text-2xs font-medium text-muted-foreground">
        {label}
      </figcaption>
      <svg
        role="img"
        aria-labelledby={id}
        viewBox={`0 0 ${WIDTH} 73`}
        className="block h-auto w-full font-mono text-4xs tabular-nums"
      >
        <path
          d={`M${LEFT} 12 H${RIGHT} M${LEFT} ${BASE} H${RIGHT}`}
          fill="none"
          stroke="var(--border)"
        />
        <text x={LEFT - 4} y="15" fill="var(--muted-foreground)" textAnchor="end">
          {format(maximum)}
        </text>
        <text x={LEFT - 4} y={BASE + 3} fill="var(--muted-foreground)" textAnchor="end">
          0
        </text>
        {line
          ? rows.map((row) => (
              <g key={row.label}>
                <path
                  d={row.values
                    .map((v, index) =>
                      v === null
                        ? ""
                        : `${index > 0 && row.values[index - 1] !== null ? "L" : "M"}${x(index)},${BASE - size(v)}`,
                    )
                    .join(" ")}
                  fill="none"
                  stroke={row.color}
                  strokeWidth="1.8"
                />
                {row.values.map((v, index) =>
                  v === null ? null : (
                    <circle
                      key={runIds[index]}
                      cx={x(index)}
                      cy={BASE - size(v)}
                      r="2.8"
                      fill={row.color}
                    >
                      <title>{`${row.label} · ${format(v)}`}</title>
                    </circle>
                  ),
                )}
              </g>
            ))
          : Array.from({ length: count }, (_, index) => {
              const bar = Math.min(column * 0.58, 20);
              let top = BASE;
              return (
                <g key={runIds[index]}>
                  {rows.map((row) => {
                    const value = row.values[index];
                    if (value == null || value === 0) return null;
                    const h = size(value);
                    top -= h;
                    return (
                      <rect
                        key={row.label}
                        x={x(index) - bar / 2}
                        y={top}
                        width={bar}
                        height={h}
                        rx="1"
                        fill={row.color}
                      >
                        <title>{`${row.label} · ${format(value)}`}</title>
                      </rect>
                    );
                  })}
                </g>
              );
            })}
        {Array.from({ length: count }, (_, index) => (
          <text
            key={runIds[index]}
            x={x(index)}
            y="68"
            fill="var(--muted-foreground)"
            textAnchor="middle"
          >
            {index + 1}
          </text>
        ))}
      </svg>
    </figure>
  );
}

export function SessionGlanceCharts({ runs }: { readonly runs: readonly RunTelemetry[] }) {
  const copy = useDockCopy();
  const newest = runs.slice(-10);
  const number = new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const format = (value: number) => number.format(value);
  const rates = newest.map((run) => run.turnAvgOutputTps);
  const hit = newest.map((run) => run.cacheHitRate);
  const tokenSeries = [
    {
      label: copy.cacheRead,
      values: newest.map((run) => run.tokenUsage?.cachedInputTokens ?? null),
      color: COLORS[1]!,
    },
    {
      label: copy.cacheWrite,
      values: newest.map((run) => run.tokenUsage?.cacheWriteInputTokens ?? null),
      color: COLORS[2]!,
    },
    {
      label: copy.uncached,
      values: newest.map((run) => run.tokenUsage?.uncachedInputTokens ?? null),
      color: COLORS[3]!,
    },
    {
      label: copy.output,
      values: newest.map((run) => run.tokenUsage?.outputTokens ?? null),
      color: COLORS[4]!,
    },
  ];
  const maxTokens = Math.max(
    1,
    ...newest.map((_, index) =>
      tokenSeries.reduce((sum, row) => sum + (row.values[index] ?? 0), 0),
    ),
  );
  const hasHistory = newest.some(
    (run) => run.tokenUsage || run.turnAvgOutputTps !== null || run.cacheHitRate !== null,
  );
  return (
    <section
      aria-label={copy.history}
      className="space-y-2.5 rounded-xl border border-border bg-card p-3"
      data-custom-dock-history
    >
      <header>
        <h3 className="text-sm font-semibold">{copy.history}</h3>
        <p className="text-2xs text-muted-foreground">
          {hasHistory ? copy.historyNotice : copy.noHistory}
        </p>
      </header>
      {hasHistory && (
        <>
          <Plot
            runIds={newest.map((run) => run.runId)}
            rows={[{ label: copy.cache, values: hit, color: COLORS[1]! }]}
            maximum={1}
            line
            label={copy.cache}
            format={(value) => `${Math.round(value * 100)}%`}
          />
          <Plot
            runIds={newest.map((run) => run.runId)}
            rows={[{ label: copy.avgTps, values: rates, color: COLORS[0]! }]}
            maximum={Math.ceil(Math.max(1, ...rates.map((value) => value ?? 0)))}
            label={copy.avgTps}
            format={format}
          />
          <Plot
            runIds={newest.map((run) => run.runId)}
            rows={tokenSeries}
            maximum={maxTokens}
            label={copy.tokens}
            format={format}
          />
          <ul className="flex flex-wrap gap-x-2.5 gap-y-1 text-3xs text-muted-foreground">
            {tokenSeries.map((row) => (
              <li key={row.label} className="flex items-center gap-1">
                <span className="size-1.5 rounded-full" style={{ backgroundColor: row.color }} />
                {row.label}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
