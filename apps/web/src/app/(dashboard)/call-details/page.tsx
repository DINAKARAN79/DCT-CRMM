"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { callDetailsApi } from "@/lib/api";
import { maskDialpadNumber } from "@/lib/bizcall-dialpad";

type UnlinkedCall = {
  id: string;
  leadId: string | null;
  name: string;
  callType: string;
  status: string;
  callTo: string | null;
  startAt: string;
  duration: number;
};

export default function CallDetailsIndexPage() {
  const [calls, setCalls] = React.useState<UnlinkedCall[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const loadCalls = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await callDetailsApi.list();
      const data = response.data.data;
      if (!Array.isArray(data)) throw new Error("Unexpected call records response.");
      setCalls(data.filter((call): call is UnlinkedCall => Boolean(call && !call.leadId)));
    } catch {
      setError("Manual call records could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadCalls();
  }, [loadCalls]);

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Phone className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Call Details</p>
          <h1 className="text-lg font-semibold">Call records</h1>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Calls without a lead</CardTitle>
          <CardDescription>
            Manual calls placed directly from Bizcall are recorded here. Calls associated with a lead remain in that lead&apos;s Call Details tab.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? <p className="text-sm text-muted-foreground">Loading call records…</p> : null}
          {error ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 text-sm text-destructive">
              <span>{error}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadCalls()}>Retry</Button>
            </div>
          ) : null}
          {!loading && !error && calls.length === 0 ? (
            <p className="text-sm text-muted-foreground">No manual calls have been recorded.</p>
          ) : null}
          {calls.map((call) => (
            <div key={call.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{call.name}</p>
                <p className="text-xs text-muted-foreground">
                  {call.callType} · {call.status} · {new Date(call.startAt).toLocaleString()}
                </p>
              </div>
              <span className="font-mono text-xs">{maskDialpadNumber(call.callTo)}</span>
            </div>
          ))}
          <Button asChild>
            <Link href="/leads">
              Open Leads
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
