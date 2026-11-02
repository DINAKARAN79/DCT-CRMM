"use client";

import React from "react";
import Link from "next/link";
import { CircleHelp } from "lucide-react";

function reasonMessage(reasonCode: string, isAdmin: boolean) {
  if (reasonCode === "NO_PERMISSION") return "You do not have permission to place calls. Ask an admin.";
  if (reasonCode === "KEY_UNREADABLE" && isAdmin) {
    return "Telephony key cannot be read on this server. Check API_KEY_ENCRYPTION_SECRET.";
  }
  if (reasonCode === "DISABLED") return "Telephony is switched off for this company.";
  if (["NOT_CONFIGURED", "KEY_MISSING", "KEY_UNREADABLE"].includes(reasonCode)) {
    return "Telephony is not set up for this company";
  }
  return "Telephony is unavailable. Ask an admin to check the company telephony settings.";
}

export function TelephonyStatusHint({
  reasonCode,
  isAdmin = false,
}: {
  reasonCode: string;
  isAdmin?: boolean;
}) {
  const message = reasonMessage(reasonCode, isAdmin);
  const showSettingsLink = isAdmin && ["NOT_CONFIGURED", "KEY_MISSING", "KEY_UNREADABLE"].includes(reasonCode);
  const className = "inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground";
  if (showSettingsLink) {
    return (
      <Link
        href="/setup/integrations/telephony"
        className={className}
        title={`${message}. Open Setup > Integrations > Telephony.`}
        aria-label={`${message}. Open Setup > Integrations > Telephony.`}
      >
        <CircleHelp className="h-4 w-4" />
      </Link>
    );
  }
  return (
    <button type="button" className={className} title={message} aria-label={message}>
      <CircleHelp className="h-4 w-4" />
    </button>
  );
}
