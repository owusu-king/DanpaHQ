"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { Check } from "@/components/Check";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { Select } from "@/components/Select";
import { Icon } from "@/components/portal/icons";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { PanelSkeleton, WorkspaceHead } from "@/components/workspace/Workspace";
import { listOrganizations, uploadFile, type Organization } from "@/lib/console";
import { useSession } from "@/lib/session";
import { DOCUMENT_TYPES, PASSPORT_STATUS, addPassportDocument, getProviderPassport, passportDownload, passportForm, passportPath, removePassportDocument, saveProviderPassport, submitProviderPassport, type ProviderPassport, type ProviderPassportForm } from "@/lib/providerPassport";
import "@/styles/passport.css";
import "@/styles/provider-passport.css";

const message = (error: unknown) => error instanceof Error ? error.message : "The Passport could not be updated. Try again.";

export default function ProviderPassportPage() {
  const { state, activeContext } = useSession();
  const [organizations, setOrganizations] = useState<Organization[] | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (state.status !== "signed_in") return;
    let live = true;
    void listOrganizations().then(rows => { if (live) { setOrganizations(rows.filter(row => ["owner", "admin"].includes(row.current_user_role ?? ""))); setError(""); } }).catch(cause => { if (live) setError(message(cause)); });
    return () => { live = false; };
  }, [state.status, retry]);
  const id = activeContext?.replace(/^organization:/, "");
  const organization = organizations?.find(row => row.id === (selected || id)) ?? organizations?.[0];
  return <div className="ws-page provider-passport">
    <WorkspaceHead icon="passport" title="Provider Passport" />
    {error ? <><Notice tone="error" title={error} /><Button variant="secondary" onClick={() => setRetry(value => value + 1)}>Try again</Button></> : null}
    {!organizations && !error ? <PanelSkeleton rows={4} /> : null}
    {organizations && !organization ? <Notice title="No Passport to manage" body="Available to approved Portfolio owners and administrators." /> : null}
    {organizations && organizations.length > 1 ? <div className="pp-portfolio"><Select label="Portfolio" value={organization?.id ?? ""} onChange={setSelected} options={organizations.map(row => [row.id, row.name] as const)} /></div> : null}
    {organization ? <PassportEditor key={organization.id} organization={organization} /> : null}
  </div>;
}

function PassportEditor({ organization }: { organization: Organization }) {
  const { state } = useSession();
  const [passport, setPassport] = useState<ProviderPassport | null>(null);
  const [form, setForm] = useState<ProviderPassportForm | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [removing, setRemoving] = useState<string | null>(null);
  const [photoRecord, setPhotoRecord] = useState<{ id: string; url: string } | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    let current = true;
    void getProviderPassport(organization.id).then(next => { if (current && live.current) { setPassport(next); setForm(passportForm(next)); setError(""); } }).catch(cause => { if (current && live.current) setError(message(cause)); });
    return () => { current = false; live.current = false; };
  }, [organization.id, retry]);
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
    try { const next = await action(); if (live.current) { setPassport(next); if (reset) setForm(passportForm(next)); setNotice(success); setRemoving(null); } }
    catch (cause) { if (live.current) setError(message(cause)); }
    finally { if (live.current) setBusy(false); }
  }
  async function view(path: string) {
    try { const file = await passportDownload(path); if (live.current) window.open(file.url, "_blank", "noopener,noreferrer"); }
    catch (cause) { if (live.current) setError(message(cause)); }
  }
  if (!passport || !form) return <>{error ? <><Notice tone="error" title={error} /><Button variant="secondary" onClick={() => setRetry(value => value + 1)}>Try again</Button></> : <PanelSkeleton rows={5} />}</>;
  const dirty = JSON.stringify(form) !== JSON.stringify(passportForm(passport));
  const locked = busy || !passport.editable;
  const business = passport.category === "property_company" || form.registered_business;
  const set = <K extends keyof ProviderPassportForm>(key: K, value: ProviderPassportForm[K]) => setForm(current => current ? { ...current, [key]: value } : current);
  const self = state.status === "signed_in" && state.me.id === passport.identity.id;
  const reviewing = ["submitted", "under_review"].includes(passport.status);
  const verified = passport.status === "verified";
  const submitLabel = verified && !dirty ? "Verified" : ["needs_more_info", "rejected"].includes(passport.status) ? "Resubmit for review" : "Submit for review";
  const submissionHint = dirty ? "Save your changes before submitting." : verified ? "Changes to credentials require a new review." : "";
  const requirement = (field: string, fallback: string) => {
    const personal: Record<string, [string, string]> = {
      legal_name: ["Complete legal name", "/settings"],
      phone: ["Verify phone number", "/settings/verification"],
      email: ["Verify email address", "/settings"],
      identity: ["Complete identity review", "/settings/verification/identity"],
      photo: ["Add profile photo", "/settings"],
    };
    if (personal[field]) return { label: personal[field][0], href: self ? personal[field][1] : "#passport-identity" };
    const labels: Record<string, string> = { representative: "Choose a representative", representative_role: "Add representative role", contact_email: "Add business email", contact_phone: "Add business phone", registration_number: "Add registration number", business_certificate: "Upload business registration", documents: "Replace unavailable documents", provider_account: "Complete provider account approval" };
    return { label: labels[field] ?? fallback, href: ["business_certificate", "documents"].includes(field) ? "#passport-documents" : field === "provider_account" ? "/provider" : "#passport-credentials" };
  };
  return <>
    {error ? <Notice tone="error" title={error} /> : null}
    {notice ? <Notice tone="success" title={notice} /> : null}
    {passport.decision_note ? <Notice title="Review response" body={passport.decision_note} /> : null}

    <div className="pp-overview">
      <section className="passport-cover pp-cover" aria-label="Provider Passport overview">
        <div className="pp-cover-top"><span className="passport-wordmark"><Icon name="passport" />DANPA HQ</span><span className="pp-cover-label">PROVIDER PASSPORT</span></div>
        <div className="pp-cover-holder"><h2>{passport.name}</h2><p>{passport.category_label}</p></div>
        <div className="pp-cover-bottom"><span className="pp-cover-status" data-status={passport.status}><Icon name={verified ? "check" : reviewing ? "clock" : "info"} />{PASSPORT_STATUS[passport.status] ?? humanize(passport.status)}</span><span><Icon name="lock" />Private record</span></div>
      </section>
      <section className="pp-readiness" aria-labelledby="passport-next-title">
        <header><h2 id="passport-next-title">{passport.missing.length ? "Finish your Passport" : reviewing ? "Review in progress" : verified ? "Your credentials are verified" : "Ready for review"}</h2>{passport.missing.length ? <span className="pp-count">{passport.missing.length} remaining</span> : <Icon name={verified ? "check" : reviewing ? "clock" : "passport"} />}</header>
        {passport.missing.length ? <ul>{passport.missing.map(item => {
          const step = requirement(item.field, item.message);
          return <li key={item.field}><Link href={step.href as never} title={item.message}><span className="pp-step-dot" /><span>{step.label}</span><span aria-hidden="true">↗</span></Link></li>;
        })}</ul> : null}
        {reviewing ? <Button variant="secondary" size="sm" disabled={busy} onClick={() => setRetry(value => value + 1)}>Refresh status</Button> : null}
      </section>
    </div>

    <div className="pp-layout">
      <div className="pp-main">
        <div className="pp-paper">
          <section className="pp-section" id="passport-credentials" aria-labelledby="passport-credentials-title">
            <header className="pp-section-head"><span className="pp-section-number">01</span><div><h2 id="passport-credentials-title">Provider credentials</h2><p>{passport.category_label}</p></div>{!passport.editable ? <span className="pp-private"><Icon name="lock" />In review</span> : null}</header>
            <form className="pp-form" onSubmit={event => { event.preventDefault(); void run(() => saveProviderPassport(organization.id, form), "", true); }}>
              <Select label="Responsible representative" value={form.representative_id} disabled={locked} onChange={value => set("representative_id", value)} options={passport.representatives.map(person => [person.id, person.name] as const)} />
              <Field label="Representative’s role" maxLength={100} value={form.representative_role} disabled={locked} onChange={event => set("representative_role", event.target.value)} />
              {passport.category !== "property_company" ? <div className="pp-form-full"><Check label="Registered business" checked={form.registered_business} disabled={locked} onChange={value => set("registered_business", value)} /></div> : null}
              {business ? <div className="pp-form-full"><Field label="Business registration number" maxLength={100} value={form.registration_number} disabled={locked} onChange={event => set("registration_number", event.target.value)} /></div> : null}
              <Field label="Business email" type="email" value={form.contact_email} disabled={locked} onChange={event => set("contact_email", event.target.value)} />
              <Field label="Business phone" type="tel" maxLength={32} value={form.contact_phone} disabled={locked} onChange={event => set("contact_phone", event.target.value)} />
              <div className="pp-form-save"><span aria-live="polite">{dirty ? "Unsaved changes" : ""}</span><Button type="submit" variant="secondary" size="sm" disabled={!dirty || locked} busy={busy}>Save changes</Button></div>
            </form>
          </section>
          <section className="pp-section" id="passport-documents" aria-labelledby="passport-documents-title">
            <header className="pp-section-head"><span className="pp-section-number">02</span><div><h2 id="passport-documents-title">Supporting documents</h2><p>PDF, JPG or PNG</p></div><span className="pp-private"><Icon name="lock" />Private</span></header>
            <div className="pp-documents">{DOCUMENT_TYPES.map(kind => {
              const documents = passport.documents.filter(document => document.evidence_type === kind.value);
              const required = kind.value === "business_certificate" && business;
              return <div className="pp-document-group" key={kind.value}>
                <div className="pp-document-head"><span className="pp-document-icon"><Icon name="leases" /></span><div><h3>{kind.label}</h3><span className="pp-document-meta">{required ? "Required" : "Optional"}{documents.length ? ` · ${documents.length} attached` : ""}</span></div>
                  <label className="btn btn-secondary btn-sm pp-upload"><Icon name="upload" />{documents.length ? "Add file" : "Upload"}<input type="file" aria-label={`Upload ${kind.label}`} accept="application/pdf,image/jpeg,image/png" disabled={locked} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void run(async () => { const stored = await uploadFile(file, "property_document"); if (!stored.is_usable) throw new Error(stored.rejection_reason || stored.status_message || "This upload is still being checked. Try again shortly."); return addPassportDocument(organization.id, stored.id, kind.value); }, ""); }} /></label>
                </div>
                {documents.map(document => <div className="pp-file" key={document.id}><span>{document.filename}</span><div><Button variant="quiet" size="sm" onClick={() => void view(document.download_path)}>View</Button><Button variant="quiet" size="sm" aria-label={`Remove ${document.filename}`} disabled={locked} onClick={() => setRemoving(document.id)}><Icon name="trash" /></Button></div></div>)}
              </div>;
            })}</div>
          </section>
          <div className="pp-submit"><div>{submissionHint ? <p>{submissionHint}</p> : null}<small>Verified credentials may appear on listings. Documents stay private.</small></div><Button disabled={locked || dirty || Boolean(passport.missing.length) || verified} busy={busy} onClick={() => void run(() => submitProviderPassport(organization.id), "Passport submitted for review.")}>{submitLabel}</Button></div>
        </div>
      </div>

      <aside className="pp-side" aria-label="Identity and activity">
        <section className="pp-paper pp-section" id="passport-identity" aria-labelledby="passport-identity-title">
          <header className="pp-side-head"><h2 id="passport-identity-title">Identity & contact</h2><Icon name="shield" /></header>
          <div className="pp-person">{photo ? <Image unoptimized width={52} height={52} className="pp-photo" src={photo} alt="Representative profile" referrerPolicy="no-referrer" /> : <span className="pp-photo pp-photo-empty"><Icon name="account" /></span>}<div><h3>{passport.identity.name || "Name not recorded"}</h3><p>Responsible representative</p></div></div>
          <dl className="pp-identity-list">
            <div><dt>Phone</dt><dd><span>{passport.identity.phone || "Not added"}</span><CheckState verified={passport.identity.phone_verified} /></dd></div>
            <div><dt>Email</dt><dd><span>{passport.identity.email || "Not added"}</span><CheckState verified={passport.identity.email_verified} /></dd></div>
            <div><dt>Identity document</dt><dd><CheckState verified={passport.identity.identity_verified} checkedLabel="Reviewed" /></dd></div>
            <div><dt>Profile photo</dt><dd><CheckState verified={passport.identity.photo_on_record} checkedLabel="On record" uncheckedLabel="Not added" /></dd></div>
          </dl>
          {self ? <div className="pp-account-links"><Link href="/settings"><Icon name="pencil" />Edit profile</Link><Link href="/settings/verification">Verification<span aria-hidden="true">↗</span></Link></div> : <p className="pp-note">Your representative completes their own identity checks.</p>}
          <details className="pp-disclosure"><summary>About these checks<Icon name="chevron-down" /></summary><p>Manual document review. Biometric and electronic Ghana Card checks are not available.</p></details>
        </section>
        <section className="pp-paper pp-section" aria-labelledby="passport-activity-title">
          <header className="pp-side-head"><h2 id="passport-activity-title">Rental activity</h2><Icon name="reports" /></header>
          <dl className="pp-activity"><div><dt>Completed tenancies</dt><dd>{passport.activity.completed_tenancies}</dd></div><div><dt>Active tenancies</dt><dd>{passport.activity.active_tenancies}</dd></div><div><dt>Completed maintenance</dt><dd>{passport.activity.completed_maintenance}</dd></div></dl>
          <details className="pp-disclosure"><summary>About this record<Icon name="chevron-down" /></summary><p>Activity during current property relationships. No reputation score is calculated.</p><p>Not recorded:</p><ul>{passport.activity.not_recorded.map(item => <li key={item}>{item}</li>)}</ul></details>
        </section>
      </aside>
    </div>

    <section className="pp-paper pp-properties" aria-labelledby="passport-properties-title">
      <header className="pp-records-head"><div><h2 id="passport-properties-title">Property authority</h2><p>Each property is verified separately.</p></div><span className="pp-count">{passport.properties.length} {passport.properties.length === 1 ? "property" : "properties"}</span></header>
      {!passport.properties.length ? <p className="pp-empty">No linked properties.</p> : <div className="pp-property-list">{passport.properties.map(property => <Link className="pp-property" key={property.id} href={`/record/property?id=${property.id}`}><span className="pp-property-name"><strong>{property.name}</strong><small>{({ owner: "Owner", manager: "Property manager", listing_agent: "Listing agent" } as Record<string, string>)[property.relationship] ?? humanize(property.relationship)}</small></span><span className="pp-property-checks"><span data-verified={property.authority_verified}><Icon name={property.authority_verified ? "check" : "info"} />Authority {property.authority_verified ? "verified" : "not verified"}</span><span data-verified={property.property_verified}><Icon name={property.property_verified ? "check" : "info"} />Property {property.property_verified ? "verified" : "not verified"}</span></span><span className="pp-property-open" aria-hidden="true">↗</span></Link>)}</div>}
    </section>
    {passport.history.length ? <details className="pp-paper pp-history"><summary><span>Recent review history<span className="pp-count">{passport.history.length}</span></span><Icon name="chevron-down" /></summary><ol>{passport.history.map(review => <li key={review.id}><div><span className="pp-history-status">{PASSPORT_STATUS[review.status] ?? humanize(review.status)}</span><time dateTime={review.submitted_at}>Submitted {new Date(review.submitted_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</time></div>{review.decision_note ? <p>{review.decision_note}</p> : null}</li>)}</ol></details> : null}
    <ModalSheet open={Boolean(removing)} onClose={() => { if (!busy) setRemoving(null); }} title="Remove document?" icon="passport" size="sm"><p>Previous review evidence is retained. A verified Passport will need review again.</p><div className="compact-form-actions"><Button variant="quiet" disabled={busy} onClick={() => setRemoving(null)}>Cancel</Button><Button busy={busy} onClick={() => { if (removing) void run(() => removePassportDocument(organization.id, removing), ""); }}>Remove document</Button></div></ModalSheet>
  </>;
}

function CheckState({ verified, checkedLabel = "Verified", uncheckedLabel = "Not verified" }: { verified: boolean; checkedLabel?: string; uncheckedLabel?: string }) {
  return <span className="pp-check" data-verified={verified}><Icon name={verified ? "check" : "info"} />{verified ? checkedLabel : uncheckedLabel}</span>;
}

function humanize(value: string) {
  const words = value.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
