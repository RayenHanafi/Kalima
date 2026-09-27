// Shared button classes (Kalima tokens; ≥44px targets; focus ring comes from the global :focus-visible rule).
const base =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border-2 px-5 text-lg font-semibold transition-colors disabled:pointer-events-none disabled:opacity-60';

export const btn = `${base} border-border bg-background text-foreground hover:bg-surface`;
export const btnPrimary = `${base} border-transparent bg-primary text-primary-foreground hover:bg-primary-hover`;
export const btnSecondary = `${base} border-transparent bg-secondary text-secondary-foreground hover:bg-secondary-hover`;
