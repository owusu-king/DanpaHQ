import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { IndexGround } from "@/components/account/IndexRows";
import { Bone } from "@/components/billing/BillingParts";
import { Fact, Panel, Pill, SmallAct } from "@/components/billing/BillingSurfaces";
import { useHomeDensity } from "@/components/home/plinth";
import {
  EmptyState,
  Footnote,
  GroupLabel,
  HARMATTAN,
  InfoNote,
  KOLA,
  KOLA_DEEP,
  LATERITE,
  ListRow,
  MUTED,
  PRESSED,
  QuietAction,
  RULE,
  RowLine,
  SearchField,
  SummaryPanel,
  initialsOf,
  rowStyles,
  type SummaryNote,
} from "@/components/portfolio/PortfolioList";
import { ActionBar, Pill as ActPill, QuietAct } from "@/components/record/RecordSurfaces";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { ModalSafeArea, SafeBottom } from "@/components/sheet/ModalSafeArea";
import {
  PropertyScope,
  RoleChoice,
  accessLabel,
  accessStateLabel,
  isScoped,
  roleArticle,
  roleConsequence,
  roleLabel,
} from "@/components/team/TeamPatterns";
import { Button, Choice, Field, Notice, Type, space } from "@/components/ui";
import {
  invitePortfolioMember,
  listOrganizationProperties,
  listOrganizations,
  listPortfolioInvitations,
  listPortfolioMembers,
  revokePortfolioInvitation,
  updateOrganization,
  type ManagedProperty,
  type Organization,
  type PortfolioInvitation,
  type PortfolioMember,
} from "@/organizations";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { theme } from "@/theme";

type Row =
  | { kind: "member"; member: PortfolioMember }
  | { kind: "invitation"; invitation: PortfolioInvitation };
type Entry =
  | { kind: "group"; key: string; title: string; count: number; first: boolean }
  | { kind: "row"; key: string; row: Row; first: boolean; last: boolean };

/** What a Portfolio is, in the words its owner would use about their business. */
const PORTFOLIO_TYPES: { value: Organization["organization_type"]; label: string }[] = [
  { value: "individual_owner", label: "Individual owner" },
  { value: "property_company", label: "Property company" },
  { value: "property_manager", label: "Management company" },
  { value: "hostel_operator", label: "Hostel operator" },
];

const ACTIVITIES: { value: Organization["activities"][number]; label: string }[] = [
  { value: "residential", label: "Residential" },
  { value: "commercial", label: "Commercial" },
  { value: "hostel", label: "Student hostel" },
];

/** Above this many people, finding one is a task of its own. */
const SEARCHABLE_FROM = 7;

type Details = {
  name: string;
  organization_type: Organization["organization_type"];
  activities: Organization["activities"];
};

/**
 * Team: who can operate this Portfolio, what they may do, and which Properties
 * they may touch.
 *
 * A roster, with each person's controls behind opening them. An earlier screen
 * put a role picker, every Property as a button, and an unconfirmed "Remove
 * member" inside every card — one stray tap ended somebody's access.
 *
 * Refined on review (2026-09-15): how many people hold access leads, then the
 * Portfolio's own identity as facts, then the roster — members and the people
 * invited to become members in one list, because an invitation is a person who
 * is nearly here. Naming and describing the Portfolio is a form with a keyboard,
 * so it opens as its own page sheet rather than unfolding the page underneath.
 */
export default function TeamScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const { activeContext, state, refreshMe } = useAuth();
  const [organization, setOrganization] = useState<Organization | null>(null);
  // The Portfolio's own details. Rooomly provisions the Portfolio and names it,
  // so this is where an owner makes it the name their tenants will see.
  const [details, setDetails] = useState<Details | null>(null);
  const [savingDetails, setSavingDetails] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [hasPortfolio, setHasPortfolio] = useState<boolean | null>(null);
  const [members, setMembers] = useState<PortfolioMember[]>([]);
  const [invitations, setInvitations] = useState<PortfolioInvitation[]>([]);
  const [properties, setProperties] = useState<ManagedProperty[]>([]);
  const [query, setQuery] = useState("");
  const [inviting, setInviting] = useState(false);
  const [revoking, setRevoking] = useState<PortfolioInvitation | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const orgs = await listOrganizations();
      setHasPortfolio(orgs.length > 0);
      const preferred = activeContext?.startsWith("organization:")
        ? activeContext.slice("organization:".length)
        : "";
      const current = orgs.find((row) => row.id === preferred) ?? orgs[0] ?? null;
      setOrganization(current);
      if (!current) return;
      setDetails({
        name: current.name,
        organization_type: current.organization_type,
        activities: [...current.activities],
      });
      setProperties(await listOrganizationProperties(current.id));
      if (["owner", "admin"].includes(current.current_user_role)) {
        const [memberRows, inviteRows] = await Promise.all([
          listPortfolioMembers(current.id),
          listPortfolioInvitations(current.id),
        ]);
        setMembers(memberRows);
        setInvitations(inviteRows);
      } else {
        setMembers([]);
        setInvitations([]);
      }
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load this Team.");
    }
  }, [activeContext]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

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
      // The name is on the header switcher and every screen's caption, so the
      // session hears about it rather than waiting for the next sign-in.
      await refreshMe();
      setEditingDetails(false);
      setNotice("Portfolio details saved.");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not save these details.");
    } finally {
      setSavingDetails(false);
    }
  }

  const canManage = organization
    ? ["owner", "admin"].includes(organization.current_user_role)
    : false;
  // Reading the roster is one thing; changing who may operate the business is
  // another, and the second waits on the backend's own answer about this
  // person. Ending access deliberately does not.
  const access = state.status === "signed_in"
    ? state.me.contexts.find((row) => row.organization_id === organization?.id)?.access ?? null
    : null;
  const canGrant = access ? access.can.manage_team : canManage;
  const pending = invitations.filter((row) => row.status === "pending");

  const rows = useMemo<Row[]>(() => {
    if (!canManage) return [];
    const needle = query.trim().toLocaleLowerCase("en-GH");
    const memberRows: Row[] = members
      .filter((member) => !needle || `${member.display_name} ${member.phone}`.toLocaleLowerCase("en-GH").includes(needle))
      .map((member) => ({ kind: "member", member }));
    if (needle) return memberRows;
    return [...memberRows, ...pending.map((invitation) => ({ kind: "invitation", invitation }) as Row)];
  }, [canManage, members, pending, query]);

  // Grouped only when both kinds are present and nothing is being searched for.
  const grouped = !query.trim() && members.length > 0 && pending.length > 0;
  const entries = useMemo(() => entriesFor(rows, grouped), [rows, grouped]);
  const searchable = canManage && members.length >= SEARCHABLE_FROM;

  const note: SummaryNote = canManage && !canGrant
    ? { text: "Verify your identity to change access", tone: "alert" }
    : pending.length
      ? { text: `${pending.length} ${pending.length === 1 ? "invitation" : "invitations"} waiting to be accepted`, tone: "calm" }
      : members.length <= 1
        ? { text: "Only you, so far", tone: "calm" }
        : { text: "Everyone here is active", tone: "calm" };

  return (
    <IndexGround>
      <FlatList
        data={entries}
        keyExtractor={(entry) => entry.key}
        contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
            tintColor={KOLA}
          />
        }
        ListHeaderComponent={(
          <View style={{ gap: density.sectionGap + space[2], marginBottom: space[4] }}>
            {error ? <Notice tone="error" title={error} /> : null}
            {notice ? <Notice tone="success" title={notice} /> : null}

            {organization && canManage ? (
              <SummaryPanel
                label="People with access"
                value={String(members.length)}
                note={note}
                facts={[
                  { label: "Invited", value: String(pending.length) },
                  { label: "Properties", value: String(properties.length) },
                ]}
              />
            ) : null}

            {organization && !canManage ? (
              <InfoNote
                tone="lagoon"
                icon="eye-outline"
                title={`You are ${roleArticle(organization.current_user_role)} here`}
                body="Owners and administrators manage membership. Your assigned Property scope is checked on every action."
              />
            ) : null}

            {canManage && !canGrant ? (
              <InfoNote
                tone="laterite"
                icon="shield-outline"
                title="Verify your identity to change access"
                body="Inviting somebody or changing a role decides who reaches your tenants and your money. You can still see the roster and end access."
              />
            ) : null}

            {organization && details ? (
              <Panel>
                <Fact first icon="business-outline" label="Portfolio" value={organization.name} />
                <Fact icon="pricetag-outline" label="Type" value={typeLabel(organization.organization_type)} />
                <Fact icon="layers-outline" label="Does" value={activityLabel(organization.activities)} />
                {canManage ? (
                  <View style={styles.panelFoot}>
                    <SmallAct icon="create-outline" label="Edit Portfolio details" onPress={() => setEditingDetails(true)} />
                  </View>
                ) : null}
              </Panel>
            ) : null}

            {canGrant ? (
              <View style={styles.invite}>
                <Pill icon="person-add-outline" label="Invite someone" onPress={() => setInviting(true)} />
              </View>
            ) : null}

            {searchable ? (
              <SearchField label="Search members" placeholder="Name or number" value={query} onChangeText={setQuery} />
            ) : null}
          </View>
        )}
        renderItem={({ item: entry }) => {
          if (entry.kind === "group") {
            return (
              <View style={[styles.group, entry.first ? null : styles.groupGap]}>
                <GroupLabel count={entry.count}>{entry.title}</GroupLabel>
              </View>
            );
          }
          // Bound to a const so the narrowing survives into the press handlers.
          const row = entry.row;
          return (
            <ListRow first={entry.first} last={entry.last}>
              {entry.first ? null : <View style={styles.rule} />}
              {row.kind === "member" ? (
                <MemberRow
                  member={row.member}
                  onPress={() =>
                    router.push({
                      pathname: "/(app)/team-member",
                      params: {
                        organizationId: organization!.id,
                        organizationName: organization!.name,
                        membershipId: row.member.id,
                      },
                    } as never)
                  }
                />
              ) : (
                <InvitationRow invitation={row.invitation} onPress={() => setRevoking(row.invitation)} />
              )}
            </ListRow>
          );
        }}
        ListEmptyComponent={
          hasPortfolio === null ? (
            <TeamSkeleton />
          ) : hasPortfolio === false ? (
            <EmptyState
              icon="business-outline"
              hero
              title="Your Portfolio is on its way"
              hint="Rooomly gives you your Portfolio when your provider verification is approved, and your Team lives inside it. Nothing to set up."
              action={<View style={styles.emptyAction}><QuietAction icon="shield-checkmark-outline" label="See your verification" onPress={() => router.push("/(app)/provider" as never)} /></View>}
            />
          ) : query.trim() ? (
            <EmptyState icon="search-outline" title="No matching member" hint="Try another name or number." />
          ) : canManage ? (
            <EmptyState
              icon="people-outline"
              hero
              title="You operate this Portfolio alone"
              hint="Invite a manager, an accountant or staff, and decide which Properties each of them may touch."
            />
          ) : null
        }
        ListFooterComponent={canManage && rows.length ? (
          <Footnote>A role decides what somebody may do; assigned Properties decide where. Open anyone to change either.</Footnote>
        ) : null}
      />

      <BottomSheet
        visible={revoking !== null}
        onClose={() => setRevoking(null)}
        title="Invitation"
        closeLabel="Close invitation"
      >
        {revoking ? (
          <RevokeBody
            invitation={revoking}
            organizationId={organization!.id}
            onRevoked={async (phone) => {
              setRevoking(null);
              setNotice(`Invitation to ${phone} revoked.`);
              await load();
            }}
            onError={(message) => { setRevoking(null); setError(message); }}
          />
        ) : null}
      </BottomSheet>

      {organization && details && canManage ? (
        <DetailsSheet
          visible={editingDetails}
          details={details}
          saving={savingDetails}
          onChange={setDetails}
          onSave={() => void saveDetails()}
          onClose={() => {
            setEditingDetails(false);
            setDetails({
              name: organization.name,
              organization_type: organization.organization_type,
              activities: [...organization.activities],
            });
          }}
        />
      ) : null}

      {organization && canManage ? (
        <InviteSheet
          visible={inviting}
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
    </IndexGround>
  );
}

/** The roster as rows the list can virtualise, with the two kinds named only when both are there. */
function entriesFor(rows: Row[], grouped: boolean): Entry[] {
  const push = (out: Entry[], items: Row[]) =>
    items.forEach((row, index) => out.push({
      kind: "row",
      key: keyOf(row),
      row,
      first: index === 0,
      last: index === items.length - 1,
    }));

  if (!grouped) {
    const out: Entry[] = [];
    push(out, rows);
    return out;
  }
  const out: Entry[] = [];
  for (const group of [
    { key: "members", title: "Members", items: rows.filter((row) => row.kind === "member") },
    { key: "invited", title: "Invited", items: rows.filter((row) => row.kind === "invitation") },
  ]) {
    if (!group.items.length) continue;
    out.push({ kind: "group", key: `group:${group.key}`, title: group.title, count: group.items.length, first: out.length === 0 });
    push(out, group.items);
  }
  return out;
}

/**
 * One person: their initials in the colour of their reach, their name and number,
 * and what they may touch. The role sits on the right, where the eye runs down a
 * roster looking for it.
 */
function MemberRow({ member, onPress }: { member: PortfolioMember; onPress: () => void }) {
  const waiting = accessStateLabel(member);
  const reach = accessLabel(member);
  const tone = memberTone(member);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${member.display_name}. ${roleLabel(member.role)}. ${waiting ? `${reach}, ${waiting}` : reach}.`}
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <View style={[styles.initials, { backgroundColor: tone.wash }]}>
        <Type variant="captionStrong" style={[styles.initialsText, { color: tone.ink }]}>{initialsOf(member.display_name)}</Type>
      </View>
      <View style={rowStyles.rowBody}>
        <RowLine
          start={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowTitle}>{member.display_name}</Type>}
          end={<Type variant="captionStrong" numberOfLines={1} style={[styles.role, { color: tone.text }]}>{roleLabel(member.role)}</Type>}
        />
        <Type variant="caption" numberOfLines={1} style={rowStyles.rowSub}>{member.phone}</Type>
        <Type variant="caption" numberOfLines={2} style={rowStyles.rowMeta}>
          {reach}
          {waiting ? <Type variant="caption" style={{ color: HARMATTAN }}>{` · ${waiting}`}</Type> : null}
        </Type>
      </View>
    </Pressable>
  );
}

/** Somebody who is nearly a member: the number invited, as what, and until when. */
function InvitationRow({ invitation, onPress }: { invitation: PortfolioInvitation; onPress: () => void }) {
  const scope = invitation.properties.length
    ? invitation.properties.map((row) => row.title).join(", ")
    : isScoped(invitation.role)
      ? "No Property assigned yet"
      : "Every Property in this Portfolio";
  const expires = shortDate(invitation.expires_at);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Invitation to ${invitation.invitee_phone} as ${roleLabel(invitation.role)}, expires ${expires}. ${scope}.`}
      accessibilityHint="Opens this invitation"
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <View style={[styles.initials, styles.invited]}>
        <Type variant="captionStrong" style={[styles.initialsText, { color: HARMATTAN }]}>···</Type>
      </View>
      <View style={rowStyles.rowBody}>
        <RowLine
          start={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowTitle}>{invitation.invitee_phone}</Type>}
          end={<Type variant="captionStrong" numberOfLines={1} style={[styles.role, { color: HARMATTAN }]}>Invited</Type>}
        />
        <Type variant="caption" numberOfLines={1} style={rowStyles.rowSub}>
          {roleLabel(invitation.role)} · expires {expires}
        </Type>
        <Type variant="caption" numberOfLines={2} style={rowStyles.rowMeta}>{scope}</Type>
      </View>
    </Pressable>
  );
}

/** An invitation, opened: what it grants, and the one deliberate way to end it. */
function RevokeBody({
  invitation,
  organizationId,
  onRevoked,
  onError,
}: {
  invitation: PortfolioInvitation;
  organizationId: string;
  onRevoked: (phone: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <View style={styles.sheetBody}>
      <Panel>
        <Fact first icon="call-outline" label="Number" value={invitation.invitee_phone} />
        <Fact icon="ribbon-outline" label="Role" value={roleLabel(invitation.role)} />
        <Fact icon="time-outline" label="Expires" value={shortDate(invitation.expires_at)} />
        <Fact
          icon="business-outline"
          label="Properties"
          value={invitation.properties.length
            ? String(invitation.properties.length)
            : isScoped(invitation.role) ? "None yet" : "All"}
        />
      </Panel>
      <Type variant="caption" style={styles.sheetNote}>{roleConsequence(invitation.role)}</Type>
      {confirming ? (
        <>
          <InfoNote
            tone="laterite"
            icon="close-circle-outline"
            title="Revoke this invitation?"
            body="It cannot be accepted afterwards. You can invite the same number again."
          />
          <View style={styles.sheetActions}>
            <Pill
              label="Confirm revoke"
              icon="close-circle-outline"
              busy={busy}
              busyLabel="Revoking…"
              onPress={async () => {
                setBusy(true);
                try {
                  await revokePortfolioInvitation(organizationId, invitation.id);
                  await onRevoked(invitation.invitee_phone);
                } catch (cause) {
                  onError(cause instanceof ApiFailure ? cause.error.message : "Could not revoke that invitation.");
                } finally {
                  setBusy(false);
                }
              }}
            />
            <Pill label="Keep it" tone="quiet" onPress={() => setConfirming(false)} />
          </View>
        </>
      ) : (
        <View style={styles.sheetActions}>
          <Pill label="Revoke invitation" icon="close-circle-outline" tone="quiet" onPress={() => setConfirming(true)} />
        </View>
      )}
    </View>
  );
}

/**
 * Naming and describing the Portfolio.
 *
 * Its own page sheet, like the invitation: a keyboard, a picker and a set of
 * choices do not belong unfolded in the middle of a roster somebody was reading.
 */
function DetailsSheet({
  visible,
  details,
  saving,
  onChange,
  onSave,
  onClose,
}: {
  visible: boolean;
  details: Details;
  saving: boolean;
  onChange: (details: Details) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => !saving && onClose()}>
      {/* The sheet has its own window, which measures its own edges. */}
      <ModalSafeArea>
      <SafeBottom render={(bottom) => (
      <ScrollView contentContainerStyle={[styles.formSheet, { paddingBottom: space[8] + bottom }]}>
        <View style={{ gap: space[1] }}>
          <Type variant="label">PORTFOLIO</Type>
          <Type variant="title1" accessibilityRole="header">Portfolio details</Type>
        </View>
        <Field
          label="Portfolio name"
          hint="What your tenants, agreements and receipts will carry."
          value={details.name}
          onChangeText={(value) => onChange({ ...details, name: value })}
        />
        <Choice
          label="Portfolio type"
          value={details.organization_type}
          options={PORTFOLIO_TYPES}
          onChange={(value) => onChange({ ...details, organization_type: value })}
        />
        <View style={{ gap: space[2] }}>
          <Type variant="caption" style={{ color: theme.color.ink["700"] }}>What this Portfolio does</Type>
          <View style={styles.activities}>
            {ACTIVITIES.map((activity) => {
              const on = details.activities.includes(activity.value);
              return (
                <Pressable
                  key={activity.value}
                  accessibilityRole="checkbox"
                  aria-checked={on}
                  accessibilityLabel={activity.label}
                  onPress={() =>
                    onChange({
                      ...details,
                      activities: on
                        ? details.activities.filter((row) => row !== activity.value)
                        : [...details.activities, activity.value],
                    })
                  }
                  {...pressableFeedback(theme.color.kola["50"])}
                  style={[styles.activity, on ? styles.activityOn : null]}
                >
                  <Type variant="body">{activity.label}</Type>
                </Pressable>
              );
            })}
          </View>
        </View>
        <Button
          label="Save details"
          busy={saving}
          disabled={!details.name.trim() || details.activities.length === 0}
          onPress={onSave}
        />
        <Button label="Cancel" variant="quiet" disabled={saving} onPress={onClose} />
      </ScrollView>
      )} />
      </ModalSafeArea>
    </Modal>
  );
}

function InviteSheet({
  visible,
  organization,
  properties,
  onClose,
  onCreated,
}: {
  visible: boolean;
  organization: Organization;
  properties: ManagedProperty[];
  onClose: () => void;
  onCreated: (invitation: PortfolioInvitation) => Promise<void>;
}) {
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<PortfolioMember["role"]>("property_manager");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    setBusy(true);
    setError("");
    try {
      const invitation = await invitePortfolioMember(organization.id, {
        phone: phone.trim(),
        role,
        property_ids: isScoped(role) ? selected : [],
      });
      setPhone("");
      setSelected([]);
      await onCreated(invitation);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not create that invitation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    // Back must not dismiss the sheet while the invitation is in flight.
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => !busy && onClose()}>
      {/* The sheet has its own window, which measures its own edges. */}
      <ModalSafeArea>
        <View style={styles.inviteWindow}>
          <ScrollView contentContainerStyle={styles.inviteScroll}>
            <View style={styles.inviteHead}>
              <Type variant="label">TEAM</Type>
              <Type variant="title2" accessibilityRole="header" style={styles.inviteTitle}>Invite someone</Type>
            </View>

            {error ? <Notice tone="error" title={error} /> : null}

            <View style={styles.inviteSection}>
              <GroupLabel>Who</GroupLabel>
              <Field
                label="Ghana mobile number"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                placeholder="024 123 4567"
              />
            </View>

            <View style={styles.inviteSection}>
              <GroupLabel>What they may do</GroupLabel>
              <RoleChoice
                value={role}
                disabled={busy}
                onChange={(value) => { setRole(value as PortfolioMember["role"]); setSelected([]); }}
              />
            </View>

            {isScoped(role) ? (
              <View style={styles.inviteSection}>
                <GroupLabel>Properties they may touch</GroupLabel>
                <PropertyScope
                  properties={properties}
                  selected={selected}
                  disabled={busy}
                  onToggle={(id) =>
                    setSelected((current) =>
                      current.includes(id) ? current.filter((row) => row !== id) : [...current, id],
                    )
                  }
                />
              </View>
            ) : null}

            <Footnote>Nothing is granted until they accept on this number. It expires in seven days.</Footnote>
          </ScrollView>

          {/* Inside the modal's own provider, so the bar clears this window's edge. */}
          <ActionBar>
            <ActPill
              label="Send invitation"
              icon="paper-plane-outline"
              busy={busy}
              busyLabel="Sending"
              disabled={!phone.trim()}
              grow
              onPress={() => void send()}
            />
            <QuietAct label="Cancel" disabled={busy} onPress={onClose} />
          </ActionBar>
        </View>
      </ModalSafeArea>
    </Modal>
  );
}

/** Shaped like the summary and the first rows, so nothing jumps when they arrive. */
function TeamSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading your Team" style={styles.skeleton}>
      <Panel style={styles.skeletonPanel}>
        <Bone width="42%" height={11} />
        <Bone width="18%" height={30} />
        <Bone height={34} />
      </Panel>
      <Panel>
        {[0, 1, 2].map((key) => (
          <View key={key} style={[styles.skeletonRow, key ? styles.ruled : null]}>
            <Bone width={36} height={36} round={18} />
            <View style={styles.skeletonLines}>
              <Bone width="46%" height={14} />
              <Bone width="60%" />
              <Bone width="38%" />
            </View>
          </View>
        ))}
      </Panel>
    </View>
  );
}

function keyOf(row: Row) {
  return row.kind === "member" ? `member:${row.member.id}` : `invitation:${row.invitation.id}`;
}

/** Portfolio-wide reach in kola, something unfinished in harmattan, an ended one in laterite. */
function memberTone(member: PortfolioMember) {
  const state = member.access?.state;
  if (state === "revoked") return { ink: LATERITE, wash: theme.color.laterite["100"], text: LATERITE };
  if (state === "pending_verification" || state === "limited") {
    return { ink: HARMATTAN, wash: theme.color.harmattan["100"], text: HARMATTAN };
  }
  if (member.effective_access === "portfolio_wide") {
    return { ink: KOLA_DEEP, wash: theme.color.kola["50"], text: KOLA };
  }
  return { ink: theme.color.ink["700"], wash: theme.color.field["100"], text: MUTED };
}

function typeLabel(value: Organization["organization_type"]) {
  return PORTFOLIO_TYPES.find((row) => row.value === value)?.label ?? value.replaceAll("_", " ");
}

function activityLabel(values: Organization["activities"]) {
  if (!values.length) return "Not set";
  return values.map((value) => ACTIVITIES.find((row) => row.value === value)?.label ?? value).join(" · ");
}

function shortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GH", { day: "numeric", month: "short" });
}

const styles = StyleSheet.create({
  group: {
    paddingBottom: space[2],
  },
  groupGap: {
    marginTop: space[5],
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 14,
    backgroundColor: RULE,
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  panelFoot: {
    flexDirection: "row",
    paddingHorizontal: 14,
    paddingBottom: space[3],
  },
  invite: {
    flexDirection: "row",
  },
  initials: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  invited: {
    backgroundColor: theme.color.harmattan["100"],
  },
  initialsText: {
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: 0.3,
  },
  role: {
    fontSize: 12.5,
    lineHeight: 17,
  },
  sheetBody: {
    gap: space[4],
  },
  sheetNote: {
    color: MUTED,
  },
  sheetActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  formSheet: {
    padding: space[5],
    paddingBottom: space[10],
    gap: space[4],
  },
  /**
   * The invitation fills its window and pins its own bar, so the scroll ends
   * above the decision rather than under it.
   */
  inviteWindow: {
    flex: 1,
  },
  inviteScroll: {
    padding: space[4],
    paddingBottom: space[6],
    gap: space[4],
  },
  inviteHead: {
    gap: space[1],
    paddingHorizontal: 2,
  },
  inviteTitle: {
    fontSize: 19,
    lineHeight: 25,
  },
  inviteSection: {
    gap: space[2],
  },
  activities: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  activity: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: space[4],
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.color.field["300"],
  },
  activityOn: {
    borderWidth: 2,
    borderColor: theme.color.kola["600"],
    backgroundColor: theme.color.kola["50"],
  },
  emptyAction: {
    marginTop: space[2],
  },
  skeleton: {
    gap: space[5],
  },
  skeletonPanel: {
    gap: space[3],
    padding: space[4],
  },
  skeletonRow: {
    flexDirection: "row",
    gap: space[3],
    padding: 14,
  },
  skeletonLines: {
    flex: 1,
    justifyContent: "center",
    gap: space[2],
  },
});
