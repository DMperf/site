interface Props {
  values: number[]
  min: number
  max: number
}

export function Sparkline({ values, min, max }: Props) {
  if (values.length < 2) return <svg className="h-8 w-full" />
  const range = max - min || 1
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100
      const y = 30 - ((Math.min(max, Math.max(min, v)) - min) / range) * 28
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg className="h-8 w-full" viewBox="0 0 100 32" preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
