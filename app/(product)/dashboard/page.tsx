export default function DashboardPage() {
  return (
    <section className="dashboard-empty" aria-labelledby="dashboard-heading">
      <p className="eyebrow">Your workspace</p>
      <h1 id="dashboard-heading">Your story starts here.</h1>
      <p>
        Your dashboard is ready. The guided Story Vault interview arrives in the
        next step of the beta.
      </p>
      <div className="empty-note">
        <span aria-hidden="true">01</span>
        <p>Nothing is stored until you choose to begin.</p>
      </div>
    </section>
  );
}
