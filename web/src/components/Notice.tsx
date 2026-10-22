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
