import pytest

from src.service import normalize_invoice


@pytest.mark.parametrize(
    "invoice,total",
    [
        ({"id": "a", "customer": "Acme", "lines": [{"amount": 10}]}, 10),
        ({"id": "b", "customer": "Beta", "lines": [{"amount": 3}, {"amount": 7}]}, 10),
    ],
)
def test_normalize_invoice(invoice, total):
    assert normalize_invoice(invoice)["total"] == total
