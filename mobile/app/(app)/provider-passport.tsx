import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Image, Linking, ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "@/auth";
import { Select } from "@/components/form/Select";
import { RecordPanel, KOLA, EDGE } from "@/components/record/RecordSurfaces";
import { Button, Field, Notice, Type, space } from "@/components/ui";
import { listOrganizations, type Organization } from "@/organizations";
import { uploadImage } from "@/provider";
import { DOCUMENT_TYPES, PASSPORT_STATUS, addPassportDocument, getProviderPassport, passportDownload, passportForm, passportPath, removePassportDocument, saveProviderPassport, submitProviderPassport, type ProviderPassport, type ProviderPassportForm } from "@/providerPassport";
import { useSafeBottom } from "@/platform";

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
  return <ScrollView contentContainerStyle={[styles.page, { paddingBottom: bottom }]}>
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
  const set = <K extends keyof ProviderPassportForm>(key: K, value: ProviderPassportForm[K]) => setForm(current => current ? { ...current, [key]: value } : current);
  return <>
    <View style={styles.cover}><Type style={styles.coverLabel}>DANPA HQ · PROVIDER PASSPORT</Type><Type variant="title1" style={styles.coverText}>{passport.name}</Type><Type style={styles.coverText}>{passport.category_label}</Type><Type variant="captionStrong" style={styles.coverText}>{PASSPORT_STATUS[passport.status] ?? passport.status}</Type><Type variant="caption" style={styles.coverText}>{passport.missing.length ? `${passport.missing.length} requirements outstanding` : "Required information complete"}</Type></View>
    {error ? <Notice tone="error" title={error} /> : null}{notice ? <Notice tone="success" title={notice} /> : null}
    {passport.decision_note ? <Notice title="Review response" body={passport.decision_note} /> : null}
    {["submitted", "under_review"].includes(passport.status) ? <Button variant="secondary" disabled={busy} label="Refresh status" onPress={() => void reload()} /> : null}
    {passport.missing.length ? <RecordPanel><Type variant="title2">To complete</Type>{passport.missing.map(item => <Type key={item.field} variant="caption">• {item.message}</Type>)}</RecordPanel> : null}
    <RecordPanel><Type variant="title2">Identity & contact</Type>
      {photo ? <Image source={{ uri: photo }} accessibilityLabel="Representative profile" style={styles.photo} /> : null}
      <Type variant="bodyStrong">{passport.identity.name || "Legal name not recorded"}</Type>
      <Type>{passport.identity.phone || "No phone"} · {passport.identity.phone_verified ? "Verified" : "Not verified"}</Type>
      <Type>{passport.identity.email || "No email"} · {passport.identity.email_verified ? "Verified" : "Not verified"}</Type>
      <Type>Identity document · {passport.identity.identity_verified ? "Reviewed by Danpa HQ" : "Not verified"}</Type>
      <Type variant="caption">Identity review does not include electronic Ghana Card or biometric verification.</Type>
      {state.status === "signed_in" && state.me.id === passport.identity.id ? <><Button variant="quiet" label="Edit profile" onPress={() => router.push("/(app)/profile-edit" as never)} /><Button variant="quiet" label="Identity & contact checks" onPress={() => router.push("/(app)/trust" as never)} /></> : <Type variant="caption">The representative completes their own profile and identity checks.</Type>}
    </RecordPanel>
    <RecordPanel><Type variant="title2">Provider credentials</Type>
      <Select label="Responsible representative" value={form.representative_id} disabled={locked} options={passport.representatives.map(person => ({ value: person.id, label: person.name }))} onChange={value => set("representative_id", value)} />
      <Field label="Representative's role" maxLength={100} value={form.representative_role} editable={!locked} onChangeText={value => set("representative_role", value)} />
      {passport.category !== "property_company" ? <Select label="Registered business" value={form.registered_business ? "yes" : "no"} disabled={locked} options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes" }]} onChange={value => set("registered_business", value === "yes")} /> : null}
      {business ? <Field label="Business registration number" value={form.registration_number} maxLength={100} editable={!locked} onChangeText={value => set("registration_number", value)} /> : null}
      <Field label="Organization email" value={form.contact_email} keyboardType="email-address" autoCapitalize="none" editable={!locked} onChangeText={value => set("contact_email", value)} />
      <Field label="Organization phone" value={form.contact_phone} maxLength={32} keyboardType="phone-pad" editable={!locked} onChangeText={value => set("contact_phone", value)} />
      <Button variant="secondary" label="Save credentials" disabled={!dirty || locked} busy={busy} onPress={() => void run(() => saveProviderPassport(organization.id, form), "Credentials saved. Submit for review when ready.", true)} />
    </RecordPanel>
    <RecordPanel><Type variant="title2">Supporting documents</Type><Type variant="caption">Private document images. Representative authorization covers the business role; property authority is reviewed separately.</Type>
      {DOCUMENT_TYPES.map(kind => <View style={styles.row} key={kind.value}><View style={styles.grow}><Type variant="bodyStrong">{kind.label}</Type><Type variant="caption">{kind.value === "business_certificate" && business ? "Required" : "Optional"}</Type></View><Button variant="secondary" label="Upload photo" disabled={locked} onPress={() => void upload(kind.value)} /></View>)}
      {passport.documents.map(document => <View style={styles.document} key={document.id}><Type>{document.filename}</Type><View style={styles.actions}><Button variant="quiet" label="View" onPress={() => void view(document.download_path)} /><Button variant="quiet" label="Remove" disabled={locked} onPress={() => Alert.alert("Remove document?", "Previous review evidence is retained. A verified Passport will need review again.", [{ text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => void run(() => removePassportDocument(organization.id, document.id), "Document removed.") }])} /></View></View>)}
      <Type variant="caption">Verified credentials may appear on public listings. Documents and contact information stay private. Editing verified credentials requires a new review.</Type>
      <Button label={passport.status === "needs_more_info" || passport.status === "rejected" ? "Resubmit for review" : "Submit for review"} disabled={locked || dirty || Boolean(passport.missing.length) || passport.status === "verified"} busy={busy} onPress={() => void run(() => submitProviderPassport(organization.id), "Passport submitted for review.")} />
    </RecordPanel>
    <RecordPanel><Type variant="title2">Property ownership & management</Type><Type variant="caption">A verified Passport does not verify any property.</Type>
      {!passport.properties.length ? <Type>No linked properties.</Type> : passport.properties.map(property => <View style={styles.document} key={property.id}><Type variant="bodyStrong">{property.name}</Type><Type variant="caption">{property.relationship.replaceAll("_", " ")} · {property.authority_verified ? "Authority verified" : "Authority not verified"} · {property.property_verified ? "Property verified" : "Property not verified"}</Type><Button variant="quiet" label="View property" onPress={() => router.push({ pathname: "/(app)/provider-property", params: { propertyId: property.id } } as never)} /></View>)}
    </RecordPanel>
    <RecordPanel><Type variant="title2">Rental activity</Type><Type>{passport.activity.completed_tenancies} completed tenancies</Type><Type>{passport.activity.active_tenancies} active tenancies</Type><Type>{passport.activity.completed_maintenance} completed maintenance records</Type><Type variant="caption">Recorded during current property relationships. No reputation score is calculated.</Type><Type variant="captionStrong">Not recorded</Type>{passport.activity.not_recorded.map(item => <Type variant="caption" key={item}>{item}</Type>)}</RecordPanel>
    {passport.history.length ? <RecordPanel><Type variant="title2">Recent review history</Type>{passport.history.map(review => <View style={styles.document} key={review.id}><Type variant="bodyStrong">{review.status.replaceAll("_", " ")} · {new Date(review.submitted_at).toLocaleDateString()}</Type>{review.decision_note ? <Type variant="caption">{review.decision_note}</Type> : null}</View>)}</RecordPanel> : null}
  </>;
}

const styles = StyleSheet.create({
  page: { padding: space[4], gap: space[4] },
  cover: { backgroundColor: KOLA, padding: space[5], gap: space[3], borderRadius: 18, borderWidth: 1, borderColor: EDGE },
  coverLabel: { color: "#EEE9DD", letterSpacing: 1.1, fontSize: 10 },
  coverText: { color: "#FFFFFF" },
  photo: { width: 72, height: 72, borderRadius: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[3], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: EDGE, paddingVertical: space[3] },
  grow: { flexGrow: 1, flexShrink: 1, gap: space[1] },
  document: { gap: space[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: EDGE, paddingVertical: space[3] },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
});
