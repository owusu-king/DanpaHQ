from django.db import migrations

FORWARD_SQL = "\nCREATE OR REPLACE FUNCTION payments_reject_financial_record_mutation()\nRETURNS trigger AS $$\nBEGIN\n    RAISE EXCEPTION 'confirmed payment financial records are append-only';\nEND;\n$$ LANGUAGE plpgsql;\n\nCREATE TRIGGER payments_transaction_append_only\nBEFORE UPDATE OR DELETE ON payments_transaction\nFOR EACH ROW EXECUTE FUNCTION payments_reject_financial_record_mutation();\n\nCREATE TRIGGER payments_ledger_append_only\nBEFORE UPDATE OR DELETE ON payments_ledger_entry\nFOR EACH ROW EXECUTE FUNCTION payments_reject_financial_record_mutation();\n\nCREATE TRIGGER payments_receipt_append_only\nBEFORE UPDATE OR DELETE ON payments_receipt\nFOR EACH ROW EXECUTE FUNCTION payments_reject_financial_record_mutation();\n\n\nCREATE TRIGGER payments_allocation_append_only\nBEFORE UPDATE OR DELETE ON payments_allocation\nFOR EACH ROW EXECUTE FUNCTION payments_reject_financial_record_mutation();\n"
REVERSE_SQL = '\nDROP TRIGGER IF EXISTS payments_allocation_append_only ON payments_allocation;\n\n\nDROP TRIGGER IF EXISTS payments_transaction_append_only ON payments_transaction;\nDROP TRIGGER IF EXISTS payments_ledger_append_only ON payments_ledger_entry;\nDROP TRIGGER IF EXISTS payments_receipt_append_only ON payments_receipt;\nDROP FUNCTION IF EXISTS payments_reject_financial_record_mutation();\n'

class Migration(migrations.Migration):
    dependencies = [('payments', '0001_initial')]
    operations = [migrations.RunSQL(FORWARD_SQL, REVERSE_SQL)]
