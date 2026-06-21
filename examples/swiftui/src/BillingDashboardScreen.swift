import SwiftUI

struct Account {
    let isPastDue: Bool
}

struct Invoice: Identifiable {
    let id: String
    let customer: String
    let requiresReview: Bool
    let isDisputed: Bool
    let isHighValue: Bool
    let isOverdue: Bool
}

struct BillingDashboardScreen: View {
    let account: Account
    let invoices: [Invoice]
    let onOpenInvoice: (Invoice) -> Void

    @State private var selectedTab = "open"
    @State private var query = ""
    @State private var showFilters = false
    @State private var selectedCustomer: String?
    @State private var snackbarMessage: String?
    @AppStorage("billingSortOrder") private var sortOrder = "dueDate"
    @StateObject private var listState = ScrollStateModel()
    @FocusState private var searchFocused: Bool

    var body: some View {
        VStack {
            if account.isPastDue {
                PastDueBanner(account: account)
            }
            if showFilters {
                BillingFilterDrawer(query: query, selectedCustomer: selectedCustomer)
            }
            if selectedTab == "open" {
                OpenInvoiceHeader(invoices: invoices)
            }
            if selectedTab == "paid" {
                PaidInvoiceHeader(invoices: invoices)
            }
            if selectedCustomer != nil {
                CustomerChip(customer: selectedCustomer)
            }
            if !query.isEmpty {
                SearchSummary(query: query)
            }
            if sortOrder == "amount" {
                AmountSortNotice()
            }
            if snackbarMessage != nil {
                BillingSnackbar(message: snackbarMessage)
            }
            switch true {
            case invoices.isEmpty:
                EmptyBillingState()
            case invoices.contains(where: { $0.requiresReview }):
                ReviewQueue(invoices: invoices)
            case invoices.contains(where: { $0.isDisputed }):
                DisputeQueue(invoices: invoices)
            default:
                InvoiceList(invoices: invoices, onOpenInvoice: onOpenInvoice)
            }
            ForEach(invoices) { invoice in
                if invoice.isHighValue {
                    HighValueInvoiceRow(invoice: invoice, onOpenInvoice: onOpenInvoice)
                } else if invoice.isOverdue {
                    OverdueInvoiceRow(invoice: invoice, onOpenInvoice: onOpenInvoice)
                } else {
                    InvoiceRow(invoice: invoice, onOpenInvoice: onOpenInvoice)
                }
            }
            BillingFooter()
        }
    }
}

struct BillingSummaryRow: View {
    let invoice: Invoice
    let expanded: Bool
    let onExpandedChange: (Bool) -> Void
    let onOpenInvoice: (Invoice) -> Void

    var body: some View {
        HStack {
            Text(invoice.customer)
            Button(expanded ? "Hide" : "Show") {
                onExpandedChange(!expanded)
            }
            Button("Open") {
                onOpenInvoice(invoice)
            }
        }
    }
}

private struct ScrollStateModel: ObservableObject {}

private struct PastDueBanner: View {
    let account: Account
    var body: some View { Text("Past due") }
}

private struct BillingFilterDrawer: View {
    let query: String
    let selectedCustomer: String?
    var body: some View { Text(query) }
}

private struct OpenInvoiceHeader: View {
    let invoices: [Invoice]
    var body: some View { Text("Open") }
}

private struct PaidInvoiceHeader: View {
    let invoices: [Invoice]
    var body: some View { Text("Paid") }
}

private struct CustomerChip: View {
    let customer: String?
    var body: some View { Text(customer ?? "") }
}

private struct SearchSummary: View {
    let query: String
    var body: some View { Text(query) }
}

private struct AmountSortNotice: View {
    var body: some View { Text("Amount sort") }
}

private struct BillingSnackbar: View {
    let message: String?
    var body: some View { Text(message ?? "") }
}

private struct EmptyBillingState: View {
    var body: some View { Text("Empty") }
}

private struct ReviewQueue: View {
    let invoices: [Invoice]
    var body: some View { Text("Review") }
}

private struct DisputeQueue: View {
    let invoices: [Invoice]
    var body: some View { Text("Dispute") }
}

private struct InvoiceList: View {
    let invoices: [Invoice]
    let onOpenInvoice: (Invoice) -> Void
    var body: some View { Text("List") }
}

private struct HighValueInvoiceRow: View {
    let invoice: Invoice
    let onOpenInvoice: (Invoice) -> Void
    var body: some View { Text(invoice.id) }
}

private struct OverdueInvoiceRow: View {
    let invoice: Invoice
    let onOpenInvoice: (Invoice) -> Void
    var body: some View { Text(invoice.id) }
}

private struct InvoiceRow: View {
    let invoice: Invoice
    let onOpenInvoice: (Invoice) -> Void
    var body: some View { Text(invoice.id) }
}

private struct BillingFooter: View {
    var body: some View { Text("Footer") }
}
