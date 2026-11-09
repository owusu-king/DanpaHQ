const STAGING_WEB = "https://staging.danpahq.com";
const STAGING_API = "https://api-staging.danpahq.com/api/v1";
const ORGANIZATION_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function onRequest({ request, params }) {
  const { organizationId } = params;
  if (new URL(request.url).origin !== STAGING_WEB
      || typeof organizationId !== "string" || !ORGANIZATION_ID.test(organizationId)) {
    return new Response(null, { status: 404, headers: PRIVATE_HEADERS });
  }
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: { ...PRIVATE_HEADERS, Allow: "GET" } });
  }
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return new Response(null, { status: 401, headers: PRIVATE_HEADERS });
  }

  const headers = new Headers({ Authorization: authorization, "X-Client": "web" });
  const requestId = request.headers.get("X-Request-ID");
  if (requestId) headers.set("X-Request-ID", requestId);

  let upstream;
  try {
    upstream = await fetch(`${STAGING_API}/organizations/${organizationId}/portfolio/?view=home`, {
      headers,
      cache: "no-store",
      redirect: "manual",
    });
  } catch {
    return new Response(null, { status: 502, headers: PRIVATE_HEADERS });
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    return new Response(null, { status: 502, headers: PRIVATE_HEADERS });
  }

  const responseHeaders = new Headers(PRIVATE_HEADERS);
  for (const name of ["Server-Timing", "X-Request-ID", "Retry-After"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  const contentType = upstream.headers.get("Content-Type");
  if (contentType?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return new Response(null, { status: upstream.ok ? 502 : upstream.status, headers: responseHeaders });
  }
  responseHeaders.set("Content-Type", contentType);
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
