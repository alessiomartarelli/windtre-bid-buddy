interface BrandGlyphProps {
  className?: string;
}

export function BrandGlyph({ className }: BrandGlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4.5 3.5h15L21 8H3l1.5-4.5Z" />
      <path d="M3 8v1.5a2.25 2.25 0 0 0 4.5 0V8" />
      <path d="M7.5 8v1.5a2.25 2.25 0 0 0 4.5 0V8" />
      <path d="M12 8v1.5a2.25 2.25 0 0 0 4.5 0V8" />
      <path d="M16.5 8v1.5a2.25 2.25 0 0 0 4.5 0V8" />
      <path d="M2.5 15h19" />
      <path d="M4.5 20.5V15" />
      <path d="M19.5 20.5V15" />
    </svg>
  );
}
