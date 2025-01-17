import { Router } from 'itty-router';
import { Constants } from './constants';
import { handleStatus } from './status';
import { Strings } from './strings';
import { Flags } from './types';

const router = Router();

const statusRequest = async (request: any, event: FetchEvent, flags: Flags = {}) => {
  const { handle, id, mediaNumber } = request.params;
  const url = new URL(request.url);
  const userAgent = request.headers.get('User-Agent');

  let isBotUA = userAgent.match(/bot|facebook/gi) !== null;

  if (
    url.pathname.match(/\/status(es)?\/\d+\.(mp4|png|jpg)/g) !== null ||
    Constants.DIRECT_MEDIA_DOMAINS.includes(url.hostname)
  ) {
    console.log('Direct media request by extension');
    flags.direct = true;
  }

  if (isBotUA || flags.direct) {
    console.log('Matched bot UA');

    let response: Response;

    let status = await handleStatus(
      id.match(/\d{2,20}/)?.[0],
      parseInt(mediaNumber || 1),
      userAgent,
      flags
    );

    if (status instanceof Response) {
      console.log('handleStatus sent response');
      response = status;
    } else {
      /* Fallback if a person browses to a direct media link with a Tweet without media */
      if (!isBotUA) {
        return Response.redirect(`${Constants.TWITTER_ROOT}/${handle}/status/${id}`, 302);
      }
      console.log('handleStatus sent embed');

      response = new Response(status, {
        headers: Constants.RESPONSE_HEADERS,
        status: 200
      });
    }

    return response;
  } else {
    console.log('Matched human UA');
    return Response.redirect(`${Constants.TWITTER_ROOT}/${handle}/status/${id}`, 302);
  }
};

const statusDirectMediaRequest = async (request: any, event: FetchEvent) => {
  return await statusRequest(request, event, { direct: true });
};

const profileRequest = async (request: any, _event: FetchEvent) => {
  const { handle } = request.params;
  const url = new URL(request.url);

  if (handle.match(/[a-z0-9_]{1,15}/gi)[0] !== handle) {
    return Response.redirect(Constants.REDIRECT_URL, 302);
  } else {
    return Response.redirect(`${Constants.TWITTER_ROOT}${url.pathname}`, 302);
  }
};

/* Direct media handlers */
router.get('/dl/:handle/status/:id', statusDirectMediaRequest);
router.get('/dl/:handle/status/:id/photo/:mediaNumber', statusDirectMediaRequest);
router.get('/dl/:handle/status/:id/video/:mediaNumber', statusDirectMediaRequest);
router.get('/dl/:handle/statuses/:id', statusDirectMediaRequest);
router.get('/dl/:handle/statuses/:id/photo/:mediaNumber', statusDirectMediaRequest);
router.get('/dl/:handle/statuses/:id/video/:mediaNumber', statusDirectMediaRequest);

router.get('/dir/:handle/status/:id', statusDirectMediaRequest);
router.get('/dir/:handle/status/:id/photo/:mediaNumber', statusDirectMediaRequest);
router.get('/dir/:handle/status/:id/video/:mediaNumber', statusDirectMediaRequest);
router.get('/dir/:handle/statuses/:id', statusDirectMediaRequest);
router.get('/dir/:handle/statuses/:id/photo/:mediaNumber', statusDirectMediaRequest);
router.get('/dir/:handle/statuses/:id/video/:mediaNumber', statusDirectMediaRequest);

/* Handlers for Twitter statuses */
router.get('/:handle/status/:id', statusRequest);
router.get('/:handle/status/:id/photo/:mediaNumber', statusRequest);
router.get('/:handle/status/:id/video/:mediaNumber', statusRequest);
router.get('/:handle/statuses/:id', statusRequest);
router.get('/:handle/statuses/:id/photo/:mediaNumber', statusRequest);
router.get('/:handle/statuses/:id/video/:mediaNumber', statusRequest);

router.get('/owoembed', async (request: any) => {
  console.log('oembed hit!');
  const { searchParams } = new URL(request.url);

  /* Fallbacks */
  let text = searchParams.get('text') || 'Twitter';
  let author = searchParams.get('author') || 'dangeredwolf';
  let status = searchParams.get('status') || '1547514042146865153';

  const test = {
    author_name: decodeURIComponent(text),
    author_url: `${Constants.TWITTER_ROOT}/${encodeURIComponent(
      author
    )}/status/${encodeURIComponent(status)}`,
    provider_name: Constants.BRANDING_NAME_DISCORD,
    provider_url: Constants.REDIRECT_URL,
    title: Strings.DEFAULT_AUTHOR_TEXT,
    type: 'link',
    version: '1.0'
  };
  return new Response(JSON.stringify(test), {
    headers: Constants.RESPONSE_HEADERS,
    status: 200
  });
});

router.get('/:handle', profileRequest);
router.get('/:handle/', profileRequest);

router.get('*', async request => {
  return Response.redirect(Constants.REDIRECT_URL, 307);
});

const cacheWrapper = async (event: FetchEvent): Promise<Response> => {
  const { request } = event;
  const userAgent = request.headers.get('User-Agent') || '';
  // https://developers.cloudflare.com/workers/examples/cache-api/
  const url = new URL(request.url);
  const cacheUrl = new URL(
    userAgent.includes('Telegram')
      ? `${request.url}&telegram`
      : userAgent.includes('Discord')
      ? `${request.url}&discord`
      : request.url
  );

  console.log('cacheUrl', cacheUrl);

  const cacheKey = new Request(cacheUrl.toString(), request);
  const cache = caches.default;

  /* Itty-router doesn't seem to like routing file names for some reason */
  if (cacheUrl.pathname === '/robots.txt') {
    return new Response(Constants.ROBOTS_TXT, {
      headers: Constants.RESPONSE_HEADERS,
      status: 200
    });
  }

  switch (request.method) {
    case 'GET':
      let cachedResponse = await cache.match(cacheKey);

      if (cachedResponse) {
        console.log('Cache hit');
        return cachedResponse;
      }

      console.log('Cache miss');

      let response = await router.handle(event.request, event);

      // Store the fetched response as cacheKey
      // Use waitUntil so you can return the response without blocking on
      // writing to cache
      event.waitUntil(cache.put(cacheKey, response.clone()));

      return response;
    /* Telegram sends this from Webpage Bot, and Cloudflare sends it if we purge cache, and we respect it.
       PURGE is not defined in an RFC, but other servers like Nginx apparently use it. */
    case 'PURGE':
      console.log('Purging cache as requested');
      await cache.delete(cacheKey);
      return new Response('', { status: 200 });
    case 'HEAD':
      return new Response('', {
        headers: Constants.RESPONSE_HEADERS,
        status: 200
      });
    case 'OPTIONS':
      return new Response('', {
        headers: {
          allow: Constants.RESPONSE_HEADERS.allow
        },
        status: 204
      });
    default:
      return new Response('', { status: 405 });
  }
};

/*
  Event to receive web requests on Cloudflare Worker
*/
addEventListener('fetch', (event: FetchEvent) => {
  event.respondWith(cacheWrapper(event));
});
