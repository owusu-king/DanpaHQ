"use client";

import { CircleAlert } from "lucide-react";
import { useEffect, useId, useRef } from "react";

import { Button } from "@/components/Button";
import styles from "./error-dialog.module.css";

export type ErrorAction = { label: string; onSelect: () => void };

export type ErrorMessage = {
  id: number;
  title: string;
  description: string;
  action?: ErrorAction;
};

export function ErrorDialog({ error, onDismiss }: {
  error: ErrorMessage;
  onDismiss: (id: number) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const title = useId();
  const description = useId();
  const { id, action } = error;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // The top layer also works over existing native sheets and drawers.
    dialog.showModal();
    return () => { dialog.close(); };
  }, []);

  function close() {
    ref.current?.close();
    onDismiss(id);
  }

  return (
    <dialog
      ref={ref}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={title}
      aria-describedby={description}
      className={styles.dialog}
      onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}
      onCancel={(event) => { event.preventDefault(); close(); }}
    >
      <div className={styles.content}>
        <CircleAlert className={styles.icon} aria-hidden="true" />
        <div className={styles.copy}>
          <h2 id={title}>{error.title}</h2>
          <p id={description}>{error.description}</p>
        </div>
      </div>
      <div className={styles.actions}>
        <Button type="button" variant={action ? "quiet" : "primary"} onClick={close}>
          {action ? "Dismiss" : "OK"}
        </Button>
        {action ? (
          <Button type="button" onClick={() => { close(); action.onSelect(); }}>
            {action.label}
          </Button>
        ) : null}
      </div>
    </dialog>
  );
}
