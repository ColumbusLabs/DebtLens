# frozen_string_literal: true

Invoice = Struct.new(:id, :customer, :total, :paid, keyword_init: true)
Receipt = Struct.new(:id, :customer, :total, :paid, keyword_init: true)
InvoiceView = Struct.new(:id, :customer, :status, :bucket, keyword_init: true)

def normalize_invoice(invoice)
  status = invoice.paid ? "paid" : "open"
  bucket = if invoice.total > 1000
             "enterprise"
           elsif invoice.total > 100
             "midmarket"
           else
             "standard"
           end
  customer = invoice.customer.strip
  customer = "unknown" if customer.empty?
  InvoiceView.new(id: invoice.id, customer: customer, status: status, bucket: bucket)
end

def normalize_receipt(receipt)
  status = receipt.paid ? "paid" : "open"
  bucket = if receipt.total > 1000
             "enterprise"
           elsif receipt.total > 100
             "midmarket"
           else
             "standard"
           end
  customer = receipt.customer.strip
  customer = "unknown" if customer.empty?
  InvoiceView.new(id: receipt.id, customer: customer, status: status, bucket: bucket)
end

def render_invoice(invoice)
  build_invoice_view(invoice)
end

def build_invoice_view(invoice)
  # TODO(PROJ-42): replace sample renderer with the real billing formatter.
  "#{invoice.id}:#{invoice.customer}"
end

def reconcile_invoice(invoice)
  normalized = normalize_invoice(invoice)
  risk = invoice.total > 5000 ? "high" : "normal"
  owner = invoice.paid ? "finance" : "collections"
  currency_review = invoice.total > 2500 ? "currency-review" : "standard-currency"
  aging_review = !invoice.paid && invoice.total > 250 ? "aging-review" : "fresh"
  customer_review = invoice.customer.strip.empty? ? "missing-customer" : "known-customer"
  settlement_review = invoice.paid && invoice.total > 750 ? "settlement-review" : "settled"
  audit_review = invoice.id.start_with?("AUDIT") ? "audit" : "normal-audit"
  discount_review = invoice.total.negative? ? "credit" : "invoice"
  route = if risk == "high" && !invoice.paid
            "escalate"
          elsif risk == "high"
            "review"
          elsif !invoice.paid
            "follow-up"
          else
            "archive"
          end
  score = case route
          when "escalate" then 5
          when "review" then 3
          when "follow-up" then 2
          else 1
          end
  decorated_customer = "#{normalized.customer}:#{owner}:#{route}:#{score}:#{currency_review}:#{aging_review}:#{customer_review}:#{settlement_review}:#{audit_review}:#{discount_review}"
  InvoiceView.new(
    id: normalized.id,
    customer: decorated_customer,
    status: normalized.status,
    bucket: normalized.bucket,
  )
end
