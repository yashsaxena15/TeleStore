import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Building blocks shared by every Settings section, so all of them look the same.

export const SettingsPanel = ({ icon: Icon, title, description, actions, children, className }) => (<section className={cn("rounded-xl border border-border bg-card", className)}>
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 border-b border-border">
      {Icon && <Icon className="w-4 h-4 text-muted-foreground shrink-0"/>}
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
    <div className="p-4 grid gap-4">{children}</div>
  </section>);

export const Field = ({ label, hint, htmlFor, children }) => (<div className="grid gap-1.5 min-w-0">
    {label && <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">{label}</label>}
    {children}
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>);

// Read-only value in an input-like box
export const ValueBox = ({ children, mono, className }) => (<div className={cn("min-h-9 flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-background text-sm min-w-0", className)}>
    <span className={cn("min-w-0 flex-1 truncate", mono && "font-mono text-[13px]")}>{children}</span>
  </div>);

const PILL_TONES = {
    success: "text-success bg-success/10 border-success/25",
    warning: "text-warning bg-warning/10 border-warning/25",
    destructive: "text-destructive bg-destructive/10 border-destructive/25",
    muted: "text-muted-foreground bg-muted border-border",
};

export const StatusPill = ({ tone = "muted", icon: Icon, children }) => (<span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11.5px] font-medium shrink-0", PILL_TONES[tone])}>
    {Icon && <Icon className="w-3 h-3"/>}{children}
  </span>);

// A row of mutually exclusive choices (theme, auto-lock time)
export const Segmented = ({ label, value, options, onChange, disabled }) => (<div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 p-1 rounded-lg border border-border bg-background">
    {options.map(({ value: v, label: l, icon: Icon }) => (<button key={v} type="button" role="radio" aria-checked={value === v} disabled={disabled} onClick={() => value !== v && onChange(v)} className={cn("h-8 inline-flex items-center gap-1.5 px-3 rounded-md text-xs font-medium transition-colors disabled:opacity-50", value === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground hover:bg-muted")}>
        {Icon && <Icon className="w-3.5 h-3.5"/>}{l}
      </button>))}
  </div>);

export const CopyValue = ({ label, value }) => {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        }
        catch {
            toast.error("Couldn't copy to the clipboard");
        }
    };
    return (<div className="flex items-center gap-2 min-h-9 pl-3 pr-1 rounded-md border border-border bg-background min-w-0">
      <span className="min-w-0 flex-1 truncate font-mono text-[13px] select-all" title={value}>{value}</span>
      <button type="button" onClick={copy} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted" aria-label={`Copy ${label}`} title={`Copy ${label}`}>
        {copied ? <Check className="w-3.5 h-3.5 text-success"/> : <Copy className="w-3.5 h-3.5"/>}
      </button>
    </div>);
};
