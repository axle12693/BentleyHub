// Simple cozy house mark, shared by every generated app icon.
export function IconArt({ size, safe = false }: { size: number; safe?: boolean }) {
  const w = size * (safe ? 0.62 : 0.78);
  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#5e7d5c',
        borderRadius: safe ? 0 : size * 0.22,
      }}
    >
      <svg width={w} height={w} viewBox="0 0 100 100">
        <path d="M50 12 L90 46 L82 46 L82 86 L18 86 L18 46 L10 46 Z" fill="#faf6ee" />
        <rect x="42" y="58" width="16" height="28" rx="4" fill="#8ba888" />
        <circle cx="50" cy="40" r="7" fill="#c9a87c" />
      </svg>
    </div>
  );
}
