# Yup + Dayjs date/time validation utilities

Reusable, UI-independent TypeScript validation for MUI X pickers and Yup v1.

## Contents

- `dateTimeValidation.ts` — core schemas and composable rules; dependencies: `dayjs`, `yup`.
- `dateTimeValidation.test.ts` — Vitest regression tests.
- `muiDateTimeValidation.ts` — optional adapter for MUI picker-specific validation reasons; dependency: `@mui/x-date-pickers`.

## Install

```sh
npm install yup dayjs
npm install -D vitest
# only if you are using MUI date/time pickers:
npm install @mui/x-date-pickers
```

Do not install `@types/yup`: Yup v1 ships its own TypeScript declarations.

Put all three files in your preferred `src/shared/utilities/` directory, or omit the MUI file if your project does not use MUI X.

## Example: start/end dates in a search form

```ts
import * as yup from 'yup';
import { dateTime, dateTimeRules } from './dateTimeValidation';

export const searchSchema = yup.object({
  startDateTime: dateTime.required(
    'Start date',
    dateTimeRules.notInFuture(),
  ),
  endDateTime: dateTime.required(
    'End date',
    dateTimeRules.notInFuture(),
    dateTimeRules.afterField('startDateTime', { otherLabel: 'Start date' }),
  ),
});

export type ValidatedSearch = yup.InferType<typeof searchSchema>;
```

If you want date-only comparisons, pass `{ unit: 'day' }` to the relevant rule. If you want the start and end times to be equal as well, pass `{ inclusive: true }`.

### Business hours and durations

```ts
const appointmentSchema = yup.object({
  start: dateTime.required(
    'Start',
    dateTimeRules.notInPast(),
    dateTimeRules.weekdaysOnly(),
    dateTimeRules.timeBetween('09:00', '17:00'),
    dateTimeRules.minuteStep(15),
  ),
  end: dateTime.required(
    'End',
    dateTimeRules.durationFrom('start', { minMinutes: 30, maxMinutes: 120 }),
  ),
});
```

### Min/max and rolling windows

```ts
import dayjs from 'dayjs';

const cutoff = dayjs('2026-01-01');
const dateSchema = dateTime.optional(
  'Effective date',
  dateTimeRules.minDate(cutoff, { unit: 'day' }),
  dateTimeRules.maxDate(() => dayjs().add(90, 'day'), { unit: 'day' }),
);

const recentDateSchema = dateTime.required(
  'Updated at',
  dateTimeRules.withinLast(24, 'hour'),
);
```

### Nested field references

```ts
const nested = yup.object({
  filter: yup.object({
    from: dateTime.required('From'),
    to: dateTime.required('To', dateTimeRules.afterField('from')),
  }),
});
```

Cross-field references refer to *sibling fields in the current object*. If a referenced field is missing/invalid, the comparison skips and that field's own schema reports the error.

### MUI X picker-specific validation errors

MUI's `DateTimeValidationError` represents picker UI validation, and is **not a Dayjs value**. You generally should not store it as a Yup schema field or attempt to compare it to a date. Handle picker error reasons with `onError` or `onChange`'s second `context.validationError` argument, and use Yup to validate actual Dayjs values before submit.

```tsx
import { useState } from 'react';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import type { DateTimeValidationError } from '@mui/x-date-pickers/models';
import { pickerDateTimeErrorMessage } from './muiDateTimeValidation';

function Example({ value, onChange }: {
  value: import('dayjs').Dayjs | null;
  onChange: (value: import('dayjs').Dayjs | null) => void;
}) {
  const [pickerError, setPickerError] = useState<DateTimeValidationError>(null);

  return (
    <DateTimePicker
      label="End date"
      value={value}
      onChange={(nextValue) => onChange(nextValue)}
      onError={setPickerError}
      slotProps={{
        textField: {
          error: pickerError !== null,
          helperText: pickerDateTimeErrorMessage(pickerError, 'End date'),
        },
      }}
    />
  );
}
```

If the picker allows incomplete text editing, the UI can temporarily contain uncommitted invalid text that the form's last Dayjs value does not represent. Preserve the picker error separately and prevent submit while it exists; do not assume a Yup check alone can see the uncommitted text. Align constraints in the picker and Yup schema.

## Behavior and invariants

1. The factories accept only valid **Dayjs** instances for non-empty fields. Strings, `Date` objects, and invalid Dayjs instances fail; no implicit parsing or coercion.
2. `dateTime.optional()` accepts `null` and `undefined`; `dateTime.required()` rejects them.
3. Business rules skip missing/invalid values to avoid duplicate errors. The base factory always performs the required/validity checks.
4. Without `unit`, comparisons use millisecond precision. Passing `unit: 'minute'` means entire minutes are compared; values within the same minute are treated as equal.
5. Min/max boundaries default to inclusive. Cross-field `beforeField`/`afterField` comparisons default to exclusive.
6. `timeBetween` compares the *clock portion* (`HH:mm`) at minute precision and supports intervals crossing midnight. It does **not** compare calendar dates.
7. `minuteStep(n)` requires seconds/milliseconds to be zero by default. Pass `{ requireWholeMinute: false }` if only the minutes section matters.
8. `durationFrom` measures actual elapsed milliseconds (`value.valueOf()`), not wall-clock arithmetic, including across daylight saving transitions. Negative duration fails.
9. `withinLast`/`withinNext` use one `now()` reading each time a rule is evaluated. Calendar units (`day`, `week`, `month`, `year`) require integer counts.
10. For business-specific timezones, normalize or create both dates in the intended timezone before validating. Dayjs `.tz()` requires its UTC/timezone plugins. Calendar-unit comparisons use the timezone of the Dayjs values, so use a consistent zone for both.
11. MUI DatePicker values are typically `Dayjs | null`; a *validated* Yup `required` schema infers `Dayjs` for the output. In React Hook Form, consider raw form types (nullable) separately from successfully validated submit types (non-null).
12. If you validate only `end` against `start` and the user changes `start`, ensure that the `end` field is revalidated. Avoid attaching identical order rules to both fields unless you want both to show errors.
13. Use explicit ISO serialization / UTC for persistence, and revalidate incoming API values on the backend. This client-side library is not a substitute for server-side checks.

## Run tests

```sh
npx vitest run src/shared/utilities/dateTimeValidation.test.ts
```

**Verification note:** Source files were syntax-transpiled with TypeScript. The Vitest suite was authored but not executed here because `yup`, `dayjs`, and `vitest` are not available in this environment. Run it in your project to confirm compatibility with your installed versions.
