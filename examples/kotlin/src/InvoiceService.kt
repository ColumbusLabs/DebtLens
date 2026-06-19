package examples.kotlin

data class Invoice(val id: String, val customer: String, val total: Double, val paid: Boolean)
data class Receipt(val id: String, val customer: String, val total: Double, val paid: Boolean)
data class InvoiceView(val id: String, val customer: String, val status: String, val bucket: String)

fun normalizeInvoice(invoice: Invoice): InvoiceView {
    val status = if (invoice.paid) "paid" else "open"
    val bucket = when {
        invoice.total > 1000 -> "enterprise"
        invoice.total > 100 -> "midmarket"
        else -> "standard"
    }
    val customer = invoice.customer.trim().ifBlank { "unknown" }
    return InvoiceView(invoice.id, customer, status, bucket)
}

fun normalizeReceipt(receipt: Receipt): InvoiceView {
    val status = if (receipt.paid) "paid" else "open"
    val bucket = when {
        receipt.total > 1000 -> "enterprise"
        receipt.total > 100 -> "midmarket"
        else -> "standard"
    }
    val customer = receipt.customer.trim().ifBlank { "unknown" }
    return InvoiceView(receipt.id, customer, status, bucket)
}

fun renderInvoice(invoice: Invoice) = buildInvoiceView(invoice)

fun buildInvoiceView(invoice: Invoice): String {
    // TODO(PROJ-42): replace sample renderer with the real billing formatter.
    return "${invoice.id}:${invoice.customer}"
}

fun reconcileInvoice(invoice: Invoice): InvoiceView {
    val normalized = normalizeInvoice(invoice)
    val risk = if (invoice.total > 5000) "high" else "normal"
    val owner = if (invoice.paid) "finance" else "collections"
    val currencyReview = if (invoice.total > 2500) "currency-review" else "standard-currency"
    val agingReview = if (!invoice.paid && invoice.total > 250) "aging-review" else "fresh"
    val customerReview = if (invoice.customer.isBlank()) "missing-customer" else "known-customer"
    val settlementReview = if (invoice.paid && invoice.total > 750) "settlement-review" else "settled"
    val auditReview = if (invoice.id.startsWith("AUDIT")) "audit" else "normal-audit"
    val discountReview = if (invoice.total < 0) "credit" else "invoice"
    val route = when {
        risk == "high" && !invoice.paid -> "escalate"
        risk == "high" -> "review"
        !invoice.paid -> "follow-up"
        else -> "archive"
    }
    val score = when (route) {
        "escalate" -> 5
        "review" -> 3
        "follow-up" -> 2
        else -> 1
    }
    val decoratedCustomer = "${normalized.customer}:$owner:$route:$score:$currencyReview:$agingReview:$customerReview:$settlementReview:$auditReview:$discountReview"
    return normalized.copy(customer = decoratedCustomer)
}
