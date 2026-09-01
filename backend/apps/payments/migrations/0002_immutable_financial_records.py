from django.db import migrations


FORWARD_SQL = """
CREATE OR REPLACE FUNCTION payments_reject_financial_record_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'confirmed payment financial records are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_transaction_append_only
BEFORE UPDATE OR DELETE ON payments_transaction
FOR EACH ROW EXECUTE FUNCTION payments_reject_financial_record_mutation();

CREATE TRIGGER payments_ledger_append_only
BEFORE UPDATE OR DELETE ON payments_ledger_entry
FOR EACH ROW EXECUTE FUNCTION payments_reject_financial_record_mutation();

CREATE TRIGGER payments_receipt_append_only
BEFORE UPDATE OR DELETE ON payments_receipt
FOR EACH ROW EXECUTE FUNCTION payments_reject_financial_record_mutation();
"""

REVERSE_SQL = """
DROP TRIGGER IF EXISTS payments_transaction_append_only ON payments_transaction;
DROP TRIGGER IF EXISTS payments_ledger_append_only ON payments_ledger_entry;
DROP TRIGGER IF EXISTS payments_receipt_append_only ON payments_receipt;
DROP FUNCTION IF EXISTS payments_reject_financial_record_mutation();
"""


class Migration(migrations.Migration):
    dependencies = [("payments", "0001_initial")]

    operations = [migrations.RunSQL(FORWARD_SQL, REVERSE_SQL)]
