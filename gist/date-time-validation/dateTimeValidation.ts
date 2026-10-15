import dayjs, { type Dayjs } from 'dayjs';
import * as yup from 'yup';

/** Values used by the MUI Dayjs date/time pickers. */
export type DateTimeValue = Dayjs | null;

/** Omitting the unit means millisecond-accurate instant comparisons. */
export type DateTimeUnit =
  | 'millisecond'
  | 'second'
  | 'minute'
  | 'hour'
  | 'day'
  | 'week'
  | 'month'
  | 'year';

/** A static limit, or a factory evaluated each time the schema is validated. */
export type DateTimeBoundary = Dayjs | (() => Dayjs);

export type RelativeTimeUnit =
  | 'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

/** A reusable Yup rule that receives the field's user-facing label. */
export type DateTimeRule = (
  label: string,
) => yup.TestConfig<Dayjs | null | undefined, yup.AnyObject>;

export interface RuleOptions {
  message?: string;
}

export interface ComparisonOptions extends RuleOptions {
  unit?: DateTimeUnit;
  /** Defaults to false for cross-field comparisons. */
  inclusive?: boolean;
  /** Optional human-readable name for the referenced field. */
  otherLabel?: string;
}

export interface LimitOptions extends RuleOptions {
  unit?: DateTimeUnit;
  /** Defaults to true for minimum/maximum limits. */
  inclusive?: boolean;
}

export interface NowOptions extends RuleOptions {
  unit?: DateTimeUnit;
  /** Injectable clock; defaults to dayjs(). */
  now?: () => Dayjs;
}

export interface BetweenOptions extends RuleOptions {
  unit?: DateTimeUnit;
  includeStart?: boolean;
  includeEnd?: boolean;
}

export interface DurationOptions extends RuleOptions {
  minMinutes?: number;
  maxMinutes?: number;
  otherLabel?: string;
}

export interface TimeWindowOptions extends RuleOptions {
  includeStart?: boolean;
  includeEnd?: boolean;
}

export interface MinuteStepOptions extends RuleOptions {
  /** Require seconds and milliseconds to be zero (default: true). */
  requireWholeMinute?: boolean;
}

export const isValidDayjs = (value: unknown): value is Dayjs =>
  dayjs.isDayjs(value) && value.isValid();

const requireBoundary = (boundary: DateTimeBoundary): Dayjs => {
  const value = typeof boundary === 'function' ? boundary() : boundary;

  if (!isValidDayjs(value)) {
    throw new TypeError('A date/time validation boundary must be a valid Dayjs instance.');
  }

  return value;
};

const compare = (
  actual: Dayjs,
  expected: Dayjs,
  direction: 'before' | 'after',
  inclusive: boolean,
  unit?: DateTimeUnit,
): boolean => {
  const passes = direction === 'before'
    ? actual.isBefore(expected, unit)
    : actual.isAfter(expected, unit);

  return passes || (inclusive && actual.isSame(expected, unit));
};

const formattedBoundary = (boundary: Dayjs, unit?: DateTimeUnit): string =>
  unit === 'day' || unit === 'week' || unit === 'month' || unit === 'year'
    ? boundary.format('YYYY-MM-DD')
    : boundary.format('YYYY-MM-DD HH:mm:ss.SSS Z');

/** Each rule skips absent/invalid values; dateTime.required/optional handle those. */
const makeRule = (
  name: string,
  evaluate: (
    value: Dayjs,
    label: string,
    context: yup.TestContext<yup.AnyObject>,
  ) => true | string,
): DateTimeRule =>
  (label) => ({
    name,
    test(value, context) {
      if (!isValidDayjs(value)) return true;

      const result = evaluate(value, label, context);
      return result === true ? true : context.createError({ message: result });
    },
  });

const siblingValue = (context: yup.TestContext<yup.AnyObject>, field: string): Dayjs | null => {
  const resolved: unknown = context.resolve(yup.ref(field));
  return isValidDayjs(resolved) ? resolved : null;
};

const fieldComparison = (
  field: string,
  direction: 'before' | 'after',
  options: ComparisonOptions = {},
): DateTimeRule => {
  if (!field.trim()) throw new Error('A comparison field name is required.');

  const { inclusive = false, unit, otherLabel = field, message } = options;
  return makeRule(`date-time:${direction}-field:${field}`, (value, label, context) => {
    const other = siblingValue(context, field);
    if (!other) return true; // The other field's own schema handles missing/invalid values.

    if (compare(value, other, direction, inclusive, unit)) return true;

    const verb = direction === 'before'
      ? inclusive ? 'on or before' : 'before'
      : inclusive ? 'on or after' : 'after';

    return message ?? `${label} must be ${verb} ${otherLabel}`;
  });
};

const limitRule = (
  boundary: DateTimeBoundary,
  direction: 'before' | 'after',
  options: LimitOptions = {},
): DateTimeRule => {
  if (typeof boundary !== 'function') requireBoundary(boundary);
  const { unit, inclusive = true, message } = options;

  return makeRule(`date-time:${direction}-limit`, (value, label) => {
    const limit = requireBoundary(boundary);
    if (compare(value, limit, direction, inclusive, unit)) return true;

    const relation = direction === 'before'
      ? inclusive ? 'on or before' : 'before'
      : inclusive ? 'on or after' : 'after';

    return message ?? `${label} must be ${relation} ${formattedBoundary(limit, unit)}`;
  });
};

const validateWindowAmount = (amount: number, unit: RelativeTimeUnit): void => {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError('The window amount must be a finite nonnegative number.');
  }
  if (['day', 'week', 'month', 'year'].includes(unit) && !Number.isInteger(amount)) {
    throw new RangeError('Calendar-based rolling windows need a whole-number amount.');
  }
};

const nowRule = (
  direction: 'before' | 'after',
  inclusive: boolean,
  options: NowOptions = {},
): DateTimeRule =>
  makeRule(`date-time:${direction}-now:${inclusive}`, (value, label) => {
    const now = requireBoundary(options.now ?? dayjs); // One clock read per test.
    if (compare(value, now, direction, inclusive, options.unit)) return true;

    const description = direction === 'before'
      ? inclusive ? 'cannot be in the future' : 'must be in the past'
      : inclusive ? 'cannot be in the past' : 'must be in the future';

    return options.message ?? `${label} ${description}`;
  });

/** Date-only or date-time values from MUI DatePicker/DateTimePicker/TimePicker. */
export const dateTime = {
  optional(label: string, ...rules: DateTimeRule[]) {
    let schema = yup.mixed<Dayjs>()
      .nullable()
      .label(label)
      .test({
        name: 'date-time:valid-dayjs',
        message: `${label} must be a valid date and time`,
        test: (value) => value == null || isValidDayjs(value),
      });

    for (const rule of rules) {
      schema = schema.test(rule(label));
    }

    return schema;
  },

  required(label: string, ...rules: DateTimeRule[]) {
    return dateTime.optional(label, ...rules).required(`${label} is required`);
  },
};

/** All rules are reusable. The returned value can also be used with schema.test(rule(label)). */
export const dateTimeRules = {
  /** Includes the current instant by default. */
  notInFuture: (options: NowOptions = {}) => nowRule('before', true, options),
  notInPast: (options: NowOptions = {}) => nowRule('after', true, options),
  inPast: (options: NowOptions = {}) => nowRule('before', false, options),
  inFuture: (options: NowOptions = {}) => nowRule('after', false, options),

  /** Inclusive rolling time window in the past, evaluated against one clock reading. */
  withinLast: (amount: number, unit: RelativeTimeUnit, options: Omit<NowOptions, 'unit'> = {}): DateTimeRule => {
    validateWindowAmount(amount, unit);
    return makeRule('date-time:within-last', (value, label) => {
      const now = requireBoundary(options.now ?? dayjs);
      const from = now.subtract(amount, unit);
      return (compare(value, from, 'after', true) && compare(value, now, 'before', true))
        ? true : options.message ?? `${label} must be within the last ${amount} ${unit}(s)`;
    });
  },

  /** Inclusive rolling time window in the future, evaluated against one clock reading. */
  withinNext: (amount: number, unit: RelativeTimeUnit, options: Omit<NowOptions, 'unit'> = {}): DateTimeRule => {
    validateWindowAmount(amount, unit);
    return makeRule('date-time:within-next', (value, label) => {
      const now = requireBoundary(options.now ?? dayjs);
      const until = now.add(amount, unit);
      return (compare(value, now, 'after', true) && compare(value, until, 'before', true))
        ? true : options.message ?? `${label} must be within the next ${amount} ${unit}(s)`;
    });
  },

  /** Minimum allowed date/time (inclusive by default). */
  minDate: (boundary: DateTimeBoundary, options: LimitOptions = {}) =>
    limitRule(boundary, 'after', options),

  /** Maximum allowed date/time (inclusive by default). */
  maxDate: (boundary: DateTimeBoundary, options: LimitOptions = {}) =>
    limitRule(boundary, 'before', options),

  between: (
    startBoundary: DateTimeBoundary,
    endBoundary: DateTimeBoundary,
    options: BetweenOptions = {},
  ): DateTimeRule => {
    if (typeof startBoundary !== 'function') requireBoundary(startBoundary);
    if (typeof endBoundary !== 'function') requireBoundary(endBoundary);

    const { includeStart = true, includeEnd = true, unit, message } = options;
    if (typeof startBoundary !== 'function' && typeof endBoundary !== 'function' &&
        startBoundary.isAfter(endBoundary, unit)) {
      throw new RangeError('Date/time range start must not be after its end.');
    }
    return makeRule('date-time:between', (value, label) => {
      const start = requireBoundary(startBoundary);
      const end = requireBoundary(endBoundary);

      if (start.isAfter(end, unit)) {
        throw new RangeError('Date/time range start must not be after its end.');
      }

      const passes = compare(value, start, 'after', includeStart, unit) &&
        compare(value, end, 'before', includeEnd, unit);

      return passes
        ? true
        : message ?? `${label} must be between ${formattedBoundary(start, unit)} and ${formattedBoundary(end, unit)}`;
    });
  },

  /** Field references are relative to the schema's current parent object. */
  beforeField: (field: string, options: ComparisonOptions = {}) =>
    fieldComparison(field, 'before', options),

  afterField: (field: string, options: ComparisonOptions = {}) =>
    fieldComparison(field, 'after', options),

  sameAsField: (field: string, options: RuleOptions & { unit?: DateTimeUnit; otherLabel?: string } = {}): DateTimeRule => {
    if (!field.trim()) throw new Error('A comparison field name is required.');

    return makeRule(`date-time:same-field:${field}`, (value, label, context) => {
      const other = siblingValue(context, field);
      if (!other || value.isSame(other, options.unit)) return true;
      return options.message ?? `${label} must be the same as ${options.otherLabel ?? field}`;
    });
  },

  /** Exact elapsed-time difference, including across DST transitions. */
  durationFrom: (field: string, options: DurationOptions = {}): DateTimeRule => {
    if (!field.trim()) throw new Error('A duration reference field name is required.');

    const { minMinutes, maxMinutes, otherLabel = field, message } = options;
    for (const n of [minMinutes, maxMinutes]) {
      if (n !== undefined && (!Number.isFinite(n) || n < 0)) {
        throw new RangeError('Duration limits must be finite nonnegative minute counts.');
      }
    }
    if (minMinutes !== undefined && maxMinutes !== undefined && minMinutes > maxMinutes) {
      throw new RangeError('minMinutes must not exceed maxMinutes.');
    }

    return makeRule(`date-time:duration-from:${field}`, (value, label, context) => {
      const other = siblingValue(context, field);
      if (!other) return true;

      const elapsedMs = value.valueOf() - other.valueOf();
      if (elapsedMs < 0) return message ?? `${label} must not be before ${otherLabel}`;
      if (minMinutes !== undefined && elapsedMs < minMinutes * 60_000) {
        return message ?? `${label} must be at least ${minMinutes} minutes after ${otherLabel}`;
      }
      if (maxMinutes !== undefined && elapsedMs > maxMinutes * 60_000) {
        return message ?? `${label} must be at most ${maxMinutes} minutes after ${otherLabel}`;
      }
      return true;
    });
  },

  /** Dayjs .day(): Sunday=0, Monday=1, ... Saturday=6. */
  allowedWeekdays: (days: readonly number[], options: RuleOptions = {}): DateTimeRule => {
    if (!days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      throw new RangeError('allowedWeekdays needs weekday numbers from 0 (Sun) to 6 (Sat).');
    }
    const allowed = new Set(days);

    return makeRule('date-time:allowed-weekdays', (value, label) =>
      allowed.has(value.day())
        ? true
        : options.message ?? `${label} must be on an allowed day of the week`,
    );
  },

  weekdaysOnly: (options: RuleOptions = {}) =>
    makeRule('date-time:weekdays-only', (value, label) =>
      value.day() >= 1 && value.day() <= 5
        ? true : options.message ?? `${label} must be Monday through Friday`,
    ),

  weekendsOnly: (options: RuleOptions = {}) =>
    makeRule('date-time:weekends-only', (value, label) =>
      value.day() === 0 || value.day() === 6
        ? true : options.message ?? `${label} must be Saturday or Sunday`,
    ),

  /** Clock-time boundaries, evaluated to minute precision; 22:00–06:00 wraps overnight. */
  timeBetween: (start: string, end: string, options: TimeWindowOptions = {}): DateTimeRule => {
    const startMinute = parseClockTime(start);
    const endMinute = parseClockTime(end);
    const { includeStart = true, includeEnd = true, message } = options;

    return makeRule('date-time:time-between', (value, label) => {
      const minute = value.hour() * 60 + value.minute();
      const afterStart = includeStart ? minute >= startMinute : minute > startMinute;
      const beforeEnd = includeEnd ? minute <= endMinute : minute < endMinute;
      const passes = startMinute <= endMinute
        ? afterStart && beforeEnd
        : afterStart || beforeEnd;

      return passes ? true : message ?? `${label} must be between ${start} and ${end}`;
    });
  },

  /** Enforce the grid for a TimePicker configured with minutesStep. */
  minuteStep: (step: number, options: MinuteStepOptions = {}): DateTimeRule => {
    if (!Number.isInteger(step) || step < 1 || step > 60 || 60 % step !== 0) {
      throw new RangeError('minuteStep must be a positive integer that divides 60.');
    }
    const { requireWholeMinute = true, message } = options;

    return makeRule('date-time:minute-step', (value, label) => {
      const passes = value.minute() % step === 0 &&
        (!requireWholeMinute || (value.second() === 0 && value.millisecond() === 0));

      return passes ? true : message ?? `${label} must be in ${step}-minute increments`;
    });
  },
};

function parseClockTime(value: string): number {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new RangeError('Clock times must be in 24-hour HH:mm format (for example, 09:30).');
  }

  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}
