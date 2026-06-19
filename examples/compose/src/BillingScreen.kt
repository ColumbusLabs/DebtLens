package com.example.billing

@Composable
fun BillingDashboardScreen(account: Account, invoices: List<Invoice>, onOpenInvoice: (Invoice) -> Unit) {
    var selectedTab by rememberSaveable { mutableStateOf("open") }
    var query by remember { mutableStateOf("") }
    var showFilters by remember { mutableStateOf(false) }
    var selectedCustomer by remember { mutableStateOf<String?>(null) }
    var snackbarMessage by remember { mutableStateOf<String?>(null) }
    var sortOrder by rememberSaveable { mutableStateOf("dueDate") }
    val listState = rememberLazyListState()
    val scrollState = rememberScrollState()

    Column {
        if (account.isPastDue) {
            PastDueBanner(account)
        }
        if (showFilters) {
            BillingFilterDrawer(query, selectedCustomer)
        }
        if (selectedTab == "open") {
            OpenInvoiceHeader(invoices)
        }
        if (selectedTab == "paid") {
            PaidInvoiceHeader(invoices)
        }
        if (selectedCustomer != null) {
            CustomerChip(selectedCustomer)
        }
        if (query.isNotBlank()) {
            SearchSummary(query)
        }
        if (sortOrder == "amount") {
            AmountSortNotice()
        }
        if (snackbarMessage != null) {
            BillingSnackbar(snackbarMessage)
        }
        when {
            invoices.isEmpty() -> EmptyBillingState()
            invoices.any { it.requiresReview } -> ReviewQueue(invoices)
            invoices.any { it.isDisputed } -> DisputeQueue(invoices)
            else -> InvoiceList(invoices, listState, onOpenInvoice)
        }
        invoices.forEach { invoice ->
            if (invoice.isHighValue) {
                HighValueInvoiceRow(invoice, onOpenInvoice)
            } else if (invoice.isOverdue) {
                OverdueInvoiceRow(invoice, onOpenInvoice)
            } else {
                InvoiceRow(invoice, onOpenInvoice)
            }
        }
        BillingFooter(scrollState)
    }
}

@Composable
fun BillingSummaryRow(
    invoice: Invoice,
    expanded: Boolean,
    onExpandedChange: (Boolean) -> Unit,
    onOpenInvoice: (Invoice) -> Unit,
) {
    Row {
        Text(invoice.customer)
        Button(onClick = { onExpandedChange(!expanded) }) {
            Text(if (expanded) "Hide" else "Show")
        }
        Button(onClick = { onOpenInvoice(invoice) }) {
            Text("Open")
        }
    }
}
