// One knob for heads, memory blocks and floors, with labeled stops (section 4.3): a radio group, so
// arrow keys move between stops and every stop is a tap target.
import { useId } from "react";
import { S } from "../strings.ts";

export function Knob({ value, onChange, label, disabled }: { value: number; onChange: (v: number) => void; label: string; disabled?: boolean }) {
  const id = useId();
  const stops = S.stops;
  const idx = Math.max(0, stops.findIndex((s) => s.v === value));
  const key = (e: React.KeyboardEvent) => {
    let j = idx;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") j = Math.min(stops.length - 1, idx + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") j = Math.max(0, idx - 1);
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = stops.length - 1;
    else return;
    e.preventDefault();
    onChange(stops[j].v);
    (e.currentTarget.parentElement?.children[j] as HTMLElement | undefined)?.focus();
  };
  return (
    <div className="seg change" role="radiogroup" aria-labelledby={id}>
      <span id={id} className="sr-only">{label}</span>
      {stops.map((s, i) => (
        <button key={s.v} type="button" role="radio" data-v={s.v} aria-checked={value === s.v} tabIndex={i === idx ? 0 : -1}
          disabled={disabled} onClick={() => onChange(s.v)} onKeyDown={key}>
          {s.label}
        </button>
      ))}
    </div>
  );
}
