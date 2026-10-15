import dayjs from 'dayjs';
import * as yup from 'yup';
import { describe, expect, it } from 'vitest';
import { dateTime, dateTimeRules, isValidDayjs } from './dateTimeValidation';

const FIXED_NOW = dayjs('2026-05-01T10:30:30.500');
const now = () => FIXED_NOW;

describe('dateTime schema factories', () => {
  it('distinguishes missing values from invalid Dayjs values', () => {
    const required = dateTime.required('Start date');
    const optional = dateTime.optional('Start date');

    expect(required.isValidSync(null)).toBe(false);
    expect(required.isValidSync(undefined)).toBe(false);
    expect(optional.isValidSync(null)).toBe(true);
    expect(optional.isValidSync(undefined)).toBe(true);

    for (const value of [dayjs('invalid'), '2026-05-01', new Date(), {}, 123]) {
      expect(required.isValidSync(value)).toBe(false);
      expect(optional.isValidSync(value)).toBe(false);
    }

    expect(required.isValidSync(FIXED_NOW)).toBe(true);
    expect(isValidDayjs(FIXED_NOW)).toBe(true);
    expect(isValidDayjs(dayjs('invalid'))).toBe(false);
  });

  it('provides required and invalid-date errors independently', () => {
    expect(() => dateTime.required('Start date').validateSync(null))
      .toThrow('Start date is required');
    expect(() => dateTime.optional('Start date').validateSync(dayjs('invalid')))
      .toThrow('Start date must be a valid date and time');
  });
});

describe('relative-to-now rules', () => {
  it('accepts now and past for notInFuture; rejects a millisecond into the future', () => {
    const schema = dateTime.required('Date', dateTimeRules.notInFuture({ now }));
    expect(schema.isValidSync(FIXED_NOW)).toBe(true);
    expect(schema.isValidSync(FIXED_NOW.subtract(1, 'millisecond'))).toBe(true);
    expect(schema.isValidSync(FIXED_NOW.add(1, 'millisecond'))).toBe(false);
  });

  it('allows explicit minute granularity', () => {
    const minuteSchema = dateTime.required(
      'Date', dateTimeRules.notInFuture({ now, unit: 'minute' }),
    );
    expect(minuteSchema.isValidSync(FIXED_NOW.add(10, 'second'))).toBe(true);
    expect(minuteSchema.isValidSync(FIXED_NOW.add(1, 'minute'))).toBe(false);
  });

  it('supports strict past/future and inclusive notInPast', () => {
    expect(dateTime.required('Date', dateTimeRules.inPast({ now })).isValidSync(FIXED_NOW))
      .toBe(false);
    expect(dateTime.required('Date', dateTimeRules.inFuture({ now })).isValidSync(FIXED_NOW))
      .toBe(false);
    expect(dateTime.required('Date', dateTimeRules.notInPast({ now })).isValidSync(FIXED_NOW))
      .toBe(true);
  });

  it('supports rolling windows with one clock read per field validation', () => {
    let called = 0;
    const clock = () => { called += 1; return FIXED_NOW; };
    const lastHour = dateTime.required('Date', dateTimeRules.withinLast(1, 'hour', { now: clock }));

    expect(lastHour.isValidSync(FIXED_NOW.subtract(1, 'hour'))).toBe(true);
    expect(called).toBe(1);
    expect(lastHour.isValidSync(FIXED_NOW.subtract(61, 'minute'))).toBe(false);
    expect(lastHour.isValidSync(FIXED_NOW.add(1, 'second'))).toBe(false);

    const nextHour = dateTime.required('Date', dateTimeRules.withinNext(1, 'hour', { now }));
    expect(nextHour.isValidSync(FIXED_NOW.add(1, 'hour'))).toBe(true);
    expect(nextHour.isValidSync(FIXED_NOW.subtract(1, 'second'))).toBe(false);
  });
});

describe('date/time boundaries', () => {
  const lower = dayjs('2026-05-01T09:00:00');
  const upper = dayjs('2026-05-01T17:00:00');

  it('defaults min/max to inclusive boundaries', () => {
    const min = dateTime.required('Date', dateTimeRules.minDate(lower));
    const max = dateTime.required('Date', dateTimeRules.maxDate(upper));
    expect(min.isValidSync(lower)).toBe(true);
    expect(min.isValidSync(lower.subtract(1, 'millisecond'))).toBe(false);
    expect(max.isValidSync(upper)).toBe(true);
    expect(max.isValidSync(upper.add(1, 'millisecond'))).toBe(false);
  });

  it('supports inclusive and exclusive between limits', () => {
    const inclusive = dateTime.required('Date', dateTimeRules.between(lower, upper));
    const exclusive = dateTime.required('Date', dateTimeRules.between(lower, upper, {
      includeStart: false,
      includeEnd: false,
    }));
    expect(inclusive.isValidSync(lower)).toBe(true);
    expect(inclusive.isValidSync(upper)).toBe(true);
    expect(exclusive.isValidSync(lower)).toBe(false);
    expect(exclusive.isValidSync(lower.add(1, 'millisecond'))).toBe(true);
    expect(exclusive.isValidSync(upper)).toBe(false);
  });

  it('rejects bad static configuration and reversed dynamic bounds', () => {
    expect(() => dateTimeRules.maxDate(dayjs('invalid'))).toThrow(TypeError);
    const schema = dateTime.required('Date', dateTimeRules.between(() => upper, () => lower));
    expect(() => schema.validateSync(upper)).toThrow(RangeError);
  });
});

describe('cross-field rules', () => {
  const schema = yup.object({
    start: dateTime.required('Start'),
    end: dateTime.required(
      'End',
      dateTimeRules.afterField('start', { otherLabel: 'Start' }),
    ),
  });

  const start = dayjs('2026-05-01T10:30:00');

  it('uses configurable sibling references', () => {
    expect(schema.isValidSync({ start, end: start.add(1, 'millisecond') })).toBe(true);
    expect(schema.isValidSync({ start, end: start })).toBe(false);
    expect(schema.isValidSync({ start, end: start.subtract(1, 'millisecond') })).toBe(false);
  });

  it('can allow equality, including at minute granularity', () => {
    const endSchema = dateTime.required(
      'End', dateTimeRules.afterField('start', { inclusive: true, unit: 'minute' }),
    );
    const formSchema = yup.object({ start: dateTime.required('Start'), end: endSchema });
    expect(formSchema.isValidSync({ start, end: start })).toBe(true);
    expect(formSchema.isValidSync({ start, end: start.add(20, 'second') })).toBe(true);
  });

  it('avoids redundant comparison failures when the sibling value is missing', () => {
    const optional = yup.object({
      start: dateTime.optional('Start'),
      end: dateTime.required('End', dateTimeRules.afterField('start')),
    });
    expect(optional.isValidSync({ start: null, end: start })).toBe(true);
  });

  it('validates nested siblings without hardcoded parent types', () => {
    const nested = yup.object({
      range: yup.object({
        from: dateTime.required('From'),
        to: dateTime.required('To', dateTimeRules.afterField('from')),
      }),
    });
    expect(nested.isValidSync({ range: { from: start, to: start.add(1, 'minute') } }))
      .toBe(true);
  });

  it('compares equality with the configured precision', () => {
    const same = yup.object({
      from: dateTime.required('From'),
      to: dateTime.required('To', dateTimeRules.sameAsField('from', { unit: 'day' })),
    });
    expect(same.isValidSync({ from: start, to: start.add(5, 'hour') })).toBe(true);
    expect(same.isValidSync({ from: start, to: start.add(1, 'day') })).toBe(false);
  });
});

describe('duration and scheduling rules', () => {
  const start = dayjs('2026-05-01T10:00:00');

  it('validates exact elapsed durations (no rounding to minutes)', () => {
    const form = yup.object({
      start: dateTime.required('Start'),
      end: dateTime.required('End', dateTimeRules.durationFrom('start', {
        minMinutes: 15,
        maxMinutes: 60,
      })),
    });
    expect(form.isValidSync({ start, end: start.add(15, 'minute') })).toBe(true);
    expect(form.isValidSync({ start, end: start.add(60, 'minute') })).toBe(true);
    expect(form.isValidSync({ start, end: start.add(15, 'minute').subtract(1, 'millisecond') }))
      .toBe(false);
    expect(form.isValidSync({ start, end: start.add(60, 'minute').add(1, 'millisecond') }))
      .toBe(false);
    expect(form.isValidSync({ start, end: start.subtract(1, 'minute') })).toBe(false);
  });

  it('rejects invalid rule configuration', () => {
    expect(() => dateTimeRules.durationFrom('start', { minMinutes: -1 })).toThrow(RangeError);
    expect(() => dateTimeRules.durationFrom('start', { minMinutes: 60, maxMinutes: 15 }))
      .toThrow(RangeError);
    expect(() => dateTimeRules.minuteStep(7)).toThrow(RangeError);
    expect(() => dateTimeRules.timeBetween('25:00', '17:00')).toThrow(RangeError);
    expect(() => dateTimeRules.allowedWeekdays([8])).toThrow(RangeError);
    expect(() => dateTimeRules.withinLast(-1, 'day')).toThrow(RangeError);
  });

  it('supports weekdays/weekends and specific weekdays', () => {
    const monday = dayjs('2024-06-10T10:00:00');
    const saturday = dayjs('2024-06-08T10:00:00');
    expect(dateTime.required('Date', dateTimeRules.weekdaysOnly()).isValidSync(monday)).toBe(true);
    expect(dateTime.required('Date', dateTimeRules.weekdaysOnly()).isValidSync(saturday)).toBe(false);
    expect(dateTime.required('Date', dateTimeRules.weekendsOnly()).isValidSync(saturday)).toBe(true);
    expect(dateTime.required('Date', dateTimeRules.allowedWeekdays([1])).isValidSync(monday))
      .toBe(true);
  });

  it('handles normal and overnight clock windows', () => {
    const businessHours = dateTime.required('Date', dateTimeRules.timeBetween('09:00', '17:00'));
    expect(businessHours.isValidSync(dayjs('2026-05-01T09:00:00'))).toBe(true);
    expect(businessHours.isValidSync(dayjs('2026-05-01T17:01:00'))).toBe(false);

    const nightShift = dateTime.required('Date', dateTimeRules.timeBetween('22:00', '06:00'));
    expect(nightShift.isValidSync(dayjs('2026-05-01T23:00:00'))).toBe(true);
    expect(nightShift.isValidSync(dayjs('2026-05-02T05:30:00'))).toBe(true);
    expect(nightShift.isValidSync(dayjs('2026-05-01T12:00:00'))).toBe(false);
  });

  it('requires exact minute increments unless configured otherwise', () => {
    const strict = dateTime.required('Date', dateTimeRules.minuteStep(15));
    const lenient = dateTime.required('Date', dateTimeRules.minuteStep(15, {
      requireWholeMinute: false,
    }));
    const value = dayjs('2026-05-01T10:30:00');
    expect(strict.isValidSync(value)).toBe(true);
    expect(strict.isValidSync(value.add(1, 'second'))).toBe(false);
    expect(strict.isValidSync(value.add(1, 'minute'))).toBe(false);
    expect(lenient.isValidSync(value.add(1, 'second'))).toBe(true);
  });
});
