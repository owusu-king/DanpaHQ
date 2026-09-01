"""Waivers and write-offs become append-only at the engine.

`ObligationAdjustment.save`/`delete` refuse a rewrite, but neither runs for
`QuerySet.update()` or `QuerySet.delete()`. A waiver is the record of a
provider forgiving a real debt; if it can be edited afterwards it stops being
evidence of anything. Rent keeps its own trigger function rather than borrowing
the payments one, so the two apps stay independently reversible.
"""

from django.db import migrations

FORWARD_SQL = """
CREATE OR REPLACE FUNCTION rent_reject_adjustment_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'obligation adjustments are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rent_obligation_adjustment_append_only
BEFORE UPDATE OR DELETE ON rent_obligation_adjustment
FOR EACH ROW EXECUTE FUNCTION rent_reject_adjustment_mutation();
"""

REVERSE_SQL = """
DROP TRIGGER IF EXISTS rent_obligation_adjustment_append_only
    ON rent_obligation_adjustment;
DROP FUNCTION IF EXISTS rent_reject_adjustment_mutation();
"""


class Migration(migrations.Migration):
    dependencies = [("rent", "0008_rentpayment_evidence_file")]

    operations = [migrations.RunSQL(FORWARD_SQL, REVERSE_SQL)]
