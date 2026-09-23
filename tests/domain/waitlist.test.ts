import { describe, expect, it } from 'vitest';
import { holdsPlace, leaveWaitlist, offerTo, settle } from '../../src/domain/waitlist';
import { aReservation, anEntry } from '../support/builders';

describe('R15 — waiting-list entry transitions', () => {
  it('offerTo moves Waiting to Offered and records the hold', () => {
    const waiting = anEntry();
    const offered = offerTo(waiting, aReservation({ id: 'res-9' }));
    expect(offered).toEqual({ ...waiting, state: 'Offered', reservationId: 'res-9' });
    expect(waiting.state).toBe('Waiting');
  });

  it('settle: a confirmed hold makes the entry Bought', () => {
    const offered = anEntry({ state: 'Offered', reservationId: 'res-9' });
    expect(settle(offered, aReservation({ id: 'res-9', state: 'Confirmed' })).state).toBe('Bought');
  });

  it.each(['Cancelled', 'Expired'] as const)(
    'settle: a %s hold makes the entry Passed',
    (state) => {
      const offered = anEntry({ state: 'Offered', reservationId: 'res-9' });
      expect(settle(offered, aReservation({ id: 'res-9', state })).state).toBe('Passed');
    },
  );

  it('settle leaves the same object while the hold is still Active, or when nothing applies', () => {
    const offered = anEntry({ state: 'Offered', reservationId: 'res-9' });
    expect(settle(offered, aReservation({ id: 'res-9', state: 'Active' }))).toBe(offered);
    expect(settle(offered, undefined)).toBe(offered);
    const waiting = anEntry();
    expect(settle(waiting, aReservation({ state: 'Confirmed' }))).toBe(waiting);
  });

  it('leaveWaitlist marks the entry Left from Waiting or Offered', () => {
    expect(leaveWaitlist(anEntry()).state).toBe('Left');
    expect(leaveWaitlist(anEntry({ state: 'Offered', reservationId: 'res-9' })).state).toBe('Left');
  });

  it('holdsPlace is true only while Waiting or Offered', () => {
    expect(holdsPlace(anEntry())).toBe(true);
    expect(holdsPlace(anEntry({ state: 'Offered' }))).toBe(true);
    expect(holdsPlace(anEntry({ state: 'Bought' }))).toBe(false);
    expect(holdsPlace(anEntry({ state: 'Passed' }))).toBe(false);
    expect(holdsPlace(anEntry({ state: 'Left' }))).toBe(false);
  });
});
