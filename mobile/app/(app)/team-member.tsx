import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { Bone } from "@/components/billing/BillingParts";
import {
  ActionBar,
  EDGE,
  Fact,
  Footnote,
  GroupLabel,
  INK,
  Lead,
  Pill,
  QuietAct,
  RecordPanel,
  StandingLine,
  type RecordTone,
} from "@/components/record/RecordSurfaces";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { Notice, Type, space } from "@/components/ui";
import {
  PropertyScope,
  RoleChoice,
  accessLabel,
  accessStateLabel,
  isScoped,
  roleLabel,
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
import { useSafeBottom } from "@/platform";

/**
 * One member's access.
 *
 * Its own screen rather than controls inside a roster card: changing what
 * somebody may reach is a deliberate act, and the previous card put a role
 * picker, every Property, and an unconfirmed "Remove member" one tap apart.
 *
 * Refined on review (2026-09-21) onto the record surfaces. It read as three
 * ruled sections under a display heading, each role explained in a sentence
 * below the picker and every Property a full-width button; the roles now carry
 * their own consequence on their own rows, the Properties are ticked rather
 * than pressed, and the two acts that change anything — save, or remove — are
 * the only things that look like acts.
 */
export default function TeamMemberScreen() {
  const pageBottom = useSafeBottom(space[8]);
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
  const [removing, setRemoving] = useState(false);

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
      <View style={styles.page}>
        {error ? <Notice tone="error" title={error} /> : <MemberSkeleton />}
      </View>
    );
  }

  const roleChanged = role !== member.role;
  const scopeChanged =
    isScoped(role) && (scope.length !== assigned.length || scope.some((id) => !assigned.includes(id)));
  const dirty = roleChanged || scopeChanged;

  const waiting = accessStateLabel(member);
  const tone: RecordTone = waiting === "access ended" ? "alert" : waiting ? "waiting" : "good";
  const owner = member.role === "owner";
  // The roster says "Property manager · verification needed", where the label
  // is a clause. Standing on its own it has to be a sentence.
  const standing = waiting === "limited" ? "Limited access" : `${waiting.charAt(0).toUpperCase()}${waiting.slice(1)}`;

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

  /**
   * Removal is irreversible and is not offered on the page it is decided from.
   * It opens, names the person and what ends, and is confirmed there.
   */
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await removePortfolioMember(organizationId, membershipId);
      setRemoving(false);
      router.back();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not remove that member.");
      setBusy(false);
      setRemoving(false);
    }
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.page, { paddingBottom: dirty ? space[6] : pageBottom }]}>
        <View style={styles.identity}>
          <Type variant="title2" accessibilityRole="header" numberOfLines={2} style={styles.who}>
            {member.display_name}
          </Type>
          {waiting ? <StandingLine tone={tone} line={standing} /> : null}
        </View>

        {error ? <Notice tone="error" title={error} /> : null}
        {notice && !dirty ? <Notice tone="success" title={notice} /> : null}

        <RecordPanel>
          <Lead label="Role" value={roleLabel(member.role)} note={accessLabel(member)} tone={tone} />
          <View style={styles.rule} />
          <Fact first label="Phone" value={member.phone} />
          <Fact label="In the Team since" value={formatDate(member.joined_at)} />
        </RecordPanel>

        {waiting ? (
          <Footnote>
            {member.access.requirements.includes("identity")
              ? "Tenant-facing work waits on their own identity verification."
              : "This Portfolio's verification is not current, so tenant-facing work is paused for everyone."}
          </Footnote>
        ) : null}

        <View style={styles.section}>
          <GroupLabel>What they may do</GroupLabel>
          {owner ? (
            <>
              <RecordPanel>
                <Fact wide first label="Owner" value="Holds this Portfolio, its verification, its plan and the account rent settles into." />
              </RecordPanel>
              <Footnote>Ownership is transferred deliberately rather than changed from the roster.</Footnote>
            </>
          ) : (
            <RoleChoice value={role} onChange={(value) => setRole(value as PortfolioMember["role"])} disabled={busy} />
          )}
        </View>

        {!owner && isScoped(role) ? (
          <View style={styles.section}>
            <GroupLabel>Properties they may touch</GroupLabel>
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
          </View>
        ) : null}

        {owner ? null : (
          <View style={styles.exit}>
            <QuietAct
              label="Remove from this Portfolio"
              icon="person-remove-outline"
              accessibilityLabel={`Remove ${member.display_name} from this Portfolio`}
              disabled={busy}
              onPress={() => setRemoving(true)}
            />
          </View>
        )}
      </ScrollView>

      {dirty ? (
        <ActionBar note={roleChanged ? `Their role becomes ${roleLabel(role)}.` : undefined}>
          <Pill label="Save access" busy={busy} busyLabel="Saving" grow onPress={() => void save()} />
          <QuietAct
            label="Discard changes"
            disabled={busy}
            onPress={() => { setRole(member.role); setScope(assigned); }}
          />
        </ActionBar>
      ) : null}

      <BottomSheet
        visible={removing}
        onClose={() => !busy && setRemoving(false)}
        title={`Remove ${member.display_name}?`}
        closeLabel="Keep their access"
      >
        <View style={styles.sheetBody}>
          <RecordPanel>
            <Fact first label="Loses" value={accessLabel(member)} tone="alert" />
            <Fact label="Keeps" value="Their own Danpa HQ account" />
          </RecordPanel>
          <Footnote>
            Their access to {organizationName || "this Portfolio"} ends immediately and their Property
            assignments are released. They can be invited again.
          </Footnote>
          <View style={styles.sheetActs}>
            <Pill
              label="Remove"
              tone="danger"
              icon="person-remove-outline"
              busy={busy}
              busyLabel="Removing"
              grow
              onPress={() => void remove()}
            />
            <QuietAct label="Keep their access" disabled={busy} onPress={() => setRemoving(false)} />
          </View>
        </View>
      </BottomSheet>
    </View>
  );
}

function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}

/** Shaped like the member, so nothing jumps when they arrive. */
function MemberSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading this member" style={{ gap: space[4] }}>
      <Bone width="58%" height={22} />
      <RecordPanel style={styles.skeletonPanel}>
        <Bone width="36%" height={12} />
        <Bone width="62%" height={26} />
      </RecordPanel>
      <Bone width="44%" height={12} />
      <RecordPanel style={styles.skeletonPanel}>
        <Bone height={44} />
        <Bone height={44} />
      </RecordPanel>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  page: {
    padding: space[4],
    gap: space[4],
  },
  identity: {
    gap: space[2],
    paddingHorizontal: 2,
  },
  who: {
    fontSize: 19,
    lineHeight: 25,
    color: INK,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: space[4],
    backgroundColor: EDGE,
  },
  section: {
    gap: space[2],
  },
  exit: {
    alignItems: "flex-start",
    paddingHorizontal: 2,
    paddingTop: space[2],
  },
  sheetBody: {
    gap: space[4],
  },
  sheetActs: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space[4],
  },
  skeletonPanel: {
    gap: space[3],
    padding: space[4],
  },
});
