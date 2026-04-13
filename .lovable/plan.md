

## Plan: Machine Registry with Friendly Names

### Overview
Create a `machine_registry` table to store machine serial numbers with friendly names, then display those names throughout the app. Add an admin management page.

### 1. Database Migration
Create `machine_registry` table and seed data:
- Columns: `id`, `serial_number` (unique), `friendly_name`, `category` (tele/frota), `is_active` (default true), `created_at`, `updated_at`
- RLS: authenticated SELECT for all, admin ALL
- Insert all 17 machines (4 Frota + 13 Tele)

### 2. Custom Hook: `useMachineRegistry`
New file `src/hooks/useMachineRegistry.ts`:
- Fetches all active machines from `machine_registry` on mount
- Returns a `Map<string, { friendly_name, category }>` keyed by serial_number
- Helper function `getFriendlyName(serial)` returns friendly name or null
- Cache in React Query or local state (single fetch per page load)

### 3. Update `SerialAutocomplete`
- Accept machine registry map as prop
- Show friendly name next to each suggestion (e.g., "**Tele 1** — 158242609374")
- Allow searching by friendly name too (filter matches on both `serial` and `friendly_name`)
- When user types "Tele 5", match the corresponding serial

### 4. Update `MachineReadingsSection`
- Load machine registry via the new hook
- Pass registry to `SerialAutocomplete`
- In the collapsed header line, show friendly name instead of raw serial: "**Tele 1** — Sem entregador" with small SN below
- In totals-by-driver dialog, show friendly name if available
- In the expanded detail, show friendly name label next to the SN input

### 5. Admin Page: `/admin/maquininhas`
New file `src/pages/MachineRegistry.tsx`:
- Simple CRUD table for machines
- Fields: friendly_name, serial_number, category (dropdown: tele/frota), is_active (toggle)
- Add new machine button, inline edit, delete confirmation
- Admin-only access

### 6. Routing & Navigation
- Add route `/admin/maquininhas` in `App.tsx` (admin-guarded)
- Add sidebar entry in `AppSidebar.tsx` for admins only

### Files to Create/Edit
| File | Action |
|------|--------|
| Migration SQL | Create table + seed data |
| `src/hooks/useMachineRegistry.ts` | Create |
| `src/components/SerialAutocomplete.tsx` | Edit — add friendly name display + search |
| `src/components/MachineReadingsSection.tsx` | Edit — integrate registry, update display |
| `src/pages/MachineRegistry.tsx` | Create — admin CRUD page |
| `src/App.tsx` | Edit — add route |
| `src/components/AppSidebar.tsx` | Edit — add nav item |

