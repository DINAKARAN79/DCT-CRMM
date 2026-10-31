"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Expand, LockKeyhole, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

interface ApiOperation {
  id: string;
  method: HttpMethod;
  path: string;
  summary: string;
}

interface ApiTopic {
  objectName: string;
  label: string;
  description: string;
  operations: ApiOperation[];
}

const methodClass: Record<HttpMethod, string> = {
  GET: "bg-emerald-600 text-white",
  POST: "bg-blue-600 text-white",
  PUT: "bg-orange-500 text-white",
  DELETE: "bg-red-600 text-white",
};

function operationLabel(operation: ApiOperation) {
  if (operation.method === "GET") return operation.path.includes("/:") || operation.path.includes("/{") ? "Get one" : "List";
  if (operation.method === "POST") return "Create";
  if (operation.method === "PUT") return "Update";
  return "Delete";
}

function topicKey(topic: ApiTopic) {
  return topic.objectName.toLowerCase();
}

export function CompanyApiCards<TOp extends ApiOperation, TTopic extends ApiTopic & { operations: TOp[] }>({
  topics,
  allowDelete,
  renderOperation,
}: {
  topics: TTopic[];
  allowDelete: boolean;
  renderOperation: (topic: TTopic, operation: TOp) => React.ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = React.useState("");
  const [selectedByTopic, setSelectedByTopic] = React.useState<Record<string, string>>({});
  const [collapsedTopics, setCollapsedTopics] = React.useState<string[]>([]);
  const skipDeepLinkScroll = React.useRef(false);
  const requestedObject = (searchParams.get("object") || "").toLowerCase();
  const requestedOp = searchParams.get("op") || "";

  const visible: TTopic[] = topics.filter((topic) => {
    const haystack = `${topic.label} ${topic.objectName} ${topic.operations.map((operation) => `${operation.path} ${operation.summary}`).join(" ")}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });
  const allCollapsed = visible.length > 0 && visible.every((topic) => collapsedTopics.includes(topicKey(topic)));

  const selectOperation = (topic: TTopic, operation: TOp) => {
    skipDeepLinkScroll.current = true;
    setSelectedByTopic((current) => ({ ...current, [topicKey(topic)]: operation.id }));
    const params = new URLSearchParams(searchParams.toString());
    params.set("object", topicKey(topic));
    params.set("op", operation.id);
    router.replace(`/admin/companies?${params.toString()}`, { scroll: false });
  };

  React.useEffect(() => {
    if (!topics.length || (requestedObject && requestedOp)) return;
    const topic = topics.find((item) => topicKey(item) === requestedObject) || topics[0];
    const operation = topic?.operations.find((item) => item.id === requestedOp) || topic?.operations[0];
    if (!topic || !operation) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("object", topicKey(topic));
    params.set("op", operation.id);
    router.replace(`/admin/companies?${params.toString()}`, { scroll: false });
  }, [requestedObject, requestedOp, router, searchParams, topics]);

  React.useEffect(() => {
    if (!requestedObject || !requestedOp) return;
    const topic = topics.find((item) => topicKey(item) === requestedObject);
    if (!topic || !topic.operations.some((operation) => operation.id === requestedOp)) return;
    setSelectedByTopic((current) => current[requestedObject] === requestedOp
      ? current
      : { ...current, [requestedObject]: requestedOp });
    if (skipDeepLinkScroll.current) {
      skipDeepLinkScroll.current = false;
      return;
    }
    const target = document.getElementById(`api-object-${requestedObject}`);
    const rightPane = target?.closest<HTMLElement>('[data-testid="companies-api-right-pane"]');
    if (target && rightPane) {
      requestAnimationFrame(() => {
        const targetTop = target.getBoundingClientRect().top - rightPane.getBoundingClientRect().top + rightPane.scrollTop;
        rightPane.scrollTop = Math.max(0, targetTop - 8);
      });
    }
  }, [requestedObject, requestedOp, topics]);

  const toggleAll = () => {
    if (allCollapsed) {
      setCollapsedTopics((current) => current.filter((key) => !visible.some((topic) => topicKey(topic) === key)));
    } else {
      setCollapsedTopics((current) => Array.from(new Set([...current, ...visible.map(topicKey)])));
    }
  };

  const moveFocus = (topic: TTopic, currentIndex: number, direction: -1 | 1) => {
    const nextIndex = (currentIndex + direction + topic.operations.length) % topic.operations.length;
    const next = topic.operations[nextIndex];
    selectOperation(topic, next);
    document.getElementById(`api-tab-${topicKey(topic)}-${next.id}`)?.focus();
  };

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" size="sm" variant="outline" onClick={toggleAll}>
          <Expand className="h-3.5 w-3.5" /> {allCollapsed ? "Expand all" : "Collapse all"}
        </Button>
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search objects"
          aria-label="Search API objects"
          className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-2 text-sm"
        />
      </div>
      {visible.map((topic) => {
        const key = topicKey(topic);
        const requestedSelection = key === requestedObject ? requestedOp : "";
        const selectedId = selectedByTopic[key]
          || (topic.operations.some((operation) => operation.id === requestedSelection) ? requestedSelection : "")
          || topic.operations[0]?.id;
        const selectedOperation: TOp | undefined = topic.operations.find((operation: TOp) => operation.id === selectedId) || topic.operations[0];
        const collapsed = collapsedTopics.includes(key);
        const selectedIndex = Math.max(0, topic.operations.findIndex((operation) => operation.id === selectedOperation?.id));

        return (
          <section
            id={`api-object-${key}`}
            key={topic.objectName}
            className="min-w-0 scroll-mt-4 overflow-hidden rounded-md border bg-card"
          >
            <header className="space-y-2 px-4 py-3">
              <div className="flex min-w-0 items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold">{topic.label} API</h3>
                  <p className="text-sm text-muted-foreground">{topic.description}</p>
                </div>
                <button
                  type="button"
                  className="rounded p-1 text-muted-foreground hover:bg-muted"
                  aria-label={`${collapsed ? "Expand" : "Collapse"} ${topic.label} API`}
                  aria-expanded={!collapsed}
                  onClick={() => setCollapsedTopics((current) => collapsed
                    ? current.filter((item) => item !== key)
                    : [...current, key])}
                >
                  {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
              </div>
              <div role="tablist" aria-label={`${topic.label} API methods`} className="flex min-w-0 flex-wrap gap-1.5">
                {topic.operations.map((operation: TOp, index: number) => {
                  const selected = operation.id === selectedOperation?.id;
                  return (
                    <button
                      id={`api-tab-${key}-${operation.id}`}
                      key={operation.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      aria-controls={`api-panel-${key}`}
                      aria-label={`${operation.method} ${operationLabel(operation)}`}
                      tabIndex={selected ? 0 : -1}
                      title={operation.method === "DELETE" && !allowDelete ? "Delete is disabled for this company's key." : operation.summary}
                      onClick={() => selectOperation(topic, operation)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                          event.preventDefault();
                          moveFocus(topic, index, 1);
                        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                          event.preventDefault();
                          moveFocus(topic, index, -1);
                        } else if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectOperation(topic, operation);
                        }
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${selected ? "border-primary/50 bg-primary/10 ring-1 ring-primary/20" : "hover:bg-muted"}`}
                    >
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${methodClass[operation.method]}`}>{operation.method}</span>
                      <span>{operationLabel(operation)}</span>
                      {operation.method === "DELETE" && !allowDelete ? <LockKeyhole className="h-3 w-3 text-muted-foreground" aria-label="Delete disabled" /> : null}
                    </button>
                  );
                })}
              </div>
            </header>
            {!collapsed && selectedOperation ? (
              <div id={`api-panel-${key}`} role="tabpanel" aria-labelledby={`api-tab-${key}-${selectedOperation.id}`} className="min-w-0 border-t px-4 py-4">
                {renderOperation(topic, selectedOperation)}
              </div>
            ) : null}
          </section>
        );
      })}
      {!visible.length && <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">No objects match.</p>}
    </div>
  );
}
