"use client";

import dynamic from "next/dynamic";
import { useRef, useState, type ReactNode } from "react";

import { useToast } from "@/components/toast/Toaster";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import type { UnitDetail } from "@/lib/console";
import type { UnitWizard as UnitWizardForm, UnitWizardMode } from "./UnitWizard";

const UnitWizard = dynamic(() => import("./UnitWizard").then((module) => module.UnitWizard), {
  loading: () => <div className="cw-loading"><p className="type-caption">Loading…</p></div>,
});

type Props = UnitWizardMode & {
  open: boolean;
  propertyId: string | null;
  propertyPicker?: ReactNode;
  wizard?: typeof UnitWizardForm;
  onClose: () => void;
  onChanged?: () => void;
  onFinished?: (unit: UnitDetail) => void;
};

export function UnitWizardModal(props: Props) {
  if (!props.open) return null;
  return <OpenUnitWizardModal key={JSON.stringify([props.mode, props.unitId, props.startAt])} {...props} />;
}

function OpenUnitWizardModal(props: Props) {
  const { mode, unitId, startAt, propertyId, propertyPicker, wizard: Wizard = UnitWizard, onClose, onChanged, onFinished } = props;
  const { toast } = useToast();
  const closeGuardRef = useRef<(() => boolean) | null>(null);
  const hasSaved = useRef(false);
  const [busy, setBusy] = useState(false);

  return (
    <ModalSheet
      open
      onClose={onClose}
      size="sm"
      icon="units"
      title={mode === "edit" ? "Edit Unit" : "Add Unit"}
      meta={propertyId ? "Saved as you go" : "Choose its Property"}
      className={propertyId ? "lease-wizard-sheet is-wizard creation-sheet" : "unit-chooser-sheet"}
      closeLabel="Close Unit setup"
      dismissible={false}
      escapeCloses
      restoreFocus
      closeDisabled={busy}
      beforeClose={() => closeGuardRef.current?.() ?? true}
    >
      {(close) => propertyId ? (
        <Wizard
          {...(mode === "edit" ? { mode, unitId, startAt } : { mode })}
          key={propertyId}
          propertyId={propertyId}
          onCancel={close}
          closeGuardRef={closeGuardRef}
          onBusyChange={setBusy}
          onChanged={() => {
            hasSaved.current = true;
            onChanged?.();
          }}
          onFinished={(unit) => {
            if (hasSaved.current) {
              toast({ tone: "success", title: `${unit.label || "Unit"} saved`, description: unit.verification.state_label });
            }
            onFinished?.(unit);
            onClose();
          }}
        />
      ) : propertyPicker}
    </ModalSheet>
  );
}
