import SwiftUI

struct BillingSummaryRow: View {
    let uiState: BillingSummaryState
    let onAction: (BillingAction) -> Void
    var leadingIcon: (() -> AnyView)?
    let trailingContent: () -> AnyView

    @State private var pulse = false

    var body: some View {
        HStack {
            if let leadingIcon {
                leadingIcon()
            }
            Text(uiState.customerName)
            Button("Open") {
                onAction(.open(uiState.invoiceId))
            }
            trailingContent()
        }
        .opacity(pulse ? 1 : 0.95)
    }
}

struct BillingSummaryState {
    let customerName: String
    let invoiceId: String
}

enum BillingAction {
    case open(String)
}
