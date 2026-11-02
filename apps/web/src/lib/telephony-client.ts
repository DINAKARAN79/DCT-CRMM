import { useSyncExternalStore } from "react";
import type { ClickToCallField, ClickToCallOutcome } from "@/lib/click-to-call";
import type { DialerCommand } from "@/lib/bizcall-dialpad";

type DialRequest = {
  leadId: string;
  phoneField: ClickToCallField;
  leadName: string;
};

type DialHandler = (request: DialRequest) => Promise<ClickToCallOutcome>;
type DialerCommandHandler = (command: DialerCommand) => { ok: boolean; reason?: string };

let dialHandler: DialHandler | null = null;
let dialerCommandHandler: DialerCommandHandler | null = null;
let telephonyIsActive = false;
let telephonyReasonCode = "NOT_CONFIGURED";
let shouldMaskNumbers = false;
const activeListeners = new Set<() => void>();

export function registerTelephonyDialHandler(handler: DialHandler) {
  dialHandler = handler;
  return () => {
    if (dialHandler === handler) dialHandler = null;
  };
}

export function registerDialerCommandHandler(handler: DialerCommandHandler) {
  dialerCommandHandler = handler;
  return () => {
    if (dialerCommandHandler === handler) dialerCommandHandler = null;
  };
}

export function requestDialerCommand(command: DialerCommand) {
  if (!dialerCommandHandler) return { ok: false, reason: "DIALPAD_NOT_READY" };
  return dialerCommandHandler(command);
}

export function requestLeadCall(request: DialRequest): Promise<ClickToCallOutcome> {
  if (!dialHandler) {
    return Promise.resolve({
      ok: false,
      code: "TELEPHONY_NOT_READY",
      step: "blocked_before_send",
      message: "Telephony is not ready. Refresh the CRM and try again.",
      ignored: false,
      callDetailId: null,
      leadStatus: null,
      statusChanged: false,
      leadName: null,
    });
  }
  return dialHandler(request);
}

export function setTelephonyActive(active: boolean) {
  setTelephonyStatus(active, active ? "ACTIVE" : telephonyReasonCode);
}

export function setTelephonyStatus(active: boolean, reasonCode: string) {
  if (telephonyIsActive === active && telephonyReasonCode === reasonCode) return;
  telephonyIsActive = active;
  telephonyReasonCode = reasonCode;
  activeListeners.forEach((listener) => listener());
}

export function setTelephonyNumberMasking(enabled: boolean) {
  if (shouldMaskNumbers === enabled) return;
  shouldMaskNumbers = enabled;
  activeListeners.forEach((listener) => listener());
}

export function maskTelephonyNumber(value: string | null | undefined, countryCode?: string | null) {
  if (!value || !shouldMaskNumbers) return value || "";
  const digits = value.replace(/\D/g, "");
  const code = (countryCode || "").replace(/\D/g, "");
  const hasPlus = value.trim().startsWith("+");
  const prefixDigits = code || (hasPlus ? digits.slice(0, Math.min(2, digits.length - 4)) : "");
  const remaining = prefixDigits && digits.startsWith(prefixDigits) && (hasPlus || digits.length > 10)
    ? digits.slice(prefixDigits.length)
    : digits;
  if (remaining.length <= 4) return `${prefixDigits ? `+${prefixDigits}` : ""}${"•".repeat(Math.max(4, remaining.length))}${remaining.slice(-4)}`;
  return `${prefixDigits ? `+${prefixDigits}` : ""}${"•".repeat(Math.max(4, remaining.length - 4))}${remaining.slice(-4)}`;
}

export function useTelephonyActive() {
  return useSyncExternalStore(
    (listener) => {
      activeListeners.add(listener);
      return () => activeListeners.delete(listener);
    },
    () => telephonyIsActive,
    () => false,
  );
}

export function useTelephonyReasonCode() {
  return useSyncExternalStore(
    (listener) => {
      activeListeners.add(listener);
      return () => activeListeners.delete(listener);
    },
    () => telephonyReasonCode,
    () => "NOT_CONFIGURED",
  );
}

export function useTelephonyNumberMasking() {
  return useSyncExternalStore(
    (listener) => {
      activeListeners.add(listener);
      return () => activeListeners.delete(listener);
    },
    () => shouldMaskNumbers,
    () => false,
  );
}
