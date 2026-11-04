# Dinner Roulette

A Node.js script that chooses a weeknight meal, searches Google for a recipe, opens a likely result in Microsoft Edge, and scrolls toward its ingredients. Meal ideas are selected without repeats until they have all been used.

## Requirements

- Node.js 18 or newer
- Microsoft Edge
- Internet access

## Run

From the project directory:

```bash
npm install
npm run dinner
```

## How a Run Feels

1. A visible Edge window opens with a short pause between actions. The terminal prints `Tonight: <meal>`.
2. Google searches for that meal's recipe. The script skips ads and social links, preferring a recipe over a roundup or list of ideas.
3. A recipe opens in a separate, focused tab while Google results stay in the original tab. The terminal prints the recipe URL.
4. The page scrolls to an Ingredients heading when it finds one, then wheels down a little further. If there is no heading, it still scrolls.
5. The browser stays open while you decide or cook. A black **Reroll dinner** button sits at the bottom-right of the page.
6. Click the button, or type `r` and press Enter in the terminal, for a different meal. Rerolls reuse the recipe tab, reopening it if you closed it. Meals do not repeat until the session's bag is empty. A reroll requested during loading is remembered until the current recipe step finishes.
7. Type `q` and press Enter, press Ctrl+C in the terminal, or close the Edge window to finish.

Keep the terminal open while using the browser. If no suitable recipe is found, the script says so and lets you reroll.

## Browser Profile

The script stores its persistent browser profile at `~/.cache/playwright-edge-google`. If Google displays a browser check, complete it in the open window. The script waits for search navigation and visible result links, then resolves Google's opaque redirect links before choosing a recipe. Recipe selection relies on Google search results and can be affected by changes to Google's page markup.

Only run one copy at a time: Edge locks the profile while it is in use.

## Development

Use Node.js 24 LTS for development. ESLint 10 requires Node.js 20.19+, 22.13+, or 24+. The dinner script itself requires Node.js 18 or newer.

```bash
npm run check
```

This runs lint followed by all tests. Individual checks are also available:

```bash
npm run lint
npm test
npm run test:unit
npm run test:browser
```

ESLint checks JavaScript with its recommended rules and applies Playwright-specific rules to tests. Node globals are the default; injected browser callbacks access browser globals explicitly. Generated reports, test results, and dependencies are excluded. Warnings fail the lint command.

Tests use Playwright as the only test runner:

- Fast `@unit` tests import helpers directly without opening a browser. They cover meal-bag refill, recipe-ranking priorities, malformed links, Google redirect handling, and queued rerolls. For example, a recipe should win over a "best ideas" listicle, and a request made before `wait()` should be remembered.
- Browser tests run headless Edge in isolated contexts with intercepted Google and recipe pages. They cover separate tabs, scrolling, rerolls, closed-tab recreation, delayed links, no suitable recipe, missing Ingredients headings, browser-check recovery, and quitting during navigation or scrolling.

Tests do not use your saved profile or contact live recipe sites. Importing the script does not launch Edge; the entry point runs only when invoked directly.

Playwright keeps screenshots and traces for failed tests under `test-results/` and writes an HTML report under `playwright-report/`. To inspect the last report:

```bash
npx playwright show-report
```

Open a failed test's trace from the report to inspect its actions and network activity. Tests do not automatically retry, so failures remain visible.

## Continuous Integration

GitHub Actions runs on pushes and pull requests using Node.js 24 and Ubuntu. It installs locked dependencies with `npm ci`, installs Edge and its system dependencies, and runs `npm run check`. Failed runs upload the test results and HTML report as artifacts retained for seven days. Focused `test.only` cases are rejected in CI.

Live Google searches remain a manual smoke check with `npm run dinner`; external markup and browser checks are not reliable CI gates.
