const pad = (n: number): string => String(n).padStart(2, '0')

export const localDate = (ms: number): string => {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export const localHour = (ms: number): number => new Date(ms).getHours()
