"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  type Organization,
  type PortfolioInvitation,
  type PortfolioMember,
  type Property,
  type PropertyAssignment,
} from "@/lib/console";
import { useSession } from "@/lib/session";
import { Check } from "@/components/Check";

const ROLES: ReadonlyArray<readonly [PortfolioMember["role"], string]> = [
  ["owner", "Owner"],
  ["admin", "Administrator"],
  ["property_manager", "Property manager"],
  ["accountant", "Accountant"],
  ["staff", "Staff"],
];

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
  const { state, activeContext, setActiveContext } = useSession();
  const me = state.status === "signed_in" ? state.me : null;
  const [organization, setOrganization] = useState<Organization | null>(null);
  // Only ever rendered when there is more than one. With the Portfolio page gone
  // this is the last place that knows which Portfolio you are looking at, so it
  // owns the switch rather than leaving a multi-Portfolio account stranded.
  const [organizations, setOrganizations] = useState<Organization[]>([]);
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
      setOrganizations(orgs);
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

  const visibleMembers = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return members.filter(
      (member) => !needle || `${member.display_name} ${member.phone}`.toLocaleLowerCase("en-GH").includes(needle),
    );
  }, [members, query]);

  const pending = invitations.filter((row) => row.status === "pending");
  const openMember = members.find((member) => member.id === openMemberId) ?? null;

  if (loading && !organization) {
    return (
      <div className="team-workspace">
        <section className="settings-section"><h2>Team</h2></section>
        <LoadingRows rows={4} />
      </div>
    );
  }

  if (hasPortfolio === false) {
    return (
      <div className="team-workspace">
        <section className="settings-section"><h2>Team</h2></section>
        <Empty
          icon="users"
          title="A Team needs a Portfolio first"
          body="Your personal Portfolio is created with your first Property. Full business setup is for a company, hostel operation, professional manager, or a Team from the start."
          action={
            <div className="team-empty-actions">
              <Link href="/properties/new" className="button-link">Add first Property</Link>
              <Link href="/organization/setup" className="type-body-strong">Set up a property business →</Link>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="team-workspace">
      <section className="settings-section team-head">
        <h2>Team</h2>
        {canManageTeam ? <Button onClick={() => setInviting(true)}>Invite someone</Button> : null}
      </section>

      {error ? <Notice tone="error" title={error} /> : null}
      {notice ? <Notice tone="success" title={notice} /> : null}

      {organizations.length > 1 ? (
        <Select
          label="Portfolio"
          value={organization?.id ?? ""}
          onChange={(next) => setActiveContext(`organization:${next}`)}
          options={organizations.map((row) => [row.id, row.name] as const)}
          className="team-portfolio-switch"
        />
      ) : null}

      {organization && !canManageTeam ? (
        <Notice
          tone="info"
          title={`You are ${roleArticle(organization.current_user_role)} in this Portfolio`}
          body="Owners and administrators manage membership, so the roster is not shown to you. The Properties you may operate appear throughout the Portfolio, and the backend checks your scope on every action."
        />
      ) : null}

      {canManageTeam ? (
        <>
          <Section title={`${members.length} ${members.length === 1 ? "member" : "members"}`}>
            {members.length > 6 ? (
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
                    <button type="button" className="team-row" onClick={() => setOpenMemberId(member.id)}>
                      <span className="team-row-person">
                        <strong>{member.display_name}{member.user_id === me?.id ? " · You" : ""}</strong>
                        <span>{member.phone}</span>
                      </span>
                      <span className="team-row-role">{roleLabel(member.role)}</span>
                      <span className="team-row-access">{accessLabel(member)}</span>
                      <span className="team-row-arrow" aria-hidden="true">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon="users" title="No matching member" body="Try another name or number." />
            )}
          </Section>

          {pending.length ? (
            <Section title={`${pending.length} pending ${pending.length === 1 ? "invitation" : "invitations"}`}>
              <p className="type-caption">
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
    <li className="team-invite-row">
      <span className="team-row-person">
        <strong>{invitation.invitee_phone}</strong>
        <span>
          {roleLabel(invitation.role)} · expires {new Date(invitation.expires_at).toLocaleDateString("en-GH", { day: "numeric", month: "short" })}
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
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="team-dialog"
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === ref.current) onClose(); }}
    >
      {open ? (
        <div className="team-dialog-panel">
          <header className="team-dialog-head">
            <div>
              <p className="type-label">{label}</p>
              <h2 id={`${id}-title`}>{title}</h2>
            </div>
            <button type="button" className="team-dialog-close" aria-label="Close" onClick={onClose}>×</button>
          </header>
          <div className="team-dialog-body">{children}</div>
          {footer}
        </div>
      ) : null}
    </dialog>
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
          options={ROLES}
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
  isCurrentUser,
  onClose,
  onChanged,
  onRemoved,
}: {
  member: PortfolioMember | null;
  organization: Organization;
  properties: Property[];
  assignments: PropertyAssignment[];
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
            <Select
              label="Role"
              value={role}
              onChange={(value) => setRole(value as PortfolioMember["role"])}
              options={ROLES}
              disabled={busy}
            />
            <p className="type-caption">{roleConsequence(role)}</p>
            {roleChanged && role === "owner" ? (
              <Notice
                tone="warning"
                title="Owners can change anyone's access"
                body="Only an owner can grant this, and a Portfolio can never lose its last owner."
              />
            ) : null}
          </section>

          {isScoped(role) ? (
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
                  body="Their access ends immediately and their Property assignments are released. They keep their own Rooomly account, and can be invited again."
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
  if (member.effective_access === "portfolio_wide") return "Every Property";
  const count = member.assigned_properties.length;
  if (member.effective_access === "assigned_financial") {
    return count ? `${count} assigned · financial` : "Financial · nothing assigned";
  }
  return count ? `${count} assigned ${count === 1 ? "Property" : "Properties"}` : "Nothing assigned yet";
}
