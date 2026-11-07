import { intakeSchema } from './admissions-config.service.js';

describe('intakeSchema', () => {
  const intake = {
    name: 'September intake',
    opensAt: '2026-08-01T00:00:00.000Z',
    closesAt: '2026-09-01T00:00:00.000Z',
    startsOn: null,
    isActive: true,
  };

  it('allows an intake without a pop-up', () => {
    const result = intakeSchema.safeParse(intake);

    expect(result.success).toBe(true);
  });

  it('requires a title, details and photo for an enabled pop-up', () => {
    const result = intakeSchema.safeParse({
      ...intake,
      popupEnabled: true,
      popupTitle: 'Apply now',
      popupDetails: 'Applications are open.',
      popupImageId: null,
    });

    expect(result.success).toBe(false);
  });

  it('accepts a complete enabled pop-up', () => {
    const result = intakeSchema.safeParse({
      ...intake,
      popupEnabled: true,
      popupTitle: 'Apply now',
      popupDetails: 'Applications are open.',
      popupImageId: 12,
    });

    expect(result.success).toBe(true);
  });
});
