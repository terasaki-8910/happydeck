interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

/** A native macOS/iOS-style pill switch — used instead of a plain checkbox wherever the app has a binary on/off setting. */
export function ToggleSwitch({ checked, onChange, label }: ToggleSwitchProps) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="toggle-switch-row" onClick={() => onChange(!checked)}>
      <span>{label}</span>
      <span className={`toggle-switch ${checked ? 'toggle-switch-on' : ''}`}>
        <span className="toggle-switch-knob" />
      </span>
    </button>
  );
}
