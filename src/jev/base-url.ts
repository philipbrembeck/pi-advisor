const JEV_SYSTEM_ONE_PATH = "/v1/systemone";

export interface JevBaseUrlResult {
  baseUrl?: string;
  error?: string;
}

const VERSION_PATH = "/v1";

const IPV4_LOOPBACK_HOST = /^127(?:\.\d{1,3}){3}$/u;

const isLoopbackHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "[::1]" ||
    host === "::1" ||
    IPV4_LOOPBACK_HOST.test(host)
  );
};

const stripContractPath = (pathname: string): string => {
  let path = pathname.replace(/\/+$/u, "");
  if (path.endsWith(JEV_SYSTEM_ONE_PATH)) {
    path = path.slice(0, -JEV_SYSTEM_ONE_PATH.length);
  }
  path = path.replace(/\/+$/u, "");
  if (path.endsWith(VERSION_PATH)) {
    path = path.slice(0, -VERSION_PATH.length);
  }
  return path.replace(/\/+$/u, "");
};

/** Returns the origin plus path prefix of any accepted Base URL spelling. */
export const normalizeJevBaseUrl = (input: string): JevBaseUrlResult => {
  const trimmed = input.trim();
  if (!trimmed) {
    return { error: "Enter the Base URL of a System One–compatible endpoint." };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { error: "That is not a valid URL." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { error: "The Base URL must use https." };
  }
  if (parsed.protocol === "http:" && !isLoopbackHost(parsed.hostname)) {
    return {
      error:
        "Plain http is allowed only for localhost, ::1, and 127.x addresses.",
    };
  }
  if (parsed.username || parsed.password) {
    return { error: "Remove the credentials embedded in the URL." };
  }
  if (parsed.search) {
    return { error: "Remove the query string from the Base URL." };
  }
  if (parsed.hash) {
    return { error: "Remove the fragment from the Base URL." };
  }
  return { baseUrl: `${parsed.origin}${stripContractPath(parsed.pathname)}` };
};

export const jevSystemOneEndpoint = (baseUrl: string): string =>
  `${baseUrl}${JEV_SYSTEM_ONE_PATH}`;
