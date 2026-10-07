import { useEffect, useRef, type ReactNode } from "react";

/** Native focus trapping, Escape and focus restoration for every revealed workspace. */
export function Modal({ open, onClose, title, className = "", children }: {
  open: boolean; onClose: () => void; title: string; className?: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`modal ${className}`} aria-label={title}
      onCancel={(e) => { e.preventDefault(); close.current(); }} onClose={() => close.current()}
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const items = [...e.currentTarget.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary, [tabindex]')]
          .filter((el) => el.tabIndex >= 0 && !el.matches(":disabled") && el.getClientRects().length > 0);
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }}
      onClick={(e) => { if (e.target === e.currentTarget) close.current(); }}>
      {open && <div className="modal-content">
        <header className="modal-head"><h2>{title}</h2><button type="button" className="btn quiet" onClick={onClose}>Close</button></header>
        <div className="modal-body">{children}</div>
      </div>}
    </dialog>
  );
}
