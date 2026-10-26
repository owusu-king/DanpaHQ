"use client";

import { useState } from "react";

import {
  DataTable,
  Drawer,
  Empty,
  Fact,
  Facts,
  Feedback,
  FilterTabs,
  PageHeader,
  Panel,
  ResourceState,
  SearchField,
  Status,
  Toolbar,
  countMeta,
  formatDay,
  managementError,
  matches,
  useNotice,
  useQueryState,
  useResource,
} from "@/components/management/ManagementUI";
import { formatDate, managementFetch, useManagement } from "@/lib/management";

type ArtisanRow = {
  user_id: string;
  display_name: string;
  phone: string;
  status: string;
  verification_id: string | null;
  trades: string[];
  districts: string[];
  work_photos: number;
  certificates: number;
  applied_at: string;
  suspended_at: string | null;
  suspended_reason: string;
};

type CertificateRow = {
  id: string;
  user_id: string;
  artisan: string;
  trade: string;
  issuing_body: string;
  expires_on: string | null;
  status: string;
  added_at: string;
};

const FILTERS = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "needs_more_info", label: "More info asked" },
  { value: "approved", label: "Approved" },
  { value: "suspended", label: "Suspended" },
  { value: "rejected", label: "Rejected" },
] as const;

/**
 * Artisans: every application and where it stands.
 *
 * Applications are decided in the verification queue, beside provider standing,
 * so their evidence is reviewed the same way. This page is where an approved
 * artisan is suspended — new quotes and new assignments stop at once, every
 * existing record stays — and reinstated.
 */
export default function ArtisansPage() {
  const { can } = useManagement();
  const notify = useNotice();
  const [filter, setFilter] = useQueryState("status");
  const [query, setQuery] = useQueryState("q");
  const resource = useResource<ArtisanRow[]>(`/artisans/${filter ? `?status=${filter}` : ""}`);
  const [selected, setSelected] = useState<ArtisanRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function setSuspended(suspended: boolean) {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await managementFetch(`/artisans/${selected.user_id}/suspension/`, {
        method: "POST",
        body: JSON.stringify({ suspended, reason }),
      });
      notify("success", suspended ? "Artisan suspended. New quotes and assignments are blocked; existing records are unchanged." : "Artisan reinstated.");
      setSelected(null);
      setReason("");
      await resource.reload();
    } catch (cause) {
      setError(managementError(cause, "Could not update this artisan."));
    } finally {
      setBusy(false);
    }
  }

  const all = resource.data ?? [];
  const rows = all.filter((row) => matches(query, row.display_name, row.phone, row.trades.join(" "), row.districts.join(" ")));
  const certificates = useResource<CertificateRow[]>("/artisan-certificates/");
  const [declining, setDeclining] = useState<CertificateRow | null>(null);
  const [declineNote, setDeclineNote] = useState("");
  const [deciding, setDeciding] = useState("");

  async function viewCertificate(row: CertificateRow) {
    try {
      const { url } = await managementFetch<{ url: string }>(`/artisan-certificates/${row.id}/file/`);
      window.open(url, "_blank", "noopener");
    } catch (cause) {
      notify("error", managementError(cause, "Could not open this certificate."));
    }
  }

  async function decideCertificate(row: CertificateRow, verified: boolean, note = "") {
    setDeciding(row.id);
    setError("");
    try {
      await managementFetch(`/artisan-certificates/${row.id}/decision/`, {
        method: "POST",
        body: JSON.stringify({ verified, note }),
      });
      notify("success", verified ? `${row.trade} certificate verified for ${row.artisan}.` : "Certificate not accepted. The artisan has been told why.");
      setDeclining(null);
      setDeclineNote("");
      await certificates.reload();
    } catch (cause) {
      const message = managementError(cause, "Could not record this decision.");
      if (verified) notify("error", message);
      else setError(message);
    } finally {
      setDeciding("");
    }
  }

  const waiting = certificates.data ?? [];
  const suspending = selected?.status !== "suspended";

  return (
    <>
      <PageHeader
        title="Artisans"
        description="Every artisan application and where it stands. Applications are decided in the verification queue; suspend or reinstate approved artisans here."
      />
      <Panel title="Certificates to check" meta={certificates.data ? `${waiting.length} waiting` : undefined}>
        <ResourceState loading={certificates.loading} error={certificates.error} onRetry={certificates.reload} rows={2} />
        {certificates.data && waiting.length ? (
          <DataTable label="Certificates waiting to be checked">
            <thead><tr><th>Artisan</th><th>Certificate</th><th>Expires</th><th>Added</th><th className="is-end"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{waiting.map((row) => (
              <tr key={row.id}>
                <td><strong>{row.artisan}</strong></td>
                <td>{row.trade}<span className="management-subtext">{row.issuing_body}</span></td>
                <td>{row.expires_on ? formatDay(row.expires_on) : "Does not expire"}</td>
                <td className="is-date">{formatDate(row.added_at)}</td>
                <td className="is-end">
                  <div className="management-actions">
                    <button type="button" className="management-button" onClick={() => void viewCertificate(row)}>View</button>
                    {can("decide_verifications") ? (
                      <>
                        <button type="button" className="management-button primary" disabled={deciding !== ""} onClick={() => void decideCertificate(row, true)}>{deciding === row.id ? "Verifying…" : "Verify"}</button>
                        <button type="button" className="management-button danger" disabled={deciding !== ""} onClick={() => { setDeclining(row); setDeclineNote(""); setError(""); }}>Not accepted</button>
                      </>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </DataTable>
        ) : certificates.data ? (
          <Empty icon="verification" message="No certificates are waiting to be checked." />
        ) : null}
      </Panel>

      <Panel title="Applications" busy={resource.refreshing} meta={resource.data ? countMeta(rows.length, all.length, ["artisan", "artisans"]) : undefined}>
        <Toolbar>
          <SearchField label="Filter artisans" placeholder="Name, phone, trade or district" value={query} onChange={setQuery} />
          <FilterTabs label="Filter by status" value={filter} onChange={setFilter} options={FILTERS} />
        </Toolbar>
        <ResourceState loading={resource.loading} error={resource.error} onRetry={resource.reload} />
        {resource.data && rows.length ? (
          <DataTable label="Artisan applications">
            <thead><tr><th>Artisan</th><th>Trades</th><th>Area</th><th>Sent</th><th>Status</th><th>Applied</th><th className="is-end"><span className="sr-only">Action</span></th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.user_id}>
                <td><strong>{row.display_name}</strong><span className="management-subtext">{row.phone}</span></td>
                <td>{row.trades.join(", ")}</td>
                <td>{row.districts.join(", ")}</td>
                <td>{row.work_photos} photo{row.work_photos === 1 ? "" : "s"}<span className="management-subtext">{row.certificates ? `${row.certificates} certificate${row.certificates === 1 ? "" : "s"}` : "No certificates"}</span></td>
                <td><Status value={row.status} />{row.suspended_reason ? <span className="management-subtext">{row.suspended_reason}</span> : null}</td>
                <td className="is-date">{formatDate(row.applied_at)}</td>
                <td className="is-end">
                  {can("manage_users") && (row.status === "approved" || row.status === "suspended") ? (
                    <button type="button" className={`management-button${row.status === "suspended" ? "" : " danger"}`} onClick={() => { setSelected(row); setReason(""); setError(""); }}>
                      {row.status === "suspended" ? "Reinstate" : "Suspend"}
                    </button>
                  ) : (
                    <span className="management-subtext">{row.status === "pending" ? "In the verification queue" : "—"}</span>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </DataTable>
        ) : resource.data ? (
          <Empty icon="hammer" message={all.length ? "No artisans match this search." : filter ? "No applications have this status." : "No artisan applications yet."} />
        ) : null}
      </Panel>

      {declining ? (
        <Drawer
          title="Certificate not accepted"
          meta={`${declining.artisan} · ${declining.trade}`}
          onClose={() => setDeclining(null)}
          busy={deciding !== ""}
          footer={<>
            <button type="button" className="management-button danger solid" disabled={deciding !== "" || !declineNote.trim()} onClick={() => void decideCertificate(declining, false, declineNote)}>
              {deciding ? "Recording…" : "Record not accepted"}
            </button>
            <button type="button" className="management-button" disabled={deciding !== ""} onClick={() => setDeclining(null)}>Cancel</button>
          </>}
        >
          <Facts>
            <Fact label="Issued by">{declining.issuing_body || "—"}</Fact>
            <Fact label="Expires">{declining.expires_on ? formatDay(declining.expires_on) : "Does not expire"}</Fact>
          </Facts>
          <div className="management-form">
            <label>
              Reason the artisan will read
              <textarea value={declineNote} onChange={(event) => setDeclineNote(event.target.value)} placeholder="Say what was wrong and what they can send instead." disabled={deciding !== ""} />
              <small>Required.</small>
            </label>
            <Feedback error={error} />
          </div>
        </Drawer>
      ) : null}

      {selected ? (
        <Drawer
          title={`${suspending ? "Suspend" : "Reinstate"} ${selected.display_name}`}
          meta={selected.trades.join(", ")}
          onClose={() => setSelected(null)}
          busy={busy}
          footer={<>
            <button
              type="button"
              className={`management-button ${suspending ? "danger solid" : "primary"}`}
              disabled={busy || (suspending && !reason.trim())}
              onClick={() => void setSuspended(suspending)}
            >
              {busy ? "Saving…" : suspending ? "Suspend artisan" : "Reinstate artisan"}
            </button>
            <button type="button" className="management-button" disabled={busy} onClick={() => setSelected(null)}>Cancel</button>
          </>}
        >
          <Facts>
            <Fact label="Phone">{selected.phone}</Fact>
            <Fact label="Area">{selected.districts.join(", ") || "—"}</Fact>
            <Fact label="Applied">{formatDate(selected.applied_at)}</Fact>
            <Fact label="Status"><Status value={selected.status} /></Fact>
          </Facts>
          <div className="management-form">
            {suspending ? (
              <>
                <p className="management-hint">New quotes and new assignments stop at once. Every existing job, quote and payment stays as it is.</p>
                <label>
                  Reason the artisan will read
                  <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Say what happened and what they should do next." disabled={busy} />
                  <small>Required.</small>
                </label>
              </>
            ) : (
              <>
                {selected.suspended_reason ? <blockquote className="management-quote">{selected.suspended_reason}</blockquote> : null}
                <p className="management-hint">They can send quotes and take on new jobs again as soon as you confirm.</p>
              </>
            )}
            <Feedback error={error} />
          </div>
        </Drawer>
      ) : null}
    </>
  );
}
