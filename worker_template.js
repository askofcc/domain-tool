// Cloudflare Worker serving the batch domain query tool and proxying whois2.php requests

// DNS lookup helper using Cloudflare DoH (JSON API)
async function dnsCheck(domain) {
  try {
    const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=A`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/dns-json' },
      signal: AbortSignal.timeout(2000)
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (data.Answer && data.Answer.length > 0) return true; // Has A/CNAME record
    if (data.Status === 0) { // NOERROR but no A record; check NS record
      const nsUrl = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=NS`;
      const nsRes = await fetch(nsUrl, {
        headers: { 'Accept': 'application/dns-json' },
        signal: AbortSignal.timeout(2000)
      });
      if (nsRes.ok) {
        const nsData = await nsRes.json();
        if (nsData.Answer && nsData.Answer.length > 0) return true; // Has NS records
      }
    }
  } catch (err) {
    // Ignore DNS error, fallback to WHOIS
  }
  return false;
}

const HTML_CONTENT = __HTML_CONTENT__;
const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function normalizeDomains(domains) {
  if (!Array.isArray(domains) || domains.length > 60) return null;
  const out = [];
  for (let i = 0; i < domains.length; i++) {
    if (typeof domains[i] !== "string") return null;
    const domain = domains[i].trim().toLowerCase();
    if (!DOMAIN_RE.test(domain)) return null;
    out.push(domain);
  }
  return out;
}

function appendCookieParts(cookies, value) {
  if (!value) return;
  String(value).split(/,(?=\s*[^;,\s]+=)/).forEach(part => {
    const cookiePart = part.trim().split(";")[0];
    if (cookiePart) cookies.push(cookiePart);
  });
}

async function fetchSessionCookie() {
  const response = await fetch("https://www.quyu.net/domainchecker.php", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    }
  });
  if (!response.ok) throw new Error("Session HTTP " + response.status);

  const cookies = [];
  if (response.headers) {
    if (typeof response.headers.getSetCookie === "function") {
      response.headers.getSetCookie().forEach(value => appendCookieParts(cookies, value));
    } else {
      appendCookieParts(cookies, response.headers.get("set-cookie"));
      for (const [key, value] of response.headers.entries()) {
        if (key.toLowerCase() === "set-cookie") appendCookieParts(cookies, value);
      }
    }
  }
  return Array.from(new Set(cookies)).join("; ");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS headers for local/cross-origin calls
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
    };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // Fetch dynamic session cookies from quyu.net
    if (url.pathname === "/api/session" && request.method === "GET") {
      try {
        const cookieStr = await fetchSessionCookie();

        return new Response(JSON.stringify({ cookie: cookieStr }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // Aggregated query endpoint with DNS pre-filtering (Stateless client-side polling contract)
    if (url.pathname === "/api/check" && request.method === "POST") {
      try {
        const payload = await request.json();
        const domains = normalizeDomains(payload.domains);
        const isPoll = payload.isPoll === true;
        const allowWait = payload.allowWait === true;

        if (Object.prototype.hasOwnProperty.call(payload, "cookie") && typeof payload.cookie !== "string") {
          return new Response(JSON.stringify({ error: "cookie must be a string when provided" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        if (!domains) {
          return new Response(JSON.stringify({ error: "domains must be an array of max 60 valid domain names" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        let sessionCookie = payload.cookie ? payload.cookie.trim() : "";
        if (!sessionCookie) {
          sessionCookie = await fetchSessionCookie();
        }

        const finalResults = {};

        if (!isPoll) {
          // 1. Concurrently prefilter via DNS
          const dnsFlags = await Promise.all(domains.map(dnsCheck));
          const unresolvedDomains = [];

          for (let i = 0; i < domains.length; i++) {
            const domain = domains[i];
            if (dnsFlags[i]) {
              finalResults[domain] = { status: "success", result: "unavailable", domain };
            } else {
              unresolvedDomains.push(domain);
              finalResults[domain] = { status: "success", result: "wait", domain };
            }
          }

          // 2. Query WHOIS via single fetch for unresolved domains (without &wait=wait)
          if (unresolvedDomains.length > 0) {
            try {
              const bodyText = "domain=" + encodeURIComponent(unresolvedDomains.join(",")) + "&ajax=1";
              const response = await fetch("https://www.quyu.net/whois2.php", {
                method: "POST",
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
                  "Referer": "https://www.quyu.net/domainchecker.php",
                  "X-Requested-With": "XMLHttpRequest",
                  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                  "Cookie": sessionCookie,
                  "Accept": "application/json, text/javascript, */*; q=0.01"
                },
                body: bodyText,
              });
              if (response.ok) {
                const initialRes = await response.json();
                (Array.isArray(initialRes) ? initialRes : []).forEach(r => {
                  if (r && r.domain && finalResults[r.domain]) finalResults[r.domain] = r;
                });
              } else {
                unresolvedDomains.forEach(d => { finalResults[d] = { status: "success", result: "timeout", domain: d }; });
              }
            } catch (e) {
              unresolvedDomains.forEach(d => { finalResults[d] = { status: "success", result: "timeout", domain: d }; });
            }
          }
        } else {
          // Polling request: directly query WHOIS with &wait=wait, skipping DNS pre-filter
          try {
            const bodyText = "domain=" + encodeURIComponent(domains.join(",")) + "&ajax=1&wait=wait";
            const response = await fetch("https://www.quyu.net/whois2.php", {
              method: "POST",
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
                "Referer": "https://www.quyu.net/domainchecker.php",
                "X-Requested-With": "XMLHttpRequest",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "Cookie": sessionCookie,
                "Accept": "application/json, text/javascript, */*; q=0.01"
              },
              body: bodyText,
            });
            if (response.ok) {
              const pollRes = await response.json();
              (Array.isArray(pollRes) ? pollRes : []).forEach(r => {
                if (r && r.domain) finalResults[r.domain] = r;
              });
            } else {
              domains.forEach(d => { finalResults[d] = { status: "success", result: "timeout", domain: d }; });
            }
          } catch (e) {
            domains.forEach(d => { finalResults[d] = { status: "success", result: "timeout", domain: d }; });
          }
        }

        const responseData = domains.map(d => {
          const item = finalResults[d] || { status: "success", result: "wait", domain: d };
          if (!allowWait && item.result === "wait") return { status: "success", result: "timeout", domain: d };
          return item;
        });
        return new Response(JSON.stringify(responseData), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // Proxy whois2.php requests to quyu.net (Keep for backward compatibility)
    if (url.pathname === "/whois2.php" && request.method === "POST") {
      try {
        const bodyText = await request.text();
        let sessionCookie = request.headers.get("Cookie") || "";
        if (!sessionCookie) {
          sessionCookie = await fetchSessionCookie();
        }

        const response = await fetch("https://www.quyu.net/whois2.php", {
          method: "POST",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
            "Referer": "https://www.quyu.net/domainchecker.php",
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Cookie": sessionCookie,
            "Accept": "application/json, text/javascript, */*; q=0.01"
          },
          body: bodyText,
        });

        const data = await response.text();

        return new Response(data, {
          status: response.status,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json; charset=utf-8",
          },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 502,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json; charset=utf-8",
          },
        });
      }
    }

    // Serve the single-page application for all other requests (like GET /)
    return new Response(HTML_CONTENT, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  },
};
