import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { Button, Choice, Notice, Type, space } from "@/components/ui";
import {
  GRANTABLE_ROLES,
  PropertyScope,
  accessLabel,
  accessStateLabel,
  isScoped,
  roleConsequence,
} from "@/components/team/TeamPatterns";
import {
  assignPortfolioProperty,
  changePortfolioMemberRole,
  listOrganizationProperties,
  listPortfolioAssignments,
  listPortfolioMembers,
  removePortfolioMember,
  unassignPortfolioProperty,
  type ManagedProperty,
  type PortfolioMember,
  type PropertyAssignment,
} from "@/organizations";
import { theme } from "@/theme";

/**
 * One member's access.
 *
 * Its own screen rather than controls inside a roster card: changing what
 * somebody may reach is a deliberate act, and the previous card put a role
 * picker, every Property, and an unconfirmed "Remove member" one tap apart.
 */
export default function TeamMemberScreen() {
  const router = useRouter();
  const { organizationId, organizationName, membershipId } = useLocalSearchParams<{
    organizationId: string;
    organizationName?: string;
    membershipId: string;
  }>();

  const [member, setMember] = useState<PortfolioMember | null>(null);
  const [properties, setProperties] = useState<ManagedProperty[]>([]);
  const [assigned, setAssigned] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<PropertyAssignment[]>([]);
  const [role, setRole] = useState<PortfolioMember["role"]>("staff");
  const [scope, setScope] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!organizationId || !membershipId) return;
    try {
      const [members, propertyRows, assignmentRows] = await Promise.all([
        listPortfolioMembers(organizationId),
        listOrganizationProperties(organizationId),
        listPortfolioAssignments(organizationId),
      ]);
      const found = members.find((row) => row.id === membershipId) ?? null;
      const mine = assignmentRows
        .filter((row) => row.membership_id === membershipId)
        .map((row) => row.property_id);
      setMember(found);
      setProperties(propertyRows);
      setAssignments(assignmentRows);
      setAssigned(mine);
      setRole(found?.role ?? "staff");
      setScope(mine);
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load this member.");
    }
  }, [organizationId, membershipId]);

  useEffect(() => { void load(); }, [load]);

  if (!member) {
    return (
      <ScrollView contentContainerStyle={{ padding: space[5], gap: space[3] }}>
        {error ? <Notice tone="error" title={error} /> : <Type variant="caption">Loading…</Type>}
      </ScrollView>
    );
  }

  const roleChanged = role !== member.role;
  const scopeChanged =
    isScoped(role) && (scope.length !== assigned.length || scope.some((id) => !assigned.includes(id)));
  const dirty = roleChanged || scopeChanged;

  /** Apply the difference, then settle once — not a request per tap. */
  async function save() {
    setBusy(true);
    setError("");
    try {
      if (roleChanged) await changePortfolioMemberRole(organizationId, membershipId, role);
      if (isScoped(role)) {
        for (const propertyId of scope.filter((id) => !assigned.includes(id))) {
          await assignPortfolioProperty(organizationId, membershipId, propertyId);
        }
        for (const propertyId of assigned.filter((id) => !scope.includes(id))) {
          const assignment = assignments.find(
            (row) => row.membership_id === membershipId && row.property_id === propertyId,
          );
          if (assignment) await unassignPortfolioProperty(organizationId, assignment.id);
        }
      }
      setNotice("Access updated.");
      await load();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That Team change did not save.");
    } finally {
      setBusy(false);
    }
  }

  function confirmRemoval() {
    Alert.alert(
      `Remove ${member!.display_name}?`,
      "Their access ends immediately and their Property assignments are released. They keep their own Rooomly account, and can be invited again.",
      [
        { text: "Go back", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            setError("");
            try {
              await removePortfolioMember(organizationId, membershipId);
              router.back();
            } catch (cause) {
              setError(cause instanceof ApiFailure ? cause.error.message : "Could not remove that member.");
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: space[12], gap: space[5] }}>
      <View style={{ gap: space[1] }}>
        <Type variant="label">TEAM MEMBER</Type>
        <Type variant="display2" accessibilityRole="header">{member.display_name}</Type>
        <Type variant="body">{member.phone} · {accessLabel(member)}</Type>
      </View>

      {error ? <Notice tone="error" title={error} /> : null}
      {notice && !dirty ? <Notice tone="success" title={notice} /> : null}

      <Section title="What they may do">
        {member.role === "owner" ? (
          <Notice
            tone="info"
            title="This is the Portfolio's owner"
            body="Ownership carries the Portfolio's verification, its plan and its settlement account, so it is transferred deliberately rather than changed from the roster."
          />
        ) : (
          <>
            <Choice
              label="Role"
              value={role}
              options={GRANTABLE_ROLES.map((row) => ({ ...row }))}
              onChange={(value) => setRole(value as PortfolioMember["role"])}
            />
            <Type variant="caption">{roleConsequence(role)}</Type>
          </>
        )}
        {accessStateLabel(member) ? (
          <Notice
            tone="info"
            title={`Their access is ${accessStateLabel(member)}`}
            body={member.access.requirements.includes("identity")
              ? "They have not verified their identity yet, so tenant-facing work and any Portfolio-wide administration wait for it. Their own Verification screen is where that happens."
              : "This Portfolio's provider verification is not current, so tenant-facing work is paused for everyone in it."}
          />
        ) : null}
      </Section>

      {isScoped(role) ? (
        <Section title="Which Properties they may touch">
          <PropertyScope
            properties={properties}
            selected={scope}
            disabled={busy}
            onToggle={(id) =>
              setScope((current) =>
                current.includes(id) ? current.filter((row) => row !== id) : [...current, id],
              )
            }
          />
        </Section>
      ) : null}

      {dirty ? (
        <View style={{ gap: space[2] }}>
          <Button label="Save access" busy={busy} onPress={() => void save()} />
          <Button
            label="Discard changes"
            variant="quiet"
            disabled={busy}
            onPress={() => { setRole(member.role); setScope(assigned); }}
          />
        </View>
      ) : null}

      <Section title="Remove from this Portfolio">
        <Type variant="caption">
          Ends their access to {organizationName || "this Portfolio"}. It does not touch their account.
        </Type>
        <Button label="Remove member" variant="destructive" disabled={busy} onPress={confirmRemoval} />
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space[3], paddingTop: space[4], borderTopWidth: 1, borderTopColor: theme.color.field["200"] }}>
      <Type variant="title2" accessibilityRole="header">{title}</Type>
      {children}
    </View>
  );
}
