from django.db import migrations

FORWARD_SQL = "\nCREATE OR REPLACE FUNCTION rent_reject_adjustment_mutation()\nRETURNS trigger AS $$\nBEGIN\n    RAISE EXCEPTION 'obligation adjustments are append-only';\nEND;\n$$ LANGUAGE plpgsql;\n\nCREATE TRIGGER rent_obligation_adjustment_append_only\nBEFORE UPDATE OR DELETE ON rent_obligation_adjustment\nFOR EACH ROW EXECUTE FUNCTION rent_reject_adjustment_mutation();\n"
REVERSE_SQL = '\nDROP TRIGGER IF EXISTS rent_obligation_adjustment_append_only\n    ON rent_obligation_adjustment;\nDROP FUNCTION IF EXISTS rent_reject_adjustment_mutation();\n'

class Migration(migrations.Migration):
    dependencies = [('rent', '0001_initial')]
    operations = [migrations.RunSQL(FORWARD_SQL, REVERSE_SQL)]
