"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { Select } from "@/components/Select";
import { Empty, LoadingRows, Section } from "@/components/portal/PageHeader";
import { ApiFailure } from "@/lib/api";
import {
  assignPortfolioProperty,
  changePortfolioMemberRole,
  getOrganization,
  invitePortfolioMember,
  listOrganizationProperties,
  listOrganizations,
  listPortfolioAssignments,
  listPortfolioInvitations,
  listPortfolioMembers,
  removePortfolioMember,
  revokePortfolioInvitation,
  unassignPortfolioProperty,
  updateOrganization,
  type Organization,
  type PortfolioInvitation,
  type PortfolioMember,
  type Property,
  type PropertyAssignment,
} from "@/lib/console";
import { useSession } from "@/lib/session";
import { Check } from "@/components/Check";
import { ModalSheet } from "@/components/workspace/ModalSheet";

/** What a Portfolio is, in the words its owner would use about their business. */
const PORTFOLIO_TYPES: ReadonlyArray<readonly [Organization["organization_type"], string]> = [
  ["individual_owner", "Individual property owner"],
  ["property_company", "Property company"],
  ["property_manager", "Property management company"],
  ["hostel_operator", "Student hostel operator"],
];

const ACTIVITIES: ReadonlyArray<readonly [Organization["activities"][number], string]> = [
  ["residential", "Residential"],
  ["commercial", "Commercial"],
  ["hostel", "Student hostel"],
];

const ROLES: ReadonlyArray<readonly [PortfolioMember["role"], string]> = [
  ["owner", "Owner"],
  ["admin", "Administrator"],
  ["property_manager", "Property manager"],
  ["accountant", "Accountant"],
  ["staff", "Staff"],
];

/**
 * The roles this page may hand out.
 *
 * Owner is absent, and not only because the backend refuses it. An owner
 * carries the Portfolio's standing to operate, its plan and the account its
 * rent settles into; that moves through its own deliberate transfer rather than
 * a line in an invitation form. `ROLES` keeps it, so an existing owner still
 * reads as "Owner" everywhere they appear.
 */
const GRANTABLE_ROLES = ROLES.filter(([value]) => value !== "owner");

const SCOPED_ROLES = ["property_manager", "accountant", "staff"];
const isScoped = (role: string) => SCOPED_ROLES.includes(role);

/**
 * Team: who can operate this Portfolio, what they may do, and which Properties
 * they may touch.
 *
 * The page is a roster first. Everything that *changes* somebody's access —
 * their role, their Property scope, removing them — lives behind opening that
 * person, because those are deliberate acts and spreading their controls across
 * every row made the page a wall of selects and checkboxes at rest.
 */
export default function TeamPage() {
  const { state, activeContext, refresh } = useSession();
  const me = state.status === "signed_in" ? state.me : null;
  const [organization, setOrganization] = useState<Organization | null>(null);
  // Switching between Portfolios is the header's job now — a select sitting
  // above every Team page was a control somebody had to read past to reach the
  // people they came for. This page only needs the one it is about, and whether
  // there is one at all.
  const [hasPortfolio, setHasPortfolio] = useState<boolean | null>(null);
  const [members, setMembers] = useState<PortfolioMember[]>([]);
  const [invitations, setInvitations] = useState<PortfolioInvitation[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [assignments, setAssignments] = useState<PropertyAssignment[]>([]);
  const [query, setQuery] = useState("");
  const [inviting, setInviting] = useState(false);
  const [openMemberId, setOpenMemberId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [canManageTeam, setCanManageTeam] = useState(false);
  // The Portfolio's own details, editable here because this is the only place
  // they can be edited: Danpa HQ provisions the Portfolio and names it, and the
  // owner is the one who decides what it should actually be called.
  const [details, setDetails] = useState<{
    name: string;
    organization_type: Organization["organization_type"];
    activities: Organization["activities"];
  } | null>(null);
  const [savingDetails, setSavingDetails] = useState(false);
  // The details are read far more often than changed, so they show as a
  // summary and open into the form only when somebody asks to edit them.
  const [editingDetails, setEditingDetails] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const activeId = activeContext?.startsWith("organization:")
    ? activeContext.slice("organization:".length)
    : "";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const orgs = await listOrganizations();
      const chosen = orgs.find((row) => row.id === activeId) ?? orgs[0];
      setHasPortfolio(orgs.length > 0);
      if (!chosen) {
        setOrganization(null);
        setMembers([]);
        setInvitations([]);
        setProperties([]);
        setAssignments([]);
        return;
      }
      const [detail, portfolioProperties] = await Promise.all([
        getOrganization(chosen.id),
        listOrganizationProperties(chosen.id),
      ]);
      setOrganization(detail);
      setDetails({
        name: detail.name,
        organization_type: detail.organization_type,
        activities: [...detail.activities],
      });
      setProperties(portfolioProperties);
      const mayManage = detail.current_user_role === "owner" || detail.current_user_role === "admin";
      setCanManageTeam(mayManage);
      if (mayManage) {
        const [memberRows, inviteRows, assignmentRows] = await Promise.all([
          listPortfolioMembers(chosen.id),
          listPortfolioInvitations(chosen.id),
          listPortfolioAssignments(chosen.id),
        ]);
        setMembers(memberRows);
        setInvitations(inviteRows);
        setAssignments(assignmentRows);
      } else {
        setMembers([]);
        setInvitations([]);
        setAssignments([]);
      }
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load this Team.");
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  useEffect(() => { void load(); }, [load]);

  async function saveDetails() {
    if (!organization || !details) return;
    setSavingDetails(true);
    setError("");
    setNotice("");
    try {
      const saved = await updateOrganization(organization.id, {
        name: details.name.trim(),
        organization_type: details.organization_type,
        activities: details.activities,
      });
      setOrganization(saved);
      setDetails({
        name: saved.name,
        organization_type: saved.organization_type,
        activities: [...saved.activities],
      });
      // The name is on the header switcher, the rail and every receipt, so the
      // session has to hear about it rather than waiting for the next reload.
      await refresh();
      setEditingDetails(false);
      setNotice("Portfolio details saved.");
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not save these details.",
      );
    } finally {
      setSavingDetails(false);
    }
  }

  const visibleMembers = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return members.filter(
      (member) => !needle || `${member.display_name} ${member.phone}`.toLocaleLowerCase("en-GH").includes(needle),
    );
  }, [members, query]);

  const pending = invitations.filter((row) => row.status === "pending");
  const openMember = members.find((member) => member.id === openMemberId) ?? null;
  // Reading the roster is one thing; changing who may operate the business is
  // another, and the second waits on the backend's own answer about this
  // person. Ending access deliberately does not: stopping somebody must never
  // wait on paperwork.
  const access = me?.contexts.find(
    (context) => context.organization_id === organization?.id,
  )?.access ?? null;
  const canGrant = access ? access.can.manage_team : canManageTeam;

  if (loading && !organization) {
    return (
      <div className="team-workspace">
        <header className="team-hero" aria-busy="true">
          <div className="team-hero-copy"><h2>Team</h2><p>Loading who can operate this Portfolio…</p></div>
        </header>
        <div className="team-card"><LoadingRows rows={4} /></div>
      </div>
    );
  }

  if (hasPortfolio === false) {
    return (
      <div className="team-workspace">
        <header className="team-hero">
          <div className="team-hero-copy"><h2>Team</h2></div>
        </header>
        <Empty
          title="Your Portfolio is on its way"
          body="Danpa HQ gives you your Portfolio when your provider verification is approved, and your Team lives inside it. Nothing to set up."
          action={
            <div className="team-empty-actions">
              <Link href="/provider" className="button-link">See your verification status</Link>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="team-workspace">
      <header className="team-hero">
        <div className="team-hero-copy">
          <h2>Team</h2>
          <p>
            {organization?.name ?? "Your Portfolio"}
            {canManageTeam ? (
              <>
                <span aria-hidden="true"> · </span>
                {members.length} {members.length === 1 ? "member" : "members"}
                {pending.length ? <>{" · "}<b>{pending.length} pending</b></> : null}
              </>
            ) : null}
          </p>
        </div>
        {canManageTeam && members.length ? (
          <span className="team-stack" aria-hidden="true">
            {members.slice(0, 4).map((member) => (
              <span key={member.id} className="team-avatar" data-role={member.role}>{initials(member.display_name)}</span>
            ))}
            {members.length > 4 ? <span className="team-avatar is-more">+{members.length - 4}</span> : null}
          </span>
        ) : null}
        {canGrant ? <Button onClick={() => setInviting(true)}>Invite someone</Button> : null}
      </header>

      {error ? <Notice tone="error" title={error} /> : null}
      {notice ? <Notice tone="success" title={notice} /> : null}

      {canManageTeam && !canGrant ? (
        <Notice
          tone="info"
          title="Verify your identity to change who may operate this Portfolio"
          body="Inviting somebody, changing a role or assigning a Property decides who reaches your tenants and your money, so Danpa HQ confirms who you are first. You can still see the roster and end somebody's access."
        />
      ) : null}

      {organization && !canManageTeam ? (
        <Notice
          tone="info"
          title={`You are ${roleArticle(organization.current_user_role)} in this Portfolio`}
          body="Owners and administrators manage membership, so the roster is not shown to you. The Properties you may operate appear throughout the Portfolio, and the backend checks your scope on every action."
        />
      ) : null}

      {canManageTeam && details && organization && !editingDetails ? (
        <section className="team-card team-identity" aria-labelledby="team-identity-title">
          <span className="team-identity-mark" aria-hidden="true">{initials(organization.name)}</span>
          <div className="team-identity-copy">
            <h3 id="team-identity-title">{organization.name}</h3>
            <p>
              {PORTFOLIO_TYPES.find(([value]) => value === organization.organization_type)?.[1] ?? "Portfolio"}
              <span aria-hidden="true"> · </span>
              {organization.activities.map((value) => ACTIVITIES.find(([key]) => key === value)?.[1] ?? value).join(", ") || "No activities set"}
            </p>
            <small>The name your tenants, agreements and receipts carry.</small>
          </div>
          <button type="button" className="team-quiet-action" onClick={() => setEditingDetails(true)}>Edit details</button>
        </section>
      ) : null}

      {canManageTeam && details && editingDetails ? (
        <Section title="Portfolio details">
          {/* Danpa HQ names the Portfolio when it provisions it, which is why
              nobody is asked to invent one up front — and why this has to
              exist. The name here is the one tenants, agreements and receipts
              will carry. */}
          <form
            className="team-portfolio-details"
            onSubmit={(event) => {
              event.preventDefault();
              void saveDetails();
            }}
          >
            <Field
              label="Portfolio name"
              hint="What your tenants, agreements and receipts will carry."
              value={details.name}
              onChange={(event) => setDetails({ ...details, name: event.target.value })}
            />
            <Select
              label="Portfolio type"
              value={details.organization_type}
              onChange={(value) =>
                setDetails({
                  ...details,
                  organization_type: value as Organization["organization_type"],
                })
              }
              options={PORTFOLIO_TYPES}
            />
            <fieldset className="team-portfolio-activities">
              <legend className="type-caption">What this Portfolio does</legend>
              {ACTIVITIES.map(([value, label]) => (
                <Check
                  key={value}
                  label={label}
                  checked={details.activities.includes(value)}
                  onChange={(checked) =>
                    setDetails({
                      ...details,
                      activities: checked
                        ? [...details.activities, value]
                        : details.activities.filter((row) => row !== value),
                    })
                  }
                />
              ))}
            </fieldset>
            <div className="team-actions">
              <Button
                type="submit"
                busy={savingDetails}
                disabled={!details.name.trim() || details.activities.length === 0}
              >
                Save details
              </Button>
              <Button
                variant="quiet"
                type="button"
                disabled={savingDetails}
                onClick={() => {
                  if (organization) {
                    setDetails({ name: organization.name, organization_type: organization.organization_type, activities: [...organization.activities] });
                  }
                  setEditingDetails(false);
                }}
              >Cancel</Button>
            </div>
          </form>
        </Section>
      ) : null}

      {canManageTeam ? (
        <>
          <Section title="Members">
            {members.length > 4 ? (
              <label className="team-search">
                <span className="sr-only">Search members</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search name or number"
                />
              </label>
            ) : null}
            {visibleMembers.length ? (
              <ul className="team-rows">
                {visibleMembers.map((member) => (
                  <li key={member.id}>
                    <button type="button" className="team-row" aria-haspopup="dialog" onClick={() => setOpenMemberId(member.id)}>
                      <span className="team-avatar" data-role={member.role} aria-hidden="true">{initials(member.display_name)}</span>
                      <span className="team-row-person">
                        <strong>
                          {member.display_name}
                          {member.user_id === me?.id ? <em className="team-you">You</em> : null}
                        </strong>
                        <span>{member.phone}</span>
                      </span>
                      <span className="team-row-role" data-role={member.role}>{roleLabel(member.role)}</span>
                      <span className="team-row-access" data-state={member.access?.state ?? "active"}>
                        <i aria-hidden="true" />{accessLabel(member)}
                      </span>
                      <svg className="team-row-arrow" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
                        <path d="m6 3.5 4.5 4.5L6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="No matching member" body="Try another name or number." />
            )}
          </Section>

          {pending.length ? (
            <Section title={`Pending ${pending.length === 1 ? "invitation" : "invitations"}`}>
              <p className="team-section-note">
                Nothing is granted until the person signs in with that exact number and accepts.
              </p>
              <ul className="team-rows">
                {pending.map((invitation) => (
                  <InvitationRow
                    key={invitation.id}
                    invitation={invitation}
                    onRevoke={async () => {
                      await revokePortfolioInvitation(organization!.id, invitation.id);
                      setNotice(`Invitation to ${invitation.invitee_phone} revoked.`);
                      await load();
                    }}
                    onError={setError}
                  />
                ))}
              </ul>
            </Section>
          ) : null}
        </>
      ) : null}

      {organization && canManageTeam ? (
        <InviteDialog
          open={inviting}
          organization={organization}
          properties={properties}
          onClose={() => setInviting(false)}
          onCreated={async (invitation) => {
            setInviting(false);
            setNotice(`Invitation created for ${invitation.invitee_phone}.`);
            await load();
          }}
        />
      ) : null}

      {organization && canManageTeam ? (
        <MemberDialog
          member={openMember}
          organization={organization}
          properties={properties}
          assignments={assignments}
          canGrant={canGrant}
          isCurrentUser={openMember?.user_id === me?.id}
          onClose={() => setOpenMemberId(null)}
          onChanged={async (message) => {
            setNotice(message);
            await load();
          }}
          onRemoved={async (message) => {
            setOpenMemberId(null);
            setNotice(message);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function InvitationRow({
  invitation,
  onRevoke,
  onError,
}: {
  invitation: PortfolioInvitation;
  onRevoke: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const shareUrl = typeof window === "undefined" || !invitation.token
    ? ""
    : `${window.location.origin}/portfolio-invitations?invitation=${invitation.id}&token=${encodeURIComponent(invitation.token)}`;

  return (
    <li className={`team-invite-row${confirming ? " is-confirming" : ""}`}>
      <span className="team-avatar is-invite" aria-hidden="true">
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 5.5h13v9h-13Z" /><path d="m3.5 6 6.5 5 6.5-5" />
        </svg>
      </span>
      <span className="team-row-person">
        <strong>{invitation.invitee_phone}</strong>
        <span>
          <span className="team-row-role" data-role={invitation.role}>{roleLabel(invitation.role)}</span>
          {" · expires "}{new Date(invitation.expires_at).toLocaleDateString("en-GH", { day: "numeric", month: "short" })}
        </span>
        <span>
          {invitation.properties.length
            ? invitation.properties.map((row) => row.title).join(", ")
            : isScoped(invitation.role)
              ? "No Property assigned yet"
              : "Every Property in this Portfolio"}
        </span>
      </span>
      <span className="team-row-access">
        {confirming ? "Revoking cancels this invitation. It cannot be accepted afterwards." : ""}
      </span>
      <span className="team-invite-actions">
        {confirming ? (
          <>
            <Button
              variant="destructive"
              busy={busy}
              onClick={async () => {
                setBusy(true);
                try { await onRevoke(); } catch (cause) {
                  onError(cause instanceof ApiFailure ? cause.error.message : "Could not revoke that invitation.");
                } finally { setBusy(false); setConfirming(false); }
              }}
            >Confirm revoke</Button>
            <Button variant="quiet" disabled={busy} onClick={() => setConfirming(false)}>Go back</Button>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              disabled={!shareUrl}
              onClick={async () => {
                await navigator.clipboard.writeText(shareUrl);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              }}
            >{copied ? "Link copied" : "Copy invite link"}</Button>
            <Button variant="destructive" onClick={() => setConfirming(true)}>Revoke</Button>
          </>
        )}
      </span>
    </li>
  );
}

/**
 * One dialog shape for this area, matching the Lease and Rent records: a sticky
 * head that keeps the subject in view while the body scrolls, and an optional
 * sticky footer for actions that must not scroll away.
 *
 * `id` is a parameter rather than a constant because two of these are mounted at
 * once; a shared `aria-labelledby` target would name the wrong dialog.
 */
function Dialog({
  open,
  id,
  label,
  title,
  onClose,
  footer,
  children,
}: {
  open: boolean;
  id: string;
  label: string;
  title: string;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  // The workspace's sheet: narrow, over the page, closing the way every other
  // modal here does. The label reads as the line under the title.
  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      icon="users"
      size="sm"
      className="team-sheet"
      titleId={`${id}-title`}
      title={title}
      meta={label.charAt(0) + label.slice(1).toLowerCase()}
      footer={footer ? () => footer : undefined}
    >
      {children}
    </ModalSheet>
  );
}

function InviteDialog({
  open,
  organization,
  properties,
  onClose,
  onCreated,
}: {
  open: boolean;
  organization: Organization;
  properties: Property[];
  onClose: () => void;
  onCreated: (invitation: PortfolioInvitation) => Promise<void>;
}) {
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<PortfolioMember["role"]>("property_manager");
  const [propertyIds, setPropertyIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) { setPhone(""); setRole("property_manager"); setPropertyIds([]); setError(""); }
  }, [open]);

  return (
    <Dialog open={open} id="team-invite-dialog" label="TEAM" title="Invite someone" onClose={onClose}>
      <div className="team-form">
        <p className="type-caption">
          Nothing is granted until they accept. Expires in seven days.
        </p>
        <Field
          label="Ghana mobile number"
          placeholder="024 123 4567"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
        <Select
          label="Role"
          value={role}
          onChange={(value) => { setRole(value as PortfolioMember["role"]); setPropertyIds([]); }}
          options={GRANTABLE_ROLES}
        />
        <p className="type-caption">{roleConsequence(role)}</p>
        {isScoped(role) ? (
          <PropertyScope
            properties={properties}
            selected={propertyIds}
            onChange={setPropertyIds}
          />
        ) : null}
        {error ? <Notice tone="error" title={error} /> : null}
        <div className="team-actions">
          <Button
            busy={busy}
            busyLabel="Creating invitation…"
            disabled={!phone.trim()}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onCreated(
                  await invitePortfolioMember(organization.id, {
                    phone: phone.trim(),
                    role,
                    property_ids: isScoped(role) ? propertyIds : [],
                  }),
                );
              } catch (cause) {
                setError(cause instanceof ApiFailure ? cause.error.message : "Could not create that invitation.");
              } finally {
                setBusy(false);
              }
            }}
          >Send invitation</Button>
          <Button variant="quiet" disabled={busy} onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Dialog>
  );
}

function MemberDialog({
  member,
  organization,
  properties,
  assignments,
  canGrant,
  isCurrentUser,
  onClose,
  onChanged,
  onRemoved,
}: {
  member: PortfolioMember | null;
  organization: Organization;
  properties: Property[];
  assignments: PropertyAssignment[];
  canGrant: boolean;
  isCurrentUser: boolean;
  onClose: () => void;
  onChanged: (message: string) => Promise<void>;
  onRemoved: (message: string) => Promise<void>;
}) {
  const assignedIds = useMemo(
    () => (member ? assignments.filter((row) => row.membership_id === member.id).map((row) => row.property_id) : []),
    [assignments, member],
  );

  const [role, setRole] = useState<PortfolioMember["role"]>(member?.role ?? "staff");
  const [scope, setScope] = useState<string[]>(assignedIds);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setRole(member?.role ?? "staff");
    setScope(assignedIds);
    setConfirmingRemoval(false);
    setError("");
  }, [member, assignedIds]);

  const roleChanged = Boolean(member) && role !== member!.role;
  const scopeChanged =
    isScoped(role)
    && (scope.length !== assignedIds.length || scope.some((id) => !assignedIds.includes(id)));
  const dirty = roleChanged || scopeChanged;

  /**
   * Apply the difference, not every checkbox.
   *
   * The old page fired one request per tick and reloaded the whole page after
   * each. Assignment is a set; it is decided here and settled once.
   */
  async function save() {
    if (!member) return;
    setBusy(true);
    setError("");
    try {
      if (roleChanged) {
        await changePortfolioMemberRole(organization.id, member.id, role);
      }
      if (isScoped(role)) {
        for (const propertyId of scope.filter((id) => !assignedIds.includes(id))) {
          await assignPortfolioProperty(organization.id, member.id, propertyId);
        }
        for (const propertyId of assignedIds.filter((id) => !scope.includes(id))) {
          const assignment = assignments.find(
            (row) => row.membership_id === member.id && row.property_id === propertyId,
          );
          if (assignment) await unassignPortfolioProperty(organization.id, assignment.id);
        }
      }
      await onChanged(`${member.display_name}'s access was updated.`);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That Team change did not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={Boolean(member)}
      id="team-member-dialog"
      label="TEAM MEMBER"
      title={member?.display_name ?? ""}
      onClose={onClose}
      footer={
        dirty ? (
          <div className="team-dialog-footer">
            <p className="type-caption">Unsaved changes to what this person can reach.</p>
            <Button busy={busy} onClick={() => void save()}>Save access</Button>
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => { setRole(member!.role); setScope(assignedIds); }}
            >Discard</Button>
          </div>
        ) : null
      }
    >
      {member ? (
        <>
          <dl className="team-facts">
            <div>
              <dt>Number</dt>
              <dd>{member.phone}</dd>
            </div>
            <div>
              <dt>Joined</dt>
              <dd>{new Date(member.joined_at).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" })}</dd>
            </div>
            <div>
              <dt>Reaches now</dt>
              <dd>{accessLabel(member)}</dd>
            </div>
          </dl>

          {error ? <Notice tone="error" title={error} /> : null}

          <section className="team-dialog-section">
            <h3>What they may do</h3>
            {member.role === "owner" ? (
              <Notice
                tone="info"
                title="This is the Portfolio's owner"
                body="Ownership carries the Portfolio's verification, its plan and its settlement account, so it is transferred deliberately rather than changed from this roster."
              />
            ) : canGrant ? (
              <>
                <Select
                  label="Role"
                  value={role}
                  onChange={(value) => setRole(value as PortfolioMember["role"])}
                  options={GRANTABLE_ROLES}
                  disabled={busy}
                />
                <p className="type-caption">{roleConsequence(role)}</p>
              </>
            ) : (
              <p className="type-caption">
                {roleLabel(member.role)}. {roleConsequence(member.role)}
              </p>
            )}
            {member.access?.state !== "active" ? (
              <Notice
                tone="info"
                title={`Their access is ${member.access.state === "pending_verification" ? "waiting on verification" : "limited"}`}
                body={member.access.requirements.includes("identity")
                  ? "They have not verified their identity, so tenant-facing work — and any Portfolio-wide administration — waits for it. They do that from their own Verification screen."
                  : "This Portfolio's provider verification is not current, so tenant-facing work is paused for everyone in it."}
              />
            ) : null}
          </section>

          {isScoped(role) && canGrant && member.role !== "owner" ? (
            <section className="team-dialog-section">
              <h3>Which Properties they may touch</h3>
              <PropertyScope properties={properties} selected={scope} onChange={setScope} disabled={busy} />
            </section>
          ) : null}

          <div className="team-danger">
            {isCurrentUser && member.role === "owner" ? (
              <p className="type-caption">You cannot remove yourself while you are an owner.</p>
            ) : confirmingRemoval ? (
              <>
                <Notice
                  tone="warning"
                  title={`Remove ${member.display_name}?`}
                  body="Their access ends immediately and their Property assignments are released. They keep their own Danpa HQ account, and can be invited again."
                />
                <div className="team-actions">
                  <Button
                    variant="destructive"
                    busy={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        await removePortfolioMember(organization.id, member.id);
                        await onRemoved(`${member.display_name} was removed from ${organization.name}.`);
                      } catch (cause) {
                        setError(cause instanceof ApiFailure ? cause.error.message : "Could not remove that member.");
                        setBusy(false);
                      }
                    }}
                  >Confirm removal</Button>
                  <Button variant="quiet" disabled={busy} onClick={() => setConfirmingRemoval(false)}>Go back</Button>
                </div>
              </>
            ) : (
              <button type="button" className="team-danger-open" onClick={() => setConfirmingRemoval(true)}>
                Remove from this Portfolio
              </button>
            )}
          </div>
        </>
      ) : null}
    </Dialog>
  );
}

function PropertyScope({
  properties,
  selected,
  onChange,
  disabled = false,
}: {
  properties: Property[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  if (properties.length === 0) {
    return <p className="type-caption">No Property is in this Portfolio yet, so there is nothing to assign.</p>;
  }
  return (
    <fieldset className="team-properties">
      <legend className="type-caption">Assigned Properties</legend>
      {properties.map((property) => (
        <Check
          key={property.id}
          label={property.title}
          checked={selected.includes(property.id)}
          disabled={disabled}
          onChange={(next) =>
            onChange(
              next ? [...selected, property.id] : selected.filter((id) => id !== property.id),
            )
          }
        />
      ))}
    </fieldset>
  );
}

function roleLabel(role: string) {
  return ROLES.find(([value]) => value === role)?.[1] ?? role.replaceAll("_", " ");
}

function roleArticle(role: string) {
  const label = roleLabel(role).toLocaleLowerCase("en-GH");
  return /^[aeiou]/.test(label) ? `an ${label}` : `a ${label}`;
}

/** What the role actually means, in the consequence the person will feel. */
function roleConsequence(role: string) {
  return role === "owner"
    ? "Sees and manages every Property in this Portfolio, and can change anyone's access."
    : role === "admin"
      ? "Sees and manages every Property in this Portfolio, and can manage the Team."
      : role === "accountant"
        ? "Reads rent and payment records for the Properties you assign. No Property management."
        : role === "property_manager"
          ? "Manages only the Properties you assign, including tenants and lettings."
          : "Operates only the Properties you assign, without Team or high-trust actions.";
}

function accessLabel(member: PortfolioMember) {
  const scope = member.effective_access === "portfolio_wide"
    ? "Every Property"
    : member.effective_access === "assigned_financial"
      ? member.assigned_properties.length
        ? `${member.assigned_properties.length} assigned · financial`
        : "Financial · nothing assigned"
      : member.assigned_properties.length
        ? `${member.assigned_properties.length} assigned ${member.assigned_properties.length === 1 ? "Property" : "Properties"}`
        : "Nothing assigned yet";
  // A role that is in place but not yet whole says so here. Somebody who reads
  // "Administrator" and then meets a refusal concludes the product is broken.
  const waiting = member.access?.state === "pending_verification"
    ? " · verification needed"
    : member.access?.state === "limited"
      ? " · limited"
      : "";
  return `${scope}${waiting}`;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}
