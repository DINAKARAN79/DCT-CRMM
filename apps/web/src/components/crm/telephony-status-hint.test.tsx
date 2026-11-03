import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TelephonyStatusHint } from "./telephony-status-hint";

describe("TelephonyStatusHint", () => {
  it("explains missing permission and disabled company telephony", () => {
    const { rerender } = render(<TelephonyStatusHint reasonCode="NO_PERMISSION" />);
    expect(screen.getByRole("button", { name: "You do not have permission to place calls. Ask an admin." })).toBeInTheDocument();

    rerender(<TelephonyStatusHint reasonCode="DISABLED" />);
    expect(screen.getByRole("button", { name: "Telephony is switched off for this company." })).toBeInTheDocument();

    rerender(<TelephonyStatusHint reasonCode="KEY_MISSING" />);
    expect(screen.getByRole("button", { name: "The telephony API key is missing for this company. Ask an admin to configure it." })).toBeInTheDocument();
  });

  it("explains a missing permission definition to administrators", () => {
    render(<TelephonyStatusHint reasonCode="PERMISSION_UNAVAILABLE" isAdmin />);
    expect(screen.getByRole("link", { name: /public\."Permission"\."name".*TELEPHONY_AWS_FIX\.md/ })).toHaveAttribute(
      "href",
      "/setup/integrations/telephony",
    );
  });

  it("gives admins a setup link and the encryption recovery instruction", () => {
    const { rerender } = render(<TelephonyStatusHint reasonCode="NOT_CONFIGURED" isAdmin />);
    expect(screen.getByRole("link", { name: /Telephony is not set up for this company/ })).toHaveAttribute("href", "/setup/integrations/telephony");

    rerender(<TelephonyStatusHint reasonCode="KEY_UNREADABLE" isAdmin />);
    expect(screen.getByRole("link", { name: /Check API_KEY_ENCRYPTION_SECRET/ })).toBeInTheDocument();
  });

  it("does not reveal the encryption setting to non-admin users", () => {
    render(<TelephonyStatusHint reasonCode="KEY_UNREADABLE" />);
    expect(screen.getByRole("button", { name: "Telephony is not set up for this company" })).toBeInTheDocument();
  });
});
