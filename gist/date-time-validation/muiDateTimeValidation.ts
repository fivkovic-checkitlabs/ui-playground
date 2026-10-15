import type {
  DateTimeValidationError,
  DateValidationError,
  TimeValidationError,
} from '@mui/x-date-pickers/models';

/**
 * Optional UI integration. Keep this MUI-specific helper separate from
 * dateTimeValidation.ts so validation rules have no UI library dependency.
 */
export const pickerDateTimeErrorMessage = (
  error: DateTimeValidationError | DateValidationError | TimeValidationError,
  label = 'Date and time',
): string | undefined => {
  if (error == null) return undefined;

  switch (error) {
    case 'invalidDate':
      return `${label} must be a valid date and time`;
    case 'disablePast':
      return `${label} cannot be in the past`;
    case 'disableFuture':
      return `${label} cannot be in the future`;
    case 'minDate':
    case 'minTime':
    case 'minDateTime':
      return `${label} is earlier than the allowed minimum`;
    case 'maxDate':
    case 'maxTime':
    case 'maxDateTime':
      return `${label} is later than the allowed maximum`;
    case 'minutesStep':
      return `${label} must align with the permitted minute increments`;
    default:
      return `${label} is not an allowed date or time`;
  }
};
