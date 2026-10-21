"""API v1 router.

The version lives in the URL because mobile clients cannot be force-upgraded: a
tenant on a 2019 Android phone with 400MB free may run last year's build for a
long time, and the API has to keep answering it.
"""

from django.urls import include, path

from apps.application import views as application_views
from apps.artisan import views as artisan_views
from apps.billing.api import views as billing_views
from apps.core.health import healthz, readyz
from apps.files import urls as files_urls
from apps.files import views as files_views
from apps.geo import views as geo_views
from apps.identity import views as identity_views
from apps.lease import views as lease_views
from apps.listing import views as listing_views
from apps.maintenance import views as maintenance_views
from apps.notifications import views as notification_views
from apps.occupancy import tenancy_views
from apps.occupancy import views as occupancy_views
from apps.operations import views as operations_views
from apps.organization import views as organization_views
from apps.passport import views as passport_views
from apps.payments import views as payment_views
from apps.property import lifecycle_views
from apps.property import type_views as property_type_views
from apps.property import views as property_views
from apps.rent import views as rent_views
from apps.sale import views as sale_views
from apps.trust import condition_views as trust_condition_views
from apps.trust import evidence_views
from apps.trust import views as trust_views
from apps.viewing import views as viewing_views

from .views import meta

app_name = "api"

auth_patterns = [
    path("auth/sign-in/", identity_views.PasswordSignInView.as_view(), name="auth-sign-in"),
    path("auth/google/", identity_views.GoogleSignInView.as_view(), name="auth-google"),
    path("auth/challenge/", identity_views.StartChallengeView.as_view(), name="auth-challenge"),
    path("auth/verify/", identity_views.VerifyChallengeView.as_view(), name="auth-verify"),
    path(
        "auth/password-reset/",
        identity_views.StartPasswordResetView.as_view(),
        name="auth-password-reset",
    ),
    path(
        "auth/password-reset/verify/",
        identity_views.VerifyPasswordResetView.as_view(),
        name="auth-password-reset-verify",
    ),
    path(
        "auth/password-reset/complete/",
        identity_views.CompletePasswordResetView.as_view(),
        name="auth-password-reset-complete",
    ),
    path("auth/refresh/", identity_views.RefreshView.as_view(), name="auth-refresh"),
    path("auth/sign-out/", identity_views.SignOutView.as_view(), name="auth-sign-out"),
    path("auth/step-up/", identity_views.StepUpView.as_view(), name="auth-step-up"),
]

me_patterns = [
    path("me/", identity_views.MeView.as_view(), name="me"),
    path(
        "me/registration/",
        identity_views.CompleteRegistrationView.as_view(),
        name="me-registration",
    ),
    path("me/password/", identity_views.ChangePasswordView.as_view(), name="me-password"),
    path("me/google/", identity_views.GoogleLinkView.as_view(), name="me-google"),
    path("me/phone/", identity_views.PhoneVerificationView.as_view(), name="me-phone"),
    path(
        "me/phone/verify/",
        identity_views.ConfirmPhoneVerificationView.as_view(),
        name="me-phone-verify",
    ),
    path("me/email/", identity_views.EmailView.as_view(), name="me-email"),
    path("me/email/verify/", identity_views.VerifyEmailView.as_view(), name="me-email-verify"),
    path("me/workspace/", identity_views.WorkspaceView.as_view(), name="me-workspace"),
    path(
        "me/provider-verification/",
        identity_views.ProviderVerificationView.as_view(),
        name="me-provider-verification",
    ),
    path("me/profile/", identity_views.ProfileView.as_view(), name="me-profile"),
    path(
        "me/profile/<str:role>/", identity_views.RoleProfileView.as_view(), name="me-role-profile"
    ),
    path("me/roles/", identity_views.RoleView.as_view(), name="me-roles"),
    path(
        "me/onboarding/role/",
        identity_views.OnboardingRoleView.as_view(),
        name="me-onboarding-role",
    ),
    path(
        "me/onboarding/intent/",
        identity_views.OnboardingIntentView.as_view(),
        name="me-onboarding-intent",
    ),
    path("me/onboarding/", identity_views.OnboardingView.as_view(), name="me-onboarding"),
    path("me/security/", identity_views.SecurityStatusView.as_view(), name="me-security"),
    path(
        "me/devices/",
        identity_views.DeviceViewSet.as_view({"get": "list"}),
        name="me-devices",
    ),
    path(
        "me/devices/<uuid:pk>/",
        identity_views.DeviceViewSet.as_view({"delete": "destroy"}),
        name="me-device",
    ),
    path(
        "me/devices/<uuid:pk>/block/",
        identity_views.DeviceViewSet.as_view({"post": "block"}),
        name="me-device-block",
    ),
    path(
        "me/sessions/",
        identity_views.SessionViewSet.as_view({"get": "list"}),
        name="me-sessions",
    ),
    path(
        "me/sessions/<uuid:pk>/",
        identity_views.SessionViewSet.as_view({"delete": "destroy"}),
        name="me-session",
    ),
]


file_patterns = [
    path("files/limits/", files_views.UploadLimitsView.as_view(), name="file-limits"),
    path("files/uploads/", files_views.ReserveUploadView.as_view(), name="file-upload"),
    path(
        "files/uploads/<uuid:pk>/complete/",
        files_views.CompleteUploadView.as_view(),
        name="file-complete",
    ),
    path("files/<uuid:pk>/", files_views.FileDetailView.as_view(), name="file-detail"),
    path("files/<uuid:pk>/download/", files_views.FileDownloadView.as_view(), name="file-download"),
]

local_storage_patterns = [
    path("storage/upload/<path:key>", files_views.local_upload, name="local-upload"),
    path("storage/download/<path:key>", files_views.local_download, name="local-download"),
]


notification_patterns = [
    path(
        "me/notifications/",
        notification_views.NotificationListView.as_view(),
        name="me-notifications",
    ),
    path(
        "me/notifications/read/",
        notification_views.MarkReadView.as_view(),
        name="me-notifications-read",
    ),
    path(
        "me/notification-preferences/",
        notification_views.NotificationPreferenceView.as_view(),
        name="me-notification-preferences",
    ),
]

geo_patterns = [
    path("geo/regions/", geo_views.RegionListView.as_view(), name="geo-regions"),
    path("geo/districts/", geo_views.DistrictListView.as_view(), name="geo-districts"),
    path("geo/localities/", geo_views.LocalityListView.as_view(), name="geo-localities"),
    path("geo/places/suggest/", geo_views.PlaceSuggestView.as_view(), name="geo-place-suggest"),
    path("geo/places/resolve/", geo_views.PlaceResolveView.as_view(), name="geo-place-resolve"),
    path("map/config/", geo_views.MapConfigView.as_view(), name="map-config"),
    path("geo/addresses/", geo_views.AddressListCreateView.as_view(), name="geo-addresses"),
    path("geo/addresses/<uuid:pk>/", geo_views.AddressDetailView.as_view(), name="geo-address"),
]

property_patterns = [
    path(
        "provider/readiness/",
        property_views.ProviderReadinessView.as_view(),
        name="provider-readiness",
    ),
    path(
        "provider/applications/",
        property_views.ProviderApplicationView.as_view(),
        name="provider-applications",
    ),
    path(
        "provider/applications/<uuid:pk>/evidence/",
        property_views.ProviderApplicationEvidenceView.as_view(),
        name="provider-application-evidence",
    ),
    # The vocabulary itself: categories, and what each may contain. Served so
    # neither client keeps its own copy of the matrix.
    path(
        "property-types/",
        property_type_views.PropertyTypeOptionsView.as_view(),
        name="property-types",
    ),
    path("properties/", property_views.PropertyListCreateView.as_view(), name="properties"),
    # The document, recorded against the property and not sent. Creation's
    # Documents step — see `PropertyClaimView` for why it is not the onboarding
    # endpoint with a flag.
    path(
        "properties/<uuid:pk>/claim/",
        property_views.PropertyClaimView.as_view(),
        name="property-claim",
    ),
    path(
        "properties/<uuid:pk>/", property_views.PropertyDetailView.as_view(), name="property-detail"
    ),
    path(
        "properties/<uuid:property_pk>/units/",
        property_views.UnitListCreateView.as_view(),
        name="property-units",
    ),
    path(
        "units/<uuid:unit_pk>/beds/", property_views.BedListCreateView.as_view(), name="unit-beds"
    ),
    path(
        "properties/<uuid:property_pk>/media/",
        property_views.PropertyMediaView.as_view(),
        name="property-media",
    ),
    # The rentable space itself. Before the verification routes below, which are
    # more specific paths under the same prefix and are matched first by Django
    # in the order they are listed.
    path("units/<uuid:pk>/", property_views.UnitDetailView.as_view(), name="unit-detail"),
    path(
        "units/<uuid:pk>/access-code/rotate/",
        property_views.UnitAccessCodeRotateView.as_view(),
        name="unit-access-code-rotate",
    ),
    path(
        "units/<uuid:pk>/access-code/revoke/",
        property_views.UnitAccessCodeRevokeView.as_view(),
        name="unit-access-code-revoke",
    ),
    path("units/<uuid:pk>/photos/", property_views.UnitMediaView.as_view(), name="unit-photos"),
    path(
        "units/<uuid:pk>/photos/<uuid:media_pk>/",
        property_views.UnitMediaItemView.as_view(),
        name="unit-photo",
    ),
    path(
        "units/<uuid:pk>/amenities/",
        property_views.UnitAmenityView.as_view(),
        name="unit-amenities",
    ),
    path(
        "properties/<uuid:pk>/amenities/",
        property_views.PropertyAmenityView.as_view(),
        name="property-amenities",
    ),
    # The amenity vocabulary, scoped and filtered by space type, so neither
    # client keeps its own copy of which amenities suit which kind of space.
    path("amenity-options/", property_views.AmenityOptionsView.as_view(), name="amenity-options"),
    # Lifecycle. Archive and delete are separate verbs on purpose: one is
    # reversible and the other is not, and sharing DELETE for both would make
    # the safe act look like the destructive one.
    path("me/archive/", lifecycle_views.MyArchiveView.as_view(), name="me-archive"),
    # Condition evidence: collect against named slots, then submit. The
    # submission is gated on completeness in `trust.condition`.
    path(
        "properties/<uuid:pk>/verification/",
        trust_condition_views.PropertyConditionView.as_view(),
        name="property-verification",
    ),
    path(
        "properties/<uuid:pk>/verification/evidence/",
        trust_condition_views.PropertyConditionEvidenceView.as_view(),
        name="property-verification-evidence",
    ),
    # Taking a submission back. Its own verb, because nothing is deleted: the
    # reviews and their evidence stay, and only their place in the queue goes.
    path(
        "properties/<uuid:pk>/verification/withdraw/",
        property_views.PropertyWithdrawView.as_view(),
        name="property-verification-withdraw",
    ),
    path(
        "units/<uuid:pk>/verification/",
        trust_condition_views.SpaceConditionView.as_view(),
        name="space-verification",
    ),
    path(
        "units/<uuid:pk>/verification/evidence/",
        trust_condition_views.SpaceConditionEvidenceView.as_view(),
        name="space-verification-evidence",
    ),
    # Reopening is not submitting. Separate verb, separate route: one asks for a
    # decision, the other takes an existing one away.
    path(
        "units/<uuid:pk>/verification/recheck/",
        property_views.SpaceRecheckView.as_view(),
        name="space-recheck",
    ),
    path(
        "units/<uuid:pk>/verification/withdraw/",
        trust_condition_views.SpaceConditionWithdrawView.as_view(),
        name="space-verification-withdraw",
    ),
    path(
        "properties/<uuid:pk>/archive/",
        lifecycle_views.PropertyArchiveView.as_view(),
        name="property-archive",
    ),
    path(
        "properties/<uuid:pk>/restore/",
        lifecycle_views.PropertyRestoreView.as_view(),
        name="property-restore",
    ),
    path(
        "spaces/<uuid:pk>/archive/",
        lifecycle_views.SpaceArchiveView.as_view(),
        name="space-archive",
    ),
    path(
        "spaces/<uuid:pk>/restore/",
        lifecycle_views.SpaceRestoreView.as_view(),
        name="space-restore",
    ),
]

organization_patterns = [
    path(
        "organizations/",
        organization_views.OrganizationListView.as_view(),
        name="organizations",
    ),
    path(
        "organizations/<uuid:pk>/",
        organization_views.OrganizationDetailView.as_view(),
        name="organization-detail",
    ),
    path(
        "organizations/<uuid:pk>/memberships/",
        organization_views.OrganizationMembershipView.as_view(),
        name="organization-memberships",
    ),
    path(
        "organizations/<uuid:pk>/memberships/<uuid:membership_pk>/",
        organization_views.OrganizationMembershipDetailView.as_view(),
        name="organization-membership-detail",
    ),
    path(
        "organizations/<uuid:pk>/invitations/",
        organization_views.OrganizationInvitationView.as_view(),
        name="organization-invitations",
    ),
    path(
        "organizations/<uuid:pk>/invitations/<uuid:invitation_pk>/revoke/",
        organization_views.OrganizationInvitationRevokeView.as_view(),
        name="organization-invitation-revoke",
    ),
    path(
        "me/portfolio-invitations/",
        organization_views.MyOrganizationInvitationView.as_view(),
        name="my-organization-invitations",
    ),
    path(
        "portfolio-invitations/<uuid:invitation_pk>/",
        organization_views.OrganizationInvitationResolveView.as_view(),
        name="organization-invitation-detail",
    ),
    path(
        "portfolio-invitations/<uuid:invitation_pk>/accept/",
        organization_views.OrganizationInvitationDecisionView.as_view(),
        {"decision": "accept"},
        name="organization-invitation-accept",
    ),
    path(
        "portfolio-invitations/<uuid:invitation_pk>/decline/",
        organization_views.OrganizationInvitationDecisionView.as_view(),
        {"decision": "decline"},
        name="organization-invitation-decline",
    ),
    path(
        "portfolio/properties/",
        organization_views.PersonalPortfolioPropertyCreateView.as_view(),
        name="personal-portfolio-property-create",
    ),
    path(
        "organizations/<uuid:pk>/properties/",
        organization_views.OrganizationPropertyView.as_view(),
        name="organization-properties",
    ),
    path(
        "organizations/<uuid:pk>/units/",
        organization_views.OrganizationUnitView.as_view(),
        name="organization-units",
    ),
    path(
        "organizations/<uuid:pk>/portfolio/",
        organization_views.OrganizationPortfolioView.as_view(),
        name="organization-portfolio",
    ),
    path(
        "organizations/<uuid:pk>/billing/",
        billing_views.PortfolioBillingView.as_view(),
        name="organization-billing",
    ),
    path(
        "organizations/<uuid:pk>/billing/quote/",
        billing_views.PlanChangeQuoteView.as_view(),
        name="organization-billing-quote",
    ),
    path(
        "organizations/<uuid:pk>/billing/checkout/",
        billing_views.CheckoutView.as_view(),
        name="organization-billing-checkout",
    ),
    path(
        "organizations/<uuid:pk>/billing/checkout/<uuid:intent_pk>/",
        billing_views.CheckoutDetailView.as_view(),
        name="organization-billing-checkout-detail",
    ),
    path(
        "organizations/<uuid:pk>/billing/checkout/<uuid:intent_pk>/refresh/",
        billing_views.CheckoutRefreshView.as_view(),
        name="organization-billing-checkout-refresh",
    ),
    path(
        "organizations/<uuid:pk>/billing/checkout/<uuid:intent_pk>/retry/",
        billing_views.CheckoutRetryView.as_view(),
        name="organization-billing-checkout-retry",
    ),
    path(
        "organizations/<uuid:pk>/billing/checkout/<uuid:intent_pk>/cancel/",
        billing_views.CheckoutCancelView.as_view(),
        name="organization-billing-checkout-cancel",
    ),
    path(
        "organizations/<uuid:pk>/billing/plan-change/",
        billing_views.PlanChangeView.as_view(),
        name="organization-billing-plan-change",
    ),
    path(
        "organizations/<uuid:pk>/billing/keep-plan/",
        billing_views.KeepPlanView.as_view(),
        name="organization-billing-keep-plan",
    ),
    path(
        "organizations/<uuid:pk>/billing/resource-access/reactivate/",
        billing_views.ResourceReactivateView.as_view(),
        name="organization-billing-reactivate",
    ),
    path("plans/", billing_views.PlanCatalogueView.as_view(), name="plan-catalogue"),
    path(
        "organizations/<uuid:pk>/payout-destination/",
        payment_views.OrganizationPayoutDestinationView.as_view(),
        name="organization-payout-destination",
    ),
    path(
        "organizations/<uuid:pk>/payout-institutions/",
        payment_views.OrganizationPayoutInstitutionView.as_view(),
        name="organization-payout-institutions",
    ),
    path(
        "organizations/<uuid:pk>/payout-destination/resolve/",
        payment_views.OrganizationPayoutAccountResolveView.as_view(),
        name="organization-payout-destination-resolve",
    ),
    path(
        "organizations/<uuid:pk>/payout-destination/refresh/",
        payment_views.OrganizationPayoutVerificationRefreshView.as_view(),
        name="organization-payout-destination-refresh",
    ),
    path(
        "organizations/<uuid:pk>/payout-destinations/<uuid:profile_pk>/refresh/",
        payment_views.OrganizationPayoutProfileVerificationRefreshView.as_view(),
        name="organization-payout-profile-refresh",
    ),
    path(
        "organizations/<uuid:pk>/payout-destinations/<uuid:profile_pk>/activate/",
        payment_views.OrganizationPayoutProfileActivateView.as_view(),
        name="organization-payout-profile-activate",
    ),
    path(
        "organizations/<uuid:pk>/payout-destinations/<uuid:profile_pk>/",
        payment_views.OrganizationPayoutProfileDetailView.as_view(),
        name="organization-payout-profile-detail",
    ),
    path(
        "organizations/<uuid:pk>/property-assignments/",
        organization_views.OrganizationPropertyAssignmentView.as_view(),
        name="organization-property-assignments",
    ),
    path(
        "organizations/<uuid:pk>/property-assignments/<uuid:assignment_pk>/",
        organization_views.OrganizationPropertyAssignmentDetailView.as_view(),
        name="organization-property-assignment-detail",
    ),
]

occupancy_patterns = [
    path("me/occupancies/", occupancy_views.MyOccupanciesView.as_view(), name="me-occupancies"),
    path(
        "me/join-requests/",
        occupancy_views.MyJoinRequestsView.as_view(),
        name="me-join-requests",
    ),
    # Every tenancy, whole. The clients used to stitch this from three calls
    # and collapse the result to one, which is how a second tenancy became
    # invisible.
    path("me/tenancies/", tenancy_views.MyTenanciesView.as_view(), name="me-tenancies"),
    path(
        "property-join-lookup/",
        occupancy_views.PropertyJoinLookupView.as_view(),
        name="property-join-lookup",
    ),
    path(
        "properties/<uuid:property_pk>/invitations/",
        occupancy_views.PropertyInvitationView.as_view(),
        name="property-invitations",
    ),
    # Resolving comes first and consumes nothing: an invitation is access to a
    # decision, and the decision is a separate act.
    path(
        "property-invitations/resolve/",
        occupancy_views.ResolveInvitationView.as_view(),
        name="property-invitation-resolve",
    ),
    path(
        "property-invitations/accept/",
        occupancy_views.AcceptInvitationView.as_view(),
        name="property-invitation-accept",
    ),
    path(
        "property-invitations/decline/",
        occupancy_views.DeclineInvitationView.as_view(),
        name="property-invitation-decline",
    ),
    path(
        "properties/<uuid:property_pk>/join-requests/",
        occupancy_views.PropertyJoinRequestView.as_view(),
        name="property-join-requests",
    ),
    path(
        "join-requests/<uuid:pk>/decision/",
        occupancy_views.JoinRequestDecisionView.as_view(),
        name="property-join-decision",
    ),
]

# Properties for sale: public discovery, the seller's controls and enquiries.
sale_patterns = [
    path("sales/", sale_views.SaleSearchView.as_view(), name="sales"),
    path("sales/<uuid:pk>/", sale_views.SaleDetailView.as_view(), name="sale-detail"),
    path(
        "sales/<uuid:pk>/enquiries/",
        sale_views.SaleEnquiryStartView.as_view(),
        name="sale-enquiry-start",
    ),
    path("properties/<uuid:pk>/sale/", sale_views.PropertySaleView.as_view(), name="property-sale"),
    path(
        "properties/<uuid:pk>/sale/withdraw/",
        sale_views.PropertySaleStatusView.as_view(action="withdraw"),
        name="property-sale-withdraw",
    ),
    path(
        "properties/<uuid:pk>/sale/relist/",
        sale_views.PropertySaleStatusView.as_view(action="relist"),
        name="property-sale-relist",
    ),
    path(
        "properties/<uuid:pk>/sale/sold/",
        sale_views.PropertySaleStatusView.as_view(action="sold"),
        name="property-sale-sold",
    ),
    path("me/sale-enquiries/", sale_views.MyEnquiriesView.as_view(), name="my-sale-enquiries"),
    path(
        "sale-enquiries/<uuid:pk>/",
        sale_views.EnquiryDetailView.as_view(),
        name="sale-enquiry-detail",
    ),
    path(
        "sale-enquiries/<uuid:pk>/messages/",
        sale_views.EnquiryReplyView.as_view(),
        name="sale-enquiry-reply",
    ),
]

listing_patterns = [
    path("listings/", listing_views.ListingSearchView.as_view(), name="listings"),
    path("listings/map/", listing_views.ListingMapView.as_view(), name="listings-map"),
    path("listings/<uuid:pk>/", listing_views.ListingDetailView.as_view(), name="listing-detail"),
    # Before the <str:action> route, which would otherwise swallow these names.
    path(
        "listings/<uuid:pk>/related/",
        listing_views.RelatedListingsView.as_view(),
        name="listing-related",
    ),
    path(
        "listings/<uuid:pk>/media/", listing_views.ListingMediaView.as_view(), name="listing-media"
    ),
    path(
        "listings/<uuid:pk>/<str:action>/",
        listing_views.ListingManageView.as_view(),
        name="listing-action",
    ),
    path("amenities/", listing_views.AmenityListView.as_view(), name="amenities"),
    path("me/listings/", listing_views.MyListingsView.as_view(), name="me-listings"),
    path(
        "me/listings/<uuid:pk>/",
        listing_views.MyListingDetailView.as_view(),
        name="me-listing-detail",
    ),
    path("me/saved-listings/", listing_views.SavedListingsView.as_view(), name="saved-listings"),
]

viewing_patterns = [
    path("me/viewings/", viewing_views.MyViewingsView.as_view(), name="me-viewings"),
    path("me/viewing-requests/", viewing_views.HostViewingsView.as_view(), name="host-viewings"),
    path("viewings/<uuid:pk>/", viewing_views.ViewingDetailView.as_view(), name="viewing-detail"),
    path(
        "viewings/<uuid:pk>/check-in-credential/",
        viewing_views.ViewingCheckInCredentialView.as_view(),
        name="viewing-check-in-credential",
    ),
    path(
        "viewings/<uuid:pk>/<str:action>/",
        viewing_views.ViewingActionView.as_view(),
        name="viewing-action",
    ),
]

application_patterns = [
    path(
        "me/applications/", application_views.MyApplicationsView.as_view(), name="me-applications"
    ),
    path(
        "me/received-applications/",
        application_views.HostApplicationsView.as_view(),
        name="host-applications",
    ),
    path(
        "applications/<uuid:pk>/",
        application_views.ApplicationDetailView.as_view(),
        name="application-detail",
    ),
    path(
        "applications/<uuid:pk>/<str:action>/",
        application_views.ApplicationActionView.as_view(),
        name="application-action",
    ),
]

lease_patterns = [
    path("me/leases/", lease_views.MyLeasesView.as_view(), name="me-leases"),
    path("me/granted-leases/", lease_views.LandlordLeasesView.as_view(), name="granted-leases"),
    path(
        "organizations/<uuid:organization_pk>/contracts/",
        lease_views.OrganizationContractsView.as_view(),
        name="organization-contracts",
    ),
    path(
        "organizations/<uuid:organization_pk>/terms-templates/",
        lease_views.OrganizationTermsTemplatesView.as_view(),
        name="organization-terms-templates",
    ),
    path(
        "organizations/<uuid:organization_pk>/terms-templates/<uuid:pk>/",
        lease_views.OrganizationTermsTemplateView.as_view(),
        name="organization-terms-template",
    ),
    path("leases/<uuid:pk>/", lease_views.LeaseDetailView.as_view(), name="lease-detail"),
    path(
        "leases/<uuid:pk>/document.pdf",
        lease_views.LeaseDocumentView.as_view(),
        name="lease-document",
    ),
    path(
        "leases/<uuid:pk>/<str:action>/", lease_views.LeaseActionView.as_view(), name="lease-action"
    ),
]

rent_patterns = [
    path(
        "organizations/<uuid:organization_pk>/expenses/",
        rent_views.OrganizationExpenseView.as_view(),
        name="organization-expenses",
    ),
    path("leases/<uuid:pk>/charges/", rent_views.LeaseChargesView.as_view(), name="lease-charges"),
    path("rent/payments/", rent_views.RecordPaymentView.as_view(), name="rent-payments"),
    path(
        "rent/payments/<uuid:pk>/<str:action>/",
        rent_views.PaymentActionView.as_view(),
        name="rent-payment-action",
    ),
    path(
        "rent/charges/<uuid:pk>/waive/",
        rent_views.WaiveChargeView.as_view(),
        name="rent-charge-waive",
    ),
    path(
        "rent/charges/<uuid:pk>/write-off/",
        rent_views.WriteOffChargeView.as_view(),
        name="rent-charge-write-off",
    ),
    path("me/rental-history/", rent_views.RentalHistoryView.as_view(), name="me-rental-history"),
    # Artisans (apps.artisan)
    path("me/artisan/", artisan_views.MyArtisanView.as_view(), name="me-artisan"),
    path(
        "me/artisan/profile/",
        artisan_views.MyArtisanProfileView.as_view(),
        name="me-artisan-profile",
    ),
    path("artisans/", artisan_views.DiscoverView.as_view(), name="artisan-discover"),
    path("artisans/<uuid:pk>/", artisan_views.ArtisanProfileView.as_view(), name="artisan-profile"),
    path(
        "artisan-work/",
        artisan_views.CustomerWorkView.as_view(),
        name="artisan-work",
    ),
    path(
        "me/artisan/invitations/",
        artisan_views.MyInvitationsView.as_view(),
        name="me-artisan-invitations",
    ),
    path(
        "me/artisan/invitations/<uuid:pk>/",
        artisan_views.MyInvitationView.as_view(),
        name="me-artisan-invitation",
    ),
    path(
        "me/artisan/invitations/<uuid:pk>/decline/",
        artisan_views.DeclineInvitationView.as_view(),
        name="me-artisan-invitation-decline",
    ),
    path(
        "me/artisan/invitations/<uuid:pk>/quotes/",
        artisan_views.SubmitQuoteView.as_view(),
        name="me-artisan-quote",
    ),
    path(
        "me/artisan/jobs/",
        artisan_views.MyJobsView.as_view(),
        name="me-artisan-jobs",
    ),
    path(
        "artisan-quotes/<uuid:pk>/withdraw/",
        artisan_views.WithdrawQuoteView.as_view(),
        name="artisan-quote-withdraw",
    ),
    path(
        "artisan-quotes/<uuid:pk>/approve/",
        artisan_views.ApproveQuoteView.as_view(),
        name="artisan-quote-approve",
    ),
    path(
        "artisan-quotes/<uuid:pk>/decline/",
        artisan_views.DeclineQuoteView.as_view(),
        name="artisan-quote-decline",
    ),
    path(
        "me/artisan/invitations/<uuid:pk>/work-reports/",
        artisan_views.WorkReportView.as_view(),
        name="me-artisan-work-report",
    ),
    path(
        "me/direct-jobs/<uuid:pk>/confirm/",
        artisan_views.ConfirmDirectJobView.as_view(),
        name="me-direct-job-confirm",
    ),
    path(
        "me/direct-jobs/<uuid:pk>/reopen/",
        artisan_views.ReopenDirectJobView.as_view(),
        name="me-direct-job-reopen",
    ),
    path(
        "artisan-jobs/<uuid:pk>/paid/",
        artisan_views.RecordPaidView.as_view(),
        name="artisan-job-paid",
    ),
    path(
        "artisan-jobs/<uuid:pk>/review/",
        artisan_views.ReviewView.as_view(),
        name="artisan-job-review",
    ),
    path(
        "artisan-jobs/<uuid:pk>/reports/",
        artisan_views.JobProblemView.as_view(),
        name="artisan-job-report",
    ),
    path(
        "artisans/<uuid:pk>/reports/",
        artisan_views.ArtisanProblemView.as_view(),
        name="artisan-report",
    ),
    path(
        "me/direct-jobs/",
        artisan_views.MyDirectJobsView.as_view(),
        name="me-direct-jobs",
    ),
    path(
        "me/direct-jobs/<uuid:pk>/",
        artisan_views.MyDirectJobView.as_view(),
        name="me-direct-job",
    ),
    path(
        "me/direct-jobs/<uuid:pk>/invitations/",
        artisan_views.DirectJobInviteView.as_view(),
        name="me-direct-job-invite",
    ),
    path(
        "me/direct-jobs/<uuid:pk>/cancel/",
        artisan_views.CancelDirectJobView.as_view(),
        name="me-direct-job-cancel",
    ),
    path(
        "direct-jobs/<uuid:pk>/revisions/",
        artisan_views.DirectJobRevisionView.as_view(),
        name="direct-job-revision",
    ),
    path(
        "maintenance/<uuid:pk>/artisan-invitations/",
        artisan_views.InviteView.as_view(),
        name="maintenance-artisan-invite",
    ),
    path(
        "maintenance/<uuid:pk>/artisan-suggestions/",
        artisan_views.SuggestView.as_view(),
        name="maintenance-artisan-suggest",
    ),
    path(
        "maintenance/<uuid:pk>/revisions/",
        artisan_views.RevisionView.as_view(),
        name="maintenance-artisan-revision",
    ),
    # Maintenance (apps.maintenance)
    path("me/maintenance/", maintenance_views.MyMaintenanceView.as_view(), name="me-maintenance"),
    path(
        "organizations/<uuid:organization_pk>/maintenance/",
        maintenance_views.OrganizationMaintenanceView.as_view(),
        name="organization-maintenance",
    ),
    path(
        "maintenance/<uuid:pk>/",
        maintenance_views.MaintenanceDetailView.as_view(),
        name="maintenance-detail",
    ),
    path(
        "maintenance/<uuid:pk>/start/",
        maintenance_views.StartWorkView.as_view(),
        name="maintenance-start",
    ),
    path(
        "maintenance/<uuid:pk>/fixed/",
        maintenance_views.ReportFixedView.as_view(),
        name="maintenance-fixed",
    ),
    path(
        "maintenance/<uuid:pk>/confirm/",
        maintenance_views.ConfirmFixedView.as_view(),
        name="maintenance-confirm",
    ),
    path(
        "maintenance/<uuid:pk>/reopen/",
        maintenance_views.ReopenView.as_view(),
        name="maintenance-reopen",
    ),
]


payment_patterns = [
    path(
        "payments/intents/",
        payment_views.PaymentIntentListCreateView.as_view(),
        name="payment-intents",
    ),
    path(
        "payments/intents/<uuid:pk>/",
        payment_views.PaymentIntentDetailView.as_view(),
        name="payment-intent-detail",
    ),
    path(
        "payments/intents/<uuid:pk>/retry/",
        payment_views.PaymentIntentRetryView.as_view(),
        name="payment-intent-retry",
    ),
    path(
        "payments/intents/<uuid:pk>/refresh/",
        payment_views.PaymentIntentRefreshView.as_view(),
        name="payment-intent-refresh",
    ),
    path(
        "payments/receipts/<uuid:pk>/",
        payment_views.ReceiptDetailView.as_view(),
        name="payment-receipt",
    ),
    path(
        "payments/receipts/<uuid:pk>/document.pdf",
        payment_views.ReceiptDocumentView.as_view(),
        name="payment-receipt-document",
    ),
    path(
        "webhooks/payments/<str:provider>/",
        payment_views.PaymentWebhookView.as_view(),
        name="payment-webhook",
    ),
]


passport_patterns = [
    path("me/passport/", passport_views.MyPassportView.as_view(), name="me-passport"),
    path(
        "me/passport/preview/",
        passport_views.PassportPreviewView.as_view(),
        name="me-passport-preview",
    ),
    path(
        "me/passport/shares/",
        passport_views.PassportSharesView.as_view(),
        name="me-passport-shares",
    ),
    path(
        "me/passport/shares/<uuid:pk>/revoke/",
        passport_views.PassportShareRevokeView.as_view(),
        name="me-passport-share-revoke",
    ),
    path(
        "me/passport/corrections/",
        passport_views.PassportCorrectionsView.as_view(),
        name="me-passport-corrections",
    ),
    # Public. The token travels in the body, never the path.
    path(
        "passport-shares/open/",
        passport_views.SharedPassportView.as_view(),
        name="passport-share-open",
    ),
]


trust_patterns = [
    # What to provide, and why. Read by the verification screens so the
    # interface and the backend cannot hold different opinions about it.
    path(
        "trust/evidence-requirements/",
        evidence_views.EvidenceRequirementsView.as_view(),
        name="evidence-requirements",
    ),
    path("trust/verifications/", trust_views.MyVerificationsView.as_view(), name="verifications"),
    path(
        "trust/verifications/<uuid:pk>/evidence/",
        trust_views.VerificationEvidenceView.as_view(),
        name="verification-evidence",
    ),
    path("trust/users/<uuid:pk>/", trust_views.PublicTrustView.as_view(), name="public-trust"),
]

urlpatterns = [
    path("meta/", meta, name="meta"),
    path("healthz/", healthz, name="healthz"),
    path("readyz/", readyz, name="readyz"),
    path(
        "me/account-deletion/",
        operations_views.MyAccountDeletionView.as_view(),
        name="me-account-deletion",
    ),
    path(
        "me/support-cases/",
        operations_views.MySupportCasesView.as_view(),
        name="me-support-cases",
    ),
    path(
        "me/support-cases/<uuid:pk>/",
        operations_views.MySupportCaseDetailView.as_view(),
        name="me-support-case-detail",
    ),
    path("management/", include("apps.operations.urls")),
    *auth_patterns,
    *me_patterns,
    *trust_patterns,
    *passport_patterns,
    *notification_patterns,
    *geo_patterns,
    *property_patterns,
    *organization_patterns,
    *occupancy_patterns,
    *listing_patterns,
    *sale_patterns,
    *viewing_patterns,
    *application_patterns,
    *rent_patterns,
    *payment_patterns,
    *lease_patterns,
    *local_storage_patterns,
    *files_urls.urlpatterns,
]
