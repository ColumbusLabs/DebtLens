import { useMemo, useState } from "react";

interface Props {
  invoices: Array<{ id: string; amount: number; status: "open" | "paid" }>;
}

export function BoundedInvoicePanel({ invoices }: Props) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "open" | "paid">("all");

  const visibleInvoices = useMemo(() => {
    return invoices.filter((invoice) => {
      const matchesStatus = status === "all" || invoice.status === status;
      const matchesQuery = invoice.id.includes(query);
      return matchesStatus && matchesQuery;
    });
  }, [invoices, query, status]);

  return (
    <section>
      <input value={query} onChange={(event) => setQuery(event.target.value)} />
      <button onClick={() => setStatus("open")}>Open</button>
      <button onClick={() => setStatus("paid")}>Paid</button>
      <ul>
        {visibleInvoices.map((invoice) => (
          <li key={invoice.id}>{invoice.amount}</li>
        ))}
      </ul>
    </section>
  );
}
