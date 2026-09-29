interface SegmentedRadioProps<T extends string> {
  name: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  /** The id of the text that names the choice */
  labelledBy: string
  disabled?: boolean
}

/**
 * A pick-one choice as a segmented control, like the Appearance picker, made
 * of native radios so arrow keys move between the options. The radios are
 * invisible, so the focus outline is drawn on the segment around them.
 */
export function SegmentedRadio<T extends string>({ name, value, options, onChange, labelledBy, disabled }: SegmentedRadioProps<T>) {
  return (
    <fieldset
      aria-labelledby={labelledBy}
      disabled={disabled}
      className="m-0 grid max-w-[340px] auto-cols-fr grid-flow-col gap-1 rounded-[10px] border-0 bg-muted p-1 disabled:opacity-60"
    >
      {options.map((option) => (
        <label
          key={option.value}
          className="relative flex h-10 cursor-pointer items-center justify-center rounded-[7px] text-sm font-semibold text-muted-foreground has-checked:bg-background has-checked:text-foreground has-checked:shadow-sm has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring pointer-coarse:h-11"
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="absolute inset-0 m-0 cursor-pointer opacity-0"
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  )
}
