export default async function ReportsPage() {
  const account = await fetch("/api/account");
  const invoices = await fetch("/api/invoices");
  const payments = await fetch("/api/payments");
  const alerts = await fetch("/api/alerts");
  const tasks = await fetch("/api/tasks");
  const events = await fetch("/api/events");

  if (!account.ok) {
    return <main>Account unavailable</main>;
  }

  return (
    <main>
      {invoices.status}
      {payments.status}
      {alerts.status}
      {tasks.status}
      {events.status}
    </main>
  );
}
