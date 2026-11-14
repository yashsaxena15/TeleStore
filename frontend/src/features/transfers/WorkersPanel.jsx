import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Server, Pause, Play, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { machineState } from "./workers";

const TONE = {
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-warning",
    muted: "bg-muted text-muted-foreground",
};

// Transfers › Workers (owner only): each machine that runs cloud transfers, with Pause / Resume.
// A paused machine takes nothing new; "Stop now" also hands what it runs to the other machines.
export const WorkersPanel = () => {
    const queryClient = useQueryClient();
    const [busy, setBusy] = useState(null);
    const { data: machines = [], isLoading } = useQuery({
        queryKey: ["transfers", "machines"],
        queryFn: async () => (await api.fetchMachines()).machines || [],
        refetchInterval: 5000,
    });
    const act = async (machine, fn, done) => {
        setBusy(machine.worker_id);
        try {
            const res = await fn();
            toast.success(done(res));
            await queryClient.invalidateQueries({ queryKey: ["transfers", "machines"] });
        }
        catch (err) {
            toast.error(err?.message || "Couldn't change it");
        }
        finally {
            setBusy(null);
        }
    };
    const pause = (m, stopNow) => act(m, () => api.pauseMachine(m.worker_id, stopNow), (res) => stopNow
        ? `${m.name} paused. ${res?.handed_back ? `${res.handed_back} transfer${res.handed_back === 1 ? "" : "s"} went back to the queue.` : "Nothing was running."}`
        : `${m.name} paused. What it's running finishes; it takes nothing new.`);
    const resume = (m) => act(m, () => api.resumeMachine(m.worker_id), () => `${m.name} resumed`);
    if (isLoading || machines.length === 0) return null;
    return (<section aria-label="Workers" className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-border text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Server className="w-3.5 h-3.5"/>Workers
        <span className="normal-case font-normal tracking-normal">· the machines that run cloud transfers</span>
      </div>
      <div className="divide-y divide-border">
        {machines.map((m) => {
            const st = machineState(m);
            return (<div key={m.worker_id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm font-medium truncate">{m.name}</span>
                  <span className={cn("shrink-0 px-1.5 py-px rounded text-[9.5px] font-semibold", TONE[st.tone])}>{st.label}</span>
                </div>
                <p className="text-[11px] text-muted-foreground truncate">{st.detail}</p>
              </div>
              {busy === m.worker_id ? (<Loader2 className="w-4 h-4 animate-spin text-muted-foreground"/>) : m.paused ? (<Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => resume(m)} aria-label={`Resume ${m.name}`}>
                  <Play className="w-3.5 h-3.5"/>Resume
                </Button>) : (<DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" aria-label={`Pause ${m.name}`}>
                      <Pause className="w-3.5 h-3.5"/>Pause<ChevronDown className="w-3 h-3 opacity-60"/>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-72">
                    <DropdownMenuItem className="flex-col items-start gap-0.5" onSelect={() => pause(m, false)}>
                      <span className="text-sm">Pause after current transfers</span>
                      <span className="text-[11px] text-muted-foreground">What it's running finishes; it takes nothing new.</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem className="flex-col items-start gap-0.5" onSelect={() => pause(m, true)}>
                      <span className="text-sm">Stop now</span>
                      <span className="text-[11px] text-muted-foreground">What it's running goes back to the queue for the other machines (starting again there).</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>)}
            </div>);
        })}
      </div>
    </section>);
};
