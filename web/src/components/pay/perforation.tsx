/** Dashed tear line on the seam between `.ticket-top` and `.ticket-bottom` (their masks cut the notches). */
export function Perforation() {
  return <span className="absolute top-0 right-6 left-6 -translate-y-1/2 border-t-2 border-dashed border-line-strong" aria-hidden="true" />;
}
