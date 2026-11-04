'use strict';

const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { chromium } = require('@playwright/test');

const ideas = [
  'weeknight thai noodles',
  'sheet pan sausage and vegetables',
  'no-oven vegetarian chili',
  '30 minute miso salmon',
  'creamy tomato chickpeas',
  'crispy rice bowl',
  'lemon garlic shrimp pasta',
  'black bean tacos',
  'coconut lentil soup',
  'ginger scallion noodles',
  'roast chicken traybake',
  'mushroom risotto',
  'kimchi fried rice',
  'harissa chickpea stew',
  'pork tenderloin with apples',
];
let remaining = [];

function nextIdea() {
  if (remaining.length === 0) remaining = [...ideas];
  return remaining.splice(Math.floor(Math.random() * remaining.length), 1)[0];
}

function unwrap(href) {
  try {
    const url = new URL(href);
    if (url.hostname.includes('google.') && url.pathname === '/url') {
      return url.searchParams.get('q') || url.searchParams.get('url') || href;
    }
  } catch {
    return href;
  }
  return href;
}

const excludedHost = /google\.|gstatic\.|youtube\.|youtu\.be|pinterest\.|facebook\.|instagram\.|tiktok\.|amazon\./i;
const recipeWords = /\b(recipe|recipes|cooking|ingredients)\b/i;
const recipeSites = /allrecipes|seriouseats|bonappetit|food52|epicurious|simplyrecipes|budgetbytes|bbcgoodfood|cooking\.nytimes|thekitchn|skinnytaste|recipetineats|loveandlemons|cookieandkate|minimalistbaker|halfbakedharvest|foodnetwork|delish|tasty\.co|eatingwell|smittenkitchen/i;
const listicleWords = /\b(best|ideas|roundup|ranked|ways to)\b/i;

function chooseRecipe(links) {
  const candidates = links.flatMap((link) => {
    if (!link.href || link.ad) return [];
    const href = unwrap(link.href);
    try {
      if (excludedHost.test(new URL(href).hostname)) return [];
    } catch {
      return [];
    }
    return [{ ...link, href, text: link.text || href }];
  });
  const isRecipe = ({ text, href }) => recipeWords.test(`${text} ${href}`) || recipeSites.test(`${text} ${href}`);
  const isListicle = ({ text, href }) => listicleWords.test(`${text} ${href}`);

  return candidates.find((link) => isRecipe(link) && !isListicle(link))
    || candidates.find(isRecipe)
    || candidates.find((link) => !isListicle(link))
    || null;
}

async function resolveGoogleLinks(page, links) {
  return Promise.all(links.map(async (link) => {
    if (!link.href || link.ad) return link;
    try {
      const url = new URL(link.href);
      if (!/(^|\.)google\.[a-z.]+$/i.test(url.hostname) || url.pathname !== '/goto') return link;
      const response = await page.request.get(link.href, { maxRedirects: 0, timeout: 10000 });
      const location = response.headers().location;
      await response.dispose();
      return location ? { ...link, href: new URL(location, link.href).href } : link;
    } catch {
      return link;
    }
  }));
}

async function dismissConsent(page) {
  const buttons = [
    page.locator('#L2AGLb'),
    page.getByRole('button', { name: /accept all|agree|consent/i }),
  ];
  try {
    const button = await Promise.any(buttons.map(async (locator) => {
      await locator.first().waitFor({ state: 'visible', timeout: 4000 });
      return locator.first();
    }));
    await button.click();
  } catch (error) {
    if (!(error instanceof AggregateError)) throw error;
  }
}

async function searchRecipe(page, idea) {
  await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded' });
  await dismissConsent(page);
  const search = page.locator('textarea[name="q"], input[name="q"]').first();
  await search.fill(`${idea} recipe`);
  await Promise.all([
    page.waitForURL(/\/(?:search\?|sorry\/)/, { timeout: 120000 }),
    search.press('Enter'),
  ]);

  if (page.url().includes('/sorry/')) {
    console.log('Complete the Google browser check in Edge to continue.');
    await page.waitForURL(/\/search\?/, { timeout: 120000 });
  }
  try {
    await page.locator('#rso a[href], #search a[href]').first().waitFor({ state: 'visible', timeout: 20000 });
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    return [];
  }
  return page.locator('#rso a, #search a').evaluateAll((anchors) => anchors.slice(0, 40).map((anchor) => ({
    href: anchor.href,
    text: (anchor.innerText || anchor.getAttribute('aria-label') || '').trim(),
    ad: Boolean(anchor.closest('#tads, #bottomads, [data-text-ad]')),
  })));
}

async function scrollIngredients(page) {
  const heading = page.getByRole('heading', { name: /ingredients/i }).first();
  try {
    await heading.waitFor({ state: 'visible', timeout: 8000 });
    await heading.scrollIntoViewIfNeeded();
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
  }

  for (let i = 0; i < 5; i += 1) {
    await page.mouse.wheel(0, 260);
    await page.waitForTimeout(700);
  }
}

function createRerollSignal() {
  let pending = false;
  let waiter;
  return {
    request() {
      if (waiter) {
        const resolve = waiter;
        waiter = undefined;
        resolve();
      } else {
        pending = true;
      }
    },
    wait() {
      if (pending) {
        pending = false;
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        waiter = resolve;
      });
    },
  };
}

async function main({ browserType = chromium, input = process.stdin, output = process.stdout, log = console.log, exit = process.exit } = {}) {
  const context = await browserType.launchPersistentContext(
    path.join(os.homedir(), '.cache', 'playwright-edge-google'),
    {
      channel: 'msedge',
      headless: false,
      viewport: { width: 1280, height: 800 },
      slowMo: 200,
      chromiumSandbox: true,
      ignoreDefaultArgs: ['--enable-automation'],
    },
  );
  let closing = false;
  const reroll = createRerollSignal();
  context.once('close', () => {
    closing = true;
    reroll.request();
    exit(0);
  });
  const page = context.pages()[0] || await context.newPage();
  let recipePage;

  await context.exposeBinding('deskReroll', () => reroll.request());
  await context.addInitScript(() => {
    const { document, window } = globalThis;
    const addButton = () => {
      if (document.getElementById('dinner-reroll')) return;
      const button = document.createElement('button');
      button.id = 'dinner-reroll';
      button.textContent = 'Reroll dinner';
      button.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;background:#111;color:#fff;border:0;border-radius:6px;padding:12px 16px;font:16px sans-serif;cursor:pointer';
      button.addEventListener('click', () => window.deskReroll());
      document.body.appendChild(button);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', addButton, { once: true });
    } else {
      addButton();
    }
  });

  const closeBrowser = async () => {
    closing = true;
    await context.close();
  };
  const terminal = readline.createInterface({ input, output });
  context.once('close', () => terminal.close());
  terminal.on('line', async (line) => {
    const command = line.trim().toLowerCase();
    if (command === 'r') reroll.request();
    if (command === 'q') await closeBrowser();
  });
  terminal.on('SIGINT', closeBrowser);

  async function showDinner() {
    const idea = nextIdea();
    log(`Tonight: ${idea}`);
    const links = await resolveGoogleLinks(page, await searchRecipe(page, idea));
    const recipe = chooseRecipe(links);
    if (!recipe) {
      log('No recipe on this results page.');
      return;
    }

    log(`Opening ${recipe.text || recipe.href}`);
    if (!recipePage || recipePage.isClosed()) recipePage = await context.newPage();
    await recipePage.bringToFront();
    await recipePage.goto(recipe.href, { waitUntil: 'domcontentloaded' });
    await dismissConsent(recipePage);
    log(`Recipe: ${recipePage.url()}`);
    await scrollIngredients(recipePage);
  }

  while (!closing) {
    try {
      await showDinner();
    } catch (error) {
      if (closing) return;
      throw error;
    }
    log('Click Reroll dinner or type r and press Enter to reroll. Type q and press Enter to quit.');
    await reroll.wait();
    if (!closing) log('Rerolling…');
  }
}

module.exports = { main, nextIdea, unwrap, chooseRecipe, resolveGoogleLinks, createRerollSignal };

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
