import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Image, Linking, ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "@/auth";
import { Select } from "@/components/form/Select";
import { RecordPanel, KOLA, KOLA_DEEP, EDGE, INK, MUTED, TONE, type RecordTone } from "@/components/record/RecordSurfaces";
import { Button, Field, Notice, Type, space } from "@/components/ui";
import { listOrganizations, type Organization } from "@/organizations";
import { uploadImage } from "@/provider";
import { DOCUMENT_TYPES, PASSPORT_STATUS, addPassportDocument, getProviderPassport, passportDownload, passportForm, passportPath, removePassportDocument, saveProviderPassport, submitProviderPassport, type ProviderPassport, type ProviderPassportForm } from "@/providerPassport";
import { useSafeBottom } from "@/platform";
import { theme } from "@/theme";

const message = (cause: unknown) => cause instanceof Error ? cause.message : "The Passport could not be updated. Try again.";

export default function ProviderPassportScreen() {
  const { activeContext } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[] | null>(null);
  const [selection, setSelection] = useState<{ context: string | null; id: string } | null>(null);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const bottom = useSafeBottom(space[8]);
  const reload = useCallback(async () => {
    const attempt = ++generation.current;
    try {
      const rows = await listOrganizations();
      if (attempt === generation.current) { setOrganizations(rows.filter(row => ["owner", "admin"].includes(row.current_user_role))); setError(""); }
    } catch (cause) { if (attempt === generation.current) setError(message(cause)); }
  }, []);
  useFocusEffect(useCallback(() => { void reload(); return () => { generation.current++; }; }, [reload]));
  const selected = selection?.context === activeContext ? selection.id : "";
  const organization = organizations?.find(row => row.id === (selected || activeContext?.replace(/^organization:/, ""))) ?? organizations?.[0];
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.page, { paddingBottom: bottom }]}>
    {error ? <><Notice tone="error" title={error} /><Button label="Try again" variant="secondary" onPress={() => void reload()} /></> : null}
    {!organizations && !error ? <Type>Loading Provider Passport…</Type> : null}
    {organizations && !organization ? <Notice title="No Passport to manage" body="Portfolio owners and administrators manage Passports after provider account approval." /> : null}
    {organizations && organizations.length > 1 ? <Select label="Portfolio" value={organization?.id ?? ""} options={organizations.map(row => ({ value: row.id, label: row.name }))} onChange={id => setSelection({ context: activeContext, id })} /> : null}
    {organization ? <PassportEditor key={organization.id} organization={organization} /> : null}
  </ScrollView>;
}

function PassportEditor({ organization }: { organization: Organization }) {
  const { state } = useAuth();
  const router = useRouter();
  const [passport, setPassport] = useState<ProviderPassport | null>(null);
  const [form, setForm] = useState<ProviderPassportForm | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const [photoRecord, setPhotoRecord] = useState<{ id: string; url: string } | null>(null);
  const live = useRef(true);
  const reload = useCallback(async () => {
    const attempt = ++generation.current;
    try {
      const next = await getProviderPassport(organization.id);
      if (live.current && attempt === generation.current) { setPassport(next); setForm(passportForm(next)); setError(""); }
    } catch (cause) { if (live.current && attempt === generation.current) setError(message(cause)); }
  }, [organization.id]);
  useFocusEffect(useCallback(() => {
    live.current = true;
    void reload();
    return () => { live.current = false; generation.current++; };
  }, [reload]));
  useEffect(() => {
    let current = true;
    if (passport?.identity.photo_on_record) {
      const id = passport.identity.id;
      void passportDownload(`${passportPath(organization.id)}photo/`).then(file => { if (current) setPhotoRecord({ id, url: file.url }); }).catch(() => undefined);
    }
    return () => { current = false; };
  }, [organization.id, passport]);
  const photo = passport?.identity.photo_on_record && photoRecord?.id === passport.identity.id ? photoRecord.url : null;
  async function run(action: () => Promise<ProviderPassport>, success: string, reset = false) {
    setBusy(true); setError(""); setNotice("");
    try { const next = await action(); if (live.current) { setPassport(next); if (reset) setForm(passportForm(next)); setNotice(success); } }
    catch (cause) { if (live.current) setError(message(cause)); }
    finally { if (live.current) setBusy(false); }
  }
  async function upload(kind: string) {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) { setError("Allow photo access to upload a document image."); return; }
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
      if (picked.canceled || !picked.assets[0] || !live.current) return;
      const asset = picked.assets[0];
      await run(async () => {
        const file = await uploadImage(asset, "property_document");
        if (!file.is_usable) throw new Error(file.rejection_reason || file.status_message || "This upload is still being checked. Try again shortly.");
        return addPassportDocument(organization.id, file.id, kind);
      }, "Document attached.");
    } catch (cause) { if (live.current) setError(message(cause)); }
  }
  async function view(path: string) {
    try { const file = await passportDownload(path); if (live.current) await Linking.openURL(file.url); }
    catch (cause) { if (live.current) setError(message(cause)); }
  }
  if (!passport || !form) return error ? <><Notice tone="error" title={error} /><Button variant="secondary" label="Try again" onPress={() => void reload()} /></> : <Type>Loading credentials…</Type>;
  const dirty = JSON.stringify(form) !== JSON.stringify(passportForm(passport));
  const locked = busy || !passport.editable;
  const business = passport.category === "property_company" || form.registered_business;
  const documentTypes = [...DOCUMENT_TYPES, ...Array.from(new Set(passport.documents.map(document => document.evidence_type)))
    .filter(value => !DOCUMENT_TYPES.some(kind => kind.value === value))
    .map(value => ({ value, label: value.replaceAll("_", " ") || "Other document" }))];
  const set = <K extends keyof ProviderPassportForm>(key: K, value: ProviderPassportForm[K]) => setForm(current => current ? { ...current, [key]: value } : current);
  return <>
    <View style={styles.cover}>
      <View style={styles.coverTop}>
        <Type style={styles.coverLabel}>DANPA HQ</Type>
        <Ionicons name="shield-outline" size={24} color="#E9DFC5" />
      </View>
      <View style={styles.coverIdentity}>
        <Type variant="caption" style={styles.coverMuted}>Provider Passport</Type>
        <Type variant="title1" style={styles.coverName}>{passport.name}</Type>
        <Type variant="caption" style={styles.coverMuted}>{passport.category_label}</Type>
      </View>
      <View style={styles.coverFoot}>
        <View style={styles.coverStatus}>
          <Ionicons name={passport.status === "verified" ? "checkmark-circle-outline" : "time-outline"} size={16} color="#FFFFFF" />
          <Type variant="captionStrong" style={styles.coverText}>{PASSPORT_STATUS[passport.status] ?? passport.status}</Type>
        </View>
        <Type variant="caption" style={styles.coverMuted}>{passport.missing.length ? `${passport.missing.length} to complete` : "Required information complete"}</Type>
      </View>
    </View>
    {error ? <Notice tone="error" title={error} /> : null}{notice ? <Notice tone="success" title={notice} /> : null}
    {passport.decision_note ? <Notice title="Review response" body={passport.decision_note} /> : null}
    {["submitted", "under_review"].includes(passport.status) ? <Button variant="secondary" disabled={busy} label="Refresh status" onPress={() => void reload()} /> : null}
    {passport.missing.length ? <RecordPanel style={styles.requirements}><SectionHeading icon="list-outline" title="To complete" />{passport.missing.map(item => <View key={item.field} style={styles.requirement}><View style={styles.requirementDot} /><Type variant="caption" style={styles.flexText}>{item.message}</Type></View>)}</RecordPanel> : null}
    <RecordPanel style={styles.panel}><SectionHeading icon="person-outline" title="Identity & contact" />
      <View style={styles.identity}>
        {photo ? <Image source={{ uri: photo }} accessibilityLabel="Representative profile" style={styles.photo} /> : <View style={styles.avatar}><Ionicons name="person-outline" size={26} color={KOLA_DEEP} /></View>}
        <View style={styles.grow}><Type variant="bodyStrong" style={styles.ink}>{passport.identity.name || "Legal name not recorded"}</Type><Type variant="caption">Responsible representative</Type></View>
      </View>
      <CredentialRow label="Phone" value={passport.identity.phone || "Not recorded"} verified={passport.identity.phone_verified} />
      <CredentialRow label="Email" value={passport.identity.email || "Not recorded"} verified={passport.identity.email_verified} />
      <CredentialRow label="Identity document" value={passport.identity.identity_verified ? "Reviewed by Danpa HQ" : "Not verified"} verified={passport.identity.identity_verified} />
      <Type variant="caption" style={styles.note}>Document review only; no electronic Ghana Card or biometric verification.</Type>
      {state.status === "signed_in" && state.me.id === passport.identity.id ? <View style={styles.actions}><Button variant="quiet" label="Edit profile" onPress={() => router.push("/(app)/profile-edit" as never)} /><Button variant="quiet" label="Identity checks" onPress={() => router.push("/(app)/trust" as never)} /></View> : <Type variant="caption">The representative completes their own profile and identity checks.</Type>}
    </RecordPanel>
    <RecordPanel style={styles.panel}><SectionHeading icon="business-outline" title="Provider credentials" />
      <Select label="Responsible representative" value={form.representative_id} disabled={locked} options={passport.representatives.map(person => ({ value: person.id, label: person.name }))} onChange={value => set("representative_id", value)} />
      <Field label="Representative's role" maxLength={100} value={form.representative_role} editable={!locked} onChangeText={value => set("representative_role", value)} />
      {passport.category !== "property_company" ? <Select label="Registered business" value={form.registered_business ? "yes" : "no"} disabled={locked} options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes" }]} onChange={value => set("registered_business", value === "yes")} /> : null}
      {business ? <Field label="Business registration number" value={form.registration_number} maxLength={100} editable={!locked} onChangeText={value => set("registration_number", value)} /> : null}
      <Field label="Organization email" value={form.contact_email} keyboardType="email-address" autoCapitalize="none" editable={!locked} onChangeText={value => set("contact_email", value)} />
      <Field label="Organization phone" value={form.contact_phone} maxLength={32} keyboardType="phone-pad" editable={!locked} onChangeText={value => set("contact_phone", value)} />
      <Button variant="secondary" label="Save credentials" disabled={!dirty || locked} busy={busy} onPress={() => void run(() => saveProviderPassport(organization.id, form), "Credentials saved. Submit for review when ready.", true)} />
    </RecordPanel>
    <RecordPanel style={styles.panel}><SectionHeading icon="folder-outline" title="Supporting documents" /><Type variant="caption" style={styles.note}>Private images for credential review. Property authority is checked separately.</Type>
      {documentTypes.map(kind => <View style={styles.uploadGroup} key={kind.value}>
        <View style={styles.grow}><Type variant="bodyStrong" style={styles.ink}>{kind.label}</Type><Type variant="caption">{kind.value === "business_certificate" && business ? "Required" : "Optional"}</Type></View>
        {passport.documents.filter(document => document.evidence_type === kind.value).map(document => <View style={styles.attachment} key={document.id}><View style={styles.attachmentName}><Ionicons name="document-text-outline" size={18} color={KOLA} /><Type variant="caption" style={styles.flexText}>{document.filename}</Type></View><View style={styles.actions}><Button variant="quiet" label="View" onPress={() => void view(document.download_path)} /><Button variant="quiet" label="Remove" disabled={locked} onPress={() => Alert.alert("Remove document?", "Previous review evidence is retained. A verified Passport will need review again.", [{ text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => void run(() => removePassportDocument(organization.id, document.id), "Document removed.") }])} /></View></View>)}
        {DOCUMENT_TYPES.some(type => type.value === kind.value) ? <Button variant="secondary" label="Upload photo" disabled={locked} onPress={() => void upload(kind.value)} /> : null}
      </View>)}
    </RecordPanel>
    <RecordPanel style={styles.panel}><SectionHeading icon="send-outline" title="Submit credentials" />
      <Type variant="caption" style={styles.note}>Verified credentials may appear on listings. Documents and contact details stay private. Changes to verified credentials require a new review.</Type>
      <Button label={passport.status === "needs_more_info" || passport.status === "rejected" ? "Resubmit for review" : "Submit for review"} disabled={locked || dirty || Boolean(passport.missing.length) || passport.status === "verified"} busy={busy} onPress={() => void run(() => submitProviderPassport(organization.id), "Passport submitted for review.")} />
    </RecordPanel>
    <RecordPanel style={styles.panel}><SectionHeading icon="home-outline" title="Linked properties" /><Type variant="caption" style={styles.note}>Property verification is separate from your Passport.</Type>
      {!passport.properties.length ? <Type variant="caption">No linked properties.</Type> : passport.properties.map(property => <View style={styles.document} key={property.id}><Type variant="bodyStrong" style={styles.ink}>{property.name}</Type><Type variant="caption" style={styles.relationship}>{property.relationship.replaceAll("_", " ")}</Type><View style={styles.badges}><StatusPill label={property.authority_verified ? "Authority verified" : "Authority not verified"} tone={property.authority_verified ? "good" : "quiet"} /><StatusPill label={property.property_verified ? "Property verified" : "Property not verified"} tone={property.property_verified ? "good" : "quiet"} /></View><View style={styles.actions}><Button variant="quiet" label="View property" onPress={() => router.push({ pathname: "/(app)/provider-property", params: { propertyId: property.id } } as never)} /></View></View>)}
    </RecordPanel>
    <RecordPanel style={styles.panel}><SectionHeading icon="bar-chart-outline" title="Rental activity" /><View style={styles.metrics}>{[{ label: "Completed tenancies", value: passport.activity.completed_tenancies }, { label: "Active tenancies", value: passport.activity.active_tenancies }, { label: "Repairs completed", value: passport.activity.completed_maintenance }].map(item => <View key={item.label} style={styles.metric}><Type variant="title1" style={styles.metricValue}>{item.value}</Type><Type variant="caption" style={styles.metricLabel}>{item.label}</Type></View>)}</View><Type variant="caption" style={styles.note}>Current property relationships only. These records are not a reputation score.</Type>{passport.activity.not_recorded.length ? <View style={styles.document}><Type variant="captionStrong">Not recorded</Type>{passport.activity.not_recorded.map(item => <Type variant="caption" key={item}>{item}</Type>)}</View> : null}</RecordPanel>
    {passport.history.length ? <RecordPanel style={styles.panel}><SectionHeading icon="time-outline" title="Review history" />{passport.history.map(review => <View style={styles.document} key={review.id}><View style={styles.historyHead}><StatusPill label={PASSPORT_STATUS[review.status] ?? review.status.replaceAll("_", " ")} tone={review.status === "verified" ? "good" : "quiet"} /><Type variant="caption">{new Date(review.submitted_at).toLocaleDateString()}</Type></View>{review.decision_note ? <Type variant="caption">{review.decision_note}</Type> : null}</View>)}</RecordPanel> : null}
  </>;
}

function SectionHeading({ icon, title }: { icon: keyof typeof Ionicons.glyphMap; title: string }) {
  return <View style={styles.sectionHeading}><Ionicons name={icon} size={19} color={KOLA} /><Type variant="bodyStrong" accessibilityRole="header" style={styles.sectionTitle}>{title}</Type></View>;
}

function StatusPill({ label, tone }: { label: string; tone: RecordTone }) {
  return <View style={[styles.pill, { backgroundColor: TONE[tone].wash }]}><Type variant="captionStrong" style={[styles.pillText, { color: TONE[tone].ink }]}>{label}</Type></View>;
}

function CredentialRow({ label, value, verified }: { label: string; value: string; verified: boolean }) {
  return <View style={styles.checkRow}><View style={styles.grow}><Type variant="caption" style={styles.checkLabel}>{label}</Type><Type variant="captionStrong" style={styles.ink}>{value}</Type></View><StatusPill label={verified ? "Verified" : "Not verified"} tone={verified ? "good" : "quiet"} /></View>;
}

const styles = StyleSheet.create({
  page: { padding: space[4], gap: 16 },
  panel: { padding: 20, gap: 16, borderRadius: 18 },
  cover: { backgroundColor: KOLA_DEEP, padding: 24, gap: 26, borderRadius: 20, borderWidth: 1, borderColor: EDGE },
  coverTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  coverLabel: { color: "#E9DFC5", letterSpacing: 2.2, fontSize: 11, fontWeight: "600" },
  coverIdentity: { gap: 6 },
  coverName: { color: "#FFFFFF", fontSize: 26, lineHeight: 32, letterSpacing: -.5 },
  coverMuted: { color: "#D5E4DB" },
  coverText: { color: "#FFFFFF", flexShrink: 1 },
  coverFoot: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#729987", paddingTop: 16, gap: 10 },
  coverStatus: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 7 },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: 9 },
  sectionTitle: { color: INK, fontSize: 16, lineHeight: 22, flex: 1 },
  ink: { color: INK },
  note: { color: MUTED, fontSize: 12, lineHeight: 18 },
  requirements: { padding: 18, gap: 12, borderRadius: 18, backgroundColor: theme.color.harmattan["100"] },
  requirement: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  requirementDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: MUTED, marginTop: 8 },
  flexText: { flex: 1, minWidth: 0 },
  identity: { flexDirection: "row", alignItems: "center", gap: 14 },
  photo: { width: 56, height: 56, borderRadius: 16 },
  avatar: { width: 56, height: 56, borderRadius: 16, backgroundColor: theme.color.kola["50"], alignItems: "center", justifyContent: "center" },
  grow: { flex: 1, minWidth: 0, gap: 4 },
  checkRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: EDGE, paddingTop: 12 },
  checkLabel: { fontSize: 11, lineHeight: 16 },
  pill: { alignSelf: "flex-start", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, maxWidth: "100%" },
  pillText: { fontSize: 11, lineHeight: 16 },
  uploadGroup: { padding: 14, borderWidth: 1, borderColor: EDGE, borderRadius: 12, gap: 12 },
  attachment: { gap: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: EDGE, paddingTop: 12 },
  attachmentName: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  document: { gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: EDGE, paddingTop: 16 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  relationship: { textTransform: "capitalize" },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metric: { flex: 1, minWidth: 76, paddingVertical: 14, paddingHorizontal: 8, backgroundColor: theme.color.field["50"], borderRadius: 10, gap: 6 },
  metricValue: { color: KOLA_DEEP, fontSize: 25, lineHeight: 30 },
  metricLabel: { color: MUTED, fontSize: 11, lineHeight: 16 },
  historyHead: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
});
