import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateIcsCalendar, type CalendarDividendEvent } from './calendarFeedService.js';

test('calendarFeed: generates valid RFC 5545 calendar with dividend events', () => {
  const events: CalendarDividendEvent[] = [
    {
      symbol: 'AAPL',
      name: 'Apple Inc',
      amount: 27,
      date: '2026-11-13',
      exDate: '2026-11-10',
      amountPerShare: 0.27,
      units: 100,
      currency: 'USD',
      isConfirmed: true
    },
    {
      symbol: 'MSFT',
      name: 'Microsoft Corp',
      amount: 75,
      date: '2026-12-10',
      exDate: '2026-11-19',
      amountPerShare: 0.75,
      units: 100,
      currency: 'USD',
      isConfirmed: false
    }
  ];

  const ics = generateIcsCalendar(events, 'My Portfolio Dividends');
  assert.ok(ics.includes('BEGIN:VCALENDAR'));
  assert.ok(ics.includes('END:VCALENDAR'));
  assert.ok(ics.includes('X-WR-CALNAME:My Portfolio Dividends'));
  assert.ok(ics.includes('SUMMARY:💰 AAPL Dividend ($27.00 USD)'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261113'));
  assert.ok(ics.includes('SUMMARY:💰 MSFT Dividend ($75.00 USD) [Estimated]'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261210'));
});
