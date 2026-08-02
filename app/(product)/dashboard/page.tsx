import Link from "next/link";

export default function DashboardPage() {
  return (
    <section className="dashboard-empty" aria-labelledby="dashboard-heading">
      <p className="eyebrow">Your workspace</p>
      <h1 id="dashboard-heading">Your story starts here.</h1>
      <p>
        Build a private source of truth for your essays. Begin with nine guided
        questions about your experiences, values, goals, and voice.
      </p>
      <Link className="button button-primary" href="/interview">
        Start or resume interview
      </Link>
      <div className="empty-note">
        <span aria-hidden="true">01</span>
        <p>Only server-confirmed answers are added to your interview.</p>
      </div>
    </section>
  );
}
