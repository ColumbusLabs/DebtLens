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


def reconcile_invoice_status(invoice, account):
    status = "review"
    if invoice.get("void"):
        return "void"
    if invoice.get("paid") and account.get("active"):
        status = "paid"
    elif invoice.get("paid") and not account.get("active"):
        status = "paid-inactive"
    elif invoice.get("pending") or invoice.get("retry"):
        status = "pending"
    else:
        for line in invoice.get("lines", []):
            if line.get("blocked"):
                status = "blocked"
            elif line.get("disputed"):
                status = "disputed"
            else:
                if line.get("amount", 0) > 1000:
                    status = "review"
    try:
        if account.get("hold"):
            status = "hold"
    except KeyError:
        status = "unknown"
    match invoice.get("region"):
        case "eu":
            if invoice.get("vat_missing"):
                status = "tax-review"
        case _:
            if account.get("manual"):
                status = "manual-review"
    return status
