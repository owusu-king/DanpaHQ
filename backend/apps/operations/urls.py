from django.urls import path

from . import views

urlpatterns = [
    path("auth/login/", views.LoginView.as_view(), name="management-login"),
    path("auth/session/", views.SessionView.as_view(), name="management-session"),
    path("profile/", views.ProfileView.as_view(), name="management-profile"),
    path("profile/password/", views.PasswordView.as_view(), name="management-password"),
    path("dashboard/", views.DashboardView.as_view(), name="management-dashboard"),
    path("users/", views.UsersView.as_view(), name="management-users"),
    path("users/<uuid:pk>/status/", views.UserStatusView.as_view(), name="management-user-status"),
    path(
        "users/<uuid:pk>/devices/",
        views.UserDevicesView.as_view(),
        name="management-user-devices",
    ),
    path(
        "users/<uuid:pk>/devices/<uuid:device_id>/restore/",
        views.UserDeviceRestoreView.as_view(),
        name="management-user-device-restore",
    ),
    path("providers/", views.ProvidersView.as_view(), name="management-providers"),
    path("artisans/", views.ArtisansView.as_view(), name="management-artisans"),
    path(
        "artisans/<uuid:pk>/suspension/",
        views.ArtisanSuspensionView.as_view(),
        name="management-artisan-suspension",
    ),
    path(
        "artisan-certificates/",
        views.ArtisanCertificatesView.as_view(),
        name="management-artisan-certificates",
    ),
    path(
        "artisan-certificates/<uuid:pk>/file/",
        views.ArtisanCertificateFileView.as_view(),
        name="management-artisan-certificate-file",
    ),
    path(
        "artisan-certificates/<uuid:pk>/decision/",
        views.ArtisanCertificateDecisionView.as_view(),
        name="management-artisan-certificate-decision",
    ),
    path("verifications/", views.VerificationQueueView.as_view(), name="management-verifications"),
    path(
        "verifications/<uuid:pk>/claim/",
        views.VerificationClaimView.as_view(),
        name="management-verification-claim",
    ),
    path(
        "verifications/<uuid:pk>/decision/",
        views.VerificationDecisionView.as_view(),
        name="management-verification-decision",
    ),
    path(
        "verifications/<uuid:pk>/more-info/",
        views.VerificationMoreInfoView.as_view(),
        name="management-verification-more-info",
    ),
    path(
        "property-verifications/<uuid:pk>/decision/",
        views.PropertyVerificationDecisionView.as_view(),
        name="management-property-verification-decision",
    ),
    path(
        "property-verifications/<uuid:pk>/more-info/",
        views.PropertyVerificationMoreInfoView.as_view(),
        name="management-property-verification-more-info",
    ),
    path(
        "verifications/<uuid:pk>/evidence/<uuid:evidence_pk>/",
        views.VerificationEvidenceView.as_view(),
        name="management-verification-evidence",
    ),
    path("properties/", views.PropertiesView.as_view(), name="management-properties"),
    path("listings/", views.ListingsView.as_view(), name="management-listings"),
    path(
        "listings/<uuid:pk>/moderate/",
        views.ListingModerationView.as_view(),
        name="management-listing-moderation",
    ),
    path("reports/", views.ReportsView.as_view(), name="management-reports"),
    path("reports/<uuid:pk>/", views.ReportDetailView.as_view(), name="management-report-detail"),
    path(
        "account-deletions/",
        views.AccountDeletionsView.as_view(),
        name="management-account-deletions",
    ),
    path(
        "account-deletions/<uuid:pk>/<str:action>/",
        views.AccountDeletionDecisionView.as_view(),
        name="management-account-deletion-decision",
    ),
    path("support/", views.SupportCasesView.as_view(), name="management-support"),
    path(
        "support/<uuid:pk>/",
        views.SupportCaseDetailView.as_view(),
        name="management-support-detail",
    ),
    path(
        "support/<uuid:pk>/messages/",
        views.SupportCaseMessageView.as_view(),
        name="management-support-message",
    ),
    path("configuration/", views.ConfigurationView.as_view(), name="management-configuration"),
    path("rentals/", views.RentalsView.as_view(), name="management-rentals"),
    path("payments/", views.PaymentOperationsView.as_view(), name="management-payments"),
    path(
        "payments/reconciliation/<uuid:pk>/",
        views.ReconciliationDecisionView.as_view(),
        name="management-payment-reconciliation",
    ),
    path("billing/", views.BillingPortfoliosView.as_view(), name="management-billing"),
    path(
        "billing/<uuid:pk>/",
        views.BillingPortfolioView.as_view(),
        name="management-billing-detail",
    ),
    path(
        "billing/<uuid:pk>/plan/",
        views.BillingPlanChangeView.as_view(),
        name="management-billing-plan",
    ),
    path("audit-logs/", views.AuditLogsView.as_view(), name="management-audit-logs"),
]
