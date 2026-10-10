// JSON fetching for the public F1 APIs, kept under their rate limits.
// OpenF1 allows 3 requests/second and Jolpica about 4/second (500/hour), so
// each API gets its own queue; a 429 or 5xx is retried with backoff.
// `cache: 'no-cache'` makes the browser revalidate instead of reusing a
// response for Jolpica's 10-minute max-age, so new results show up at once.

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function makeQueue(spacingMs) {
  let tail = Promise.resolve();
  return (task) => {
    const run = tail.then(task);
    tail = run.catch(() => { }).then(() => sleep(spacingMs));
    return run;
  };
}

async function getJSON(url, retries = 3) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { cache: 'no-cache' });
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const retryAfter = Number(res.headers.get('retry-after')) || 1;
      await sleep(retryAfter * 1000 * (attempt + 1));
      continue;
    }
    throw new Error(`${new URL(url).host} returned ${res.status}`);
  }
}

const jolpicaQueue = makeQueue(300);
const openf1Queue = makeQueue(400);

export const jolpica = (path) => jolpicaQueue(() => getJSON(`https://api.jolpi.ca/ergast/f1${path}`));

export const openf1 = (path, params) =>
  openf1Queue(() => getJSON(`https://api.openf1.org/v1${path}${params ? `?${new URLSearchParams(params)}` : ''}`));

export { getJSON };
