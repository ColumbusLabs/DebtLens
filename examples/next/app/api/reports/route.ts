export async function GET() {
  const account = await loadAccount();
  const invoices = await loadInvoices();
  const payments = await loadPayments();
  const alerts = await loadAlerts();
  const tasks = await loadTasks();
  const events = await loadEvents();

  if (!account.active) return Response.json({ error: "inactive" }, { status: 403 });
  if (!invoices.length) return Response.json({ account, invoices });

  return Response.json({ account, invoices, payments, alerts, tasks, events });
}
