# ADR 0016: Account identity, intent and resource-scoped authorization

**Status:** accepted, 14 August 2026.

## Decision

Use one phone-authenticated consumer account. Store product intent separately
from authorization. Derive user experiences from active organization
memberships, property assignments and occupancies. Treat properties as private
operational records and listings as separately moderated public advertisements.

Organizations provide owner/manager/team scope. Buildings, units and optional
beds provide one inventory model for residential property and hostels.
Invitations and manager-approved join requests create occupancies; users cannot
self-attach to private properties.

## Consequences

A tenant may later own or manage property without another account. A provider
may create private inventory before KYC, while all public publication remains
gated by user identity, property-specific authority and listing review. Existing
global roles and direct property fields remain temporary compatibility inputs,
not the target authorization source.

Contexts become stable resource identifiers (`discovery`, `occupancy:<id>`,
`organization:<id>`), and the backend owns routing and authorization truth for
both clients.
