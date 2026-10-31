import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigationMocks = vi.hoisted(() => ({
  replace: vi.fn(),
  params: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigationMocks.replace }),
  useSearchParams: () => navigationMocks.params,
}));

import { CompanyApiCards } from "./company-api-cards";

const topics = [{
  objectName: "Lead",
  label: "Lead",
  description: "Lead records.",
  operations: [
    { id: "get-list", method: "GET" as const, path: "/api/leads", summary: "List leads" },
    { id: "get-one", method: "GET" as const, path: "/api/leads/:id", summary: "Get one lead" },
    { id: "post-create", method: "POST" as const, path: "/api/leads", summary: "Create lead" },
    { id: "delete", method: "DELETE" as const, path: "/api/leads/:id", summary: "Delete lead" },
  ],
}];

describe("CompanyApiCards", () => {
  beforeEach(() => {
    navigationMocks.replace.mockReset();
    navigationMocks.params = new URLSearchParams();
  });

  it("selects the first method by default and updates the shared URL for another method", () => {
    render(
      <CompanyApiCards
        topics={topics}
        allowDelete={false}
        renderOperation={(_topic, operation) => <p>{operation.summary}</p>}
      />,
    );

    expect(screen.getByRole("tab", { name: /GET\s?List/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("List leads");
    expect(screen.getByRole("tab", { name: /DELETE\s?Delete/ })).toHaveAttribute("title", "Delete is disabled for this company's key.");

    fireEvent.click(screen.getByRole("tab", { name: /POST\s?Create/ }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Create lead");
    expect(navigationMocks.replace).toHaveBeenCalledWith(
      "/admin/companies?object=lead&op=post-create",
      { scroll: false },
    );
  });

  it("supports arrow-key method navigation and object collapse controls", () => {
    render(
      <CompanyApiCards
        topics={topics}
        allowDelete
        renderOperation={(_topic, operation) => <p>{operation.summary}</p>}
      />,
    );
    const firstTab = screen.getByRole("tab", { name: /GET\s?List/ });
    firstTab.focus();
    fireEvent.keyDown(firstTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /GET\s?Get one/ })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Get one lead");

    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Get one lead");
  });
});
