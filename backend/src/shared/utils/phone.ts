/**
 * E.164 Phone Normalization & Validation Utility
 *
 * Strict adherence to ITU-T E.164 recommendations:
 * - Begins with '+' followed by country code (1-3 digits) and national number.
 * - Maximum 15 digits total (excluding '+').
 * - Minimum 7 digits.
 * - Strips all non-digit punctuation (spaces, dashes, parens, dots).
 */

export function normalizeE164(phone: string, defaultCountryCode: string = '91'): string {
  if (!phone || typeof phone !== 'string') {
    throw new Error('Phone number must be a non-empty string');
  }

  const trimmed = phone.trim();

  // If already starts with '+', keep the plus indicator
  const hasPlus = trimmed.startsWith('+');

  // Strip all non-digit characters
  const digitsOnly = trimmed.replace(/\D/g, '');

  if (digitsOnly.length < 7 || digitsOnly.length > 15) {
    throw new Error(`Invalid phone number length: ${digitsOnly.length} digits. Must be between 7 and 15 digits.`);
  }

  let normalized: string;

  if (hasPlus) {
    normalized = `+${digitsOnly}`;
  } else {
    // Check if starts with leading 0 (national trunk prefix in India/UK/etc.)
    let stripped = digitsOnly;
    if (stripped.startsWith('0') && stripped.length === 11) {
      stripped = stripped.slice(1);
    }

    // If 10 digits and default country code provided, prepend default country code
    if (stripped.length === 10 && defaultCountryCode) {
      normalized = `+${defaultCountryCode}${stripped}`;
    } else if (stripped.startsWith(defaultCountryCode) && stripped.length === 10 + defaultCountryCode.length) {
      normalized = `+${stripped}`;
    } else {
      normalized = `+${stripped}`;
    }
  }

  if (!isValidE164(normalized)) {
    throw new Error(`Normalized phone '${normalized}' is not a valid E.164 number`);
  }

  return normalized;
}

export function isValidE164(phone: string): boolean {
  if (!phone || typeof phone !== 'string') return false;
  // E.164 regex: + followed by non-zero country code digit, then 6 to 14 digits (7-15 digits total)
  return /^\+[1-9]\d{6,14}$/.test(phone);
}
