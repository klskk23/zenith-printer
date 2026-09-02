# Connecting nexus-assets to this label printer

One read each for the two sides. For *why* a decision is what it is, see
[`external-systems.md`](external-systems.md) — this page is only how to use it.

**[中文 →](nexus-assets.md)**

Two routes in opposite directions, independent of each other; using one is fine:

| | Who starts it | When it is the right one |
|---|---|---|
| **Pull** | Zenith | Somebody is standing at the printer picking which devices to label |
| **Push** | The ledger | The ledger itself knows when a label is due |

---

## 1. What the deployment does, once

Point Zenith at the ledger with two environment variables:

```
NEXUS_ASSETS_SERVICE_URL=http://nexus-assets:8080
NEXUS_ASSETS_SERVICE_API_KEY=nxk_xxxxxxxxxxxx.yyyyyyyy
```

The same two lines are in `.env.example`, commented out; for containers see
`deploy/docker-compose.yml`.

Three things to know:

- **Both, or neither.** With only one set the integration stays off and says so in
  the startup log. It does not stop the service — printing does not depend on the
  ledger.
- **With neither set, the "connect to the asset ledger" entry point does not appear
  at all.** The same as when Google is not configured.
- **The key is read from the environment only.** It is never stored and never
  echoed by any endpoint. Moving the ledger or rotating the key means editing this
  and restarting; the data sources already created need no attention.

Zenith has **no authentication of its own**, which is exactly why it never accepts a
credential over the network. Keep it on a LAN or a VPN.

## 2. The two endpoints the ledger provides

Zenith calls only these, both with `Authorization: Bearer <key>` and
`Accept-Language`:

```
GET /api/categories
→ [ { "id", "code", "name", "parent_id": null, "path": "/cat-net/", "display_key": "sn" }, … ]
```

`path` is `/ancestor/…/self/`, which Zenith uses to indent the dropdown.
`parent_id`, `path` and `display_key` may be omitted — the list simply is not
indented. **Extra fields are ignored**: the ledger keeps its own things on a
category, `print_preset_ids` among them, and Zenith neither reads nor needs them.

```
GET /api/rows?category_id=<id>&include_descendants=true&offset=0&limit=1000
→ {
    "columns": ["sys_id", "sys_sn", "sys_category", "mac"],
    "rows": [ { "sys_id": "f3ee54e2", "sys_sn": "112394521950", … } ],
    "total": 30, "offset": 0, "limit": 1000
  }
```

Four hard requirements:

1. **Every row carries `sys_id`, non-empty and unique.** It is the row's identity;
   a duplicate or an empty one refuses the whole refresh and names the offenders.
2. **Every value is a string.** Nothing here infers types — guess that `08` is the
   number eight and a barcode loses its leading zero.
3. **`columns` is ordered and authoritative**, and each row's key set must match it
   exactly: no more, no fewer.
4. When `total` exceeds the rows given, Zenith keeps fetching by `offset`, 1000 rows
   at a time, up to **ten thousand rows**.

401 means the key is wrong; 422 means `category_id` was missing. Zenith reports them
separately, because they are different people's repairs.

## 3. Pull: connecting a category

On the **data sources** page press "connect to the asset ledger" and **pick one
category** — the address, the key and which column identifies a row are never asked.
Once a category is chosen its columns are shown, so you know which `${names}` a
design can use before creating anything.

After that:

- A refresh merges on `sys_id`: same id updated, new id appended, ids the ledger
  dropped deleted — and **surviving rows keep their position**.
- Ticked rows are tracked by `sys_id` too, so **a refresh does not clear the
  selection**; if a ticked device really is gone, submitting is refused and says
  which.
- A source can carry a **refresh interval** (0 by default — only when somebody
  presses refresh) and **refresh before printing** (off by default).
- A failed refresh never overwrites the rows already here and never blocks the page.
  With the ledger down, this machine still prints.

## 4. Push: the ledger prints directly

### 4.1 Create a print preset in Zenith

On the **print presets** page: which design, which printer, which print settings,
how many copies per row. Copy its **id** to the ledger.

All four can be changed here at any time without the ledger being touched — which is
the entire reason a preset exists. The ledger keeps that id on a category
(`print_preset_ids`); a category may carry more than one.

To fill a dropdown on the ledger's side:

```
GET /api/print-presets
→ { "presets": [ { "id": "b7b7b0be-…", "name": "Router label", "templateId": "…", … } ] }
```

The `presets` envelope is part of the contract, not an implementation detail.

### 4.2 Deep link: take a person there with the settings ready

```
{ZENITH_URL}/design/{templateId}?preset={presetId}
```

`templateId` comes from `presets[].templateId` in the list above.

The page opens with the printer, the print settings and the copy count **already set
from the preset**, and the canvas follows the preset's stock. It **does not print,
and does not open the print dialog** — pressing it stays a person's decision.
`?preset=` stays in the address, so a refresh, a back and a forward all land in the
same place.

It is only an initial value: once somebody changes the printer, nothing puts it back.

Four situations are stated on the page, and the label opens regardless:

| Situation | What happens |
|---|---|
| No such preset | The printer is **left unselected**, with the reason given — never a silent fall back to whichever is default |
| Its printer was deleted | The same |
| Its print settings were deleted | The rest still applies; density and stock not being set is said out loud |
| It points at a different label | **The address wins** — nothing is swapped out from under whoever clicked it |

### 4.3 Direct submission: the ledger produces the labels

```bash
curl -X POST {ZENITH_URL}/api/print-presets/{presetId}/print \
  -H 'Idempotency-Key: <a stable id for this batch>' \
  -H 'Content-Type: application/json' \
  -d '{
        "columns": ["mac", "sys_sn"],
        "rows": [ { "mac": "001A2B3C4D5E", "sys_sn": "112394521950" } ],
        "copies": 2
      }'
```

```json
202 { "jobId": "40d56187-…", "status": "queued", "requestedCopies": 2, "seqClaims": [], "deduplicated": false }
```

Poll `GET /api/print-jobs/{jobId}` with that id — the same job state the browser
shows, not a second one built for this route.

**Always send `Idempotency-Key`.** The same key returns the same `jobId` with
`deduplicated: true` and prints nothing extra. Label stock is physical and cannot be
recalled. Use a natural identifier for the batch — a work order, a batch number —
not a timestamp.

`copies` is optional; without it the preset's own count is used. The rows are
one-off: they never become a stored data source.

Common refusals:

| code | What it means |
|---|---|
| `VARIABLE_NOT_DEFINED` | The design wants a `${name}` that is not a column in this batch; `details.references` lists them |
| `BATCH_TOO_LARGE` | rows × copies > 1000. **Never split automatically** — how to divide it is your decision |
| `QUEUE_PAUSED` | That printer's queue has been paused by somebody (409) |
| `VALIDATION_FAILED` | The printer has not been probed, so nobody knows how wide its head is |
| `NOT_FOUND` | The preset, or the design or printer it names, is gone |

## 5. When it will not connect, look here first

| What you see | Usually |
|---|---|
| No "connect to the asset ledger" on the data sources page | Only one of the two variables is set; check the startup log |
| "the ledger does not accept this machine's key" | Rotated or revoked; update the variable and restart |
| "cannot be reached" | Wrong address, or the ledger took longer than 30 seconds |
| "what came back is not a row envelope" | `details.detail` names the row and the key that is wrong |
| A refresh reporting a duplicate or empty `sys_id` | A data problem on the ledger's side; `details` lists the values |
| The deep link opened but nothing was set | A yellow notice at the foot of the page says why |

Every error is the same four parts — `{code, what, why, next}` — and `what` and
`next` can be shown to a person as they are.
