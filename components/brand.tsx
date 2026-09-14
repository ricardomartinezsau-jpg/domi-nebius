// Copyright (c) 2026 Domi Nebius. Todos los derechos reservados.
// Queda prohibida la reproducción, modificación o distribución no autorizada de este código.

export function Wordmark({ className = 'domi-wordmark' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 173 65"
      fill="none"
      aria-label="Domi"
      role="img"
      className={className}
    >
      <g fill="currentColor">
        <path
          id="domi-d"
          fillRule="evenodd"
          d="M33.85 8H44V40.65C44 51.83 35.69 60 24.45 60C13.25 60 5.2 51.88 5.2 41.04C5.2 30.17 13.35 21.62 24.4 21.62C28.02 21.62 31.3 22.77 33.85 25.15V8ZM24.45 30.87C18.9 30.87 15.55 35.13 15.55 41.04C15.55 46.91 19.02 50.88 24.45 50.88C29.98 50.88 33.96 46.83 33.96 41.04C33.96 35.2 30.11 30.87 24.45 30.87Z"
        />
        <path
          id="domi-o"
          fillRule="evenodd"
          d="M67.31 21.66C78.79 21.66 87.22 29.83 87.22 40.86C87.22 51.98 78.89 59.93 67.31 59.93C55.73 59.93 47.48 51.93 47.48 40.86C47.48 29.77 55.88 21.66 67.31 21.66ZM67.31 30.83C61.56 30.83 57.92 34.84 57.92 40.86C57.92 46.92 61.55 50.72 67.31 50.72C73.17 50.72 77 46.91 77 40.86C77 34.84 73.17 30.83 67.31 30.83Z"
        />
        <path
          id="domi-m"
          d="M90.08 59.06V37.39C90.08 28.27 97.36 21.65 107.66 21.65C112.72 21.65 117.02 23.46 120.01 26.54C123.2 23.3 127.44 21.65 132.16 21.65C142.67 21.65 149.05 28.54 149.05 37.77V59.06H138.4V37.96C138.4 33.48 135.88 31.02 131.84 31.02C127.67 31.02 124.52 33.78 124.52 38.21V59.06H113.91V37.96C113.91 33.45 111.42 31.02 107.39 31.02C103.31 31.02 100.77 33.72 100.77 38.21V59.06H90.08Z"
        />
        <path id="domi-i-asta" d="M154.05 23.2H164.88V59.06H154.05Z" />
        <path
          id="domi-i-punto"
          d="M165.7 12.25C165.7 15.72 162.94 18.48 159.5 18.48C156.08 18.48 153.3 15.72 153.3 12.25C153.3 8.77 156.08 6.07 159.5 6.07C162.94 6.07 165.7 8.77 165.7 12.25Z"
        />
      </g>
    </svg>
  )
}

export function Brand({
  showSymbol = true,
  className = 'domi-brand',
  onClick,
}: {
  showSymbol?: boolean
  className?: string
  onClick?: () => void
}) {
  const content = (
    <>
      {showSymbol && (
        <svg
          width="32"
          height="20"
          viewBox="0 0 32 20"
          fill="none"
          aria-hidden="true"
          className="domi-symbol-svg"
        >
          <path
            d="M3 4V13C3 15.7614 5.23858 18 8 18H24C26.7614 18 29 15.7614 29 13V4"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <rect x="11.5" y="7" width="9" height="6.5" rx="2" fill="#D97745" />
        </svg>
      )}
      <Wordmark className="domi-wordmark" />
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        className={`${className} domi-brand-btn`}
        onClick={onClick}
        aria-label="Domi - Ir al inicio (Añadir otro vaciado)"
      >
        {content}
      </button>
    )
  }

  return (
    <span className={className} aria-label="Domi">
      {content}
    </span>
  )
}
