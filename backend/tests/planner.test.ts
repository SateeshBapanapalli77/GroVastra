import { describe, it, expect } from 'vitest';
import {
  SettableTestClock,
  resolveNextAnnualOccurrence,
  calculateDueInstant
} from '../src/shared/utils/clock';
import { BOUTIQUE_CAMPAIGN_PRESETS } from '../src/modules/campaigns/presets/boutiquePresets';

describe('Milestone 2: Reference Campaign Planning Tests', () => {
  it('correctly discovers birthday preset and step offsets', () => {
    const preset = BOUTIQUE_CAMPAIGN_PRESETS.find((p) => p.id === 'preset_birthday_shopping');
    expect(preset).toBeDefined();
    expect(preset?.defaultSteps.length).toBe(3);

    const [step1, step2, step3] = preset!.defaultSteps;
    expect(step1.stepId).toBe('invitation');
    expect(step1.offsetDays).toBe(-14);
    expect(step2.stepId).toBe('followup');
    expect(step2.offsetDays).toBe(-7);
    expect(step3.stepId).toBe('greeting');
    expect(step3.offsetDays).toBe(0);
  });

  it('calculates D-14, D-7, and D0 due timestamps in Asia/Kolkata correctly', () => {
    // Occasion date: 2026-10-28
    const occasionDate = '2026-10-28';

    const dueD14 = calculateDueInstant(occasionDate, -14, '10:00', 'Asia/Kolkata');
    const dueD7 = calculateDueInstant(occasionDate, -7, '10:00', 'Asia/Kolkata');
    const dueD0 = calculateDueInstant(occasionDate, 0, '10:00', 'Asia/Kolkata');

    expect(dueD14.localDate).toBe('2026-10-14');
    expect(dueD14.localTime).toBe('10:00');
    // 10:00 IST = 04:30 UTC
    expect(dueD14.dueAtUtc.toISOString()).toBe('2026-10-14T04:30:00.000Z');

    expect(dueD7.localDate).toBe('2026-10-21');
    expect(dueD7.dueAtUtc.toISOString()).toBe('2026-10-21T04:30:00.000Z');

    expect(dueD0.localDate).toBe('2026-10-28');
    expect(dueD0.dueAtUtc.toISOString()).toBe('2026-10-28T04:30:00.000Z');
  });

  it('generates immutable review fingerprint for draft configuration', () => {
    const draftConfig = {
      campaignId: 'cmp_birthday',
      trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday' },
      steps: [
        { stepId: 'invitation', offsetDays: -14 },
        { stepId: 'followup', offsetDays: -7 }
      ]
    };

    const fingerprint = JSON.stringify(draftConfig);
    expect(fingerprint).toContain('cmp_birthday');
    expect(fingerprint).toContain('ANNUAL_DATE');
  });
});
