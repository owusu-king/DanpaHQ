"use client";

import { useState } from "react";

import { DataTable, Empty, Feedback, PageHeader, Panel, ResourceState, Status, useResource } from "@/components/management/ManagementUI";
import { ManagementFailure, formatDate, managementFetch, useManagement } from "@/lib/management";

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
];

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
  const [filter, setFilter] = useState("");
  const resource = useResource<ArtisanRow[]>(`/artisans/${filter ? `?status=${filter}` : ""}`);
  const [selected, setSelected] = useState<ArtisanRow | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function setSuspended(suspended: boolean) {
    if (!selected) return;
    setError("");
    setMessage("");
    try {
      await managementFetch(`/artisans/${selected.user_id}/suspension/`, {
        method: "POST",
        body: JSON.stringify({ suspended, reason }),
      });
      setMessage(suspended ? "Artisan suspended. New quotes and assignments are blocked; existing records are unchanged." : "Artisan reinstated.");
      setSelected(null);
      setReason("");
      await resource.reload();
    } catch (cause) {
      setError(cause instanceof ManagementFailure ? cause.message : "Could not update this artisan.");
    }
  }

  const rows = resource.data ?? [];
  const certificates = useResource<CertificateRow[]>("/artisan-certificates/");
  const [declining, setDeclining] = useState<CertificateRow | null>(null);
  const [declineNote, setDeclineNote] = useState("");

  async function viewCertificate(row: CertificateRow) {
    setError("");
    try {
      const { url } = await managementFetch<{ url: string }>(`/artisan-certificates/${row.id}/file/`);
      window.open(url, "_blank", "noopener");
    } catch (cause) {
      setError(cause instanceof ManagementFailure ? cause.message : "Could not open this certificate.");
    }
  }

  async function decideCertificate(row: CertificateRow, verified: boolean, note = "") {
    setError("");
    setMessage("");
    try {
      await managementFetch(`/artisan-certificates/${row.id}/decision/`, {
        method: "POST",
        body: JSON.stringify({ verified, note }),
      });
      setMessage(verified ? `${row.trade} certificate verified for ${row.artisan}.` : "Certificate not accepted. The artisan has been told why.");
      setDeclining(null);
      setDeclineNote("");
      await certificates.reload();
    } catch (cause) {
      setError(cause instanceof ManagementFailure ? cause.message : "Could not record this decision.");
    }
  }

  return (
    <>
      <PageHeader eyebrow="Artisan network" title="Artisans" description="Every artisan application and where it stands. Decide applications in the verification queue; suspend or reinstate approved artisans here." />
      <Feedback error={error || resource.error} success={message} />
      <Panel title="Certificates to check" meta={`${certificates.data?.length ?? 0} waiting`}>
        {certificates.data?.length ? (
          <DataTable label="Certificates waiting to be checked">
            <thead><tr><th>Artisan</th><th>Certificate</th><th>Expires</th><th>Added</th><th>Action</th></tr></thead>
            <tbody>{certificates.data.map((row) => (
              <tr key={row.id}>
                <td><strong>{row.artisan}</strong></td>
                <td>{row.trade}<span className="management-subtext">{row.issuing_body}</span></td>
                <td>{row.expires_on ? formatDate(row.expires_on) : "Does not expire"}</td>
                <td>{formatDate(row.added_at)}</td>
                <td>
                  <div className="management-actions">
                    <button className="management-button" onClick={() => void viewCertificate(row)}>View</button>
                    {can("decide_verifications") ? (
                      <>
                        <button className="management-button primary" onClick={() => void decideCertificate(row, true)}>Verify</button>
                        <button className="management-button danger" onClick={() => { setDeclining(row); setDeclineNote(""); }}>Not accepted</button>
                      </>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </DataTable>
        ) : certificates.loading ? null : (
          <Empty message="No certificates are waiting to be checked." />
        )}
      </Panel>
      {declining ? (
        <Panel title={`Not accepting ${declining.artisan}'s ${declining.trade.toLowerCase()} certificate`}>
          <div className="management-form">
            <label>
              Reason the artisan will read
              <textarea value={declineNote} onChange={(event) => setDeclineNote(event.target.value)} placeholder="Say what was wrong and what they can send instead." />
            </label>
            <div className="management-form-actions">
              <button className="management-button danger" disabled={!declineNote.trim()} onClick={() => void decideCertificate(declining, false, declineNote)}>
                Record not accepted
              </button>
              <button className="management-button" onClick={() => setDeclining(null)}>Cancel</button>
            </div>
          </div>
        </Panel>
      ) : null}
      <div className="management-form-actions" role="group" aria-label="Filter by status">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`management-button${filter === option.value ? " primary" : ""}`}
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <ResourceState loading={resource.loading} error="" />
      <Panel title="Applications" meta={`${rows.length} shown`}>
        {rows.length ? (
          <DataTable label="Artisan applications">
            <thead><tr><th>Artisan</th><th>Trades</th><th>Area</th><th>Sent</th><th>Status</th><th>Applied</th><th>Action</th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.user_id}>
                <td><strong>{row.display_name}</strong><span className="management-subtext">{row.phone}</span></td>
                <td>{row.trades.join(", ")}</td>
                <td>{row.districts.join(", ")}</td>
                <td>{row.work_photos} photo{row.work_photos === 1 ? "" : "s"}<span className="management-subtext">{row.certificates ? `${row.certificates} certificate${row.certificates === 1 ? "" : "s"}` : "No certificates"}</span></td>
                <td><Status value={row.status} />{row.suspended_reason ? <span className="management-subtext">{row.suspended_reason}</span> : null}</td>
                <td>{formatDate(row.applied_at)}</td>
                <td>
                  {can("manage_users") && (row.status === "approved" || row.status === "suspended") ? (
                    <button className="management-button" onClick={() => { setSelected(row); setReason(""); }}>
                      {row.status === "suspended" ? "Reinstate" : "Suspend"}
                    </button>
                  ) : (
                    <span className="management-subtext">{row.status === "pending" ? "In the verification queue" : "—"}</span>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </DataTable>
        ) : resource.loading ? null : (
          <Empty message="No artisan applications match this filter." />
        )}
      </Panel>
      {selected ? (
        <Panel title={`${selected.status === "suspended" ? "Reinstate" : "Suspend"} ${selected.display_name}`}>
          <div className="management-form">
            {selected.status === "suspended" ? (
              <p className="management-subtext">They can send quotes and take on new jobs again as soon as you confirm.</p>
            ) : (
              <label>
                Reason the artisan will read
                <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Say what happened and what they should do next." />
              </label>
            )}
            <div className="management-form-actions">
              <button
                className={`management-button ${selected.status === "suspended" ? "primary" : "danger"}`}
                disabled={selected.status !== "suspended" && !reason.trim()}
                onClick={() => void setSuspended(selected.status !== "suspended")}
              >
                {selected.status === "suspended" ? "Reinstate artisan" : "Suspend artisan"}
              </button>
              <button className="management-button" onClick={() => setSelected(null)}>Cancel</button>
            </div>
          </div>
        </Panel>
      ) : null}
    </>
  );
}
