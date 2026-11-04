# Dinner roulette — build plan

Rebuild the headed Playwright dinner roulette on a new computer. One Node script opens Microsoft Edge, searches Google for a random weeknight meal, opens the first real recipe in a separate tab, scrolls the ingredients, and waits. Reroll from a button on the page or by typing `r` in the terminal. Type `q` and press Enter or close the window when you are cooking.

This plan is only the dinner script. It does not include the morning-desk or Google “apples” scripts from the home machine.

## What you need

- Node.js 18 or newer
- Microsoft Edge installed (the script launches Edge, not bundled Chromium)
- A network connection
- A terminal you can leave open while the browser is up

Google login does not come along. The browser profile is created on this machine at `~/.cache/playwright-edge-google`. The first calendar-free run only needs normal Google search. If Google shows a browser check, finish it in the open window. The script waits up to two minutes for the results page.

## Create the project

From an empty folder:

```bash
mkdir playwright && cd playwright
npm init -y
npm install --save-dev @playwright/test
```

`package.json` needs `"type": "commonjs"` and a dinner script. The rest of the generated file can stay.

```json
{
  "type": "commonjs",
  "scripts": {
    "dinner": "node dinner-roulette.js"
  },
  "devDependencies": {
    "@playwright/test": "^1.64.1"
  }
}
```

The dinner script is plain Node, not a Playwright test, so it can stay running after the recipe is open. `playwright.config.js` configures only the automated `*.test.js` suite, including Edge and failure artifacts; it does not affect `npm run dinner`.

Add `dinner-roulette.js` next to `package.json`. Use only Node built-ins plus `chromium` from `@playwright/test`.

## How a run should feel

1. `npm run dinner` opens a visible Edge window, 1280×800, with a short delay between actions (`slowMo: 200`).
2. The terminal prints `Tonight: <meal>`.
3. The window goes to Google, accepts a consent dialog if one is there, types `<meal> recipe`, and submits.
4. It skips ads, Google’s own links, YouTube, Pinterest, Facebook, Instagram, TikTok, and Amazon.
5. It prefers a result whose title or URL looks like a recipe and is not a listicle (“best”, “ideas”, “roundup”, “ranked”, “ways to”).
6. It opens that page in a separate, focused recipe tab, scrolls to an Ingredients heading when one exists, then wheels down five times. Google results stay in the original tab; rerolls reuse the recipe tab, recreating it if you closed it.
7. The terminal prints the recipe URL and tells you how to reroll.
8. A black **Reroll dinner** button sits at the bottom-right of every page.
9. Click the button, or type `r` and press Enter. The script picks a meal it has not used yet this session and starts again.
10. Type `q` and press Enter or press Ctrl+C in the terminal to close Edge and exit. Closing the Edge window also exits.

Meals are drawn from a bag without replacement. When the bag is empty, refill it. Use these ideas:

- weeknight thai noodles
- sheet pan sausage and vegetables
- no-oven vegetarian chili
- 30 minute miso salmon
- creamy tomato chickpeas
- crispy rice bowl
- lemon garlic shrimp pasta
- black bean tacos
- coconut lentil soup
- ginger scallion noodles
- roast chicken traybake
- mushroom risotto
- kimchi fried rice
- harissa chickpea stew
- pork tenderloin with apples

## Script structure

Keep everything in `dinner-roulette.js`. These are the pieces, in order.

**Profile and browser.** Launch a persistent Edge context:

- `channel: 'msedge'`
- `headless: false`
- `viewport: { width: 1280, height: 800 }`
- `slowMo: 200`
- `chromiumSandbox: true`
- Do not pass `--disable-blink-features=AutomationControlled`; Edge displays an unsupported-command-line warning for it.
- `ignoreDefaultArgs: ['--enable-automation']`
- user data dir: `path.join(os.homedir(), '.cache', 'playwright-edge-google')`

On `context` `close`, call `process.exit(0)`. Use the first existing page, or `context.newPage()`.

**Meal picker.** `nextIdea()` refills a `remaining` array from the list above, splices one entry out at random, and returns it.

**Link cleanup.** `unwrap(href)` parses the URL. If the host contains `google.` and the path is `/url`, return the `q` or `url` query parameter. Otherwise return the original href.

**Recipe choice.** `chooseRecipe(links)` unwraps hrefs, drops links with no href, links flagged as ads, and hosts matching:

`google.|gstatic.|youtube.|youtu.be|pinterest.|facebook.|instagram.|tiktok.|amazon.`

Then return the first of:

1. A recipe-like link that is not a listicle
2. Any recipe-like link
3. Any remaining link that is not a listicle
4. `null`

Treat a link as recipe-like when its text or href matches a recipe word or a known recipe site (`allrecipes`, `seriouseats`, `bonappetit`, `food52`, `epicurious`, `simplyrecipes`, `budgetbytes`, `bbcgoodfood`, `cooking.nytimes`, `thekitchn`, `skinnytaste`, `recipetineats`, `loveandlemons`, `cookieandkate`, `minimalistbaker`, `halfbakedharvest`, `foodnetwork`, `delish`, `tasty.co`, `eatingwell`, `smittenkitchen`).

**Consent.** Look for `#L2AGLb` or a button named accept all / agree / consent. Click the first match if it shows up within 4 seconds. If it does not, continue.

**Search.** Open `https://www.google.com` with `waitUntil: 'domcontentloaded'`, dismiss consent, fill `textarea[name="q"], input[name="q"]` with `<idea> recipe`, and press Enter while waiting for navigation to `/search?` or `/sorry/`. If the URL contains `/sorry/`, tell the user to complete the browser check and wait up to 120 seconds for `/search?`. Then wait up to 20 seconds for a visible result link inside `#rso` or `#search`, not just the results container.

**First result.** Read up to 40 anchors inside `#rso a, #search a`. For each, keep `href`, the trimmed text or `aria-label`, and `ad: true` when the anchor sits inside `#tads`, `#bottomads`, or `[data-text-ad]`. For non-ad Google `/goto` links, request the redirect without following it and replace the href with its `Location` destination. Leave failed redirects unchanged so the picker excludes them. Pass that list to `chooseRecipe`.

**Ingredients.** Wait up to 8 seconds for a heading whose name matches `/ingredients/i`, then `scrollIntoViewIfNeeded`. If that heading never appears, still wheel. Wheel `page.mouse.wheel(0, 260)` five times, pausing 700ms between each.

**One dinner.** Log `Tonight: <idea>`, search, pick a recipe, and log `Opening <text or href>`. Create a separate recipe tab if one does not exist or was closed, bring it to the front, go to that URL, dismiss consent, log the final URL, and scroll that tab. Keep the original page for Google searches and reuse the recipe tab on rerolls. If no recipe was found, log `No recipe on this results page.` and return. The reroll step still runs.

**Reroll signal.** One object with `request()` and `wait()`:

- `request()` resolves the current waiter if one exists, otherwise sets a `pending` flag.
- `wait()` consumes `pending` immediately if it is already set. Otherwise it returns a promise and stores the resolver. Also listen once for the browser context to close and exit.

Clicks during search are remembered and trigger a reroll as soon as the recipe step finishes.

**On-page button.** Before the first navigation:

- `context.exposeBinding('deskReroll', ...)` calls `request()`
- `context.addInitScript` adds a fixed button, id `dinner-reroll`, label `Reroll dinner`, pinned to the bottom-right with a high z-index. Clicking it calls `window.deskReroll()`. Mount on `DOMContentLoaded` if the document is still loading. Do not add a second button if the id is already there.

**Terminal.** `readline` on stdin. A line whose trim is `r` or `R` calls `request()`. A line whose trim is `q` or `Q` closes the browser context. Ctrl+C also closes the context.

**Loop.** Forever: `showDinner`, print the reroll instructions, `await reroll.wait()`, print `Rerolling…`.

Wrap `main()` in a catch that prints the error and exits 1.

## Check it

Do not run this while another script is using `~/.cache/playwright-edge-google`. Edge locks that folder.

1. `node --check dinner-roulette.js` exits 0.
2. `npm run dinner` opens Edge and prints a `Tonight:` line within a few seconds.
3. Google results appear, then a recipe page opens in a separate, focused tab. The Google results remain in the original tab. The terminal prints an `http` URL that is not a Google, YouTube, or Pinterest link.
4. The page scrolls. The **Reroll dinner** button is visible.
5. Click the button. A new `Tonight:` line uses a different meal, and a new recipe opens in the existing recipe tab.
6. Type `r` and press Enter. A third meal opens.
7. Close only the recipe tab, then type `r` and press Enter. A new recipe tab opens.
8. Type `q` and press Enter. Edge closes and the terminal returns to a prompt. On separate runs, check that closing the Edge window and pressing Ctrl+C also exit.

A small node snippet can call `chooseRecipe` without opening a browser. Given an ad, a Pinterest link wrapped in `https://www.google.com/url?q=...`, a Serious Eats recipe link, and a “best ideas” listicle, the picker returns the Serious Eats href.

## Limits

- Google’s results markup changes. If the script reaches Google and then times out on `#rso, #search`, update those selectors before changing the picker.
- Some recipe sites never use an Ingredients heading. The wheel-down still runs.
- The floating button is injected by Playwright. It disappears if you keep browsing after the Node process has exited.
- The persistent profile is local to this computer. Signing into Google here does not affect the home machine, and the reverse is also true.
