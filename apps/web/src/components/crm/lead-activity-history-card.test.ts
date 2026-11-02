import { describe, expect, it } from "vitest";
import {
  historyDescription,
  historyDetailRows,
  historyTitle,
  type HistoryEntry,
} from "./lead-activity-history-card";

describe("booking history labels and details", () => {
  it("shows which booking fields changed and their old and new values", () => {
    const entry: HistoryEntry = {
      id: "history-1",
      action: "BOOKING_DETAILS_UPDATED",
      objectType: "Booking",
      newValues: {
        changes: [{
          field: "bankStatus",
          label: "Bank Status",
          oldValue: "Pending",
          newValue: "Approved",
        }],
      },
      createdAt: "2026-10-29T10:00:00.000Z",
    };

    expect(historyTitle(entry)).toBe("Booking Details Updated");
    expect(historyDescription(entry, () => "")).toBe("Changed booking information: Bank Status.");
    expect(historyDetailRows(entry, () => "")).toEqual([
      { label: "Bank Status", value: "Pending → Approved" },
    ]);
  });

  it("explains legacy booking edits even when previous and new values were not audited", () => {
    const entry: HistoryEntry = {
      id: "history-2",
      action: "UPDATE",
      objectType: "Booking",
      newValues: { updatedFields: ["bankStatus"] },
      createdAt: "2026-10-29T10:00:00.000Z",
    };

    expect(historyTitle(entry)).toBe("Booking Details Updated");
    expect(historyDescription(entry, () => "")).toBe("Changed booking information: Bank Status.");
    expect(historyDetailRows(entry, () => "")).toEqual([
      { label: "Bank Status", value: "Updated; previous and new values were not recorded." },
    ]);
  });

  it("describes a stage transition as a booking process instead of a generic update", () => {
    const entry: HistoryEntry = {
      id: "history-3",
      action: "UPDATE",
      objectType: "Booking",
      oldValues: { bookingStage: "NEW_BOOKING" },
      newValues: { bookingStage: "WELCOME_CALL" },
      createdAt: "2026-10-29T10:00:00.000Z",
    };

    expect(historyTitle(entry)).toBe("Booking Stage Changed");
    expect(historyDescription(entry, () => "")).toBe("Booking stage changed from NEW BOOKING to WELCOME CALL.");
  });
});
