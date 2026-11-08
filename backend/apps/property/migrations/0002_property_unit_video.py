import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("property", "0001_initial"), ("files", "0003_alter_storedfile_purpose")]
    operations = [
        migrations.AddField(
            model_name=name, name="video",
            field=models.OneToOneField(
                blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                related_name=f"{name}_video_of", to="files.storedfile",
            ),
        )
        for name in ("property", "unit")
    ]
