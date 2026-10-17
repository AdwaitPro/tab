/** Ticket perforation: side notches cut into the card plus a dashed tear line. */
export function Perforation() {
  return (
    <div className="relative my-5 h-6" aria-hidden="true">
      <span className="absolute top-0 -left-3 size-6 rounded-full bg-bg shadow-[inset_-1px_0_0_var(--line)]" />
      <span className="absolute top-0 -right-3 size-6 rounded-full bg-bg shadow-[inset_1px_0_0_var(--line)]" />
      <span className="absolute top-1/2 right-5 left-5 border-t-2 border-dashed border-line-strong" />
    </div>
  );
}
