"""The modular-monolith rule, enforced rather than trusted to review.

ADR 0002 says a domain module never imports another domain module's models.
Phase 0 left that to code review, which is how it erodes. This walks the actual
import statements.

The rule is directional: domain modules may import from the platform layer
(core, audit, outbox, files, geo), and the platform layer may import from
nothing above it. Cross-domain traffic goes through service functions or events.
"""

import ast
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
APPS = BACKEND / "apps"

PLATFORM = {"core", "audit", "outbox", "idempotency", "files", "geo", "notifications"}
# Property, listing, organization authority and occupancy share the same
# property-access boundary and may import within that bounded context. A sale is
# a property advertised whole, bound to it as a listing is to its Unit.
PROPERTY_ACCESS = frozenset({"property", "listing", "organization", "occupancy", "sale"})
DOMAIN = {
    "identity",
    "trust",
    "viewing",
    "application",
    "lease",
    "rent",
    # Repairs hang off the tenancy; the property side is reached through it.
    "maintenance",
    # Billing decides what a Portfolio may do; it must not reach into
    # another domain's models to find out, and no domain may import its
    # models to check a plan. `billing.enforcement` is the whole seam.
    "billing",
    # Reads every housing record and owns none of them; only its own share
    # grants and correction requests.
    "passport",
    # Tradespeople: their own profile and application. Approval is a trust
    # verification, read through trust services rather than its models.
    "artisan",
} | PROPERTY_ACCESS
EDGE = {"api"}


def _imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text())
    found = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            found.add(node.module)
        elif isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
    return found


def _module_files(app: str):
    return [p for p in (APPS / app).rglob("*.py") if "migrations" not in p.parts]


def _module_level_imports(path: Path) -> set[str]:
    """Only top-level import statements — inside functions is fine."""
    tree = ast.parse(path.read_text())
    found = set()
    for node in tree.body:  # only module body, not function bodies
        if isinstance(node, ast.ImportFrom) and node.module:
            found.add(node.module)
        elif isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
    return found


def test_platform_modules_do_not_import_domain_modules():
    """core must not know about identity at module level.

    Function-scoped imports (inside def or property bodies) are permitted and
    used deliberately for circular-dependency breaking. The rule is that the
    *module graph* is acyclic, not that cross-domain calls are banned.
    """
    offences = []
    for app in PLATFORM:
        for path in _module_files(app):
            for imported in _module_level_imports(path):
                for domain in DOMAIN | EDGE:
                    if imported.startswith(f"apps.{domain}"):
                        offences.append(
                            f"{path.relative_to(BACKEND)} module-level imports {imported}"
                        )
    assert not offences, "platform layer must not depend on domain layer:\n" + "\n".join(offences)


def test_domain_modules_do_not_import_each_other_at_module_level():
    """Cross-domain model imports go through service functions or events.

    Function-scope imports inside def or property bodies are permitted and
    are the mechanism used for cross-domain calls (e.g. files.services uses
    identity and trust inside function bodies). Module-level is the boundary.
    """
    offences = []
    # Domain modules may import from the platform layer (core, audit, outbox,
    # files, geo, idempotency) — that is what the platform layer is for.
    # The rule is that domain modules do NOT import other domain modules' models
    # at module level. (Function-scope cross-domain imports are fine.)
    for app in DOMAIN:
        others = DOMAIN - {app}
        # property and listing form one bounded context — cross-imports within it are permitted
        if app in PROPERTY_ACCESS:
            others -= PROPERTY_ACCESS
        for path in _module_files(app):
            for imported in _module_level_imports(path):
                for other in others:
                    if imported.startswith(f"apps.{other}.models"):
                        offences.append(
                            f"{path.relative_to(BACKEND)} module-level imports {imported}"
                        )
    assert not offences, (
        "domain modules must not import each other's models at module level:\n"
        + "\n".join(offences)
    )


def test_no_module_imports_the_api_layer():
    """The edge depends on the domains, never the other way round."""
    offences = []
    for app in PLATFORM | DOMAIN:
        for path in _module_files(app):
            for imported in _imports(path):
                if imported.startswith("apps.api"):
                    offences.append(f"{path.relative_to(BACKEND)} imports {imported}")
    assert not offences, "\n".join(offences)
