def normalize_invoice(invoice):
    total = 0
    for line in invoice["lines"]:
        total += line["amount"]
    return {
        "id": invoice["id"],
        "customer": invoice["customer"],
        "total": total,
    }


def normalize_receipt(receipt):
    total = 0
    for line in receipt["lines"]:
        total += line["amount"]
    return {
        "id": receipt["id"],
        "customer": receipt["customer"],
        "total": total,
    }


def render_invoice(invoice):
    return build_invoice_view(invoice)


def build_invoice_view(invoice):
    # TODO(PROJ-42): replace sample renderer with the real billing formatter.
    return f"{invoice['id']}:{invoice['customer']}"
