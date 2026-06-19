package com.example.billing

@Composable
fun BillingSummaryRow(
    uiState: BillingSummaryState,
    onAction: (BillingAction) -> Unit,
    modifier: Modifier = Modifier,
    leadingIcon: @Composable (() -> Unit)? = null,
    trailingContent: @Composable () -> Unit = {},
) {
    val latestAction by rememberUpdatedState(onAction)
    val listState = rememberLazyListState()
    /*
    var oldQuery by remember { mutableStateOf("") }
    var oldExpanded by remember { mutableStateOf(false) }
    */
    Row(modifier) {
        leadingIcon?.invoke()
        Text(uiState.customerName)
        Button(onClick = { latestAction(BillingAction.Open(uiState.invoiceId)) }) {
            Text("Open")
        }
        trailingContent()
    }
    LaunchedEffect(uiState.invoiceId) {
        listState.scrollToItem(0)
    }
}
