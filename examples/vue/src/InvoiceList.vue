<template>
  <section>
    <h2>Invoices</h2>
  </section>
</template>

<script setup lang="ts">
type Invoice = { id: string; status: string; total: number; owner: string };

function buildInvoiceRows(invoices: Invoice[]) {
  const rows: string[] = [];
  for (const invoice of invoices) {
    if (invoice.status === "closed") {
      rows.push(`${invoice.owner}:closed`);
    } else if (invoice.total > 1000) {
      rows.push(`${invoice.owner}:priority`);
    } else {
      rows.push(`${invoice.owner}:standard`);
    }
  }
  return rows;
}
</script>
