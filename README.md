# Shoreline

## How this repository works (the easy version)

You don't need to know git. Claude handles it:

1. **Ask Claude for a change**, either in the Claude app (Claude Code) or by
   writing `@claude <your request>` in a GitHub issue.
2. Claude writes the code and pushes it to a branch named `claude/...`.
3. GitHub **automatically** runs the tests, opens a pull request, and **merges
   it into `main`**. You don't need to click anything.

You can watch it happen under the **Actions** tab of this repository. A green
check means it worked.

### Want to stop something from being merged?

Open the pull request on GitHub and either click **"Convert to draft"** or add
the label **`hold`**. Nothing gets merged while either is on.

### If something goes red ❌

Click the failed run under **Actions** to read the message. Usually you can
just tell Claude: *"the auto-merge failed, please fix it"*.

---

## One-time setup (about 5 minutes)

### 1. Let GitHub Actions open pull requests (required)

1. Open this repository on GitHub and click **Settings**.
2. In the left menu go to **Actions → General**.
3. Scroll to **Workflow permissions**.
4. Choose **"Read and write permissions"**.
5. Tick **"Allow GitHub Actions to create and approve pull requests"**.
6. Click **Save**.

### 2. Turn on `@claude` in issues (optional)

Do this only if you want to ask Claude for work directly on GitHub.

1. Install the Claude GitHub App: https://github.com/apps/claude, and give it
   access to this repository.
2. Add a secret so the workflow can use your Claude account:
   - **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `ANTHROPIC_API_KEY`, value: an API key from
     https://console.anthropic.com
     *(or, if you have Claude Code on a computer, run `claude setup-token`
     and save the result as a secret named `CLAUDE_CODE_OAUTH_TOKEN`)*

Only you (the repository owner) can trigger `@claude`, so other people can't
get code merged into your project.

---

## Shoreline Lab (`shoreline-sim/`)

A physics model of the eroding beach at Laulea Place (Kuʻau, Maui), driven by
real NOAA wave-buoy (51205 Pauwela) and tide-gauge (1615680 Kahului) records.
It compares legal, soft ways to stabilise the shoreline: native dune plants,
sand nourishment, coir toe protection and temporary sand bags.

- `shoreline-sim/index.html` – interactive simulator page
- `shoreline-sim/model.js` – the physics (runup, wave-impact erosion, sand budget)
- `shoreline-sim/data/` – raw NOAA downloads and the packed hourly dataset
- `shoreline-sim/tools/build_data.py` – rebuilds the dataset (`npm run build-data`)
- `shoreline-sim/test/` – model tests (`npm test`)

This is a planning tool, not a stamped engineering design.
- `shoreline-sim/plan.html` – the restoration design (renders, engineering, costs, build plan)
- `shoreline-sim/tools/optimize.js` – searches design combinations and prices them (`data/design.json`)
- `shoreline-sim/render/scene.js` + `tools/render.js` – 3D site model and before/after renders
- `shoreline-sim/tools/dem.py`, `grading.py` – 2023 lidar elevation grid and the designed grading surface
- `shoreline-sim/tools/cad.py` – concept drawings: `cad/*.pdf` (7 sheets) and `cad/*.dxf` (UTM zone 4N)
