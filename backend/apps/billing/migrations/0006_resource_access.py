import apps.core.ids
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('billing', '0005_plan_taglines'),
        ('organization', '0005_organizationinvitation_sms_delivery'),
        ('property', '0014_property_amenities_confirmed_at'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='KeepActiveChoice',
            fields=[
                ('id', models.UUIDField(default=apps.core.ids.uuid7, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('kind', models.CharField(choices=[('property', 'Property'), ('unit', 'Unit')], max_length=12)),
                ('position', models.PositiveSmallIntegerField(default=0)),
                ('chosen_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('organization', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='keep_active_choices', to='organization.organization')),
                ('property', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to='property.property')),
                ('unit', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='+', to='property.unit')),
            ],
            options={
                'db_table': 'billing_keep_active_choice',
                'ordering': ('position', 'created_at'),
                'constraints': [
                    models.UniqueConstraint(condition=models.Q(('kind', 'property')), fields=('organization', 'property'), name='billing_one_choice_per_property'),
                    models.UniqueConstraint(condition=models.Q(('kind', 'unit')), fields=('organization', 'unit'), name='billing_one_choice_per_unit'),
                    models.CheckConstraint(condition=models.Q(models.Q(('kind', 'property'), ('unit__isnull', True)), models.Q(('kind', 'unit'), ('unit__isnull', False)), _connector='OR'), name='billing_choice_names_its_resource'),
                ],
            },
        ),
        migrations.CreateModel(
            name='ResourceAccess',
            fields=[
                ('id', models.UUIDField(default=apps.core.ids.uuid7, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('kind', models.CharField(choices=[('property', 'Property'), ('unit', 'Unit')], max_length=12)),
                ('state', models.CharField(choices=[('full', 'Fully active'), ('wind_down', 'Winding down'), ('read_only', 'Read-only')], max_length=12)),
                ('plan_code', models.CharField(blank=True, max_length=16)),
                ('restricted_at', models.DateTimeField()),
                ('state_changed_at', models.DateTimeField()),
                ('organization', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='resource_access', to='organization.organization')),
                ('property', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='billing_access', to='property.property')),
                ('unit', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='billing_access', to='property.unit')),
            ],
            options={
                'db_table': 'billing_resource_access',
                'ordering': ('restricted_at',),
                'indexes': [models.Index(fields=['organization', 'kind', 'state'], name='billing_access_org_kind_idx')],
                'constraints': [
                    models.UniqueConstraint(condition=models.Q(('kind', 'property')), fields=('property',), name='billing_one_access_row_per_property'),
                    models.UniqueConstraint(condition=models.Q(('kind', 'unit')), fields=('unit',), name='billing_one_access_row_per_unit'),
                    models.CheckConstraint(condition=models.Q(models.Q(('kind', 'property'), ('unit__isnull', True)), models.Q(('kind', 'unit'), ('unit__isnull', False)), _connector='OR'), name='billing_access_names_its_resource'),
                    models.CheckConstraint(condition=models.Q(('state__in', ['wind_down', 'read_only'])), name='billing_access_rows_are_restrictions'),
                ],
            },
        ),
    ]
