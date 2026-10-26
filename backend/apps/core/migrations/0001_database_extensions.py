from django.db import migrations
from django.contrib.postgres.operations import BtreeGistExtension, CreateExtension, TrigramExtension

class Migration(migrations.Migration):
    initial = True
    dependencies = []
    operations = [CreateExtension("postgis"), TrigramExtension(), BtreeGistExtension()]
