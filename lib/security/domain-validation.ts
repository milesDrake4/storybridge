export class DomainValidationError extends Error {
  constructor() {
    super("Citation URL is outside the verified school domain");
    this.name = "DomainValidationError";
  }
}

function canonicalDomain(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\.$/, "");
}

export function normalizeOnDomainHttpsUrl(
  value: string,
  allowedDomain: string,
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DomainValidationError();
  }
  const domain = canonicalDomain(allowedDomain);
  const hostname = canonicalDomain(url.hostname);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.port !== "" && url.port !== "443") ||
    (hostname !== domain && !hostname.endsWith(`.${domain}`))
  ) {
    throw new DomainValidationError();
  }
  url.hostname = hostname;
  url.hash = "";
  url.searchParams.sort();
  return url.toString();
}

export interface CitationUrlResolver {
  resolve(url: string, allowedDomain: string): Promise<string>;
}

export function createCitationUrlResolver(
  fetcher: typeof fetch = fetch,
): CitationUrlResolver {
  return {
    async resolve(value, allowedDomain) {
      let current = normalizeOnDomainHttpsUrl(value, allowedDomain);
      for (let redirect = 0; redirect <= 5; redirect += 1) {
        const response = await fetcher(current, {
          headers: { range: "bytes=0-0" },
          method: "GET",
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
        });
        await response.body?.cancel();
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location || redirect === 5) throw new DomainValidationError();
          current = normalizeOnDomainHttpsUrl(
            new URL(location, current).toString(),
            allowedDomain,
          );
          continue;
        }
        if (!response.ok) throw new Error("Citation URL is unavailable");
        return normalizeOnDomainHttpsUrl(
          response.url || current,
          allowedDomain,
        );
      }
      throw new DomainValidationError();
    },
  };
}
