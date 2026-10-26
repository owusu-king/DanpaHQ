from django.db import migrations

ENTITLEMENTS = [{'description': 'How many properties this Portfolio may hold at once.',
  'key': 'PROPERTY_LIMIT',
  'name': 'Properties',
  'value_type': 'integer'},
 {'description': 'How many rentable spaces this Portfolio may hold at once.',
  'key': 'UNIT_LIMIT',
  'name': 'Units',
  'value_type': 'integer'},
 {'description': 'How many people may belong to this Portfolio at once.',
  'key': 'TEAM_MEMBER_LIMIT',
  'name': 'Team members',
  'value_type': 'integer'},
 {'description': 'Remind tenants automatically before and after rent is due.',
  'key': 'AUTOMATED_RENT_REMINDERS',
  'name': 'Automated rent reminders',
  'value_type': 'boolean'},
 {'description': 'Financial reporting beyond the standard Portfolio summary.',
  'key': 'ADVANCED_REPORTING',
  'name': 'Advanced reporting',
  'value_type': 'boolean'},
 {'description': 'Download statements and reports.',
  'key': 'REPORT_EXPORTS',
  'name': 'Report exports',
  'value_type': 'boolean'},
 {'description': 'Occupancy, arrears and collection trends across the '
                 'Portfolio.',
  'key': 'PORTFOLIO_ANALYTICS',
  'name': 'Portfolio analytics',
  'value_type': 'boolean'},
 {'description': 'Invite people into the Portfolio and give them roles.',
  'key': 'TEAM_MANAGEMENT',
  'name': 'Team management',
  'value_type': 'boolean'},
 {'description': 'Scope a manager or staff member to particular properties.',
  'key': 'PROPERTY_ASSIGNMENTS',
  'name': 'Property assignments',
  'value_type': 'boolean'},
 {'description': 'A finance-only role that sees money without operational '
                 'control.',
  'key': 'ACCOUNTANT_ACCESS',
  'name': 'Accountant access',
  'value_type': 'boolean'},
 {'description': 'Act on many properties, units or tenancies at once.',
  'key': 'BULK_OPERATIONS',
  'name': 'Bulk operations',
  'value_type': 'boolean'},
 {'description': 'Collection performance, settlement timing and payment mix.',
  'key': 'ADVANCED_PAYMENT_ANALYTICS',
  'name': 'Payment analytics',
  'value_type': 'boolean'},
 {'description': 'Faster response from the Danpa HQ team.',
  'key': 'PRIORITY_SUPPORT',
  'name': 'Priority support',
  'value_type': 'boolean'},
 {'description': 'Programmatic access for integrations.',
  'key': 'API_ACCESS',
  'name': 'API access',
  'value_type': 'boolean'}]

PLANS = [{'annual_price_currency': 'GHS',
  'annual_price_minor': 0,
  'code': 'FREE',
  'description': 'For individual landlords getting started',
  'display_order': 1,
  'entitlements': {'ACCOUNTANT_ACCESS': {'is_unlimited': False, 'value': False},
                   'ADVANCED_PAYMENT_ANALYTICS': {'is_unlimited': False,
                                                  'value': False},
                   'ADVANCED_REPORTING': {'is_unlimited': False,
                                          'value': False},
                   'API_ACCESS': {'is_unlimited': False, 'value': False},
                   'AUTOMATED_RENT_REMINDERS': {'is_unlimited': False,
                                                'value': False},
                   'BULK_OPERATIONS': {'is_unlimited': False, 'value': False},
                   'PORTFOLIO_ANALYTICS': {'is_unlimited': False,
                                           'value': False},
                   'PRIORITY_SUPPORT': {'is_unlimited': False, 'value': False},
                   'PROPERTY_ASSIGNMENTS': {'is_unlimited': False,
                                            'value': False},
                   'PROPERTY_LIMIT': {'is_unlimited': False, 'value': 1},
                   'REPORT_EXPORTS': {'is_unlimited': False, 'value': False},
                   'TEAM_MANAGEMENT': {'is_unlimited': False, 'value': False},
                   'TEAM_MEMBER_LIMIT': {'is_unlimited': False, 'value': 1},
                   'UNIT_LIMIT': {'is_unlimited': False, 'value': 5}},
  'monthly_price_currency': 'GHS',
  'monthly_price_minor': 0,
  'name': 'Free'},
 {'annual_price_currency': 'GHS',
  'annual_price_minor': 89000,
  'code': 'PRO',
  'description': 'For growing landlords who need automation and deeper '
                 'management tools',
  'display_order': 2,
  'entitlements': {'ACCOUNTANT_ACCESS': {'is_unlimited': False, 'value': False},
                   'ADVANCED_PAYMENT_ANALYTICS': {'is_unlimited': False,
                                                  'value': True},
                   'ADVANCED_REPORTING': {'is_unlimited': False, 'value': True},
                   'API_ACCESS': {'is_unlimited': False, 'value': False},
                   'AUTOMATED_RENT_REMINDERS': {'is_unlimited': False,
                                                'value': True},
                   'BULK_OPERATIONS': {'is_unlimited': False, 'value': False},
                   'PORTFOLIO_ANALYTICS': {'is_unlimited': False,
                                           'value': True},
                   'PRIORITY_SUPPORT': {'is_unlimited': False, 'value': True},
                   'PROPERTY_ASSIGNMENTS': {'is_unlimited': False,
                                            'value': False},
                   'PROPERTY_LIMIT': {'is_unlimited': False, 'value': 10},
                   'REPORT_EXPORTS': {'is_unlimited': False, 'value': True},
                   'TEAM_MANAGEMENT': {'is_unlimited': False, 'value': True},
                   'TEAM_MEMBER_LIMIT': {'is_unlimited': False, 'value': 3},
                   'UNIT_LIMIT': {'is_unlimited': False, 'value': 50}},
  'monthly_price_currency': 'GHS',
  'monthly_price_minor': 8900,
  'name': 'Pro'},
 {'annual_price_currency': 'GHS',
  'annual_price_minor': 299000,
  'code': 'BUSINESS',
  'description': 'For professional property operations and teams',
  'display_order': 3,
  'entitlements': {'ACCOUNTANT_ACCESS': {'is_unlimited': False, 'value': True},
                   'ADVANCED_PAYMENT_ANALYTICS': {'is_unlimited': False,
                                                  'value': True},
                   'ADVANCED_REPORTING': {'is_unlimited': False, 'value': True},
                   'API_ACCESS': {'is_unlimited': False, 'value': True},
                   'AUTOMATED_RENT_REMINDERS': {'is_unlimited': False,
                                                'value': True},
                   'BULK_OPERATIONS': {'is_unlimited': False, 'value': True},
                   'PORTFOLIO_ANALYTICS': {'is_unlimited': False,
                                           'value': True},
                   'PRIORITY_SUPPORT': {'is_unlimited': False, 'value': True},
                   'PROPERTY_ASSIGNMENTS': {'is_unlimited': False,
                                            'value': True},
                   'PROPERTY_LIMIT': {'is_unlimited': False, 'value': 100},
                   'REPORT_EXPORTS': {'is_unlimited': False, 'value': True},
                   'TEAM_MANAGEMENT': {'is_unlimited': False, 'value': True},
                   'TEAM_MEMBER_LIMIT': {'is_unlimited': False, 'value': 25},
                   'UNIT_LIMIT': {'is_unlimited': False, 'value': 1000}},
  'monthly_price_currency': 'GHS',
  'monthly_price_minor': 29900,
  'name': 'Business'}]

def forwards(apps, schema_editor):
    Plan = apps.get_model("billing", "Plan")
    Entitlement = apps.get_model("billing", "Entitlement")
    PlanEntitlement = apps.get_model("billing", "PlanEntitlement")
    alias = schema_editor.connection.alias
    by_key = {}
    for spec in ENTITLEMENTS:
        fields = dict(spec)
        key = fields.pop("key")
        by_key[key], _ = Entitlement.objects.using(alias).get_or_create(key=key, defaults=fields)
    for spec in PLANS:
        fields = dict(spec)
        code = fields.pop("code")
        values = fields.pop("entitlements")
        plan, _ = Plan.objects.using(alias).get_or_create(code=code, defaults=fields)
        for key, value in values.items():
            PlanEntitlement.objects.using(alias).get_or_create(
                plan=plan, entitlement=by_key[key], defaults=value)

def backwards(apps, schema_editor):
    alias = schema_editor.connection.alias
    if apps.get_model("billing", "Subscription").objects.using(alias).exists():
        raise RuntimeError("Refusing to remove plans while subscriptions reference them.")
    apps.get_model("billing", "Plan").objects.using(alias).filter(
        code__in=[spec["code"] for spec in PLANS]).delete()
    apps.get_model("billing", "Entitlement").objects.using(alias).all().delete()

class Migration(migrations.Migration):
    dependencies = [("billing", "0003_invoice_guard")]
    operations = [migrations.RunPython(forwards, backwards)]
