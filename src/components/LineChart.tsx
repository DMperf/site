import { useEffect, useId, useRef, useState, type PointerEvent } from 'react'

interface Props {
  points: { x: number; y: number }[]
  xLabel: string
  yLabel: string
  formatX?: (x: number) => string
  formatY?: (y: number) => string
  height?: number
  /** Optionale Markierung, z. B. Leistungsspitze. */
  highlight?: { x: number; y: number; label: string }
}

const PAD = { top: 28, right: 16, bottom: 34, left: 48 }

function niceTicks(min: number, max: number, count = 5) {
  const span = max - min || 1
  const raw = span / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? raw
  const ticks: number[] = []
  const end = Math.ceil(max / step - 1e-9) * step
  for (let v = Math.floor(min / step + 1e-9) * step; v <= end + 1e-9; v += step) ticks.push(v)
  return ticks
}

/** Einfaches Liniendiagramm (eine Reihe) mit Fadenkreuz-Tooltip. */
export function LineChart({
  points,
  xLabel,
  yLabel,
  formatX = (x) => x.toFixed(0),
  formatY = (y) => y.toFixed(0),
  height = 260,
  highlight,
}: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const [W, setW] = useState(600)
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()

  // Echte Breite messen, damit Schrift nicht mitskaliert.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setW(Math.max(280, entry.contentRect.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (points.length < 2) return null

  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yTicks = niceTicks(Math.min(0, ...ys), Math.max(...ys) * 1.05)
  const yMin = yTicks[0]
  const yMax = yTicks[yTicks.length - 1]
  const xTicks = niceTicks(xMin, xMax, W < 450 ? 4 : 6).filter((t) => t >= xMin && t <= xMax)

  const plotW = W - PAD.left - PAD.right
  const plotH = height - PAD.top - PAD.bottom
  const sx = (x: number) => PAD.left + ((x - xMin) / (xMax - xMin || 1)) * plotW
  const sy = (y: number) => PAD.top + (1 - (y - yMin) / (yMax - yMin || 1)) * plotH
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('')

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = xMin + ((e.clientX - rect.left) / rect.width) * (xMax - xMin)
    let best = 0
    points.forEach((p, i) => {
      if (Math.abs(p.x - x) < Math.abs(points[best].x - x)) best = i
    })
    setHover(best)
  }

  const h = hover === null ? null : points[hover]

  return (
    <div ref={ref}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        width={W}
        height={height}
        className="block max-w-full select-none"
        role="img"
        aria-labelledby={titleId}
      >
        <title id={titleId}>{`${yLabel} über ${xLabel}`}</title>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)} className="stroke-zinc-800" />
            <text x={PAD.left - 8} y={sy(t)} dy="0.32em" textAnchor="end" className="fill-zinc-500 text-[11px]">
              {formatY(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={sx(t)} y={height - PAD.bottom + 16} textAnchor="middle" className="fill-zinc-500 text-[11px]">
            {formatX(t)}
          </text>
        ))}
        <text x={W - PAD.right} y={height - 4} textAnchor="end" className="fill-zinc-500 text-[11px]">
          {xLabel}
        </text>
        <text x={PAD.left - 8} y={12} textAnchor="end" className="fill-zinc-500 text-[11px]">
          {yLabel}
        </text>

        <path d={path} fill="none" strokeWidth={2} strokeLinejoin="round" className="stroke-red-500" />

        {highlight && (
          <g>
            <circle cx={sx(highlight.x)} cy={sy(highlight.y)} r={4} className="fill-red-500 stroke-zinc-900" strokeWidth={2} />
            <text
              x={sx(highlight.x)}
              y={sy(highlight.y) - 10}
              textAnchor="middle"
              className="fill-zinc-100 text-[12px] font-semibold"
            >
              {highlight.label}
            </text>
          </g>
        )}

        {h && (
          <g pointerEvents="none">
            <line x1={sx(h.x)} x2={sx(h.x)} y1={PAD.top} y2={PAD.top + plotH} className="stroke-zinc-500" strokeDasharray="3 3" />
            <circle cx={sx(h.x)} cy={sy(h.y)} r={4} className="fill-red-500 stroke-zinc-900" strokeWidth={2} />
            <g transform={`translate(${Math.min(sx(h.x) + 8, W - PAD.right - 120)},${PAD.top + 4})`}>
              <rect width={120} height={40} rx={6} className="fill-zinc-800 stroke-zinc-700" />
              <text x={8} y={16} className="fill-zinc-400 text-[11px]">
                {xLabel}: {formatX(h.x)}
              </text>
              <text x={8} y={32} className="fill-zinc-100 text-[12px] font-semibold">
                {yLabel}: {formatY(h.y)}
              </text>
            </g>
          </g>
        )}

        <rect
          x={PAD.left}
          y={PAD.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
    </div>
  )
}
