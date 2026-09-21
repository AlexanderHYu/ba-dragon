// 国旗：Windows 的 Segoe UI Emoji 没有国旗字形（🇷🇺 会显示成 RU 两个方块字母），
// 所以自己画两面小旗子。只有俄美两方，别的阵营不画。
export default function Flag({ code }: { code: 'RU' | 'US' | null | undefined }): React.JSX.Element | null {
  if (code !== 'RU' && code !== 'US') return null
  return (
    <svg className="flag" viewBox="0 0 18 12" width="18" height="12" role="img" aria-label={code}>
      <clipPath id={'fc-' + code}>
        <rect x="0" y="0" width="18" height="12" rx="1.5" />
      </clipPath>
      <g clipPath={`url(#fc-${code})`}>
        {code === 'RU' ? (
          <>
            <rect width="18" height="4" fill="#ffffff" />
            <rect y="4" width="18" height="4" fill="#0039a6" />
            <rect y="8" width="18" height="4" fill="#d52b1e" />
          </>
        ) : (
          <>
            <rect width="18" height="12" fill="#ffffff" />
            {[0, 2, 4, 6, 8, 10].map((y) => (
              <rect key={y} y={y} width="18" height="1" fill="#b22234" />
            ))}
            <rect width="8" height="6.5" fill="#3c3b6e" />
          </>
        )}
      </g>
      <rect x="0.25" y="0.25" width="17.5" height="11.5" rx="1.4" fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth="0.5" />
    </svg>
  )
}
