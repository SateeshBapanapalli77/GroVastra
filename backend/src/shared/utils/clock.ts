import { DateTime } from 'luxon';

export type LeapDayPolicy = 'FEB_28' | 'MAR_01' | 'LEAP_ONLY';

export interface IClock {
  now(): DateTime;
  nowUtc(): Date;
}

export class SystemClock implements IClock {
  now(): DateTime {
    return DateTime.now();
  }

  nowUtc(): Date {
    return new Date();
  }
}

/**
 * Clock that can be frozen or advanced in integration tests
 */
export class SettableTestClock implements IClock {
  private currentInstant: DateTime;

  constructor(initialIso: string = '2026-10-14T10:00:00.000Z') {
    this.currentInstant = DateTime.fromISO(initialIso, { zone: 'utc' });
  }

  set(isoString: string): void {
    this.currentInstant = DateTime.fromISO(isoString, { zone: 'utc' });
  }

  advanceMinutes(minutes: number): void {
    this.currentInstant = this.currentInstant.plus({ minutes });
  }

  advanceDays(days: number): void {
    this.currentInstant = this.currentInstant.plus({ days });
  }

  now(): DateTime {
    return this.currentInstant;
  }

  nowUtc(): Date {
    return this.currentInstant.toJSDate();
  }
}

export const defaultClock: IClock = new SystemClock();

/**
 * Resolves the next annual occasion date (e.g. Birthday, Anniversary)
 * respecting timezone and explicit leap-day rules.
 */
export function resolveNextAnnualOccurrence(
  month: number, // 1-12
  day: number,   // 1-31
  timezone: string = 'Asia/Kolkata',
  leapDayPolicy: LeapDayPolicy = 'FEB_28',
  clockOrDate: IClock | Date = defaultClock,
  lookbackDays: number = 0
): { localDate: string; occurrenceYear: number; occurrenceId: string } {
  const clock: IClock = clockOrDate instanceof Date
    ? new SettableTestClock(clockOrDate.toISOString())
    : (clockOrDate && typeof (clockOrDate as any).now === 'function' ? clockOrDate : defaultClock);
  const currentNow = clock.now().setZone(timezone);
  const currentYear = currentNow.year;
  const cutoff = currentNow.startOf('day').minus({ days: lookbackDays });

  // Function to build a date for a specific year considering leap-day
  const buildDateForYear = (year: number): DateTime | null => {
    const isLeapYear = DateTime.local(year).isInLeapYear;

    if (month === 2 && day === 29 && !isLeapYear) {
      if (leapDayPolicy === 'FEB_28') {
        return DateTime.fromObject({ year, month: 2, day: 28 }, { zone: timezone });
      }
      if (leapDayPolicy === 'MAR_01') {
        return DateTime.fromObject({ year, month: 3, day: 1 }, { zone: timezone });
      }
      if (leapDayPolicy === 'LEAP_ONLY') {
        return null; // Skip non-leap years
      }
    }

    return DateTime.fromObject({ year, month, day }, { zone: timezone });
  };

  // Check this year
  let targetDt = buildDateForYear(currentYear);
  let resolvedYear = currentYear;

  // If this year is earlier than cutoff (now minus lookbackDays), check next year
  if (!targetDt || targetDt.startOf('day') < cutoff) {
    resolvedYear = currentYear + 1;
    targetDt = buildDateForYear(resolvedYear);

    // In rare cases where LEAP_ONLY skips next year too, find next leap year
    while (!targetDt) {
      resolvedYear++;
      targetDt = buildDateForYear(resolvedYear);
    }
  }

  return {
    localDate: targetDt.toISODate()!,
    occurrenceYear: resolvedYear,
    occurrenceId: `${resolvedYear}`
  };
}

/**
 * Calculates dueAt UTC instant by taking occasion localDate,
 * adding signed offsetDays, setting localTime (HH:mm), and converting via IANA timezone to UTC.
 * Resolves DST gaps (missing hours advance to next valid local time, B07).
 */
export function calculateDueInstant(
  occasionLocalDate: string, // 'YYYY-MM-DD'
  offsetDays: number,        // e.g. -14, -7, 0
  localTime: string,         // '10:00'
  timezone: string = 'Asia/Kolkata'
): { dueAtUtc: Date; localDate: string; localTime: string; timezone: string } {
  const [hourStr, minStr] = localTime.split(':');
  const hour = parseInt(hourStr || '10', 10);
  const minute = parseInt(minStr || '00', 10);

  const baseDt = DateTime.fromISO(occasionLocalDate, { zone: timezone });
  let offsetDt = baseDt.plus({ days: offsetDays }).set({ hour, minute, second: 0, millisecond: 0 });

  // DST handling (Spec p.31 test B07): if hour falls in spring-forward gap, Luxon/advance to valid hour
  if (!offsetDt.isValid) {
    offsetDt = baseDt.plus({ days: offsetDays }).set({ hour: hour + 1, minute, second: 0, millisecond: 0 });
  }

  return {
    dueAtUtc: offsetDt.toUTC().toJSDate(),
    localDate: offsetDt.toISODate()!,
    localTime,
    timezone
  };
}

/**
 * Adjusts send time for allowed hours (e.g. 10:00-19:00) and blackout dates (Handoff p.7, test B08).
 * Never pushes a send past expiresAt; skips with reason if deadline exceeded.
 */
export function adjustForAllowedHoursAndBlackouts(
  initialDueAt: Date,
  expiresAt: Date,
  timezone: string = 'Asia/Kolkata',
  allowedHours: { start: string; end: string } = { start: '10:00', end: '19:00' },
  blackoutDates: string[] = []
): { valid: boolean; adjustedDueAt: Date; reason?: string } {
  let dt = DateTime.fromJSDate(initialDueAt, { zone: timezone });
  const [startH, startM] = allowedHours.start.split(':').map(Number);
  const [endH, endM] = allowedHours.end.split(':').map(Number);

  // Check if current date is a blackout
  let attempts = 0;
  while (attempts < 30) {
    const isBlackout = blackoutDates.includes(dt.toISODate()!);
    const timeNum = dt.hour * 60 + dt.minute;
    const startNum = startH * 60 + startM;
    const endNum = endH * 60 + endM;

    if (isBlackout) {
      // Advance to next morning at start hour
      dt = dt.plus({ days: 1 }).set({ hour: startH, minute: startM, second: 0, millisecond: 0 });
      attempts++;
      continue;
    }

    if (timeNum < startNum) {
      dt = dt.set({ hour: startH, minute: startM, second: 0, millisecond: 0 });
      break;
    }

    if (timeNum >= endNum) {
      // Move to next morning
      dt = dt.plus({ days: 1 }).set({ hour: startH, minute: startM, second: 0, millisecond: 0 });
      attempts++;
      continue;
    }

    break;
  }

  const adjustedDueAt = dt.toUTC().toJSDate();
  if (adjustedDueAt >= expiresAt) {
    return {
      valid: false,
      adjustedDueAt,
      reason: 'SKIPPED_BLACKOUT_EXPIRED'
    };
  }

  return {
    valid: true,
    adjustedDueAt
  };
}
