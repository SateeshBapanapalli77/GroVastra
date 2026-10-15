import { describe, it, expect } from 'vitest';
import { normalizeE164, isValidE164 } from '../src/shared/utils/phone';

describe('P0.c: E.164 Phone Normalization Utility', () => {
  it('correctly normalizes 10-digit Indian numbers with default country code', () => {
    expect(normalizeE164('9876543210')).toBe('+919876543210');
  });

  it('handles numbers with leading 0 (national trunk prefix)', () => {
    expect(normalizeE164('09876543210')).toBe('+919876543210');
  });

  it('normalizes numbers already containing country code without plus', () => {
    expect(normalizeE164('919876543210')).toBe('+919876543210');
  });

  it('preserves valid numbers with leading plus', () => {
    expect(normalizeE164('+919876543210')).toBe('+919876543210');
    expect(normalizeE164('+15551234567')).toBe('+15551234567');
  });

  it('strips whitespace, dashes, and parentheses', () => {
    expect(normalizeE164('+91 (987) 65-43210')).toBe('+919876543210');
    expect(normalizeE164('+1 555-123-4567')).toBe('+15551234567');
  });

  it('rejects numbers that are too short or too long', () => {
    expect(() => normalizeE164('12345')).toThrow(/Invalid phone number length/);
    expect(() => normalizeE164('12345678901234567890')).toThrow(/Invalid phone number length/);
  });

  it('rejects empty or non-string inputs', () => {
    expect(() => normalizeE164('')).toThrow(/non-empty string/);
    expect(() => normalizeE164(null as any)).toThrow(/non-empty string/);
  });

  it('validates strings with isValidE164', () => {
    expect(isValidE164('+919876543210')).toBe(true);
    expect(isValidE164('+15551234567')).toBe(true);
    expect(isValidE164('9876543210')).toBe(false);
    expect(isValidE164('+0123456789')).toBe(false); // Country code cannot start with 0
    expect(isValidE164('')).toBe(false);
  });
});
