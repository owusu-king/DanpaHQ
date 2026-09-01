
ONBOARDING ARCHITECTURE

AUTHENTICATION & WORKSPACE ARCHITECTURE

The Django backend is the source of truth for identity, authentication,
roles, verification state, and workspace access.

A user's phone number identifies ONE account. Do not create separate
accounts when the same person becomes both a tenant and provider.

The welcome-screen choice is an INTENT/CONTEXT choice, not an authorization
decision and does not change the user's role.

╔══════════════════════════════════════════════════════════════════════╗
║                    AUTHENTICATION & ONBOARDING                      ║
║                         ARCHITECTURE                                ║
╚══════════════════════════════════════════════════════════════════════╝


                              WELCOME
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
              ▼                  ▼                  ▼
       FIND A PROPERTY       I'M A TENANT     I OWN/MANAGE
              │                  │              PROPERTY
              │                  │                  │
              ▼                  ▼                  ▼
       PUBLIC PROPERTY        LOGIN              LOGIN
          SEARCH                 │                  │
              │                  └────────┬─────────┘
              │                           │
              │                  AUTHENTICATED USER
              │                           │
              │              ┌────────────┴────────────┐
              │              │                         │
              │              ▼                         ▼
              │       TENANT CAPABILITY         PROVIDER CAPABILITY
              │              │                         │
              │              │                 ┌───────┴────────┐
              │              │                 │                │
              │              │              NONE/PENDING     APPROVED
              │              │                 │                │
              │              │                 ▼                ▼
              │              │        PROVIDER ONBOARDING   PROVIDER
              │              │                 │             WORKSPACE
              │              │                 ▼
              │              │        PROVIDER VERIFICATION
              │              │                 │
              │              │          ┌──────┴──────┐
              │              │          │             │
              │              │       PENDING      APPROVED
              │              │          │             │
              │              │          ▼             ▼
              │              │     VERIFICATION   PROVIDER
              │              │        STATUS       WORKSPACE
              │              │
              │              ▼
              │         TENANT SPACE
              │
              ▼
       ANONYMOUS USER
       until auth required


==================================================
IMPORTANT RULES
==================================================

1. FIND PROPERTY

"Find Property" is anonymous.

Do NOT automatically:
- create a tenant account
- assign a tenant role
- show tenant tabs
- show the tenant workspace

The user remains an anonymous property-search visitor until an action
requires authentication.

--------------------------------------------------

2. I'M A TENANT

This means the user wants the tenant experience.

If unauthenticated:
    → Login

If authenticated and tenant capability exists:
    → Tenant Space

If authenticated but tenant capability does not exist:
    → Do NOT simply grant tenant access unless the backend's business
      rules explicitly allow the user to acquire that capability.

--------------------------------------------------

3. I OWN/MANAGE PROPERTY

This means the user wants the provider experience.

If unauthenticated:
    → Login / Create Account

If authenticated:
    → Inspect provider state from the backend.

Provider states:

    NONE
       ↓
    PROVIDER ONBOARDING
       ↓
    PROVIDER VERIFICATION
       ↓
    PENDING
       ↓
    APPROVED
       ↓
    PROVIDER SPACE

The user does NOT need to create a property to create a provider account
or begin provider verification.

--------------------------------------------------

4. PROVIDER VERIFICATION IS NOT PROPERTY VERIFICATION

These are separate concepts.

Provider verification answers:

    "Is this person approved to operate as a property provider?"

Property verification answers:

    "Does this provider have authority over THIS property?"

Do not combine these states.

A provider can be:

    provider = APPROVED

while having:

    Property A = APPROVED
    Property B = PENDING
    Property C = REJECTED

--------------------------------------------------

5. TENANT + PROVIDER

A person may legitimately have both capabilities.

Example:

    User
      ├── Tenant = ACTIVE
      └── Provider = PENDING

Later:

    User
      ├── Tenant = ACTIVE
      └── Provider = APPROVED

Do NOT make tenant and provider mutually exclusive.

Do NOT convert the tenant into a provider.

Do NOT create a second account.

--------------------------------------------------

6. CURRENT EXPERIENCE

The user's current workspace/context is NOT the same thing as their
roles.

Example:

    tenant = ACTIVE
    provider = PENDING

The user may currently be in:

    provider verification

They should also be able to choose:

    "Switch to tenant experience"

This simply navigates them to the tenant workspace.

It does NOT:
- change their roles
- cancel provider verification
- log them out
- create another account

--------------------------------------------------

7. PROVIDER ACCESS

Having a provider role/account does NOT automatically mean the user can
access the provider workspace.

Provider workspace access requires backend approval.

For example:

    provider exists = true
    provider verification = pending
    provider workspace access = false

The frontend must show provider verification/status instead of the
provider workspace.

After approval:

    provider verification = approved
    provider workspace access = true

--------------------------------------------------

8. CLIENTS

This architecture must be implemented consistently in:

    Django backend
    Next.js web
    React Native mobile

Django is the source of truth.

Never rely on hiding a tab or route on the client as the security boundary.

The backend must enforce authorization for:
- tenant resources
- provider resources
- provider verification
- properties
- property authority
- provider workspace
- tenant workspace

Web and mobile should consume backend state/capabilities and render the
appropriate experience.

--------------------------------------------------

9. DO NOT ASSUME PHONE LOGIN = TENANT OR PROVIDER

Phone authentication only establishes the authenticated account.

It does NOT mean:

    logged in = tenant

and it does NOT mean:

    logged in = provider

The backend must determine the user's capabilities and verification
state.

--------------------------------------------------

10. EXISTING TENANT CHOOSES "I OWN/MANAGE PROPERTY"

This is an important case.

Example:

    User:
      tenant = ACTIVE
      provider = NONE

They choose:

    "I OWN/MANAGE PROPERTY"

After login, do NOT send them directly to tenant space.

Recognize that they are an existing authenticated tenant who wants to
enter the provider journey.

Start provider onboarding/verification:

    tenant = ACTIVE
    provider = PENDING / IN_REVIEW

They can then either:

    Continue provider verification

or:

    "Switch to tenant experience"

Switching back to tenant is only a navigation/context change.
                               