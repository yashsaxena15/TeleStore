// One header for every page: title (and optional subtitle) on the left, page actions on the right.
// Navigation happens through the sidebar / bottom tabs, so pages have no close or back button.
export const PageHeader = ({ icon: Icon, title, subtitle, actions, children }) => (<header className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 sm:px-6 pt-5 pb-4 border-b border-border">
    <div className="flex items-start gap-3 min-w-0 flex-1 basis-60">
      {Icon && (<span className="mt-0.5 w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Icon className="w-[18px] h-[18px]"/>
        </span>)}
      <div className="min-w-0">
        <h1 className="text-lg sm:text-xl font-semibold tracking-tight text-balance">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    {children}
  </header>);
