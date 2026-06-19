<script lang="ts">
  type Account = { id: string; status: string; balance: number; owner: string };

  // TODO(PROJ-92): extract account row formatting into shared script logic.
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

<section>
  <h2>Accounts</h2>
</section>
