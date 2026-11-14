'use strict';

const { findValidatedHuCandidate } = require('../../e2e/wm/roundTripHuTransfer.e2e');

describe('HU stock transfer dry-run candidate selection', () => {
  test('continues past a rejected first HU and selects a later valid HU for the same reservation', async () => {
    const validate = jest.fn()
      .mockResolvedValueOnce({ Valid: false, StatusMessage: 'HU is on hold' })
      .mockResolvedValueOnce({ Valid: true });

    const result = await findValidatedHuCandidate([
      { ReservationNo: 'R1', ReservationItem: '10' }
    ], {
      getBins: async () => [
        { UnitCategory: 'HU', AvailableStock: '1', UnitNumber: 'HU-REJECTED' },
        { UnitCategory: 'HU', AvailableStock: '2', UnitNumber: 'HU-VALID' },
        { UnitCategory: 'HU', AvailableStock: '0', UnitNumber: 'HU-EMPTY' },
        { UnitCategory: 'BIN', AvailableStock: '5', UnitNumber: 'BIN-1' }
      ],
      validate
    });

    expect(validate).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      reservationNo: 'R1',
      reservationItem: '10',
      unitNumber: 'HU-VALID',
      probe: 'validateUnit Valid'
    });
  });

  test('checks beyond the first five candidates and selects a later valid HU', async () => {
    const items = Array.from({ length: 6 }, (_, index) => ({
      ReservationNo: `R${index + 1}`,
      ReservationItem: '10'
    }));
    const validate = jest.fn(async (candidate) => ({ Valid: candidate.unitNumber === 'HU-6', StatusMessage: 'rejected' }));

    const result = await findValidatedHuCandidate(items, {
      getBins: async (item) => [{ UnitCategory: 'HU', AvailableStock: '1', UnitNumber: `HU-${item.ReservationNo.slice(1)}` }],
      validate
    });

    expect(validate).toHaveBeenCalledTimes(6);
    expect(result.unitNumber).toBe('HU-6');
  });

  test('reports when the searched reservations have no positive-stock HU', async () => {
    await expect(findValidatedHuCandidate([
      { ReservationNo: 'R1', ReservationItem: '10' }
    ], {
      getBins: async () => [{ UnitCategory: 'HU', AvailableStock: '0', UnitNumber: 'HU-EMPTY' }],
      validate: jest.fn()
    })).rejects.toThrow('no open reservation with an HU in stock');
  });
});
