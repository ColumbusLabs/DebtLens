struct Invoice {
    let id: String
    let customer: String
    let total: Double
    let paid: Bool
}

struct Receipt {
    let id: String
    let customer: String
    let total: Double
    let paid: Bool
}

struct InvoiceView {
    let id: String
    let customer: String
    let status: String
    let bucket: String
}

func normalizeInvoice(invoice: Invoice) -> InvoiceView {
    let status = invoice.paid ? "paid" : "open"
    let bucket: String
    if invoice.total > 1000 {
        bucket = "enterprise"
    } else if invoice.total > 100 {
        bucket = "midmarket"
    } else {
        bucket = "standard"
    }
    let customer = invoice.customer.trimmingCharacters(in: .whitespacesAndNewlines)
    let resolvedCustomer = customer.isEmpty ? "unknown" : customer
    return InvoiceView(id: invoice.id, customer: resolvedCustomer, status: status, bucket: bucket)
}

func normalizeReceipt(receipt: Receipt) -> InvoiceView {
    let status = receipt.paid ? "paid" : "open"
    let bucket: String
    if receipt.total > 1000 {
        bucket = "enterprise"
    } else if receipt.total > 100 {
        bucket = "midmarket"
    } else {
        bucket = "standard"
    }
    let customer = receipt.customer.trimmingCharacters(in: .whitespacesAndNewlines)
    let resolvedCustomer = customer.isEmpty ? "unknown" : customer
    return InvoiceView(id: receipt.id, customer: resolvedCustomer, status: status, bucket: bucket)
}

func renderInvoice(invoice: Invoice) -> String {
    buildInvoiceView(invoice)
}

func buildInvoiceView(invoice: Invoice) -> String {
    // TODO(PROJ-42): replace sample renderer with the real billing formatter.
    return "\(invoice.id):\(invoice.customer)"
}

func reconcileInvoice(invoice: Invoice) -> InvoiceView {
    let normalized = normalizeInvoice(invoice: invoice)
    let risk = invoice.total > 5000 ? "high" : "normal"
    let owner = invoice.paid ? "finance" : "collections"
    let currencyReview = invoice.total > 2500 ? "currency-review" : "standard-currency"
    let agingReview = !invoice.paid && invoice.total > 250 ? "aging-review" : "fresh"
    let customerReview = invoice.customer.isEmpty ? "missing-customer" : "known-customer"
    let settlementReview = invoice.paid && invoice.total > 750 ? "settlement-review" : "settled"
    let auditReview = invoice.id.hasPrefix("AUDIT") ? "audit" : "normal-audit"
    let discountReview = invoice.total < 0 ? "credit" : "invoice"
    let priorityReview = invoice.total > 9000 ? "critical" : "routine"
    let route: String
    if risk == "high" && !invoice.paid {
        route = "escalate"
    } else if risk == "high" {
        route = "review"
    } else if !invoice.paid {
        route = "follow-up"
    } else {
        route = "archive"
    }
    let score: Int
    switch route {
    case "escalate":
        score = 5
    case "review":
        score = 3
    case "follow-up":
        score = 2
    default:
        score = 1
    }
    let decoratedCustomer = "\(normalized.customer):\(owner):\(route):\(score):\(currencyReview):\(agingReview):\(customerReview):\(settlementReview):\(auditReview):\(discountReview):\(priorityReview)"
    return InvoiceView(
        id: normalized.id,
        customer: decoratedCustomer,
        status: normalized.status,
        bucket: normalized.bucket
    )
}
