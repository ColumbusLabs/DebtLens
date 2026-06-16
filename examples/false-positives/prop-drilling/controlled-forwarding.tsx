interface Props {
  value: string;
  label: string;
  onChange: (value: string) => void;
}

export function ControlledForwarding({ value, label, onChange }: Props) {
  return (
    <section>
      <FieldLabel label={label} />
      <FieldInput value={value} onChange={onChange} />
    </section>
  );
}

function FieldLabel({ label }: Pick<Props, "label">) {
  return <label>{label}</label>;
}

function FieldInput({ value, onChange }: Pick<Props, "value" | "onChange">) {
  return <input value={value} onChange={(event) => onChange(event.target.value)} />;
}
