"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { PasswordSection } from "@/components/account/AccountSections";
import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { LoadingRows } from "@/components/portal/PageHeader";
import { ApiFailure } from "@/lib/api";
import { authedFetch } from "@/lib/auth";
import {
  endSignedInDevice,
  listSignedInDevices,
  type SignedInDevice,
} from "@/lib/console";

export default function SecuritySettingsPage() {
  const router = useRouter();
  const [devices, setDevices] = useState<SignedInDevice[] | null>(null);
  const [ending, setEnding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setDevices(await listSignedInDevices());
      setError("");
    } catch (cause) {
      setDevices([]);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your signed-in devices.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <section className="settings-section">
        <h2>Password</h2>
        <PasswordSection />
      </section>

      <section className="settings-section">
        <h2>Where you are signed in</h2>

        {error ? <Notice tone="error" title={error} /> : null}
        {devices === null ? <LoadingRows rows={3} /> : null}

        {devices?.length ? (
          <ul className="settings-rows">
            {devices.map((device) => (
              <li key={device.id} className="settings-row">
                <span className="settings-row-text">
                  <span className="type-body">
                    {device.device_label || device.client || "Unknown device"}
                    {device.is_current ? <span className="type-label settings-row-here">THIS ONE</span> : null}
                  </span>
                  <span className="settings-row-when">
                    {new Date(device.last_used_at ?? device.issued_at).toLocaleString("en-GH")}
                  </span>
                </span>
                {!device.is_current ? (
                  <Button
                    variant="quiet"
                    busy={ending === device.id}
                    busyLabel="Signing out…"
                    disabled={ending !== null}
                    onClick={async () => {
                      setEnding(device.id);
                      setError("");
                      try {
                        await endSignedInDevice(device.id);
                        await load();
                      } catch (cause) {
                        setError(cause instanceof ApiFailure ? cause.error.message : "Could not sign out that device.");
                      } finally {
                        setEnding(null);
                      }
                    }}
                  >Sign out</Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="settings-actions">
          <Button
            variant="destructive"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await authedFetch("/auth/sign-out/", {
                  method: "POST",
                  body: JSON.stringify({ everywhere: true }),
                });
                router.replace("/sign-in");
              } catch (cause) {
                setError(cause instanceof ApiFailure ? cause.error.message : "Could not sign out everywhere.");
                setBusy(false);
              }
            }}
          >Sign out everywhere</Button>
        </div>
        <p className="type-caption">
          This ends every session including this one, so you will sign in again.
        </p>
      </section>
    </>
  );
}
