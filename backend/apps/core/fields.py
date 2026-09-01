"""Custom model fields that push domain invariants into the schema."""

from __future__ import annotations

from django.core.exceptions import ValidationError
from django.db import models

from .digital_address import DigitalAddressError, normalise_digital_address
from .money import GHS, Money
from .phone import PhoneNumberError, normalise_ghana_msisdn


class PhoneNumberField(models.CharField):
    """Stores E.164. Normalises on the way in so uniqueness actually holds.

    Without this, ``0241234567`` and ``+233241234567`` are two different strings
    and a unique index on the column silently allows duplicate humans.
    """

    description = "Ghanaian phone number stored in E.164"

    def __init__(self, *args, mobile_only: bool = True, **kwargs):
        kwargs.setdefault("max_length", 16)
        self.mobile_only = mobile_only
        super().__init__(*args, **kwargs)

    def deconstruct(self):
        name, path, args, kwargs = super().deconstruct()
        if self.mobile_only is not True:
            kwargs["mobile_only"] = self.mobile_only
        if kwargs.get("max_length") == 16:
            kwargs.pop("max_length", None)
        return name, path, args, kwargs

    def clean(self, value, model_instance):
        value = self.to_python(value)
        return super().clean(value, model_instance)

    def to_python(self, value):
        if value in self.empty_values:
            return value
        try:
            return normalise_ghana_msisdn(str(value), mobile_only=self.mobile_only)
        except PhoneNumberError as exc:
            raise ValidationError(str(exc), code="invalid_phone") from exc

    def pre_save(self, model_instance, add):
        value = self.to_python(getattr(model_instance, self.attname))
        setattr(model_instance, self.attname, value)
        return value


class DigitalAddressField(models.CharField):
    """GhanaPost GPS code, normalised to ``GA-543-0125``."""

    description = "GhanaPost GPS digital address"

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("max_length", 12)
        super().__init__(*args, **kwargs)

    def deconstruct(self):
        name, path, args, kwargs = super().deconstruct()
        if kwargs.get("max_length") == 12:
            kwargs.pop("max_length", None)
        return name, path, args, kwargs

    def to_python(self, value):
        if value in self.empty_values:
            return value
        try:
            return normalise_digital_address(str(value)).value
        except DigitalAddressError as exc:
            raise ValidationError(str(exc), code="invalid_digital_address") from exc

    def pre_save(self, model_instance, add):
        value = self.to_python(getattr(model_instance, self.attname))
        setattr(model_instance, self.attname, value)
        return value


class MoneyDescriptor:
    def __init__(self, field: MoneyField):
        self.field = field

    def __get__(self, instance, owner=None):
        if instance is None:
            return self.field
        minor = instance.__dict__.get(self.field.minor_attr)
        if minor is None:
            return None
        code = instance.__dict__.get(self.field.currency_attr) or GHS.code
        return Money(minor, code)

    def __set__(self, instance, value):
        if value is None:
            instance.__dict__[self.field.minor_attr] = None
            return
        if not isinstance(value, Money):
            raise TypeError(
                f"{self.field.name} takes a Money instance, not {type(value).__name__}. "
                "Use Money.from_major('1500.00')."
            )
        instance.__dict__[self.field.minor_attr] = value.minor
        instance.__dict__[self.field.currency_attr] = value.currency_code


class MoneyField:
    """Declares a (BIGINT minor units, CHAR(3) currency) column pair.

    Not a single ``DecimalField``: an amount without its currency is a bug
    waiting for the first cross-border landlord, and a float amount is a bug
    waiting for the first reconciliation run.

    Usage::

        class Invoice(BaseModel):
            amount = MoneyField()

        invoice.amount = Money.from_major("1500.00")
        invoice.amount_minor      # 150000
        invoice.amount_currency   # "GHS"
    """

    def __init__(self, *, null: bool = False, default_currency: str = GHS.code, **kwargs):
        self.null = null
        self.default_currency = default_currency
        self.kwargs = kwargs

    def contribute_to_class(self, cls, name, **_):
        self.name = name
        self.minor_attr = f"{name}_minor"
        self.currency_attr = f"{name}_currency"

        models.BigIntegerField(null=self.null, **self.kwargs).contribute_to_class(
            cls, self.minor_attr
        )
        models.CharField(
            max_length=3, default=self.default_currency, null=self.null
        ).contribute_to_class(cls, self.currency_attr)
        setattr(cls, name, MoneyDescriptor(self))
