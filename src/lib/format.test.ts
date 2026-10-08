import { describe, expect, it } from 'vitest';
import { formatDuration, formatMoney, formatSlotLong, isoWeekday, utcOffsetLabel } from './format';
import { buildIcs } from './ics';

describe('format', () => {
  it('money in minor units', () => {
    expect(formatMoney(350000).replace(/\s/g, ' ')).toBe('3 500 ₽');
    expect(formatMoney(1800000, 'RUB', true).replace(/\s/g, ' ')).toBe('от 18 000 ₽');
    expect(formatMoney(350050).replace(/\s/g, ' ')).toBe('3 500,50 ₽');
  });

  it('durations including multi-day', () => {
    expect(formatDuration(45)).toBe('45 мин');
    expect(formatDuration(90)).toBe('1 ч 30 мин');
    expect(formatDuration(1440)).toBe('1 день');
    expect(formatDuration(2880)).toBe('2 дня');
    expect(formatDuration(1680)).toBe('1 день 4 ч');
    expect(formatDuration(7200)).toBe('5 дней');
  });

  it('slot labels use the studio timezone, not the device', () => {
    const now = new Date('2027-03-01T03:00:00Z');
    expect(formatSlotLong('2027-03-02T05:00:00Z', 'Asia/Yekaterinburg', now)).toBe('завтра, 2 марта, вт, 10:00');
    expect(utcOffsetLabel('Asia/Yekaterinburg', now)).toBe('UTC+5');
    expect(utcOffsetLabel('Europe/Moscow', now)).toBe('UTC+3');
  });

  it('ISO weekday of a local date', () => {
    expect(isoWeekday('2027-03-01')).toBe(1);
    expect(isoWeekday('2027-03-07')).toBe(7);
  });
});

describe('ics', () => {
  it('produces a valid VEVENT with a one-day alarm and escaped text', () => {
    const ics = buildIcs(
      { uid: 'ABC@studio', start: '2027-03-02T05:00:00Z', end: '2027-03-02T06:30:00Z', title: 'Мойка; салон, коврики', location: 'Улица, 1' },
      new Date('2027-03-01T00:00:00Z'),
    );
    expect(ics).toContain('DTSTART:20270302T050000Z');
    expect(ics).toContain('DTEND:20270302T063000Z');
    expect(ics).toContain('SUMMARY:Мойка\\; салон\\, коврики');
    expect(ics).toContain('TRIGGER:-P1D');
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
});
