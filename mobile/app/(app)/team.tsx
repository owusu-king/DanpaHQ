import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Modal, Pressable, RefreshControl, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { Button, Choice, Field, Notice, Type, space } from "@/components/ui";
import {
  GRANTABLE_ROLES,
  PropertyScope,
  accessLabel,
  accessStateLabel,
  isScoped,
  roleArticle,
  roleConsequence,
  roleLabel,
} from "@/components/team/TeamPatterns";
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
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";

type Row =
  | { kind: "member"; member: PortfolioMember }
  | { kind: "invitation"; invitation: PortfolioInvitation };

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

type Details = {
  name: string;
  organization_type: Organization["organization_type"];
  activities: Organization["activities"];
};

/**
 * Team: who can operate this Portfolio, what they may do, and which Properties
 * they may touch.
 *
 * A roster, with each person's controls behind opening them. The previous
 * screen put a role picker, every Property as a button, and an unconfirmed
 * "Remove member" inside every card — one stray tap ended somebody's access.
 */
export default function TeamScreen() {
  const router = useRouter();
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

  return (
    <>
      <FlatList
        data={rows}
        keyExtractor={(row) => (row.kind === "member" ? row.member.id : row.invitation.id)}
        contentContainerStyle={{ padding: space[5], paddingBottom: space[12] }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
            tintColor={theme.color.kola["600"]}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: space[4], marginBottom: space[2] }}>
            <View style={{ gap: space[1] }}>
              <Type variant="label">PORTFOLIO ACCESS</Type>
              <Type variant="display2" accessibilityRole="header">Team</Type>
              <Type variant="body">
                {organization
                  ? `Who can operate ${organization.name}, what they may do, and which Properties they may touch.`
                  : "Who can operate this Portfolio and which Properties they may touch."}
              </Type>
            </View>

            {error ? <Notice tone="error" title={error} /> : null}
            {notice ? <Notice tone="success" title={notice} /> : null}

            {hasPortfolio === false ? (
              <View style={{ gap: space[3], paddingLeft: space[4], borderLeftWidth: 3, borderLeftColor: theme.color.kola["600"] }}>
                <Type variant="title2" accessibilityRole="header">Your Portfolio is on its way</Type>
                <Type variant="caption">
                  Rooomly gives you your Portfolio when your provider verification is approved,
                  and your Team lives inside it. Nothing to set up.
                </Type>
                <Button label="See your verification status" onPress={() => router.push("/(app)/provider" as never)} />
              </View>
            ) : null}

            {organization && !canManage ? (
              <Notice
                tone="info"
                title={`You are ${roleArticle(organization.current_user_role)} in this Portfolio`}
                body="Owners and administrators manage membership, so the roster is not shown to you. The backend checks your assigned Property scope on every action."
              />
            ) : null}

            {canManage && !canGrant ? (
              <Notice
                tone="info"
                title="Verify your identity to change who may operate this Portfolio"
                body="Inviting somebody, changing a role or assigning a Property decides who reaches your tenants and your money, so Rooomly confirms who you are first. You can still see the roster and end somebody's access."
              />
            ) : null}

            {canManage && details ? (
              <View style={{ gap: space[3] }}>
                {/* Rooomly names the Portfolio when it provisions it, which is
                    why nobody is asked to invent one up front — and why this
                    has to exist. */}
                {editingDetails ? (
                  <View style={{ gap: space[3] }}>
                    <Field
                      label="Portfolio name"
                      hint="What your tenants, agreements and receipts will carry."
                      value={details.name}
                      onChangeText={(value) => setDetails({ ...details, name: value })}
                    />
                    <Choice
                      label="Portfolio type"
                      value={details.organization_type}
                      options={PORTFOLIO_TYPES}
                      onChange={(value) => setDetails({ ...details, organization_type: value })}
                    />
                    <View style={{ gap: space[2] }}>
                      <Type variant="caption" style={{ color: theme.color.ink["700"] }}>
                        What this Portfolio does
                      </Type>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
                        {ACTIVITIES.map((activity) => {
                          const on = details.activities.includes(activity.value);
                          return (
                            <Pressable
                              key={activity.value}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: on }}
                              accessibilityLabel={activity.label}
                              onPress={() =>
                                setDetails({
                                  ...details,
                                  activities: on
                                    ? details.activities.filter((row) => row !== activity.value)
                                    : [...details.activities, activity.value],
                                })
                              }
                              {...pressableFeedback(theme.color.kola["50"])}
                              style={{
                                minHeight: 44,
                                justifyContent: "center",
                                paddingHorizontal: space[4],
                                borderRadius: 22,
                                borderWidth: on ? 2 : 1,
                                borderColor: on ? theme.color.kola["600"] : theme.color.field["300"],
                                backgroundColor: on ? theme.color.kola["50"] : "transparent",
                              }}
                            >
                              <Type variant="body">{activity.label}</Type>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                    <Button
                      label="Save details"
                      busy={savingDetails}
                      disabled={!details.name.trim() || details.activities.length === 0}
                      onPress={() => void saveDetails()}
                    />
                    <Button
                      label="Cancel"
                      variant="secondary"
                      onPress={() => {
                        setEditingDetails(false);
                        setDetails({
                          name: organization!.name,
                          organization_type: organization!.organization_type,
                          activities: [...organization!.activities],
                        });
                      }}
                    />
                  </View>
                ) : (
                  <Button
                    label="Edit Portfolio details"
                    variant="secondary"
                    onPress={() => setEditingDetails(true)}
                  />
                )}
              </View>
            ) : null}

            {canManage ? (
              <>
                {canGrant ? <Button label="Invite someone" onPress={() => setInviting(true)} /> : null}
                {members.length > 6 ? (
                  <Field
                    label="Search members"
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Name or number"
                    returnKeyType="search"
                  />
                ) : null}
                <Type variant="title2" accessibilityRole="header">
                  {members.length} {members.length === 1 ? "member" : "members"}
                  {pending.length && !query ? ` · ${pending.length} invited` : ""}
                </Type>
              </>
            ) : null}
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: theme.color.field["200"] }} />}
        renderItem={({ item }) =>
          item.kind === "member" ? (
            <MemberRow
              member={item.member}
              onPress={() =>
                router.push({
                  pathname: "/(app)/team-member",
                  params: {
                    organizationId: organization!.id,
                    organizationName: organization!.name,
                    membershipId: item.member.id,
                  },
                } as never)
              }
            />
          ) : (
            <InvitationRow
              invitation={item.invitation}
              onRevoked={async () => {
                setNotice(`Invitation to ${item.invitation.invitee_phone} revoked.`);
                await load();
              }}
              onError={setError}
              organizationId={organization!.id}
            />
          )
        }
        ListEmptyComponent={
          canManage && query ? (
            <View style={{ paddingVertical: space[6], gap: space[2] }}>
              <Type variant="bodyStrong">No matching member</Type>
              <Type variant="caption">Try another name or number.</Type>
            </View>
          ) : null
        }
      />
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
    </>
  );
}

function MemberRow({ member, onPress }: { member: PortfolioMember; onPress: () => void }) {
  const waiting = accessStateLabel(member);
  const access = waiting ? `${accessLabel(member)} · ${waiting}` : accessLabel(member);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${member.display_name}. ${roleLabel(member.role)}. ${access}.`}
      onPress={onPress}
      {...pressableFeedback(theme.color.field["200"])}
      style={({ pressed }) => ({
        minHeight: 76,
        paddingVertical: space[3],
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: space[3],
        opacity: pressed ? 0.82 : 1,
      })}
    >
      <View style={{ flex: 1, minWidth: 180, gap: space[1] }}>
        <Type variant="bodyStrong">{member.display_name}</Type>
        <Type variant="caption">{member.phone} · {access}</Type>
      </View>
      <Type variant="bodyStrong" style={{ color: theme.color.kola["600"] }}>{roleLabel(member.role)} →</Type>
    </Pressable>
  );
}

function InvitationRow({
  invitation,
  organizationId,
  onRevoked,
  onError,
}: {
  invitation: PortfolioInvitation;
  organizationId: string;
  onRevoked: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <View style={{ paddingVertical: space[3], gap: space[2] }}>
      <Type variant="bodyStrong">{invitation.invitee_phone}</Type>
      <Type variant="caption">
        Invited as {roleLabel(invitation.role).toLocaleLowerCase("en-GH")} · expires{" "}
        {new Date(invitation.expires_at).toLocaleDateString("en-GH", { day: "numeric", month: "short" })}
      </Type>
      <Type variant="caption">
        {invitation.properties.length
          ? invitation.properties.map((row) => row.title).join(", ")
          : isScoped(invitation.role)
            ? "No Property assigned yet"
            : "Every Property in this Portfolio"}
      </Type>
      {confirming ? (
        <>
          <Notice
            tone="warning"
            title="Revoke this invitation?"
            body="It cannot be accepted afterwards. You can invite the same number again."
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            <Button
              label="Confirm revoke"
              variant="destructive"
              busy={busy}
              onPress={async () => {
                setBusy(true);
                try {
                  await revokePortfolioInvitation(organizationId, invitation.id);
                  await onRevoked();
                } catch (cause) {
                  onError(cause instanceof ApiFailure ? cause.error.message : "Could not revoke that invitation.");
                } finally {
                  setBusy(false);
                  setConfirming(false);
                }
              }}
            />
            <Button label="Go back" variant="quiet" disabled={busy} onPress={() => setConfirming(false)} />
          </View>
        </>
      ) : (
        <Button label="Revoke invitation" variant="secondary" onPress={() => setConfirming(true)} />
      )}
    </View>
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

  return (
    // Back must not dismiss the sheet while the invitation is in flight.
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => !busy && onClose()}>
      <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: space[10], gap: space[4] }}>
        <View style={{ gap: space[1] }}>
          <Type variant="label">TEAM</Type>
          <Type variant="title1" accessibilityRole="header">Invite someone</Type>
        </View>
        <Type variant="caption">
          They use their own Rooomly account. Nothing is granted until they sign in with this exact
          number and accept, and the invitation expires in seven days.
        </Type>
        <Field label="Ghana mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="024 123 4567" />
        <Choice
          label="Role"
          value={role}
          options={GRANTABLE_ROLES.map((row) => ({ ...row }))}
          onChange={(value) => { setRole(value as PortfolioMember["role"]); setSelected([]); }}
        />
        <Type variant="caption">{roleConsequence(role)}</Type>
        {isScoped(role) ? (
          <PropertyScope
            properties={properties}
            selected={selected}
            onToggle={(id) =>
              setSelected((current) =>
                current.includes(id) ? current.filter((row) => row !== id) : [...current, id],
              )
            }
          />
        ) : null}
        {error ? <Notice tone="error" title={error} /> : null}
        <Button
          label="Send invitation"
          busy={busy}
          disabled={!phone.trim()}
          onPress={async () => {
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
          }}
        />
        <Button label="Cancel" variant="quiet" disabled={busy} onPress={onClose} />
      </ScrollView>
    </Modal>
  );
}
