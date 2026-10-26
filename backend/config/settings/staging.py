"""Hosted staging uses the same security requirements as production."""

from .production import *

ENVIRONMENT = "staging"
