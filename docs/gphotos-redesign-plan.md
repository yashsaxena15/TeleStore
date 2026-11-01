# Photos section: Google Photos–style redesign

Reference: 11 Google Photos screenshots in `~/Screenshots/Screenshot_2026-11-01-23-1*_app.morphe.android.apps.photos.jpg`.
Agreed with the owner on 2026-11-01. Android app first, then the website gets the same design.

## Decisions
- Keep the app's own bottom bar (Home / Photos / Files / Transfers / More). Only the Photos tab changes.
- Google's colours (pure black, dark grey cards, light purple accent) in the Photos section only.
- Build every Google feature we can do ourselves. Leave out Lens, Create (AI) and Ask.
- Layouts: Comfortable (mixed big/small tiles), Day (3-across), Month (small grid with month headings),
  chosen on a "Photos view" page; pinch also switches.
- Extras: stack similar photos, content from other apps (only backed-up, hide clutter, customize by app),
  video length on tiles, backup status pill + panel.
- Details sheet uses our own facts (Backed up to TeleStore · Original quality · stored on Telegram), not Google's wording.
- Edit = basic editor: crop, rotate, brightness/contrast, saved as a new copy; videos: trim.
- A Collections page (icon in the Photos top bar): Favourites, Archive, Trash, Albums, phone folders.
- "+" opens a create menu: New album, Upload from phone, Back up now, Import from Files.
- Ship after each part: merge and build a new APK, owner tries it.

## Parts
1. Main photos screen: backup pill → panel, + / bell / avatar ring, tall memory cards, day headings with
   places + select-all tick + ⋮, month headings, edge-to-edge tiles with thin gaps, Google-style scrubber.
2. Layouts + Photos view page, stack similar, content from other apps.
3. Selection: "✕ N" pill, inset rounded tiles with ticks, action sheet (Share / Add to album / Create / Trash / Backup)
   and an "Add to album · View all" row.
4. Viewer + details: "Nov 1 ›" / "time • place" header, star, ⋮ menu (About, Archive, Use as, Slideshow, Cast,
   Delete from device, Print), Share / Edit / Add to / Trash bar, video controls, details sheet (caption,
   editable date, camera settings, file chips, on-device size/path, add location). Collections page.
5. Basic editor, video length on tiles (server stores duration; older videos are filled in over time).
