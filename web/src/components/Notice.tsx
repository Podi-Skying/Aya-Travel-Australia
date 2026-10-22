export function ConfigNotice({ missing }: { missing: string[] }) {
  return (
    <Notice title="網站設定還沒完成">
      <p>伺服器缺少下列環境變數，所以還不能顯示行程：</p>
      <ul>
        {missing.map((k) => (
          <li key={k}>
            <code>{k}</code>
          </li>
        ))}
      </ul>
      <p className="muted small">請到 Vercel → 專案 → Settings → Environment Variables 加上這些變數，然後到 Deployments 重新部署（Redeploy）。說明見 docs/DEPLOY.md。</p>
    </Notice>
  );
}

export function Notice({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <main id="main">
      <div className="card center-card">
        <h2>{title}</h2>
        {children}
      </div>
    </main>
  );
}
