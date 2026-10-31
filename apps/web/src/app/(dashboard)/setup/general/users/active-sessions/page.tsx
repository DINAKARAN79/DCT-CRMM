"use client";

import * as React from "react";
import Link from "next/link";
import { presenceApi } from "@/lib/api";
import { useActiveUsers } from "@/components/crm/use-active-users";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export default function ActiveSessionsPage() {
  const { toast } = useToast();
  const [search, setSearch] = React.useState("");
  const [profileId, setProfileId] = React.useState("");
  const [includeOffline, setIncludeOffline] = React.useState(false);
  const { payload, status, reload } = useActiveUsers({ search, includeOffline });
  const live = status === "live";
  const [idleMinutes, setIdleMinutes] = React.useState("2");
  const [heartbeatSeconds, setHeartbeatSeconds] = React.useState("30");
  const [confirm, setConfirm] = React.useState<{ kind: "user" | "session"; id: string; label: string } | null>(null);

  React.useEffect(() => {
    void presenceApi.settings().then((response) => {
      const data = response.data.data;
      if (!data) return;
      setIdleMinutes(String(Math.round(data.idleTimeoutSeconds / 60)));
      setHeartbeatSeconds(String(data.heartbeatIntervalSeconds));
    }).catch(() => undefined);
  }, []);

  const profiles = payload?.byProfile.map((row) => row.profile) || [];
  const visibleUsers = (payload?.users || []).filter((user) => !profileId || user.profile?.name === profileId);

  const saveSettings = async () => {
    try {
      await presenceApi.saveSettings({
        idleTimeoutSeconds: Math.round(Number(idleMinutes) * 60),
        heartbeatIntervalSeconds: Math.round(Number(heartbeatSeconds)),
      });
      toast({ title: "Presence settings saved" });
    } catch (error: any) {
      toast({ title: "Could not save settings", description: error?.response?.data?.error || "Check the values.", variant: "destructive" as any });
    }
  };

  const forceLogout = async () => {
    if (!confirm) return;
    try {
      if (confirm.kind === "user") await presenceApi.forceLogoutUser(confirm.id);
      else await presenceApi.forceLogoutSession(confirm.id);
      toast({ title: "Session ended" });
      setConfirm(null);
      await reload();
    } catch (error: any) {
      toast({ title: "Force logout failed", description: error?.response?.data?.error || "Try again.", variant: "destructive" as any });
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground"><Link href="/setup/general/users" className="hover:underline">Users</Link> / Active Sessions</p>
          <h1 className="text-xl font-semibold">Active Sessions</h1>
        </div>
        <span className={`inline-flex items-center gap-1 text-sm font-semibold ${live ? "text-emerald-700" : "text-slate-500"}`}>
          <span className={`h-2 w-2 rounded-full ${live ? "bg-emerald-500" : "bg-slate-300"}`} />
          {live ? "Live" : "Reconnecting..."}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Summary label="Logged in now" value={payload?.onlineCount ?? 0} />
        <Summary label="Total active users" value={payload?.totalUsers ?? 0} />
        <Summary label="Logged out" value={payload?.loggedOut ?? 0} />
        <Summary label="Online" value={`${payload?.onlineCount ?? 0} of ${payload?.totalUsers ?? 0}`} />
      </div>
      {payload?.byProfile && payload.byProfile.length > 0 && (
        <p className="text-sm text-slate-600">{payload.byProfile.map((row) => `${row.profile} ${row.count}`).join(" · ")}</p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Search
          <Input value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 w-56" />
        </label>
        <label className="text-sm">
          Profile
          <select value={profileId} onChange={(event) => setProfileId(event.target.value)} className="mt-1 block h-10 rounded-md border px-2">
            <option value="">All profiles</option>
            {profiles.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeOffline} onChange={(event) => setIncludeOffline(event.target.checked)} />
          Show offline too
        </label>
      </div>

      {payload?.detailsHidden ? (
        <p className="rounded-md border bg-slate-50 p-4 text-sm">Session details are available while you are signed in as that company&apos;s admin.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-3 py-2">User ID</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Profile</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Active sessions</th>
                <th className="px-3 py-2">Browser / OS</th>
                <th className="px-3 py-2">IP</th>
                <th className="px-3 py-2">Logged in since</th>
                <th className="px-3 py-2">Last activity</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((user) => (
                <tr key={user.id} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">{user.id}</td>
                  <td className="px-3 py-2">{user.firstName} {user.lastName}</td>
                  <td className="px-3 py-2">{user.profile?.name || "—"}</td>
                  <td className="px-3 py-2">{user.role?.name || "—"}</td>
                  <td className="px-3 py-2">Active sessions: {user.sessionCount}</td>
                  <td className="px-3 py-2">{[user.browser, user.os].filter(Boolean).join(" / ") || "—"}</td>
                  <td className="px-3 py-2">{user.ipAddress || "—"}</td>
                  <td className="px-3 py-2">{user.loggedInSince ? new Date(user.loggedInSince).toLocaleString() : "—"}</td>
                  <td className="px-3 py-2">{user.lastActivity || "—"}</td>
                  <td className="px-3 py-2">
                    <Button size="sm" variant="outline" onClick={() => setConfirm({ kind: "user", id: user.id, label: `${user.firstName} ${user.lastName}` })}>Force logout all</Button>
                    {user.sessions.map((session) => (
                      <button key={session.id} type="button" className="ml-2 text-xs text-blue-700 hover:underline" onClick={() => setConfirm({ kind: "session", id: session.id, label: session.browser || "session" })}>
                        End {session.browser || "session"}
                      </button>
                    ))}
                  </td>
                </tr>
              ))}
              {visibleUsers.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">No users match this view.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="max-w-xl rounded-md border p-4">
        <h2 className="font-semibold">Offline timeout</h2>
        <p className="mt-1 text-sm text-muted-foreground">A user counts as offline after this long without a heartbeat. This does not sign them out.</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <label className="text-sm">Idle timeout (minutes)
            <Input value={idleMinutes} onChange={(event) => setIdleMinutes(event.target.value)} className="mt-1 w-32" />
          </label>
          <label className="text-sm">Heartbeat (seconds)
            <Input value={heartbeatSeconds} onChange={(event) => setHeartbeatSeconds(event.target.value)} className="mt-1 w-32" />
          </label>
          <Button className="self-end" onClick={saveSettings}>Save</Button>
        </div>
      </div>

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
            <h2 className="text-lg font-semibold">Force logout</h2>
            <p className="mt-2 text-sm text-slate-600">End the session for {confirm.label}? They will show offline if no other browser is still active.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
              <Button onClick={forceLogout}>End session</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
