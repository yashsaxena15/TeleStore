import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { NEW_ITEM_GROUPS } from "./shellActions";

// The "New" menu: uploads, folders and remote transfers in one visible place.
export const NewMenu = ({ children, onAction, side = "bottom", align = "start" }) => (<DropdownMenu>
    <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
    <DropdownMenuContent side={side} align={align} className="w-64">
      {NEW_ITEM_GROUPS.map((group, index) => (<div key={group.label}>
          {index > 0 && <DropdownMenuSeparator />}
          <DropdownMenuLabel className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</DropdownMenuLabel>
          {group.items.map(({ id, label, icon: Icon }) => (<DropdownMenuItem key={id} onSelect={() => onAction(id)} className="gap-2.5 cursor-pointer">
              <Icon className="w-4 h-4 text-muted-foreground"/>
              <span>{label}</span>
            </DropdownMenuItem>))}
        </div>))}
    </DropdownMenuContent>
  </DropdownMenu>);
