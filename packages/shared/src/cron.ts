import { CronExpressionParser } from 'cron-parser'

export function isValidCron(expr: string): boolean {
  try {
    CronExpressionParser.parse(expr)
    return true
  } catch {
    return false
  }
}

// Next fire time strictly after `from`, in UTC.
export function nextRun(expr: string, from: Date = new Date()): Date {
  return CronExpressionParser.parse(expr, { currentDate: from, tz: 'UTC' }).next().toDate()
}
