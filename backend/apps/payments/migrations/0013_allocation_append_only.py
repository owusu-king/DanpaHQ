"""Allocations become append-only at the engine, not only in Python.

`PaymentAllocation.save`/`delete` already refused a rewrite, but a model guard
is only as strong as the code path that goes through it: `QuerySet.update()`
and `QuerySet.delete()` never call either, so a single mistaken line could
silently change or remove the row that says which obligation a confirmed
payment settled. Transactions, ledger lines and receipts have carried an
engine-level trigger since `payments/0002`; the record that makes a charge paid
was the one still missing it.
"""

from django.db import migrations

FORWARD_SQL = """
CREATE TRIGGER payments_allocation_append_only
BEFORE UPDATE OR DELETE ON payments_allocation
FOR EACH ROW EXECUTE FUNCTION payments_reject_financial_record_mutation();
"""

REVERSE_SQL = """
DROP TRIGGER IF EXISTS payments_allocation_append_only ON payments_allocation;
"""


class Migration(migrations.Migration):
    dependencies = [("payments", "0012_external_payment_receipts")]

    operations = [migrations.RunSQL(FORWARD_SQL, REVERSE_SQL)]
