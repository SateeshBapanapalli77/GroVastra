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
  clock: IClock = defaultClock
): { localDate: string; occurrenceYear: number; occurrenceId: string } {
  const currentNow = clock.now().setZone(timezone);
  const currentYear = currentNow.year;

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

  // If this year is already past (or skipped by LEAP_ONLY), check next year
  if (!targetDt || targetDt.startOf('day') < currentNow.startOf('day')) {
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
  const offsetDt = baseDt.plus({ days: offsetDays }).set({ hour, minute, second: 0, millisecond: 0 });

  return {
    dueAtUtc: offsetDt.toUTC().toJSDate(),
    localDate: offsetDt.toISODate()!,
    localTime,
    timezone
  };
}
