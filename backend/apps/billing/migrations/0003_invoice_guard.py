from django.db import migrations

FORWARD_SQL = "\nCREATE OR REPLACE FUNCTION billing_invoice_reject_final_mutation()\nRETURNS trigger AS $$\nBEGIN\n    IF TG_OP = 'DELETE' THEN\n        RAISE EXCEPTION 'billing invoices are financial history and cannot be deleted';\n    END IF;\n    IF OLD.status IN ('paid', 'void') THEN\n        RAISE EXCEPTION 'a paid or void billing invoice is final';\n    END IF;\n    RETURN NEW;\nEND;\n$$ LANGUAGE plpgsql;\n\nCREATE TRIGGER billing_invoice_final\nBEFORE UPDATE OR DELETE ON billing_invoice\nFOR EACH ROW EXECUTE FUNCTION billing_invoice_reject_final_mutation();\n"
REVERSE_SQL = '\nDROP TRIGGER IF EXISTS billing_invoice_final ON billing_invoice;\nDROP FUNCTION IF EXISTS billing_invoice_reject_final_mutation();\n'

class Migration(migrations.Migration):
    dependencies = [('billing', '0002_initial')]
    operations = [migrations.RunSQL(FORWARD_SQL, REVERSE_SQL)]
