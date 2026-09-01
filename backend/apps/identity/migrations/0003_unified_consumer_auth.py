from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("identity", "0002_onboarding_completed_at")]

    operations = [
        migrations.AlterField(
            model_name="authchallenge",
            name="purpose",
            field=models.CharField(
                choices=[
                    ("continue", "Continue with phone"),
                    ("sign_up", "Sign up"),
                    ("sign_in", "Sign in"),
                    ("step_up", "Confirm a sensitive action"),
                    ("change_phone", "Change phone number"),
                    ("recover_account", "Recover account"),
                ],
                max_length=32,
            ),
        ),
    ]
