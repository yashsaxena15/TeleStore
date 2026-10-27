import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Laptop, LogOut, MonitorSmartphone, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { relativeTime } from "@/features/notifications/notificationHelpers";
import { api } from "@/lib/api";
import { SettingsPanel, StatusPill } from "../SettingsUi";
import { errorMessage } from "../errorMessage";

export const DEVICES_KEY = ["devices"];

/** "Password · signed in Oct 12 · active 5 min ago" */
export const deviceDetails = (device, now = new Date()) => [
    device.method === "google" ? "Google" : "Password",
    device.signed_in_at && `signed in ${relativeTime(device.signed_in_at, now)}`,
    !device.current && device.last_seen && `active ${relativeTime(device.last_seen, now)}`,
].filter(Boolean).join(" · ");

/** Every place this account is signed in; any other one can be signed out from here. */
export const DevicesPanel = () => {
    const queryClient = useQueryClient();
    const { data, isLoading, error } = useQuery({ queryKey: DEVICES_KEY, queryFn: api.fetchDevices, refetchOnWindowFocus: true });
    const [confirm, setConfirm] = useState(null); // a device, or "others"
    const [busy, setBusy] = useState(false);
    const devices = data?.devices ?? [];
    const others = devices.filter((d) => !d.current);

    const signOut = async () => {
        setBusy(true);
        try {
            if (confirm === "others") {
                const res = await api.signOutOtherDevices();
                toast.success(res?.signed_out === 1 ? "Signed out 1 device" : `Signed out ${res?.signed_out ?? 0} devices`);
            } else {
                await api.signOutDevice(confirm.id);
                toast.success(`Signed out ${confirm.name}`);
            }
        } catch (err) {
            toast.error(errorMessage(err, "Couldn't sign out"));
        } finally {
            setBusy(false);
            setConfirm(null);
            queryClient.invalidateQueries({ queryKey: DEVICES_KEY });
        }
    };

    return (<SettingsPanel icon={MonitorSmartphone} title="Your devices" description="Where your account is signed in. Sign out any you don't recognise."
        actions={others.length > 1 && <Button variant="outline" size="sm" className="h-8" onClick={() => setConfirm("others")}><LogOut className="w-3.5 h-3.5 mr-1.5"/>Sign out all others</Button>}>
      {isLoading && <p className="text-sm text-muted-foreground">Loading your devices…</p>}
      {error && <p role="alert" className="text-sm text-destructive">{errorMessage(error, "Couldn't load your devices")}</p>}
      <ul aria-label="Signed-in devices" className="grid gap-2">
        {devices.map((device) => {
            const Icon = device.kind === "app" ? Smartphone : Laptop;
            return (<li key={device.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 min-w-0">
              <Icon className="w-5 h-5 text-muted-foreground shrink-0" aria-hidden/>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate flex items-center gap-2">
                  <span className="truncate">{device.name}</span>
                  {device.current && <StatusPill tone="success">This device</StatusPill>}
                </p>
                <p className="text-xs text-muted-foreground truncate">{deviceDetails(device)}</p>
              </div>
              {!device.current && <Button variant="ghost" size="sm" className="h-8 shrink-0" aria-label={`Sign out ${device.name}`} onClick={() => setConfirm(device)}>Sign out</Button>}
            </li>);
        })}
      </ul>
      {!isLoading && !error && others.length === 0 && <p className="text-sm text-muted-foreground">You're only signed in here.</p>}

      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "others" ? `Sign out ${others.length} other devices?` : `Sign out ${confirm?.name}?`}</AlertDialogTitle>
            <AlertDialogDescription>They'll need your password (or Google) to sign in again. Uploads running there stop.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); signOut(); }}>{busy ? "Signing out…" : "Sign out"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPanel>);
};
