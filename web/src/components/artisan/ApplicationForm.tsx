"use client";

import { BookOpen, Car, CreditCard, FileBadge, ImagePlus, MapPin, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { ApiFailure } from "@/lib/api";
import {
  MAX_DISTRICTS,
  MAX_WORK_PHOTOS,
  MIN_WORK_PHOTOS,
  CERTIFICATE_LABEL,
  applyAsArtisan,
  updateArtisanProfile,
  type ArtisanCertificate,
  listDistricts,
  type ArtisanApplication,
  type District,
} from "@/lib/artisan";
import { uploadFile } from "@/lib/console";

/**
 * The artisan application, as one form.
 *
 * Asks for what a reviewer needs and nothing more: what they do, where, a few
 * photographs of work they have done, and — only when Danpa HQ does not already
 * hold one — a government ID. Certificates are optional for every trade.
 *
 * Re-sending after a reviewer asked for more, or after a rejection, starts from
 * what was sent last time: photographs and certificates already uploaded are
 * kept by their file, so nobody uploads the same picture twice.
 */

const ID_TYPES = [
  { value: "ghana_card_front", label: "Ghana Card", Icon: CreditCard },
  { value: "passport", label: "Passport", Icon: BookOpen },
  { value: "drivers_licence", label: "Driver's licence", Icon: Car },
] as const;

type Photo = { key: string; fileId?: string; file?: File; url: string | null };
type Certificate = {
  key: string;
  /** Where Management's check stands, for a certificate already on file. */
  status?: ArtisanCertificate["status"];
  note?: string;
  fileId?: string;
  file?: File;
  fileName: string;
  trade: string;
  issuingBody: string;
  expiresOn: string;
};

let sequence = 0;
const nextKey = () => `k${++sequence}`;

export function ApplicationForm({
  application,
  onSent,
  mode = "apply",
}: {
  application: ArtisanApplication;
  onSent: (next: ArtisanApplication) => void;
  /** `edit`: an approved artisan keeping their profile current — no ID, no new review. */
  mode?: "apply" | "edit";
}) {
  const profile = application.profile;
  const [trades, setTrades] = useState<string[]>(profile?.trades.map((trade) => trade.value) ?? []);
  const [districts, setDistricts] = useState<District[]>(
    profile?.districts.map((district) => ({ ...district, region_name: district.region })) ?? [],
  );
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [photos, setPhotos] = useState<Photo[]>(
    profile?.portfolio.map((photo) => ({ key: nextKey(), fileId: photo.file_id, url: photo.url })) ?? [],
  );
  const [idType, setIdType] = useState<string>("ghana_card_front");
  const [idFile, setIdFile] = useState<File | null>(null);
  const [certificates, setCertificates] = useState<Certificate[]>(
    profile?.certificates.map((certificate) => ({
      key: nextKey(),
      fileId: certificate.file_id,
      fileName: `${certificate.trade_label} certificate`,
      status: certificate.status,
      note: certificate.decision_note ?? "",
      trade: certificate.trade,
      issuingBody: certificate.issuing_body,
      expiresOn: certificate.expires_on ?? "",
    })) ?? [],
  );
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  // Local previews are released when their photograph is removed, and the rest
  // when the form goes away.
  const previews = useRef(new Set<string>());
  useEffect(() => {
    const held = previews.current;
    return () => held.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  function removePhoto(photo: Photo) {
    if (photo.file && photo.url) {
      URL.revokeObjectURL(photo.url);
      previews.current.delete(photo.url);
    }
    setPhotos((current) => current.filter((row) => row.key !== photo.key));
  }

  const needsId = mode === "apply" && !application.identity_on_file;
  const missing = {
    trades: trades.length === 0,
    districts: districts.length === 0,
    photos: photos.length < MIN_WORK_PHOTOS,
    id: needsId && !idFile,
    certificates: certificates.some((row) => !row.issuingBody.trim() || !row.trade),
  };
  const ready = !Object.values(missing).some(Boolean);

  function toggleTrade(value: string) {
    setTrades((current) => (current.includes(value) ? current.filter((t) => t !== value) : [...current, value]));
  }

  function addPhotos(files: FileList | null) {
    if (!files) return;
    const room = MAX_WORK_PHOTOS - photos.length;
    const added = Array.from(files)
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, Math.max(room, 0))
      .map((file) => {
        const url = URL.createObjectURL(file);
        previews.current.add(url);
        return { key: nextKey(), file, url };
      });
    setPhotos((current) => [...current, ...added]);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setAttempted(true);
    if (!ready) return;
    setError("");
    try {
      // Files go one at a time: on a metered connection a failure part-way
      // should cost one photograph, not all of them.
      const portfolio: string[] = [];
      for (const [index, photo] of photos.entries()) {
        if (photo.fileId) {
          portfolio.push(photo.fileId);
          continue;
        }
        setBusy(`Uploading photo ${index + 1} of ${photos.length}…`);
        const stored = await uploadFile(photo.file!, "artisan_work_photo");
        portfolio.push(stored.id);
      }
      const identity = [];
      if (needsId && idFile) {
        setBusy("Uploading your ID…");
        const stored = await uploadFile(idFile, "identity_document");
        identity.push({ file_id: stored.id, evidence_type: idType });
      }
      const certificateRows = [];
      for (const row of certificates) {
        let fileId = row.fileId;
        if (!fileId && row.file) {
          setBusy("Uploading your certificates…");
          fileId = (await uploadFile(row.file, "artisan_certificate")).id;
        }
        if (!fileId) continue;
        certificateRows.push({
          file_id: fileId,
          trade: row.trade,
          issuing_body: row.issuingBody.trim(),
          expires_on: row.expiresOn || null,
        });
      }
      const fields = {
        trades,
        district_ids: districts.map((district) => district.id),
        bio: bio.trim(),
        portfolio_file_ids: portfolio,
        certificates: certificateRows,
      };
      setBusy(mode === "edit" ? "Saving your profile…" : "Sending your application…");
      const next = mode === "edit"
        ? await updateArtisanProfile(fields)
        : await applyAsArtisan({ ...fields, identity_documents: identity });
      onSent(next);
    } catch (cause) {
      setError(
        cause instanceof ApiFailure
          ? cause.error.message
          : cause instanceof Error
            ? cause.message
            : "Could not send your application.",
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <form className="art-form" onSubmit={submit} noValidate>
      {error ? <Notice tone="error" title={error} /> : null}

      <section className="pv-card art-step" aria-labelledby="art-trades">
        <header className="art-step-head">
          <span className="art-step-number" aria-hidden="true">1</span>
          <div>
            <h2 id="art-trades">What you do</h2>
            <p>Pick every trade you take on.</p>
          </div>
        </header>
        <div className="art-chips" role="group" aria-label="Trades">
          {application.trade_options.map((option) => (
            <button
              key={option.value}
              type="button"
              className="art-chip"
              aria-pressed={trades.includes(option.value)}
              onClick={() => toggleTrade(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {attempted && missing.trades ? <p className="art-missing" role="alert">Choose at least one trade.</p> : null}
      </section>

      <section className="pv-card art-step" aria-labelledby="art-area">
        <header className="art-step-head">
          <span className="art-step-number" aria-hidden="true">2</span>
          <div>
            <h2 id="art-area">Where you work</h2>
            <p>Customers see the area, never your address.</p>
          </div>
        </header>
        <DistrictPicker selected={districts} onChange={setDistricts} />
        {attempted && missing.districts ? <p className="art-missing" role="alert">Choose at least one district.</p> : null}
      </section>

      <section className="pv-card art-step" aria-labelledby="art-work">
        <header className="art-step-head">
          <span className="art-step-number" aria-hidden="true">3</span>
          <div>
            <h2 id="art-work">Your work</h2>
            <p>Up to {MAX_WORK_PHOTOS} photos of finished jobs.</p>
          </div>
        </header>
        <div className="art-photos">
          {photos.map((photo, index) => (
            <figure key={photo.key} className="art-photo">
              {/* A local preview or a short-lived signed URL; next/image can do neither. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {photo.url ? <img src={photo.url} alt={`Work photo ${index + 1}`} /> : <span className="art-photo-empty" />}
              <button
                type="button"
                className="art-photo-remove"
                aria-label={`Remove work photo ${index + 1}`}
                onClick={() => removePhoto(photo)}
              >
                <X aria-hidden="true" />
              </button>
            </figure>
          ))}
          {photos.length < MAX_WORK_PHOTOS ? (
            <label className="art-photo-add">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic"
                multiple
                className="sr-only"
                onChange={(event) => {
                  addPhotos(event.target.files);
                  event.target.value = "";
                }}
              />
              <ImagePlus aria-hidden="true" />
              <span>{photos.length ? "Add more" : "Add photos"}</span>
            </label>
          ) : null}
        </div>
        {attempted && missing.photos ? <p className="art-missing" role="alert">Add at least one photo of your work.</p> : null}
        <div className="mt-field">
          <label htmlFor="art-bio">About your work <span className="art-optional">optional</span></label>
          <textarea
            id="art-bio"
            className="lw-textarea"
            rows={3}
            maxLength={600}
            value={bio}
            placeholder="Experience, the jobs you take on, anything a customer should know."
            onChange={(event) => setBio(event.target.value)}
          />
        </div>
      </section>

      {needsId ? (
        <section className="pv-card art-step" aria-labelledby="art-id">
          <header className="art-step-head">
            <span className="art-step-number" aria-hidden="true">4</span>
            <div>
              <h2 id="art-id">Your ID</h2>
              <p>Ghana Card, passport or driver&apos;s licence. Only our review team sees it.</p>
            </div>
          </header>
          <div className="pv-types" role="radiogroup" aria-label="Document type">
            {ID_TYPES.map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={idType === value}
                className="pv-type"
                onClick={() => setIdType(value)}
              >
                <Icon aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          <label className={`pv-drop${idFile ? " is-filled" : ""}`}>
            <input
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              className="sr-only"
              onChange={(event) => setIdFile(event.target.files?.[0] ?? null)}
            />
            <span className="pv-drop-icon" aria-hidden="true">{idFile ? <FileBadge /> : <ImagePlus />}</span>
            <span className="pv-drop-text">
              <strong>{idFile ? idFile.name : "Choose a photo or scan"}</strong>
              <small>{idFile ? "Click to choose a different file" : "All four corners in view · JPEG, PNG or PDF"}</small>
            </span>
          </label>
          {attempted && missing.id ? <p className="art-missing" role="alert">Add a photo of your ID.</p> : null}
        </section>
      ) : mode === "edit" ? null : (
        <Notice
          tone="success"
          title="Your ID is already on file"
          body="Nothing to upload here."
        />
      )}

      <section className="pv-card art-step" aria-labelledby="art-certificates">
        <header className="art-step-head">
          <span className="art-step-number is-optional" aria-hidden="true">+</span>
          <div>
            <h2 id="art-certificates">Certificates <span className="art-optional">optional</span></h2>
            <p>Shown as provided until we check it, then verified with the date.</p>
          </div>
        </header>
        {certificates.map((row, index) => (
          <div key={row.key} className="art-certificate">
            <div className="art-certificate-file">
              <FileBadge aria-hidden="true" />
              <span>{row.fileName}</span>
              {row.status ? (
                <span className={`art-cert-status is-${row.status}`}>{CERTIFICATE_LABEL[row.status]}</span>
              ) : null}
              <button
                type="button"
                className="art-certificate-remove"
                aria-label={`Remove certificate ${index + 1}`}
                onClick={() => setCertificates((current) => current.filter((item) => item.key !== row.key))}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            {row.status === "declined" && row.note ? (
              <p className="art-certificate-note">Not accepted: {row.note} Remove it, or add a current certificate.</p>
            ) : null}
            <div className="art-certificate-fields">
              <label className="art-select">
                <span className="type-caption field-label">Trade</span>
                <select
                  value={row.trade}
                  onChange={(event) =>
                    setCertificates((current) =>
                      current.map((item) => (item.key === row.key ? { ...item, trade: event.target.value } : item)),
                    )}
                >
                  <option value="">Choose…</option>
                  {application.trade_options.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <Field
                label="Issued by"
                value={row.issuingBody}
                placeholder="For example, Energy Commission"
                error={attempted && !row.issuingBody.trim() ? "Say who issued it." : undefined}
                onChange={(event) =>
                  setCertificates((current) =>
                    current.map((item) => (item.key === row.key ? { ...item, issuingBody: event.target.value } : item)),
                  )}
              />
              <Field
                label="Expires"
                type="date"
                hint="Leave blank if it does not expire"
                value={row.expiresOn}
                onChange={(event) =>
                  setCertificates((current) =>
                    current.map((item) => (item.key === row.key ? { ...item, expiresOn: event.target.value } : item)),
                  )}
              />
            </div>
          </div>
        ))}
        {certificates.length < 6 ? (
          <label className="art-add-certificate">
            <input
              type="file"
              accept="image/jpeg,image/png,image/heic,application/pdf"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                setCertificates((current) => [
                  ...current,
                  { key: nextKey(), file, fileName: file.name, trade: trades[0] ?? "", issuingBody: "", expiresOn: "" },
                ]);
              }}
            />
            <Plus aria-hidden="true" />
            Add a certificate
          </label>
        ) : null}
      </section>

      <div className="art-submit">
        <Button type="submit" busy={Boolean(busy)} busyLabel={busy || "Sending…"}>
          {mode === "edit" ? "Save profile" : "Send application"}
        </Button>
        {attempted && !ready ? <span className="art-missing">Some parts above still need you.</span> : null}
      </div>
    </form>
  );
}

/**
 * Districts, found by typing. All of them load once — the government's list is
 * a few hundred short rows, smaller than one of the photographs on this page.
 */
export function DistrictPicker({
  selected,
  onChange,
  max = MAX_DISTRICTS,
  label = "Add a district",
  chosenLabel = "Districts you work in",
  placeholder = "Type a district, for example Ayawaso or Kumasi",
}: {
  selected: District[];
  onChange: (next: District[]) => void;
  max?: number;
  label?: string;
  chosenLabel?: string;
  placeholder?: string;
}) {
  const [all, setAll] = useState<District[] | null>(null);
  const [query, setQuery] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    listDistricts().then(setAll).catch(() => setFailed(true));
  }, []);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!all || needle.length < 2) return [];
    const chosen = new Set(selected.map((district) => district.id));
    return all
      .filter((district) => !chosen.has(district.id))
      .filter((district) => `${district.name} ${district.region_name}`.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [all, query, selected]);

  const full = selected.length >= max;

  return (
    <div className="art-districts">
      {selected.length ? (
        <ul className="art-chosen" aria-label={chosenLabel}>
          {selected.map((district) => (
            <li key={district.id}>
              <MapPin aria-hidden="true" />
              <span>{district.name}</span>
              <button
                type="button"
                aria-label={`Remove ${district.name}`}
                onClick={() => onChange(selected.filter((row) => row.id !== district.id))}
              >
                <X aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {failed ? <Notice tone="error" title="Could not load the list of districts. Reload the page to try again." /> : null}
      {!full ? (
        <Field
          label={label}
          value={query}
          placeholder={placeholder}
          hint={max > 1 ? `Up to ${max}` : undefined}
          onChange={(event) => setQuery(event.target.value)}
        />
      ) : null}
      {matches.length ? (
        <ul className="art-matches" role="listbox" aria-label="Matching districts">
          {matches.map((district) => (
            <li key={district.id} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => {
                  onChange([...selected, district]);
                  setQuery("");
                }}
              >
                <strong>{district.name}</strong>
                <small>{district.region_name}</small>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
