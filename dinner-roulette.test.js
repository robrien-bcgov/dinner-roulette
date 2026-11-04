'use strict';

const { test, expect } = require('@playwright/test');
const { PassThrough } = require('node:stream');
const { main, nextIdea, unwrap, resolveGoogleLinks, chooseRecipe, createRerollSignal } = require('./dinner-roulette');

test.describe('core logic', { tag: '@unit' }, () => {
  test('draws every meal once before refilling the bag', () => {
    const firstBag = Array.from({ length: 15 }, () => nextIdea());
    const secondBag = Array.from({ length: 15 }, () => nextIdea());
    expect(new Set(firstBag).size).toBe(15);
    expect(new Set(secondBag)).toEqual(new Set(firstBag));
  });

  for (const { name, links, expected } of [
    {
      name: 'prefers a recipe over a listicle',
      links: [
        { href: 'https://food.test/best-recipes', text: 'Best recipes' },
        { href: 'https://food.test/chili-recipe', text: 'Chili recipe' },
      ],
      expected: 'https://food.test/chili-recipe',
    },
    {
      name: 'falls back to a recipe listicle',
      links: [{ href: 'https://food.test/best-recipes', text: 'Best recipes' }],
      expected: 'https://food.test/best-recipes',
    },
    {
      name: 'falls back to a non-listicle page',
      links: [{ href: 'https://food.test/chili', text: 'Chili' }],
      expected: 'https://food.test/chili',
    },
    {
      name: 'recognizes a known recipe site',
      links: [{ href: 'https://www.seriouseats.com/chili', text: 'Chili' }],
      expected: 'https://www.seriouseats.com/chili',
    },
    {
      name: 'rejects malformed, missing, sponsored, social, and non-recipe listicle links',
      links: [
        {},
        { href: 'not a URL', text: 'Recipe' },
        { href: 'https://ads.test/recipe', ad: true },
        { href: 'https://www.youtube.com/recipe' },
        { href: 'https://food.test/best-ideas', text: 'Best ideas' },
      ],
      expected: null,
    },
    { name: 'handles an empty result list', links: [], expected: null },
  ]) {
    test(name, () => {
      expect(chooseRecipe(links)?.href ?? null).toBe(expected);
    });
  }

  test('unwraps Google query parameters and leaves malformed URLs unchanged', () => {
    expect(unwrap('https://www.google.com/url?q=https%3A%2F%2Ffood.test%2Frecipe')).toBe('https://food.test/recipe');
    expect(unwrap('https://www.google.com/url?url=https%3A%2F%2Ffood.test%2Frecipe')).toBe('https://food.test/recipe');
    expect(unwrap('https://food.test/recipe')).toBe('https://food.test/recipe');
    expect(unwrap('not a URL')).toBe('not a URL');
  });

  test('remembers requests made before waiting and coalesces repeated clicks', async () => {
    const signal = createRerollSignal();
    signal.request();
    signal.request();
    await signal.wait();
    let resolved = false;
    const waiting = signal.wait().then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false);
    signal.request();
    await waiting;
    expect(resolved).toBe(true);
  });

  test('resolves an active waiter without creating a second pending reroll', async () => {
    const signal = createRerollSignal();
    const waiting = signal.wait();
    signal.request();
    await waiting;
    let resolved = false;
    const nextWaiting = signal.wait().then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false);
    signal.request();
    await nextWaiting;
    expect(resolved).toBe(true);
  });

  test('leaves failed redirects excluded without discarding valid recipes', async () => {
    const links = [
      { href: 'https://www.google.com/goto?url=broken', text: 'Recipe' },
      { href: 'https://food.test/recipe', text: 'Recipe' },
    ];
    const page = { request: { get: async () => { throw new Error('Request timed out'); } } };
    const resolved = await resolveGoogleLinks(page, links);
    expect(resolved).toEqual(links);
    expect(chooseRecipe(resolved).href).toBe('https://food.test/recipe');
  });

  test('disposes redirect responses even when no destination is returned', async () => {
    let disposed = false;
    const page = { request: { get: async () => ({
      headers: () => ({}),
      dispose: async () => { disposed = true; },
    }) } };
    const links = [{ href: 'https://www.google.com/goto?url=missing' }];
    expect(await resolveGoogleLinks(page, links)).toEqual(links);
    expect(disposed).toBe(true);
  });
});

async function startDinner(context, { delayedResults = false, noRecipe = false, noIngredients = false, browserCheck = false, holdNavigation = false } = {}) {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'www.google.com') {
      if (url.pathname === '/sorry/') {
        return route.fulfill({ contentType: 'text/html', body: `<a href="/search?q=${encodeURIComponent(url.searchParams.get('q'))}&checked=1">Continue</a>` });
      }
      const results = url.pathname === '/search'
        ? noRecipe ? '<div id="rso"><a href="https://www.pinterest.com/recipe">Pinterest recipe</a></div>' : `<div id="rso">
            <div id="tads"><a href="https://ads.test/recipe">Sponsored recipe</a></div>
            <a href="https://www.pinterest.com/recipe">Pinterest recipe</a>
            <a href="https://recipe.test/best-recipes">Best dinner ideas</a>
            <a href="https://recipe.test/recipes/${encodeURIComponent(url.searchParams.get('q'))}">Dinner recipe</a>
          </div>`
        : '';
      return route.fulfill({
        contentType: 'text/html',
        body: `<button id="L2AGLb" onclick="this.remove()">Accept all</button>
          <form action="${browserCheck ? '/sorry/' : '/search'}"><input name="q"><button>Search</button></form>${delayedResults && results
            ? `<div id="rso" style="min-height:1px"></div><script>setTimeout(() => {
                document.getElementById('rso').outerHTML = ${JSON.stringify(results)};
              }, 1500);</script>`
            : results}`,
      });
    }
    if (url.hostname === 'recipe.test') {
      if (holdNavigation) return;
      return route.fulfill({
        contentType: 'text/html',
        body: `<button onclick="this.remove()">Agree</button>
          <h1>Dinner recipe</h1>
          <div style="height:1600px">Recipe introduction</div>
          <section id="ingredients" style="height:2600px;background:#eee">
            <h2>${noIngredients ? 'Pantry' : 'Ingredients'}</h2><ul><li>Noodles</li><li>Vegetables</li></ul>
          </section>`,
      });
    }
    return route.abort();
  });

  const searchPage = await context.newPage();
  const input = new PassThrough();
  const output = new PassThrough();
  output.isTTY = true;
  const messages = [];
  const errors = [];
  const exits = [];
  const completion = main({
    browserType: { launchPersistentContext: async () => context },
    input,
    output,
    log: (message) => messages.push(message),
    exit: (code) => exits.push(code),
  }).catch((error) => errors.push(error));

  return {
    searchPage,
    completion,
    input,
    errors,
    exits,
    messages,
    interrupt: () => input.write('\u0003'),
    async waitForDinner(count) {
      await expect.poll(() => messages.filter((message) => message.startsWith('Click Reroll dinner')).length, { timeout: 20000 })
        .toBe(count);
      expect(errors).toEqual([]);
    },
    cleanup() {
      input.destroy();
      output.destroy();
    },
  };
}

test('opens ingredients in another tab, rerolls, recreates a closed tab, and quits', async ({ context }) => {
  test.setTimeout(60000);
  const app = await startDinner(context);
  try {
    await app.waitForDinner(1);
    expect(context.pages()).toHaveLength(2);
    await expect(app.searchPage).toHaveURL(/google\.com\/search\?q=/);
    const recipePage = context.pages().find((page) => page !== app.searchPage);
    await expect(recipePage).toHaveURL(/^https:\/\/recipe\.test\/recipes\//);
    await expect.poll(() => recipePage.evaluate(() => globalThis.document.hasFocus())).toBe(true);
    await expect(recipePage.getByRole('button', { name: 'Reroll dinner' })).toBeVisible();
    await expect.poll(() => recipePage.evaluate(() => {
      const { document, window, innerHeight } = globalThis;
      const rect = document.getElementById('ingredients').getBoundingClientRect();
      return window.scrollY > 1600 && rect.top < innerHeight && rect.bottom > 0;
    })).toBe(true);
    const firstRecipe = recipePage.url();

    await recipePage.getByRole('button', { name: 'Reroll dinner' }).click();
    await app.waitForDinner(2);
    expect(context.pages()).toHaveLength(2);
    expect(recipePage.url()).not.toBe(firstRecipe);

    app.input.write('r\n');
    await app.waitForDinner(3);
    expect(context.pages()).toHaveLength(2);
    expect(new Set(app.messages.filter((message) => message.startsWith('Tonight:'))).size).toBe(3);

    await recipePage.close();
    app.input.write('r\n');
    await app.waitForDinner(4);
    expect(context.pages()).toHaveLength(2);
    const replacement = context.pages().find((page) => page !== app.searchPage);
    expect(replacement).not.toBe(recipePage);
    await expect(replacement.getByRole('heading', { name: 'Ingredients', exact: true })).toBeAttached();
    await expect(app.searchPage).toHaveURL(/google\.com\/search\?q=/);

    app.input.write('q\n');
    await expect.poll(() => app.exits).toEqual([0]);
    expect(context.pages()).toHaveLength(0);
    expect(app.errors).toEqual([]);
  } finally {
    await app.cleanup();
  }
});

test('waits for recipe links when the results container is initially empty', async ({ context }) => {
  const app = await startDinner(context, { delayedResults: true });
  try {
    await expect.poll(() => context.pages().length, { timeout: 10000 }).toBe(2);
    await app.waitForDinner(1);
    expect(context.pages()).toHaveLength(2);
    const recipePage = context.pages().find((page) => page !== app.searchPage);
    await expect(recipePage).toHaveURL(/^https:\/\/recipe\.test\/recipes\//);
  } finally {
    await app.cleanup();
  }
});

test('quits cleanly while the recipe is still scrolling', async ({ context }) => {
  const app = await startDinner(context);
  try {
    await expect.poll(() => app.messages.some((message) => message.startsWith('Recipe:'))).toBe(true);
    app.input.write('q\n');
    await app.completion;
    await expect.poll(() => app.exits).toEqual([0]);
    expect(app.errors).toEqual([]);
  } finally {
    await app.cleanup();
  }
});

test('recovers when the recipe tab closes while scrolling', async ({ context }) => {
  const app = await startDinner(context);
  try {
    await expect.poll(() => app.messages.some((message) => message.startsWith('Recipe:'))).toBe(true);
    const recipePage = context.pages().find((page) => page !== app.searchPage);
    await expect.poll(() => recipePage.evaluate(() => globalThis.scrollY)).toBeGreaterThan(0);
    await recipePage.close();
    await app.waitForDinner(1);

    app.input.write('r\n');
    await app.waitForDinner(2);
    expect(context.pages()).toHaveLength(2);
    expect(app.errors).toEqual([]);
  } finally {
    await app.cleanup();
  }
});

test('resolves opaque Google redirects before filtering recipe destinations', { tag: '@unit' }, async () => {
  const destinations = new Map([
    ['https://www.google.com/goto?url=opaque-pinterest', 'https://www.pinterest.com/recipe'],
    ['https://www.google.com/goto?url=opaque-recipe', 'https://www.seriouseats.com/chili-recipe'],
    ['https://www.google.com/goto?url=opaque-google', 'https://www.google.com/search?q=recipe'],
  ]);
  const requests = [];
  const page = {
    request: {
      async get(href, options) {
        requests.push(href);
        expect(options.maxRedirects).toBe(0);
        return { headers: () => ({ location: destinations.get(href) }), dispose: async () => {} };
      },
    },
  };
  const links = await resolveGoogleLinks(page, [
    { href: 'https://www.google.com/goto?url=opaque-ad', text: 'Sponsored recipe', ad: true },
    ...Array.from(destinations.keys(), (href) => ({ href, text: 'Chili recipe' })),
    { href: 'https://recipe.test/best-ideas', text: 'Best dinner ideas' },
    { href: 'https://www.google.com/url?q=https%3A%2F%2Fwww.pinterest.com%2Frecipe', text: 'Recipe' },
  ]);
  expect(chooseRecipe(links).href).toBe('https://www.seriouseats.com/chili-recipe');
  expect(requests).toEqual(Array.from(destinations.keys()));
});

test('allows rerolling when no suitable recipe is found', async ({ context }) => {
  const app = await startDinner(context, { noRecipe: true });
  try {
    await app.waitForDinner(1);
    expect(app.messages).toContain('No recipe on this results page.');
    expect(context.pages()).toHaveLength(1);
    await app.searchPage.getByRole('button', { name: 'Reroll dinner' }).click();
    await app.waitForDinner(2);
    expect(new Set(app.messages.filter((message) => message.startsWith('Tonight:'))).size).toBe(2);
  } finally {
    await app.cleanup();
  }
});

test('still scrolls when the recipe has no Ingredients heading', async ({ context }) => {
  const app = await startDinner(context, { noIngredients: true });
  try {
    await app.waitForDinner(1);
    const recipePage = context.pages().find((page) => page !== app.searchPage);
    await expect.poll(() => recipePage.evaluate(() => globalThis.scrollY)).toBeGreaterThan(0);
    await expect(recipePage.getByRole('button', { name: 'Reroll dinner' })).toBeVisible();
  } finally {
    await app.cleanup();
  }
});

test('continues after the user completes a Google browser check', async ({ context }) => {
  const app = await startDinner(context, { browserCheck: true });
  try {
    await expect(app.searchPage).toHaveURL(/\/sorry\//, { timeout: 15000 });
    await app.searchPage.getByRole('link', { name: 'Continue' }).click();
    await app.waitForDinner(1);
    const recipePage = context.pages().find((page) => page !== app.searchPage);
    await expect(recipePage).toHaveURL(/^https:\/\/recipe\.test\/recipes\//);
  } finally {
    await app.cleanup();
  }
});

test('quits cleanly during recipe navigation', async ({ context }) => {
  const navigation = context.waitForEvent('request', { predicate: (request) => request.url().startsWith('https://recipe.test/') });
  const app = await startDinner(context, { holdNavigation: true });
  try {
    await navigation;
    app.input.write('q\n');
    await app.completion;
    await expect.poll(() => app.exits).toEqual([0]);
    expect(app.errors).toEqual([]);
  } finally {
    await app.cleanup();
  }
});

for (const { name, quit } of [
  { name: 'Q', quit: (app) => app.input.write(' Q \n') },
  { name: 'SIGINT', quit: (app) => app.interrupt() },
  { name: 'close window', quit: (app, context) => context.close() },
]) {
  test(`quits cleanly with ${name}`, async ({ context }) => {
    const app = await startDinner(context);
    try {
      await app.waitForDinner(1);
      await quit(app, context);
      await expect.poll(() => app.exits).toEqual([0]);
      expect(context.pages()).toHaveLength(0);
      expect(app.errors).toEqual([]);
    } finally {
      await app.cleanup();
    }
  });
}
