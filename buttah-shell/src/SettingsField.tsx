import TextField from '@mui/material/TextField';
import type { ReactNode } from 'react';

/**
 * Outlined brand field. Radius, height, and the focus ring are CSS
 * (`--bc-radius-sm` is 10px). A numeric MUI `borderRadius` would be multiplied
 * by the theme radius, which is also 10.
 */
export function SettingsField({
  id,
  label,
  value,
  disabled,
  readOnly,
  spellCheck,
  placeholder,
  multiline,
  onChange,
  footer,
}: {
  id: string;
  label: string;
  value: string;
  disabled?: boolean;
  readOnly?: boolean;
  spellCheck?: boolean;
  placeholder?: string;
  multiline?: boolean;
  onChange?: (value: string) => void;
  footer?: ReactNode;
}) {
  return (
    <label className={multiline ? 'buttah-field buttah-field-area' : 'buttah-field'} htmlFor={id}>
      <span>{label}</span>
      <TextField
        id={id}
        name={id}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        variant="outlined"
        size="small"
        fullWidth
        multiline={multiline}
        minRows={multiline ? 4 : undefined}
        onChange={event => onChange?.(event.target.value)}
        InputProps={{ readOnly, notched: false }}
        inputProps={{ spellCheck: spellCheck ?? true, 'aria-label': label }}
      />
      {footer}
    </label>
  );
}
