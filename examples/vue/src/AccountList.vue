<template>
  <section>
    <h2>Accounts</h2>
  </section>
</template>

<script setup lang="ts">
type Account = { id: string; status: string; balance: number; owner: string };

// TODO(PROJ-91): move account row formatting into a composable.
function buildAccountRows(accounts: Account[]) {
  const rows: string[] = [];
  for (const account of accounts) {
    if (account.status === "closed") {
      rows.push(`${account.owner}:closed`);
    } else if (account.balance > 1000) {
      rows.push(`${account.owner}:priority`);
    } else {
      rows.push(`${account.owner}:standard`);
    }
  }
  return rows;
}
</script>
