/** The Fintrack mark: black tile, solid neon card with the stripe and chip cut out. Same geometry as public/icon.svg. */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 256 256" aria-hidden="true" focusable="false">
      <rect width="256" height="256" rx="56" fill="#000" />
      <path fill="#3CFFA0" fillRule="evenodd"
        d="M66 78h124a14 14 0 0 1 14 14v72a14 14 0 0 1-14 14H66a14 14 0 0 1-14-14V92a14 14 0 0 1 14-14zM52 104h152v16H52zM72 140h40v10H72z" />
    </svg>
  )
}
