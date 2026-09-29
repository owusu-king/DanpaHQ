"use client";

/**
 * One conversation between a buyer and a seller about one property.
 *
 * Opening it marks it read on the server — the GET does that — so the list's
 * "New" clears without a second call. Once the property is sold the thread
 * stays readable and stops taking replies.
 */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { LoadingRows } from "@/components/portal/PageHeader";
import { EntityPath } from "@/components/property/WorkspacePatterns";
import { ApiFailure } from "@/lib/api";
import { getEnquiry, replyToEnquiry, type EnquiryDetail } from "@/lib/sales";

export default function EnquiryPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [enquiry, setEnquiry] = useState<EnquiryDetail | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      setEnquiry(await getEnquiry(params.id));
      setError("");
    } catch (cause) {
      if (cause instanceof ApiFailure && cause.status === 401) {
        router.push("/sign-in");
        return;
      }
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load this enquiry.");
    }
  }, [params.id, router]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [enquiry?.messages.length]);

  async function send() {
    const message = draft.trim();
    if (!message) return;
    setBusy(true);
    setError("");
    try {
      setEnquiry(await replyToEnquiry(params.id, message));
      setDraft("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not send.");
    } finally {
      setBusy(false);
    }
  }

  const back = enquiry?.role === "seller" ? "/enquiries?as=seller" : "/enquiries?as=buyer";

  if (!enquiry) {
    return (
      <div>
        <EntityPath items={[{ label: "Enquiries", href: "/enquiries" }, { label: error ? "Unavailable" : "Loading" }]} />
        {error ? <Notice tone="error" title={error} /> : <LoadingRows rows={4} />}
      </div>
    );
  }

  const closed = enquiry.status === "closed" || enquiry.sale.status === "sold";
  const title = enquiry.sale.headline || "Property for sale";

  return (
    <div className="enquiry-thread-page">
      <EntityPath items={[{ label: "Enquiries", href: back }, { label: title }]} />

      <header className="enquiry-thread-head">
        <div>
          <h1>{title}</h1>
          <p>
            {[
              enquiry.role === "seller" ? `From ${enquiry.buyer_name}` : null,
              enquiry.sale.price_formatted,
              enquiry.sale.locality_name,
            ].filter(Boolean).join(" · ")}
          </p>
        </div>
        {enquiry.role === "seller" ? (
          <Link href={`/properties/${enquiry.sale.property_id}` as never} className="quiet-link">
            Open the property →
          </Link>
        ) : (
          <Link href={`/sales/${enquiry.sale.id}` as never} className="quiet-link">
            View the property →
          </Link>
        )}
      </header>

      <ol className="enquiry-thread" aria-label="Messages">
        {enquiry.messages.map((message) => (
          <li key={message.id} className={message.mine ? "is-mine" : undefined}>
            <span className="enquiry-bubble">{message.body}</span>
            <span className="enquiry-bubble-meta">
              {message.mine ? "You" : message.author_name} ·{" "}
              {new Date(message.created_at).toLocaleString("en-GH", {
                day: "numeric",
                month: "short",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          </li>
        ))}
      </ol>
      <div ref={end} />

      {error ? <Notice tone="error" title={error} /> : null}

      {closed ? (
        <Notice
          tone="info"
          title={enquiry.sale.status === "sold" ? "This property has been sold" : "This enquiry is closed"}
          body="You can still read it, but no more messages can be sent."
        />
      ) : (
        <div className="enquiry-compose">
          <label className="sr-only" htmlFor="enquiry-reply">Your reply</label>
          <textarea
            id="enquiry-reply"
            rows={3}
            maxLength={2000}
            value={draft}
            placeholder={enquiry.role === "seller" ? "Reply to the buyer…" : "Write to the seller…"}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
            }}
          />
          <Button onClick={send} busy={busy} busyLabel="Sending…" disabled={!draft.trim()}>
            Send
          </Button>
        </div>
      )}
    </div>
  );
}
